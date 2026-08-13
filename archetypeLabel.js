// The user-facing archetype label — "Sharpshooter", "Two-Way Wing", "Rim
// Protector" — derived from a player's own attributes, position and height
// at DISPLAY time, never stored. Derivation is the point: every generated
// rookie, son and future star gets one forever, and the label tracks
// progression for free (spec: docs/superpowers/specs/2026-08-13-2k27-roster-
// import-design.md §6).
//
// Distinct from `player.archetype`, the internal 8-id GENERATION shape that
// seeds attribute spreads — that field is a tool for building players, this
// one is a sentence about who they turned out to be.
//
// Thresholds are absolute, not league-relative, and that is safe by
// construction: attributes are the site's own 2K face values, and generated
// players are built through GENERATION_AFFINE onto the same scale — the
// meaning of "80 three-point" does not drift.
// Re-anchored when the import switched from quantile mapping (medians 44-52)
// to face values. Measured on the face-value league: family medians run
// 53-78 and 90th percentiles 77-86, so the bars below sit at roughly each
// family's p75 for "clearly good" and p90 for "elite". Calibrated against
// the measured label distribution: every label is populated, no bucket
// exceeds 13% of the league, and the Two-Way labels are scarce (4.1%)
// because elite-both-ways should be rare.

function _fam(a, keys) {
  let s = 0;
  for (let i = 0; i < keys.length; i++) s += (a[keys[i]] || 0);
  return s / keys.length;
}

function archetypeLabel(player) {
  const a = player.attributes;
  if (!a) return 'Prospect';
  const big = (player.heightIn || 78) >= 81;
  const guard = player.position === 'PG' || player.position === 'SG';

  const shoot = _fam(a, ['threePoint', 'midRange']);
  const three = a.threePoint || 0;
  const create = _fam(a, ['ballHandling', 'insideScoring']);
  const play = _fam(a, ['passing', 'ballHandling']);
  const post = _fam(a, ['postScoring', 'insideScoring']);
  const perD = _fam(a, ['perimeterDefense', 'steal']);
  const rimD = _fam(a, ['interiorDefense', 'block']);
  const board = _fam(a, ['offReb', 'defReb']);
  const athletic = _fam(a, ['speed', 'vertical', 'acceleration']);
  const offense = Math.max(shoot, create, post);
  const defense = Math.max(perD, rimD);

  // Ordered most-specific first; the first sentence that fits is the label.
  if (offense >= 84 && defense >= 76) return big ? 'Two-Way Big' : (guard ? 'Two-Way Guard' : 'Two-Way Wing');
  if (big && play >= 74) return 'Point Center';
  if (big && three >= 80) return 'Stretch Big';
  if (big && rimD >= 78) return 'Rim Protector';
  if (big && board >= 77) return 'Glass Cleaner';
  if (big && post >= 74) return 'Post Scorer';
  if (play >= 81 && !big) return guard ? 'Floor General' : 'Point Forward';
  if (three >= 83 && perD >= 66) return '3-and-D';
  if (three >= 85) return 'Sharpshooter';
  if (create >= 77 && athletic >= 82) return 'Slasher';
  if (create >= 77) return 'Shot Creator';
  if (perD >= 74) return 'Lockdown Defender';
  if (athletic >= 83 && post >= 62) return 'Athletic Finisher';
  if (shoot >= 78) return 'Scoring Threat';
  if (defense >= 64 || board >= 64) return 'Defensive Specialist';
  return 'Role Player';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { archetypeLabel: archetypeLabel };
}
