// Independent check of one settled hour, from the chain only:
//  1. find the operator's transactions whose memo carries this hour's Merkle root
//  2. recompute the root from the ledger lines; compare with the memo
//  3. sum the test-EUR balance changes inside those transactions; compare with the ledger transfers
// Writes/updates data/chain/<day>/<HH>Z.json. Usage: node scripts/verify-hour.js 2026-06-21 12 [2028]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { matchDay } from '../src/match.js';
import { settleDay } from '../src/settle.js';
import { buildTree, memoFor } from '../src/merkle.js';
import { MEMBERS, COMMUNITIES, ZONES, LOAD_SHAPES } from '../src/community.js';
import { ADJACENT_START } from '../src/rules42c.js';

const [, , dayArg = '2026-06-21', hourArg = '12', rules] = process.argv;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function retry(fn) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= 6 || !/429|Too Many/i.test(String(e))) throw e;
      await sleep(2000 * 2 ** i);
    }
  }
}

const day = JSON.parse(readFileSync(`data/day-${dayArg}.json`));
const dev = JSON.parse(readFileSync('data/devnet.json'));
const world = { members: MEMBERS, communities: COMMUNITIES, zones: ZONES, loadShapes: LOAD_SHAPES };
const hours = settleDay(matchDay(day, world, rules === '2028' ? { ruleDateMs: ADJACENT_START } : {}));
const berlinHour = (ms) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hourCycle: 'h23' }).format(new Date(ms)));
const h = hours.find((x) => berlinHour(x.hourStartMs) === Number(hourArg));
const tree = buildTree(h.lines);
const memo = memoFor(h.hourStartMs, tree.root, h.lines.length);

const conn = new Connection(process.env.SOLANA_RPC ?? clusterApiUrl('devnet'), 'confirmed');
const outFile = `data/chain/${dayArg}/${new Date(h.hourStartMs).toISOString().slice(11, 13)}Z.json`;
const prev = existsSync(outFile) ? JSON.parse(readFileSync(outFile)) : {};
const sigInfos = await retry(() => conn.getSignaturesForAddress(new PublicKey(dev.operator), { limit: 1000 }));
// The record's own signatures are canonical; any other tx with the same memo is a duplicate, reported separately.
const withMemo = sigInfos.filter((s) => !s.err && s.memo?.includes(memo)).reverse();
const mine = prev.signatures ? withMemo.filter((s) => prev.signatures.includes(s.signature)) : withMemo;
const duplicates = withMemo.filter((s) => !mine.includes(s)).map((s) => s.signature);

const owner = {}; // token account -> party id
for (const [c, p] of Object.entries(dev.pools)) owner[p.tokenAccount] = `pool:${c}`;
for (const [id, p] of Object.entries(dev.members)) owner[p.tokenAccount] = id;

const chainDelta = {};
for (const s of mine) {
  const tx = await retry(() => conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' }));
  const keys = tx.transaction.message.staticAccountKeys ?? tx.transaction.message.accountKeys;
  const amt = (list, i) => BigInt(list.find((b) => b.accountIndex === i && b.mint === dev.mint)?.uiTokenAmount.amount ?? '0');
  const idx = new Set([...tx.meta.preTokenBalances, ...tx.meta.postTokenBalances].filter((b) => b.mint === dev.mint).map((b) => b.accountIndex));
  for (const i of idx) {
    const id = owner[keys[i].toBase58()] ?? keys[i].toBase58();
    chainDelta[id] = (chainDelta[id] ?? 0n) + amt(tx.meta.postTokenBalances, i) - amt(tx.meta.preTokenBalances, i);
  }
  await sleep(300);
}

const ledgerDelta = {};
for (const t of h.transfers) {
  ledgerDelta[t.from] = (ledgerDelta[t.from] ?? 0n) - BigInt(t.amountMicro);
  ledgerDelta[t.to] = (ledgerDelta[t.to] ?? 0n) + BigInt(t.amountMicro);
}
const ids = new Set([...Object.keys(ledgerDelta), ...Object.keys(chainDelta)]);
const mismatches = [...ids].filter((id) => (ledgerDelta[id] ?? 0n) !== (chainDelta[id] ?? 0n))
  .map((id) => ({ id, ledger: String(ledgerDelta[id] ?? 0n), chain: String(chainDelta[id] ?? 0n) }));
const expectedTx = Math.ceil(h.transfers.length / 8);

const record = {
  ...prev,
  status: mine.length === expectedTx && mismatches.length === 0 ? 'settled' : mine.length === 0 ? 'not-found' : 'mismatch',
  day: dayArg, hourStartMs: h.hourStartMs, rules: rules === '2028' ? '2028-06-01' : 'slot date',
  root: tree.root, memo, lines: h.lines, transfers: h.transfers, gross: h.gross,
  signatures: mine.map((s) => s.signature), txFound: mine.length, txExpected: expectedTx,
  ledgerMatchesChain: mine.length > 0 && mismatches.length === 0, mismatches, duplicatesOnChain: duplicates,
  verifiedAt: new Date().toISOString(),
};
mkdirSync(`data/chain/${dayArg}`, { recursive: true });
writeFileSync(outFile, JSON.stringify(record, null, 1));
console.log(`${outFile}: status=${record.status} tx ${mine.length}/${expectedTx}, ledger==chain ${record.ledgerMatchesChain}, duplicates ${duplicates.length}`, mismatches);
if (mine[0]) console.log(`https://explorer.solana.com/tx/${mine[0].signature}?cluster=devnet`);
