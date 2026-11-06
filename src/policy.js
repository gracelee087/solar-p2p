// Member policies (what a member asked for, after a human approved it) and their measured effect.
import { matchDay } from './match.js';
import { FLEX, splitLoad, planAgent } from './flex-agent.js';
import { TARIFF, ctPerKwhToMicroPerWh } from './config.js';
// Note: buying from a neighbour still pays grid charges (TARIFF.gridChargesCt), outside the on-chain settlement.

// policies: { sellFloorCt: { [id]: ct }, flexWindow: { [id]: [startHour, endHour] } }
export function runWithPolicies(day, world, rulesOpts, policies = {}) {
  const flex = Object.fromEntries(Object.entries(FLEX).map(([id, f]) => [id, { ...f, window: policies.flexWindow?.[id] ?? f.window }]));
  const minAskMicroPerWh = Object.fromEntries(Object.entries(policies.sellFloorCt ?? {}).map(([id, ct]) => [id, ctPerKwhToMicroPerWh(ct)]));
  const loadOverride = planAgent(day, world, splitLoad(day, world, flex), { ...rulesOpts, minAskMicroPerWh });
  return matchDay(day, world, { ...rulesOpts, minAskMicroPerWh, loadOverride });
}

// One member's money for the day: local sales and purchases, grid charges on shared energy, and the grid at the assumed tariffs.
export function memberEconomics(match, id) {
  const retail = ctPerKwhToMicroPerWh(TARIFF.retailCt);
  const feedIn = ctPerKwhToMicroPerWh(TARIFF.feedInCt);
  const r = { soldWh: 0, boughtWh: 0, importWh: 0, exportWh: 0, localNetMicro: 0, gridNetMicro: 0 };
  for (const l of match.legs) if (l.memberId === id) {
    if (l.side === 'sell') { r.soldWh += l.wh; r.localNetMicro += l.amountMicro; } else { r.boughtWh += l.wh; r.localNetMicro -= l.amountMicro; r.gridNetMicro -= l.wh * ctPerKwhToMicroPerWh(TARIFF.gridChargesCt); }
  }
  for (const g of match.grid) if (g.memberId === id) {
    if (g.side === 'import') { r.importWh += g.wh; r.gridNetMicro -= g.wh * retail; } else { r.exportWh += g.wh; r.gridNetMicro += g.wh * feedIn; }
  }
  r.totalNetMicro = r.localNetMicro + r.gridNetMicro;
  return r;
}
