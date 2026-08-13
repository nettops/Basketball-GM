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
// construction: the 2K27 import quantile-mapped every attribute onto the
// engine's calibrated distributions, and generated players are built against
// the same anchors — the meaning of "70 three-point" does not drift.
// Measured on the imported league: family medians sit at 44-52 and the 75th
// percentiles at 56-66, so 62 reads "clearly good at this" and 72 "elite".

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
  if (offense >= 68 && defense >= 62) return big ? 'Two-Way Big' : (guard ? 'Two-Way Guard' : 'Two-Way Wing');
  if (big && play >= 62) return 'Point Center';
  if (big && three >= 62) return 'Stretch Big';
  if (big && rimD >= 66) return 'Rim Protector';
  if (big && board >= 64) return 'Glass Cleaner';
  if (big && post >= 60) return 'Post Scorer';
  if (play >= 66 && !big) return guard ? 'Floor General' : 'Point Forward';
  if (three >= 66 && perD >= 58) return '3-and-D';
  if (three >= 68) return 'Sharpshooter';
  if (create >= 66 && athletic >= 60) return 'Slasher';
  if (create >= 66) return 'Shot Creator';
  if (perD >= 64) return 'Lockdown Defender';
  if (athletic >= 64 && post >= 52) return 'Athletic Finisher';
  if (shoot >= 58) return 'Scoring Threat';
  if (defense >= 56 || board >= 56) return 'Defensive Specialist';
  return 'Role Player';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { archetypeLabel: archetypeLabel };
}
