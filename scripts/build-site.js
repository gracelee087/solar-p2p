// Precompute everything the static site shows, from the same engine the tests cover.
// Output: site/data/month.json, site/data/days/<day>-<rules>.json, site/data/world.json, copies of chain records.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import { matchDay } from '../src/match.js';
import { settleDay } from '../src/settle.js';
import { buildTree } from '../src/merkle.js';
import { MEMBERS, COMMUNITIES, ZONES, LOAD_SHAPES } from '../src/community.js';
import { ADJACENT_START } from '../src/rules42c.js';
import { TARIFF } from '../src/config.js';
import { FLEX, splitLoad, planAgent } from '../src/flex-agent.js';

const world = { members: MEMBERS, communities: COMMUNITIES, zones: ZONES, loadShapes: LOAD_SHAPES };
const days = readdirSync('data').filter((f) => /^day-2026-06-\d\d\.json$/.test(f)).sort().map((f) => f.slice(4, 14));
const RULES = { '2026': {}, '2028': { ruleDateMs: ADJACENT_START } };
mkdirSync('site/data/days', { recursive: true });

const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
const month = [];
for (const d of days) {
  const raw = JSON.parse(readFileSync(`data/day-${d}.json`));
  const entry = { day: d, ghiKwhM2: +(sum(raw.slots, (s) => s.ghiWm2) / 4000).toFixed(2), negSlots: raw.slots.filter((s) => s.priceEurMWh < 0).length };
  for (const [rk0, opts0] of Object.entries(RULES)) for (const agent of [false, true]) {
    const rk = agent ? `${rk0}-agent` : rk0;
    const loadOverride = agent ? planAgent(raw, world, splitLoad(raw, world), opts0) : undefined;
    const opts = { ...opts0, loadOverride };
    const m = matchDay(raw, world, opts);
    const hours = settleDay(m);
    const n = raw.slots.length;
    const arr = () => Array(n).fill(0);
    const S = { shared: arr(), cross: arr(), blocked: arr(), imp: arr(), exp: arr() };
    const flows = Array.from({ length: n }, () => ({})); // "from>to": Wh (energy direction)
    const intra = Array.from({ length: n }, () => ({})); // community: Wh shared inside
    for (const l of m.legs) if (l.side === 'buy') { S.shared[l.slot] += l.wh; if (l.tier === 'community') intra[l.slot][l.community] = (intra[l.slot][l.community] ?? 0) + l.wh; }
    for (const o of m.inter) { S.cross[o.slot] += o.wh; const k = `${o.to}>${o.from}`; flows[o.slot][k] = (flows[o.slot][k] ?? 0) + o.wh; }
    const blockedFlows = Array.from({ length: n }, () => ({}));
    for (const b of m.blocked) if (b.kind === 'zone') { S.blocked[b.slot] += b.wh; blockedFlows[b.slot][`${b.from}>${b.to}`] = b.wh; }
    for (const g of m.grid) S[g.side === 'import' ? 'imp' : 'exp'][g.slot] += g.wh;

    const per = {};
    for (const mem of MEMBERS) per[mem.id] = { gen: arr(), load: arr(), buy: arr(), sell: arr(), imp: arr(), exp: arr() };
    raw.slots.forEach((s, i) => {
      for (const mem of MEMBERS) {
        per[mem.id].gen[i] = Math.round(mem.pvKwp * s.ghiWm2 * 0.8 * 0.25);
        per[mem.id].load[i] = loadOverride?.[mem.id]?.[i] ?? Math.round(mem.loadKwh * 1000 * LOAD_SHAPES[mem.profile][i]);
      }
    });
    for (const l of m.legs) per[l.memberId][l.side][l.slot] += l.wh;
    for (const g of m.grid) per[g.memberId][g.side === 'import' ? 'imp' : 'exp'][g.slot] += g.wh;

    const kpi = {
      genWh: sum(m.slots, (s) => s.genWh), loadWh: sum(m.slots, (s) => s.loadWh), selfWh: sum(m.slots, (s) => s.selfWh),
      sharedWh: sum(S.shared, (x) => x), crossWh: sum(S.cross, (x) => x), blockedWh: sum(S.blocked, (x) => x),
      importWh: sum(S.imp, (x) => x), exportWh: sum(S.exp, (x) => x),
      localMicro: sum(m.legs.filter((l) => l.side === 'buy'), (l) => l.amountMicro),
      grossPayments: sum(hours, (h) => h.gross.payments), transfers: sum(hours, (h) => h.transfers.length), hours: hours.length,
      memberRejections: [...new Map(m.blocked.filter((b) => b.kind === 'member').map((b) => [b.memberId, b.reason])).entries()],
    };
    entry[rk] = { sharedWh: kpi.sharedWh, crossWh: kpi.crossWh, blockedWh: kpi.blockedWh, importWh: kpi.importWh, localMicro: kpi.localMicro };
    const out = {
      day: d, rules: rk, kpi,
      slots: m.slots.map((s, i) => ({ t: s.t, price: s.priceEurMWh, local: s.localPriceMicroPerWh, gen: s.genWh, load: s.loadWh, self: s.selfWh, shared: S.shared[i], cross: S.cross[i], blocked: S.blocked[i], imp: S.imp[i], exp: S.exp[i], flows: flows[i], blockedFlows: blockedFlows[i], intra: intra[i] })),
      members: per,
      hours: hours.map((h) => ({ hourStartMs: h.hourStartMs, root: buildTree(h.lines).root, lines: h.lines, transfers: h.transfers, gross: h.gross })),
    };
    writeFileSync(`site/data/days/${d}-${rk}.json`, JSON.stringify(out));
  }
  month.push(entry);
}
writeFileSync('site/data/month.json', JSON.stringify(month));
writeFileSync('site/data/world.json', JSON.stringify({
  members: MEMBERS, communities: COMMUNITIES, zones: ZONES, tariff: TARIFF, flex: FLEX,
  flexBacktest: Object.fromEntries(['2026', '2028'].filter((r) => existsSync(`data/flex-backtest-${r}.json`)).map((r) => [r, JSON.parse(readFileSync(`data/flex-backtest-${r}.json`)).tot])),
  devnet: existsSync('data/devnet.json') ? JSON.parse(readFileSync('data/devnet.json')) : null,
  sources: JSON.parse(readFileSync(`data/day-${days[0]}.json`)).sources,
}));

// Settled hours on devnet (records written by settle-onchain / verify-hour).
mkdirSync('site/data/chain', { recursive: true });
const chain = [];
if (existsSync('data/chain')) {
  for (const d of readdirSync('data/chain')) for (const f of readdirSync(`data/chain/${d}`)) {
    copyFileSync(`data/chain/${d}/${f}`, `site/data/chain/${d}-${f}`);
    const r = JSON.parse(readFileSync(`data/chain/${d}/${f}`));
    chain.push({ file: `${d}-${f}`, day: d, hourStartMs: r.hourStartMs, status: r.status, rules: r.rules, txs: r.signatures?.length ?? 0 });
  }
}
writeFileSync('site/data/chain/index.json', JSON.stringify(chain.sort((a, b) => a.hourStartMs - b.hourStartMs)));
console.log(`built ${days.length} days x ${Object.keys(RULES).length} rule sets x agent off/on, ${chain.length} settled hours`);
