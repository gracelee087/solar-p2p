// Settle one hour of the demo day on Solana DEVNET: netted test-EUR transfers + Merkle root in a memo.
// Member -> pool payments use the member's SPL delegate approval (operator signs as delegate, chain enforces the limit).
// Usage: node scripts/settle-onchain.js 2026-06-21 12 [2028]   (local Berlin hour)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, clusterApiUrl, sendAndConfirmTransaction } from '@solana/web3.js';
import { createTransferCheckedInstruction, getAccount } from '@solana/spl-token';
import { matchDay } from '../src/match.js';
import { settleDay } from '../src/settle.js';
import { buildTree, memoFor } from '../src/merkle.js';
import { MEMBERS, COMMUNITIES, ZONES, LOAD_SHAPES } from '../src/community.js';
import { ADJACENT_START } from '../src/rules42c.js';

const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const DECIMALS = 6;
const PER_TX = 8; // transfers per transaction (stays under the 1232-byte limit)

const [, , dayArg = '2026-06-21', hourArg = '12', rules] = process.argv;
const day = JSON.parse(readFileSync(`data/day-${dayArg}.json`));
const dev = JSON.parse(readFileSync('data/devnet.json'));
const world = { members: MEMBERS, communities: COMMUNITIES, zones: ZONES, loadShapes: LOAD_SHAPES };
const hours = settleDay(matchDay(day, world, rules === '2028' ? { ruleDateMs: ADJACENT_START } : {}));
const berlinHour = (ms) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hourCycle: 'h23' }).format(new Date(ms)));
const h = hours.find((x) => berlinHour(x.hourStartMs) === Number(hourArg));
if (!h) { console.error('no trades in that hour'); process.exit(1); }

// Each hour is settled exactly once.
const outFile = `data/chain/${dayArg}/${new Date(h.hourStartMs).toISOString().slice(11, 13)}Z.json`;
if ((await import('node:fs')).existsSync(outFile)) { console.error(`already settled: ${outFile}`); process.exit(1); }

const conn = new Connection(process.env.SOLANA_RPC ?? clusterApiUrl('devnet'), 'confirmed');
const kp = (name) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`keys/${name}.json`))));
const operator = kp('operator');
const mint = new PublicKey(dev.mint);
const party = (id) => (id.startsWith('pool:') ? { ...dev.pools[id.slice(5)], key: `pool-${id.slice(5)}` } : { ...dev.members[id], key: `member-${id}` });

const tree = buildTree(h.lines);
const memo = memoFor(h.hourStartMs, tree.root, h.lines.length);

// Balances before, to check ledger == chain afterwards.
const ids = [...new Set(h.transfers.flatMap((t) => [t.from, t.to]))];
const before = Object.fromEntries(await Promise.all(ids.map(async (id) => [id, (await getAccount(conn, new PublicKey(party(id).tokenAccount))).amount])));

const sigs = [];
for (let i = 0; i < h.transfers.length; i += PER_TX) {
  const chunk = h.transfers.slice(i, i + PER_TX);
  const tx = new Transaction();
  const signers = new Map([[operator.publicKey.toBase58(), operator]]);
  for (const t of chunk) {
    const from = party(t.from);
    const to = party(t.to);
    // Members pay via delegate (operator signs). Pools sign their own payouts.
    const authority = t.from.startsWith('pool:') ? kp(from.key) : operator;
    signers.set(authority.publicKey.toBase58(), authority);
    tx.add(createTransferCheckedInstruction(new PublicKey(from.tokenAccount), mint, new PublicKey(to.tokenAccount), authority.publicKey, BigInt(t.amountMicro), DECIMALS));
  }
  const part = `${memo}|part=${i / PER_TX + 1}/${Math.ceil(h.transfers.length / PER_TX)}`;
  tx.add(new TransactionInstruction({ keys: [], programId: MEMO_PROGRAM, data: Buffer.from(part, 'utf8') }));
  sigs.push(await sendAndConfirmTransaction(conn, tx, [...signers.values()], { commitment: 'confirmed' }));
  process.stdout.write('.');
}

// Ledger == chain, to the micro-euro.
const expected = {};
for (const t of h.transfers) { expected[t.from] = (expected[t.from] ?? 0n) - BigInt(t.amountMicro); expected[t.to] = (expected[t.to] ?? 0n) + BigInt(t.amountMicro); }
const mismatches = [];
for (const id of ids) {
  const after = (await getAccount(conn, new PublicKey(party(id).tokenAccount))).amount;
  if (after - before[id] !== expected[id]) mismatches.push({ id, chain: String(after - before[id]), ledger: String(expected[id]) });
}

mkdirSync(`data/chain/${dayArg}`, { recursive: true });
const record = { day: dayArg, hourStartMs: h.hourStartMs, rules: rules === '2028' ? '2028-06-01' : 'slot date', root: tree.root, memo, lines: h.lines, transfers: h.transfers, gross: h.gross, signatures: sigs, ledgerMatchesChain: mismatches.length === 0, mismatches };
writeFileSync(outFile, JSON.stringify(record, null, 1));
console.log(`\nhour ${new Date(h.hourStartMs).toISOString()}: ${h.transfers.length} transfers (gross ${h.gross.payments}) in ${sigs.length} tx`);
console.log(`ledger == chain: ${mismatches.length === 0}`, mismatches);
console.log(`first tx: https://explorer.solana.com/tx/${sigs[0]}?cluster=devnet`);
