// Rules for energy sharing, based on our reading of §42c EnWG (Germany). Demo interpretation, not legal advice.
//  - Participants: natural persons/households, public-law bodies (e.g. municipalities), and only
//    micro/small/medium enterprises (EU Recommendation 2003/361/EC).
//  - From 2026-06-01: plant and consumers within the balancing zone of one distribution grid operator.
//  - From 2028-06-01: also with a directly adjacent DSO zone in the same control area.
export const SHARING_START = Date.UTC(2026, 5, 1);
export const ADJACENT_START = Date.UTC(2028, 5, 1);
const ELIGIBLE_KINDS = new Set(['household', 'sme', 'municipal']);

export function memberEligible(member, atMs) {
  if (atMs < SHARING_START) return { ok: false, reason: 'Energy sharing under §42c EnWG starts 2026-06-01' };
  if (!ELIGIBLE_KINDS.has(member.kind)) {
    return { ok: false, reason: '§42c EnWG: only households, public bodies and micro/small/medium enterprises' };
  }
  return { ok: true };
}

// zones: { [zoneId]: { controlArea, adjacent: [zoneId] } }
export function zonesMayShare(zoneA, zoneB, atMs, zones) {
  if (zoneA === zoneB) return { ok: true };
  const a = zones[zoneA];
  const b = zones[zoneB];
  const adjacent = a?.adjacent.includes(zoneB) && a.controlArea === b?.controlArea;
  if (!adjacent) return { ok: false, reason: 'Different, non-adjacent grid zones: not allowed under §42c EnWG' };
  if (atMs < ADJACENT_START) return { ok: false, reason: 'Sharing with an adjacent grid zone is allowed only from 2028-06-01' };
  return { ok: true };
}
