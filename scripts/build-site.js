// Precompute everything the static site shows, from the same engine the tests cover.
// Output: site/data/month.json, site/data/days/<day>-<rules>.json, site/data/world.json, copies of chain records.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import { dayView } from '../src/day-view.js';
import { MEMBERS, COMMUNITIES, ZONES, LOAD_SHAPES } from '../src/community.js';
import { ADJACENT_START } from '../src/rules42c.js';
import { TARIFF } from '../src/config.js';
import { FLEX } from '../src/flex-agent.js';

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
    const out = dayView(raw, world, opts0, agent, rk);
    const { kpi } = out;
    entry[rk] = { sharedWh: kpi.sharedWh, crossWh: kpi.crossWh, blockedWh: kpi.blockedWh, importWh: kpi.importWh, localMicro: kpi.localMicro };
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
