// A standard draft-value-chart shape: pick 1 worth far more than pick 30, and
// the whole curve decays further (and flatter) across the second round.
function pickBaseValue(pickNumber) {
  if (pickNumber <= 30) {
    return 100 * Math.pow(0.93, pickNumber - 1);
  }
  const secondRoundSlot = pickNumber - 30;
  return 8 * Math.pow(0.95, secondRoundSlot - 1);
}

// Projects roughly where a team's NEXT pick in a given round will land, based
// on its current timeline, then values it on the standard pick curve. Used at
// trade time, when the exact future pick number isn't knowable yet — only the
// round and who currently projects to be good or bad.
function estimateFuturePickValue(round, team) {
  let projectedSlotWithinRound;
  if (team.timeline === 'rebuilding') projectedSlotWithinRound = 5;
  else if (team.timeline === 'retooling') projectedSlotWithinRound = 15;
  else projectedSlotWithinRound = 26;
  const pickNumber = round === 1 ? projectedSlotWithinRound : 30 + projectedSlotWithinRound;
  return pickBaseValue(pickNumber);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pickBaseValue: pickBaseValue, estimateFuturePickValue: estimateFuturePickValue };
}
