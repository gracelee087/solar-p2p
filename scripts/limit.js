// Re-approve a member's SPL delegate limit on devnet (the member signs; demo keys are server-held).
import { readFileSync } from 'node:fs';
import { Connection, Keypair, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { approveChecked } from '@solana/spl-token';

export async function setSpendingLimit(memberId, limitEur) {
  if (!(limitEur >= 0 && limitEur <= 200)) throw new Error('limit 0-200');
  const dev = JSON.parse(readFileSync('data/devnet.json'));
  // Demo keys: files in keys/ locally, or DEVNET_KEYS_JSON ({ name: [secret bytes] }) on a hosted server.
  const env = process.env.DEVNET_KEYS_JSON ? JSON.parse(process.env.DEVNET_KEYS_JSON) : null;
  const kp = (n) => Keypair.fromSecretKey(Uint8Array.from(env ? env[n] : JSON.parse(readFileSync(`keys/${n}.json`))));
  const operator = kp('operator');
  const member = kp(`member-${memberId}`);
  const conn = new Connection(process.env.SOLANA_RPC ?? clusterApiUrl('devnet'), 'confirmed');
  return approveChecked(conn, operator, new PublicKey(dev.mint), new PublicKey(dev.members[memberId].tokenAccount), operator.publicKey, member, BigInt(Math.round(limitEur * 1e6)), 6);
}
