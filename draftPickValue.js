// A standard draft-value-chart shape: pick 1 worth far more than pick 30, and
// the whole curve decays further (and flatter) across the second round.
function pickBaseValue(pickNumber) {
  if (pickNumber <= 30) {
    return 100 * Math.pow(0.93, pickNumber - 1);
  }
  const secondRoundSlot = pickNumber - 30;
  return 8 * Math.pow(0.95, secondRoundSlot - 1);
}

// Used when a pick is a FUTURE pick (not this year's) being valued for a trade:
// scales the base curve by how good/bad the owning team currently projects to
// be — a bad team's future pick is worth more (it'll likely land early).
function estimateFuturePickValue(pickNumber, team) {
  const timelineMultiplier = team.timeline === 'rebuilding' ? 1.3 : (team.timeline === 'win-now' ? 0.7 : 1.0);
  return pickBaseValue(pickNumber) * timelineMultiplier;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pickBaseValue: pickBaseValue, estimateFuturePickValue: estimateFuturePickValue };
}
