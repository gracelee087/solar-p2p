// One-time Solana DEVNET setup (no real money). Keys are demo keys kept in keys/ (git-ignored).
// In production members would hold their own wallets (passkey); here the server holds them for the demo.
//  1. keypairs: operator (fee payer, mint authority, settlement delegate), one per pool, one per member
//  2. airdrop devnet SOL to the operator
//  3. test-EUR SPL mint (6 decimals), token accounts for pools and members
//  4. fund members with test-EUR and let each member approve a spending limit for the operator (SPL delegate)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Connection, Keypair, LAMPORTS_PER_SOL, clusterApiUrl } from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, approveChecked } from '@solana/spl-token';
import { MEMBERS, COMMUNITIES } from '../src/community.js';

const DECIMALS = 6;
const START_BALANCE = 50_000_000n; // 50 test-EUR per member
const MONTHLY_LIMIT = 30_000_000n; // 30 test-EUR delegate limit per member

// Public devnet RPC rate-limits (429): retry with backoff, and pause between accounts.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function retry(fn) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= 6 || !/429|Too Many|rate limit/i.test(String(e))) throw e;
      console.error(`  rate-limited, retry ${i + 1} in ${2 * 2 ** i}s`);
      await sleep(2000 * 2 ** i);
    }
  }
}

const conn = new Connection(process.env.SOLANA_RPC ?? clusterApiUrl('devnet'), 'confirmed');
mkdirSync('keys', { recursive: true });
const key = (name) => {
  const f = `keys/${name}.json`;
  if (existsSync(f)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(f))));
  const k = Keypair.generate();
  writeFileSync(f, JSON.stringify([...k.secretKey]));
  return k;
};

const operator = key('operator');
console.log('operator', operator.publicKey.toBase58());
let bal = await conn.getBalance(operator.publicKey);
if (bal < 0.5 * LAMPORTS_PER_SOL) {
  try {
    const sig = await conn.requestAirdrop(operator.publicKey, 1 * LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, 'confirmed');
  } catch (e) {
    console.error(`airdrop failed (${e.message}). Fund ${operator.publicKey.toBase58()} via https://faucet.solana.com and re-run.`);
    process.exit(1);
  }
  bal = await conn.getBalance(operator.publicKey);
}
console.log('operator SOL', bal / LAMPORTS_PER_SOL);

const state = existsSync('keys/state.json') ? JSON.parse(readFileSync('keys/state.json')) : {};
if (!state.mint) {
  state.mint = (await createMint(conn, operator, operator.publicKey, null, DECIMALS)).toBase58();
  writeFileSync('keys/state.json', JSON.stringify(state, null, 1));
}
const { PublicKey } = await import('@solana/web3.js');
const mint = new PublicKey(state.mint);
console.log('test-EUR mint', state.mint);

const pub = { cluster: 'devnet', mint: state.mint, operator: operator.publicKey.toBase58(), pools: {}, members: {} };
for (const c of Object.keys(COMMUNITIES)) {
  const k = key(`pool-${c}`);
  const ata = await retry(() => getOrCreateAssociatedTokenAccount(conn, operator, mint, k.publicKey));
  await sleep(500);
  pub.pools[c] = { owner: k.publicKey.toBase58(), tokenAccount: ata.address.toBase58() };
}
for (const m of MEMBERS) {
  const k = key(`member-${m.id}`);
  const ata = await retry(() => getOrCreateAssociatedTokenAccount(conn, operator, mint, k.publicKey));
  if (ata.amount === 0n) await retry(() => mintTo(conn, operator, mint, ata.address, operator, START_BALANCE));
  if (ata.delegatedAmount === 0n) {
    // The member signs this: "the operator may move up to 30 test-EUR from my account". Revocable any time.
    await retry(() => approveChecked(conn, operator, mint, ata.address, operator.publicKey, k, MONTHLY_LIMIT, DECIMALS));
  }
  await sleep(500);
  pub.members[m.id] = { owner: k.publicKey.toBase58(), tokenAccount: ata.address.toBase58() };
  process.stdout.write('.');
}
// Public addresses only (safe to commit): the UI and /verify use these.
writeFileSync('data/devnet.json', JSON.stringify(pub, null, 1));
console.log('\nwrote data/devnet.json');
