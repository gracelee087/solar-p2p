// Merkle tree over one hour's settlement lines. Each member can check their own line with a short
// proof against the root published in the Solana memo, without seeing anyone else's line.
import { createHash } from 'node:crypto';

const sha = (...parts) => createHash('sha256').update(Buffer.concat(parts)).digest();

// Canonical encoding: keys sorted, so the same line always hashes the same way.
export function canonical(obj) {
  return JSON.stringify(Object.keys(obj).sort().reduce((o, k) => ((o[k] = obj[k]), o), {}));
}
export const leafHash = (line) => sha(Buffer.from([0]), Buffer.from(canonical(line)));
const nodeHash = (a, b) => (Buffer.compare(a, b) <= 0 ? sha(Buffer.from([1]), a, b) : sha(Buffer.from([1]), b, a));

export function buildTree(lines) {
  if (lines.length === 0) throw new Error('empty hour');
  const levels = [lines.map(leafHash)];
  while (levels.at(-1).length > 1) {
    const cur = levels.at(-1);
    const next = [];
    for (let i = 0; i < cur.length; i += 2) next.push(i + 1 < cur.length ? nodeHash(cur[i], cur[i + 1]) : cur[i]);
    levels.push(next);
  }
  return { root: levels.at(-1)[0].toString('hex'), levels };
}

export function proofFor(tree, index) {
  const proof = [];
  for (let l = 0; l < tree.levels.length - 1; l++) {
    const sib = index ^ 1;
    if (sib < tree.levels[l].length) proof.push(tree.levels[l][sib].toString('hex'));
    index >>= 1;
  }
  return proof;
}

export function verifyProof(line, proof, rootHex) {
  let h = leafHash(line);
  for (const p of proof) h = nodeHash(h, Buffer.from(p, 'hex'));
  return h.toString('hex') === rootHex;
}

export const memoFor = (hourStartMs, rootHex, n) => `solar-share:v1|${new Date(hourStartMs).toISOString()}|root=${rootHex}|lines=${n}`;
