// Backtest the flexible-load agent on all June days: no shifting vs simple rule vs agent.
// Usage: node scripts/flex-backtest.js [2028]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { matchDay } from '../src/match.js';
import { FLEX, splitLoad, planSimpleRule, planAgent, flexCost } from '../src/flex-agent.js';
import { MEMBERS, COMMUNITIES, ZONES, LOAD_SHAPES } from '../src/community.js';
import { ADJACENT_START } from '../src/rules42c.js';

const opts = process.argv[2] === '2028' ? { ruleDateMs: ADJACENT_START } : {};
const world = { members: MEMBERS, communities: COMMUNITIES, zones: ZONES, loadShapes: LOAD_SHAPES };
const ids = Object.keys(FLEX);
const days = readdirSync('data').filter((f) => /^day-2026-06-\d\d\.json$/.test(f)).sort();
const tot = { none: { micro: 0, gridWh: 0, localWh: 0 }, rule: { micro: 0, gridWh: 0, localWh: 0 }, agent: { micro: 0, gridWh: 0, localWh: 0 } };
const perDay = [];
for (const f of days) {
  const day = JSON.parse(readFileSync(`data/${f}`));
  const parts = splitLoad(day, world);
  const res = {
    none: flexCost(matchDay(day, world, opts), ids),
    rule: flexCost(matchDay(day, world, { ...opts, loadOverride: planSimpleRule(day, parts) }), ids),
    agent: flexCost(matchDay(day, world, { ...opts, loadOverride: planAgent(day, world, parts, opts) }), ids),
  };
  for (const k of Object.keys(tot)) for (const m of Object.keys(tot[k])) tot[k][m] += res[k][m];
  perDay.push({ day: day.day, ...Object.fromEntries(Object.entries(res).map(([k, v]) => [k, v.micro])) });
}
const eur = (m) => (m / 1e6).toFixed(2);
console.log(`flex members: ${ids.join(', ')} | ${days.length} days | rules ${process.argv[2] ?? '2026'}`);
for (const [k, v] of Object.entries(tot)) console.log(`${k.padEnd(6)} cost €${eur(v.micro)}  grid ${(v.gridWh / 1000).toFixed(0)} kWh  local ${(v.localWh / 1000).toFixed(0)} kWh`);
console.log(`agent vs none: -€${eur(tot.none.micro - tot.agent.micro)} (${((100 * (tot.none.micro - tot.agent.micro)) / tot.none.micro).toFixed(1)}%), vs simple rule: -€${eur(tot.rule.micro - tot.agent.micro)}`);
console.log(`agent worse than simple rule on ${perDay.filter((d) => d.agent > d.rule).length} of ${days.length} days`);
writeFileSync(`data/flex-backtest-${process.argv[2] ?? '2026'}.json`, JSON.stringify({ ids, tot, perDay }, null, 1));
