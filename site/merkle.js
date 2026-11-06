// Browser twin of src/merkle.js (same encoding), using WebCrypto. Lets anyone recompute a root locally.
const enc = new TextEncoder();
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));
const cat = (...a) => { const o = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const sha = async (u8) => new Uint8Array(await crypto.subtle.digest('SHA-256', u8));
const cmp = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

export const canonical = (obj) => JSON.stringify(Object.keys(obj).sort().reduce((o, k) => ((o[k] = obj[k]), o), {}));
export const leafHash = (line) => sha(cat(new Uint8Array([0]), enc.encode(canonical(line))));
const nodeHash = (a, b) => (cmp(a, b) <= 0 ? sha(cat(new Uint8Array([1]), a, b)) : sha(cat(new Uint8Array([1]), b, a)));

export async function buildTree(lines) {
  const levels = [await Promise.all(lines.map(leafHash))];
  while (levels.at(-1).length > 1) {
    const cur = levels.at(-1);
    const next = [];
    for (let i = 0; i < cur.length; i += 2) next.push(i + 1 < cur.length ? await nodeHash(cur[i], cur[i + 1]) : cur[i]);
    levels.push(next);
  }
  return { root: hex(levels.at(-1)[0]), levels };
}

export function proofFor(tree, index) {
  const proof = [];
  for (let l = 0; l < tree.levels.length - 1; l++) {
    const sib = index ^ 1;
    if (sib < tree.levels[l].length) proof.push(hex(tree.levels[l][sib]));
    index >>= 1;
  }
  return proof;
}

export async function verifyProof(line, proof, rootHex) {
  let h = await leafHash(line);
  for (const p of proof) h = await nodeHash(h, unhex(p));
  return hex(h) === rootHex;
}
