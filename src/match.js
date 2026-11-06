// 15-minute matching: own roof -> own community -> other communities (only where §42c allows) -> grid.
import { PV_PERFORMANCE_RATIO, localPriceMicroPerWh } from './config.js';
import { memberEligible, zonesMayShare } from './rules42c.js';

// Split `total` integer units in proportion to integer `weights` (largest remainder). Sums exactly to total.
export function apportion(weights, total) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0 || total === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (w * total) / sum);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k++, left--) out[order[k][1]]++;
  return out;
}

/**
 * @param day       data/day-*.json content (slots with t, priceEurMWh, ghiWm2)
 * @param world     { members, communities, zones, loadShapes }
 * @param opts      { ruleDateMs?: date used for §42c rules (default: the slot time),
 *                    minAskMicroPerWh?: { [memberId]: number } seller floors set by the agent/policy,
 *                    loadOverride?: { [memberId]: number[] } Wh per slot (e.g. after the flex agent moved load) }
 */
export function matchDay(day, world, opts = {}) {
  const { members, communities, zones, loadShapes } = world;
  const minAsk = opts.minAskMicroPerWh ?? {};
  const legs = []; // member <-> own community pool, per slot
  const inter = []; // community pool -> community pool, per slot
  const grid = []; // energy to/from the public grid supplier (not settled here)
  const blocked = []; // sharing that the rules prevented
  const slots = [];
  const cids = Object.keys(communities).sort();

  day.slots.forEach((s, i) => {
    const ruleAt = opts.ruleDateMs ?? s.t;
    const price = localPriceMicroPerWh(s.priceEurMWh);
    const st = members.map((m) => {
      const genWh = Math.round(m.pvKwp * s.ghiWm2 * PV_PERFORMANCE_RATIO * 0.25);
      const loadWh = opts.loadOverride?.[m.id]?.[i] ?? Math.round(m.loadKwh * 1000 * loadShapes[m.profile][i]);
      const self = Math.min(genWh, loadWh);
      const elig = memberEligible(m, ruleAt);
      if (!elig.ok) blocked.push({ slot: i, kind: 'member', memberId: m.id, wh: genWh + loadWh - 2 * self, reason: elig.reason });
      const offers = elig.ok && (minAsk[m.id] ?? 0) <= price;
      return {
        m, genWh, loadWh, selfWh: self,
        surplus: elig.ok && offers ? genWh - self : 0,
        deficit: elig.ok ? loadWh - self : 0,
        exportOnly: genWh - self - (elig.ok && offers ? genWh - self : 0),
        importOnly: elig.ok ? 0 : loadWh - self,
      };
    });
    const byC = Object.fromEntries(cids.map((c) => [c, st.filter((x) => x.m.community === c)]));

    const push = (x, side, wh, tier, counterparty) => {
      if (wh <= 0) return;
      legs.push({ slot: i, t: s.t, memberId: x.m.id, community: x.m.community, side, wh, priceMicroPerWh: price, amountMicro: wh * price, tier, counterparty });
    };

    // Tier 1: inside each community.
    for (const c of cids) {
      const xs = byC[c];
      const S = xs.reduce((a, x) => a + x.surplus, 0);
      const D = xs.reduce((a, x) => a + x.deficit, 0);
      const M = Math.min(S, D);
      apportion(xs.map((x) => x.surplus), M).forEach((wh, k) => { push(xs[k], 'sell', wh, 'community', `pool:${c}`); xs[k].surplus -= wh; });
      apportion(xs.map((x) => x.deficit), M).forEach((wh, k) => { push(xs[k], 'buy', wh, 'community', `pool:${c}`); xs[k].deficit -= wh; });
    }

    // Tier 2: between communities, only where allowed.
    const rs = Object.fromEntries(cids.map((c) => [c, byC[c].reduce((a, x) => a + x.surplus, 0)]));
    const rd = Object.fromEntries(cids.map((c) => [c, byC[c].reduce((a, x) => a + x.deficit, 0)]));
    const out = Object.fromEntries(cids.map((c) => [c, 0]));
    const inn = Object.fromEntries(cids.map((c) => [c, 0]));
    const denied = [];
    for (const b of cids) {
      for (const sc of cids) {
        if (sc === b || rs[sc] === 0 || rd[b] === 0) continue;
        const ok = zonesMayShare(communities[sc].zone, communities[b].zone, ruleAt, zones);
        if (!ok.ok) { denied.push({ sc, b, reason: ok.reason }); continue; }
        const wh = Math.min(rs[sc], rd[b]);
        rs[sc] -= wh; rd[b] -= wh; out[sc] += wh; inn[b] += wh;
        inter.push({ slot: i, t: s.t, from: b, to: sc, wh, priceMicroPerWh: price, amountMicro: wh * price }); // b's pool pays sc's pool
      }
    }
    // What the rules blocked: energy that WOULD have been shared after all allowed sharing, counted once
    // (each remaining surplus and deficit can be used only once, like a real match).
    const bs = { ...rs }, bd = { ...rd };
    for (const { sc, b, reason } of denied) {
      const wh = Math.min(bs[sc], bd[b]);
      if (wh > 0) { bs[sc] -= wh; bd[b] -= wh; blocked.push({ slot: i, kind: 'zone', from: sc, to: b, wh, reason }); }
    }
    for (const c of cids) {
      const xs = byC[c];
      apportion(xs.map((x) => x.surplus), out[c]).forEach((wh, k) => { push(xs[k], 'sell', wh, 'neighbour', `pool:${c}`); xs[k].surplus -= wh; });
      apportion(xs.map((x) => x.deficit), inn[c]).forEach((wh, k) => { push(xs[k], 'buy', wh, 'neighbour', `pool:${c}`); xs[k].deficit -= wh; });
    }

    // Tier 3: grid.
    for (const x of st) {
      const exp = x.surplus + x.exportOnly;
      const imp = x.deficit + x.importOnly;
      if (exp > 0) grid.push({ slot: i, memberId: x.m.id, side: 'export', wh: exp });
      if (imp > 0) grid.push({ slot: i, memberId: x.m.id, side: 'import', wh: imp });
    }
    slots.push({
      i, t: s.t, priceEurMWh: s.priceEurMWh, localPriceMicroPerWh: price,
      genWh: st.reduce((a, x) => a + x.genWh, 0), loadWh: st.reduce((a, x) => a + x.loadWh, 0),
      selfWh: st.reduce((a, x) => a + x.selfWh, 0),
    });
  });
  return { slots, legs, inter, grid, blocked };
}
