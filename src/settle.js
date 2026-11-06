// Hourly settlement with netting. Amounts are integer micro-EUR (the test-EUR token has 6 decimals).
// Positive = receives money, negative = pays.

// Turn net positions into the fewest transfers (greedy largest debtor -> largest creditor).
export function minimalTransfers(positions) {
  const debt = Object.entries(positions).filter(([, v]) => v < 0).map(([k, v]) => [k, -v]);
  const cred = Object.entries(positions).filter(([, v]) => v > 0).map(([k, v]) => [k, v]);
  const sortDesc = (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1);
  const transfers = [];
  while (debt.length && cred.length) {
    debt.sort(sortDesc); cred.sort(sortDesc);
    const x = Math.min(debt[0][1], cred[0][1]);
    transfers.push({ from: debt[0][0], to: cred[0][0], amountMicro: x });
    debt[0][1] -= x; cred[0][1] -= x;
    if (debt[0][1] === 0) debt.shift();
    if (cred[0][1] === 0) cred.shift();
  }
  return transfers;
}

/**
 * @param legs   member legs of one hour (from matchDay)
 * @param inter  pool-to-pool obligations of one hour
 * @returns { lines, transfers, gross, poolCheck }
 *   lines:     one per member and per pool (net for the hour) — these become Merkle leaves
 *   transfers: what actually moves on-chain (member<->own pool, then netted pool<->pool)
 */
export function settleHour(hourStartMs, legs, inter) {
  const member = new Map();
  for (const l of legs) {
    const r = member.get(l.memberId) ?? { kind: 'member', id: l.memberId, community: l.community, whBought: 0, whSold: 0, netMicro: 0 };
    if (l.side === 'buy') { r.whBought += l.wh; r.netMicro -= l.amountMicro; } else { r.whSold += l.wh; r.netMicro += l.amountMicro; }
    member.set(l.memberId, r);
  }
  const memberLines = [...member.values()].sort((a, b) => (a.id < b.id ? -1 : 1));

  // Pool position from members (money in from buyers, out to sellers) and from other pools.
  const pool = new Map();
  const P = (c) => pool.get(c) ?? pool.set(c, { kind: 'pool', id: `pool:${c}`, fromMembersMicro: 0, interMicro: 0 }).get(c);
  for (const r of memberLines) P(r.community).fromMembersMicro -= r.netMicro;
  for (const o of inter) { P(o.from).interMicro -= o.amountMicro; P(o.to).interMicro += o.amountMicro; }
  const poolLines = [...pool.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  // Each pool must end at zero: what it collects from its members equals what it owes other pools.
  const poolCheck = poolLines.map((p) => ({ id: p.id, residualMicro: p.fromMembersMicro + p.interMicro }));

  // Order matters on-chain (pools start empty): 1) members pay their pool, 2) pools settle with
  // each other (netted), 3) pools pay their sellers. No pool balance goes below zero at any step.
  const transfers = [];
  for (const r of memberLines) {
    if (r.netMicro < 0) transfers.push({ from: r.id, to: `pool:${r.community}`, amountMicro: -r.netMicro, type: 'member' });
  }
  const interPos = {};
  for (const o of inter) {
    interPos[`pool:${o.from}`] = (interPos[`pool:${o.from}`] ?? 0) - o.amountMicro;
    interPos[`pool:${o.to}`] = (interPos[`pool:${o.to}`] ?? 0) + o.amountMicro;
  }
  for (const t of minimalTransfers(interPos)) transfers.push({ ...t, type: 'pool' });
  for (const r of memberLines) {
    if (r.netMicro > 0) transfers.push({ from: `pool:${r.community}`, to: r.id, amountMicro: r.netMicro, type: 'member' });
  }

  // Without netting, every 15-min leg and every pool obligation would be its own payment.
  const gross = { payments: legs.length + inter.length, micro: legs.reduce((a, l) => a + l.amountMicro, 0) + inter.reduce((a, o) => a + o.amountMicro, 0) };
  return { hourStartMs, lines: [...memberLines, ...poolLines], transfers, gross, poolCheck };
}

export function settleDay(match) {
  const hours = new Map();
  const H = (t) => { const h = t - (t % 3600e3); return hours.get(h) ?? hours.set(h, { legs: [], inter: [] }).get(h); };
  for (const l of match.legs) H(l.t).legs.push(l);
  for (const o of match.inter) H(o.t).inter.push(o);
  return [...hours.entries()].sort((a, b) => a[0] - b[0]).map(([h, v]) => settleHour(h, v.legs, v.inter));
}
