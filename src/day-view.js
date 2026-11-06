// Everything the Day / Member views show for one day, from the tested engine. Used by the static
// build (June 2026) and by the live API (today / tomorrow).
import { matchDay } from './match.js';
import { settleDay } from './settle.js';
import { buildTree } from './merkle.js';
import { splitLoad, planAgent } from './flex-agent.js';

const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);

export function dayView(raw, world, rulesOpts, agent, rulesKey) {
  const loadOverride = agent ? planAgent(raw, world, splitLoad(raw, world), rulesOpts) : undefined;
  const m = matchDay(raw, world, { ...rulesOpts, loadOverride });
  const hours = settleDay(m);
  const n = raw.slots.length;
  const arr = () => Array(n).fill(0);
  const S = { shared: arr(), cross: arr(), blocked: arr(), imp: arr(), exp: arr() };
  const flows = Array.from({ length: n }, () => ({})); // "from>to": Wh (energy direction)
  const intra = Array.from({ length: n }, () => ({})); // community: Wh shared inside
  const blockedFlows = Array.from({ length: n }, () => ({}));
  for (const l of m.legs) if (l.side === 'buy') { S.shared[l.slot] += l.wh; if (l.tier === 'community') intra[l.slot][l.community] = (intra[l.slot][l.community] ?? 0) + l.wh; }
  for (const o of m.inter) { S.cross[o.slot] += o.wh; const k = `${o.to}>${o.from}`; flows[o.slot][k] = (flows[o.slot][k] ?? 0) + o.wh; }
  for (const b of m.blocked) if (b.kind === 'zone') { S.blocked[b.slot] += b.wh; blockedFlows[b.slot][`${b.from}>${b.to}`] = b.wh; }
  for (const g of m.grid) S[g.side === 'import' ? 'imp' : 'exp'][g.slot] += g.wh;

  const per = {};
  for (const mem of world.members) per[mem.id] = { gen: arr(), load: arr(), buy: arr(), sell: arr(), imp: arr(), exp: arr() };
  raw.slots.forEach((s, i) => {
    for (const mem of world.members) {
      per[mem.id].gen[i] = Math.round(mem.pvKwp * s.ghiWm2 * 0.8 * 0.25);
      per[mem.id].load[i] = loadOverride?.[mem.id]?.[i] ?? Math.round(mem.loadKwh * 1000 * world.loadShapes[mem.profile][i]);
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
  return {
    day: raw.day, rules: rulesKey, kpi,
    slots: m.slots.map((s, i) => ({ t: s.t, price: s.priceEurMWh, local: s.localPriceMicroPerWh, gen: s.genWh, load: s.loadWh, self: s.selfWh, shared: S.shared[i], cross: S.cross[i], blocked: S.blocked[i], imp: S.imp[i], exp: S.exp[i], flows: flows[i], blockedFlows: blockedFlows[i], intra: intra[i] })),
    members: per,
    hours: hours.map((h) => ({ hourStartMs: h.hourStartMs, root: buildTree(h.lines).root, lines: h.lines, transfers: h.transfers, gross: h.gross })),
  };
}
