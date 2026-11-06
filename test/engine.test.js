import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { apportion, matchDay } from '../src/match.js';
import { settleDay } from '../src/settle.js';
import { buildTree, proofFor, verifyProof } from '../src/merkle.js';
import { MEMBERS, COMMUNITIES, ZONES, LOAD_SHAPES } from '../src/community.js';
import { ADJACENT_START } from '../src/rules42c.js';

const day = JSON.parse(readFileSync(new URL('../data/day-2026-06-21.json', import.meta.url)));
const world = { members: MEMBERS, communities: COMMUNITIES, zones: ZONES, loadShapes: LOAD_SHAPES };
const m2026 = matchDay(day, world);
const m2028 = matchDay(day, world, { ruleDateMs: ADJACENT_START });

test('apportion sums exactly and is proportional', () => {
  assert.deepEqual(apportion([1, 1, 1], 10).reduce((a, b) => a + b), 10);
  assert.deepEqual(apportion([0, 0], 5), [0, 0]);
  assert.deepEqual(apportion([3, 1], 4), [3, 1]);
});

test('energy balances for every member in every slot', () => {
  for (const m of [m2026, m2028]) {
    for (let i = 0; i < day.slots.length; i++) {
      for (const mem of MEMBERS) {
        const sum = (arr, side) => arr.filter((x) => x.slot === i && x.memberId === mem.id && x.side === side).reduce((a, x) => a + x.wh, 0);
        const s = day.slots[i];
        const gen = Math.round(mem.pvKwp * s.ghiWm2 * 0.8 * 0.25);
        const load = Math.round(mem.loadKwh * 1000 * LOAD_SHAPES[mem.profile][i]);
        assert.equal(gen + sum(m.legs, 'buy') + sum(m.grid, 'import'), load + sum(m.legs, 'sell') + sum(m.grid, 'export'), `${mem.id} slot ${i}`);
      }
    }
  }
});

test('pools buy exactly what they sell in every slot', () => {
  for (let i = 0; i < day.slots.length; i++) {
    const s = m2026.legs.filter((l) => l.slot === i && l.side === 'sell').reduce((a, l) => a + l.wh, 0);
    const b = m2026.legs.filter((l) => l.slot === i && l.side === 'buy').reduce((a, l) => a + l.wh, 0);
    assert.equal(s, b);
  }
});

test('§42c: large enterprise never shares; zones A and B share only from 2028-06-01', () => {
  for (const m of [m2026, m2028]) assert.ok(!m.legs.some((l) => l.memberId === 'neu-05'));
  const crossAB = (m) => m.inter.filter((o) => COMMUNITIES[o.from].zone !== COMMUNITIES[o.to].zone);
  assert.equal(crossAB(m2026).length, 0);
  assert.ok(m2026.blocked.some((b) => b.kind === 'zone'), 'expected blocked cross-zone sharing on this day');
  assert.ok(crossAB(m2028).length > 0, 'expected cross-zone sharing under 2028 rules');
});

test('settlement: pools end at zero, transfers reproduce every net position, netting saves payments', () => {
  for (const m of [m2026, m2028]) {
    for (const h of settleDay(m)) {
      for (const p of h.poolCheck) assert.equal(p.residualMicro, 0, p.id);
      const bal = {};
      for (const t of h.transfers) { bal[t.from] = (bal[t.from] ?? 0) - t.amountMicro; bal[t.to] = (bal[t.to] ?? 0) + t.amountMicro; }
      for (const l of h.lines) assert.equal(bal[l.id] ?? 0, l.kind === 'member' ? l.netMicro : 0, `${l.id} @ ${h.hourStartMs}`);
      assert.ok(h.transfers.length <= h.gross.payments);
    }
  }
});

test('merkle: every line verifies, a changed line does not', () => {
  for (const h of settleDay(m2028)) {
    const tree = buildTree(h.lines);
    h.lines.forEach((line, k) => {
      const proof = proofFor(tree, k);
      assert.ok(verifyProof(line, proof, tree.root));
      if (line.kind === 'member') assert.ok(!verifyProof({ ...line, netMicro: line.netMicro + 1 }, proof, tree.root));
    });
  }
});

test('transfer order: no pool ever goes below zero when executed in sequence from empty pools', () => {
  for (const m of [m2026, m2028]) {
    for (const h of settleDay(m)) {
      const bal = {};
      for (const t of h.transfers) {
        bal[t.from] = (bal[t.from] ?? 0) - t.amountMicro;
        bal[t.to] = (bal[t.to] ?? 0) + t.amountMicro;
        if (t.from.startsWith('pool:')) assert.ok(bal[t.from] >= 0, `${t.from} negative @ ${h.hourStartMs}`);
      }
    }
  }
});
