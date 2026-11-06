// Flexible-load agent: moves the shiftable part of a member's load (ventilation, pre-cooling, pumps…)
// into the quarter-hours where neighbours' solar is spare and the price is lowest.
// Inputs it is allowed to use: the day-ahead wholesale price (published the day before) and the
// irradiance forecast. NOTE: in this simulation the same irradiance series is used as forecast and as
// actual, so forecast error is not modelled (results are an upper bound for this effect).
import { matchDay } from './match.js';
import { TARIFF, localPriceMicroPerWh, ctPerKwhToMicroPerWh, sharedAllInMicroPerWh } from './config.js';
import { zonesMayShare } from './rules42c.js';

export const FLEX = {
  'alt-05': { share: 0.3, window: [6, 22] }, // primary school: ventilation, water heating
  'bie-04': { share: 0.3, window: [6, 22] }, // sports hall: ventilation, pool pump
  'bie-05': { share: 0.3, window: [6, 22] }, // supermarket: pre-cooling
};

const localHour = (ms) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hourCycle: 'h23' }).format(new Date(ms)));

// Split each flex member's load into fixed part + movable energy, with a power cap.
export function splitLoad(day, world, flex = FLEX) {
  const out = {};
  for (const [id, f] of Object.entries(flex)) {
    const m = world.members.find((x) => x.id === id);
    const base = day.slots.map((_, i) => Math.round(m.loadKwh * 1000 * world.loadShapes[m.profile][i]));
    const fixed = base.map((w) => w - Math.round(w * f.share));
    const movable = base.reduce((a, b) => a + b, 0) - fixed.reduce((a, b) => a + b, 0);
    const inWindow = day.slots.map((s) => { const h = localHour(s.t); return h >= f.window[0] && h < f.window[1]; });
    const capWh = Math.ceil(movable / 16); // movable energy can be squeezed into 4 hours at most
    out[id] = { base, fixed, movable, inWindow, capWh };
  }
  return out;
}

// Strategy A: the simple rule — run the movable part evenly 11:00–15:00.
export function planSimpleRule(day, parts) {
  const plan = {};
  for (const [id, p] of Object.entries(parts)) {
    const idx = day.slots.map((s, i) => [i, localHour(s.t)]).filter(([, h]) => h >= 11 && h < 15).map(([i]) => i);
    const load = [...p.fixed];
    const each = Math.floor(p.movable / idx.length);
    idx.forEach((i, k) => { load[i] += each + (k < p.movable - each * idx.length ? 1 : 0); });
    plan[id] = load;
  }
  return plan;
}

// Strategy B: the agent — fill the cheapest slots first, where "cheap" = neighbours' spare solar at the
// local price, else the grid tariff; ties broken by the real day-ahead price (negative prices first).
export function planAgent(day, world, parts, opts = {}) {
  const fixedOnly = Object.fromEntries(Object.entries(parts).map(([id, p]) => [id, p.fixed]));
  const pre = matchDay(day, world, { ...opts, loadOverride: fixedOnly });
  // Spare solar per community per slot (what would otherwise be exported to the grid).
  const spareBy = {};
  for (const g of pre.grid) if (g.side === 'export') {
    const c = world.members.find((m) => m.id === g.memberId).community;
    (spareBy[c] ??= day.slots.map(() => 0))[g.slot] += g.wh;
  }
  const retail = ctPerKwhToMicroPerWh(TARIFF.retailCt);
  const plan = {};
  for (const [id, p] of Object.entries(parts)) {
    const load = [...p.fixed];
    // Only spare solar this member may legally receive under §42c (same community / allowed zone).
    const myC = world.members.find((m) => m.id === id).community;
    const allowed = (i) => Object.keys(spareBy).filter((c) => c === myC ||
      zonesMayShare(world.communities[c].zone, world.communities[myC].zone, opts.ruleDateMs ?? day.slots[i].t, world.zones).ok)
      .sort((a, b) => (a === myC ? -1 : b === myC ? 1 : 0));
    const spare = day.slots.map((_, i) => allowed(i).reduce((a, c) => a + spareBy[c][i], 0));
    // Spare used by this member is gone for the next flex member (own community first).
    const use = (i, wh) => { for (const c of allowed(i)) { const x = Math.min(spareBy[c][i], wh); spareBy[c][i] -= x; wh -= x; if (!wh) break; } };
    const cost = (i) => (spare[i] > 0 ? sharedAllInMicroPerWh(localPriceMicroPerWh(day.slots[i].priceEurMWh)) : retail) * 1e6 + day.slots[i].priceEurMWh;
    const order = day.slots.map((_, i) => i).filter((i) => p.inWindow[i]).sort((a, b) => cost(a) - cost(b) || a - b);
    let left = p.movable;
    for (const i of order) {
      if (left === 0) break;
      // prefer to use only the spare solar in this slot; overflow goes to later passes
      const room = Math.min(p.capWh, spare[i] > 0 ? spare[i] : p.capWh, left);
      load[i] += room; left -= room; use(i, Math.min(room, spare[i])); spare[i] = Math.max(0, spare[i] - room);
    }
    for (const i of order) { if (left === 0) break; const room = Math.min(p.capWh - (load[i] - p.fixed[i]), left); if (room > 0) { load[i] += room; left -= room; } }
    plan[id] = load;
  }
  return plan;
}

// Cost for the flex members over a day: local purchases (energy + grid charges) + grid import at the retail tariff.
export function flexCost(match, ids) {
  const retail = ctPerKwhToMicroPerWh(TARIFF.retailCt);
  let micro = 0, gridWh = 0, localWh = 0;
  for (const l of match.legs) if (ids.includes(l.memberId) && l.side === 'buy') { micro += l.amountMicro + l.wh * ctPerKwhToMicroPerWh(TARIFF.gridChargesCt); localWh += l.wh; }
  for (const g of match.grid) if (ids.includes(g.memberId) && g.side === 'import') { micro += g.wh * retail; gridWh += g.wh; }
  return { micro, gridWh, localWh };
}
