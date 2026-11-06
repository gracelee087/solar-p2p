// Local server: static site/ + a small API for the Claude agent and human approvals.
// Usage: node --env-file-if-exists=.env scripts/serve.js [port]
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { MEMBERS, COMMUNITIES, ZONES, LOAD_SHAPES } from '../src/community.js';
import { ADJACENT_START } from '../src/rules42c.js';

const root = join(process.cwd(), 'site');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const port = Number(process.argv[2] ?? 5173);
const world = { members: MEMBERS, communities: COMMUNITIES, zones: ZONES, loadShapes: LOAD_SHAPES };
const POLICIES = 'data/policies.json';
const loadPolicies = () => (existsSync(POLICIES) ? JSON.parse(readFileSync(POLICIES)) : {});

const json = (res, code, obj) => res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(obj));
async function body(req) {
  let s = '';
  for await (const c of req) { s += c; if (s.length > 20000) throw new Error('body too large'); }
  return JSON.parse(s || '{}');
}
const ctxFrom = (b) => {
  if (!/^2026-06-\d\d$/.test(b.day ?? '') || !existsSync(`data/day-${b.day}.json`)) throw new Error('bad day');
  if (!MEMBERS.some((m) => m.id === b.memberId)) throw new Error('bad member');
  return { world, day: JSON.parse(readFileSync(`data/day-${b.day}.json`)), rulesOpts: b.rules === '2028' ? { ruleDateMs: ADJACENT_START } : {}, policies: loadPolicies(), memberId: b.memberId };
};

async function api(req, res, path) {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
  const b = await body(req);
  if (path === '/api/agent') {
    if (!process.env.ANTHROPIC_API_KEY) return json(res, 503, { error: 'ANTHROPIC_API_KEY is not set on the server' });
    if (typeof b.text !== 'string' || !b.text.trim() || b.text.length > 500) return json(res, 400, { error: 'text 1-500 chars' });
    const { askAgent } = await import('../src/claude-agent.js');
    return json(res, 200, await askAgent(ctxFrom(b), b.text));
  }
  if (path === '/api/approve') {
    const p = b.proposal ?? {};
    if (!MEMBERS.some((m) => m.id === p.member_id)) return json(res, 400, { error: 'bad member' });
    const pol = loadPolicies();
    if (p.type === 'sell_floor') (pol.sellFloorCt ??= {})[p.member_id] = Number(p.min_price_ct);
    else if (p.type === 'flex_window') (pol.flexWindow ??= {})[p.member_id] = [Number(p.start_hour), Number(p.end_hour)];
    else if (p.type === 'spending_limit') {
      const { setSpendingLimit } = await import('./limit.js');
      const sig = await setSpendingLimit(p.member_id, Number(p.limit_eur));
      return json(res, 200, { applied: p, signature: sig, explorer: `https://explorer.solana.com/tx/${sig}?cluster=devnet` });
    } else return json(res, 400, { error: 'unknown proposal type' });
    await writeFile(POLICIES, JSON.stringify(pol, null, 1));
    return json(res, 200, { applied: p, policies: pol });
  }
  return json(res, 404, { error: 'unknown api' });
}

createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  if (path.startsWith('/api/')) {
    try { return await api(req, res, path); } catch (e) { return json(res, 400, { error: String(e.message ?? e).slice(0, 300) }); }
  }
  const p = normalize(join(root, path === '/' ? 'index.html' : path));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  let data;
  try { data = await readFile(p); } catch { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'content-type': (types[extname(p)] ?? 'application/octet-stream') + '; charset=utf-8' }).end(data);
}).listen(port, () => console.log(`http://localhost:${port}  (agent API ${process.env.ANTHROPIC_API_KEY ? 'on' : 'off: no ANTHROPIC_API_KEY'})`));
