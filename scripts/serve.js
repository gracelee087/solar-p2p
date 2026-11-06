// Local server: static site/ + a small API for the Claude agent and human approvals.
// Usage: node scripts/serve.js [port]   (reads .env itself)
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { MEMBERS, COMMUNITIES, ZONES, LOAD_SHAPES } from '../src/community.js';
import { ADJACENT_START } from '../src/rules42c.js';

// .env wins over variables already set in the shell (a stale global ANTHROPIC_API_KEY broke this once).
if (existsSync('.env')) for (const line of readFileSync('.env', 'utf8').split(String.fromCharCode(10))) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) process.env[m[1]] = m[2];
}
const root = join(process.cwd(), 'site');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const port = Number(process.argv[2] ?? process.env.PORT ?? 5173);
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

// Live: today / tomorrow from real published day-ahead prices + live solar forecast (cached 15 min).
const liveCache = new Map();
async function live(url) {
  const q = new URL(url, 'http://x').searchParams;
  const which = q.get('which') === 'tomorrow' ? 'tomorrow' : 'today';
  const { fetchDay, berlinDate } = await import('../src/fetch-data.js');
  const { dayView } = await import('../src/day-view.js');
  const day = berlinDate(Date.now() + (which === 'tomorrow' ? 86400e3 : 0));
  let c = liveCache.get(day);
  if (!c || Date.now() - c.at > 15 * 60e3) {
    let raw = null;
    for (let i = 0; i < 3 && !raw; i++) {
      try { raw = await fetchDay(day, { source: 'forecast' }); } catch (e) { if (i < 2) await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
    }
    // Shared hosting IPs can be rate-limited by the free weather API: fall back to the last good fetch,
    // then to a snapshot fetched earlier (data/live/<day>.json). The view always shows when data was fetched.
    if (!raw && c) raw = c.raw;
    if (!raw && existsSync(`data/live/${day}.json`)) raw = JSON.parse(readFileSync(`data/live/${day}.json`));
    if (!raw) throw new Error('live data temporarily unavailable (weather API rate limit), try again in a minute');
    c = { at: Date.now(), raw };
    liveCache.set(day, c);
  }
  const rules = q.get('rules') === '2028' ? '2028' : '2026';
  const agent = q.get('agent') === '1';
  const view = dayView(c.raw, world, rules === '2028' ? { ruleDateMs: ADJACENT_START } : {}, agent, rules + (agent ? '-agent' : ''));
  return { ...view, live: { which, fetchedAt: c.raw.fetchedAt, sources: c.raw.sources } };
}

// Protection for anything that costs money (Claude calls) or changes state (approvals, on-chain txs):
// a demo password (DEMO_PASSWORD) and rate limits per IP and overall.
const LIMITS = { perIp10min: 5, perHour: 30, perDay: 150 };
const hits = [];
function guard(req) {
  const pw = process.env.DEMO_PASSWORD;
  if (!pw) return 'Agent is disabled on this server (no DEMO_PASSWORD set).';
  if (req.headers['x-demo-password'] !== pw) return 'Demo password required.';
  const now = Date.now();
  while (hits.length && now - hits[0].t > 86400e3) hits.shift();
  const ip = (req.headers['fly-client-ip'] ?? req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
  if (hits.filter((h) => h.ip === ip && now - h.t < 600e3).length >= LIMITS.perIp10min) return 'Too many requests from you, try again in 10 minutes.';
  if (hits.filter((h) => now - h.t < 3600e3).length >= LIMITS.perHour) return 'Hourly demo limit reached, try again later.';
  if (hits.length >= LIMITS.perDay) return 'Daily demo limit reached.';
  hits.push({ t: now, ip });
  return null;
}

async function api(req, res, path) {
  if (req.method === 'GET' && path === '/api/live') return json(res, 200, await live(req.url));
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
  const denied = guard(req);
  if (denied) return json(res, denied.startsWith('Demo password') ? 401 : 429, { error: denied });
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
