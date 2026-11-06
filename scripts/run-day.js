// Run one real day through matching + hourly settlement and print a summary.
// Usage: node scripts/run-day.js 2026-06-21 [2028]   (second arg: apply 2028-06-01 §42c rules)
import { readFileSync } from 'node:fs';
import { matchDay } from '../src/match.js';
import { settleDay } from '../src/settle.js';
import { buildTree, memoFor } from '../src/merkle.js';
import { MEMBERS, COMMUNITIES, ZONES, LOAD_SHAPES } from '../src/community.js';
import { ADJACENT_START } from '../src/rules42c.js';

const [, , dayArg = '2026-06-21', rules] = process.argv;
const day = JSON.parse(readFileSync(`data/day-${dayArg}.json`));
const world = { members: MEMBERS, communities: COMMUNITIES, zones: ZONES, loadShapes: LOAD_SHAPES };
const m = matchDay(day, world, rules === '2028' ? { ruleDateMs: ADJACENT_START } : {});
const hours = settleDay(m);

const kwh = (wh) => (wh / 1000).toFixed(1);
const eur = (micro) => (micro / 1e6).toFixed(2);
const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
const gen = sum(m.slots, (s) => s.genWh);
const load = sum(m.slots, (s) => s.loadWh);
const self = sum(m.slots, (s) => s.selfWh);
const shared = sum(m.legs.filter((l) => l.side === 'buy'), (l) => l.wh);
const neighbour = sum(m.legs.filter((l) => l.side === 'buy' && l.tier === 'neighbour'), (l) => l.wh);
const blockedZone = sum(m.blocked.filter((b) => b.kind === 'zone'), (b) => b.wh);

console.log(`day ${day.day} | rules ${rules === '2028' ? '2028-06-01' : 'slot date'}`);
console.log(`generation ${kwh(gen)} kWh, load ${kwh(load)} kWh, own use ${kwh(self)} kWh`);
console.log(`shared locally ${kwh(shared)} kWh (between communities ${kwh(neighbour)} kWh), blocked by zone rule ${kwh(blockedZone)} kWh`);
console.log(`grid import ${kwh(sum(m.grid.filter((g) => g.side === 'import'), (g) => g.wh))} kWh, export ${kwh(sum(m.grid.filter((g) => g.side === 'export'), (g) => g.wh))} kWh`);
console.log(`local money moved ${eur(sum(m.legs.filter((l) => l.side === 'buy'), (l) => l.amountMicro))} EUR`);
console.log(`payments: gross ${sum(hours, (h) => h.gross.payments)} (every 15-min leg) -> settled ${sum(hours, (h) => h.transfers.length)} transfers in ${hours.length} hourly batches`);
const h = hours.find((x) => x.transfers.some((t) => t.type === 'pool')) ?? hours[0];
if (h) console.log(`example memo: ${memoFor(h.hourStartMs, buildTree(h.lines).root, h.lines.length)}`);
