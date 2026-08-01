var _INJURY_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), traits: require('./traits.js') }
  : { league: { getTeamRoster: getTeamRoster }, traits: { getTraitBonus: getTraitBonus } };

const INJURY_SEVERITIES = [
  { name: 'Day-to-Day', gamesOut: 1 },
  { name: 'Two Weeks', gamesOut: 6 },
  { name: 'One Month', gamesOut: 13 },
  { name: 'Season Ending', gamesOut: 999 }
];

// Flat base rate, scaled up by current fatigue and nudged by Iron Man/Injury
// Prone traits and the durabilityMindset personality axis.
function rollInjury(player, rng) {
  if (player.status.injury) return;
  const baseChance = 0.003;
  const fatigueMultiplier = 1 + player.status.fatigue / 100;
  const traitBonus = _INJURY_DATA.traits.getTraitBonus(player, 'injury', 'chance');
  const durabilityFactor = (player.hiddenPersonality && player.hiddenPersonality.durabilityMindset !== undefined)
    ? (50 - player.hiddenPersonality.durabilityMindset) / 100
    : 0;
  const chanceMultiplier = Math.max(0.2, 1 + traitBonus * 0.08 + durabilityFactor * 0.3);
  if (rng() < baseChance * fatigueMultiplier * chanceMultiplier) {
    const roll = rng();
    let severity;
    if (roll < 0.5) severity = INJURY_SEVERITIES[0];
    else if (roll < 0.8) severity = INJURY_SEVERITIES[1];
    else if (roll < 0.95) severity = INJURY_SEVERITIES[2];
    else severity = INJURY_SEVERITIES[3];

    // Fast Healer shortens recovery, but a torn-season-ending injury stays
    // season-ending regardless — recovery speed doesn't erase the injury.
    const recoveryBonus = _INJURY_DATA.traits.getTraitBonus(player, 'injury', 'recovery');
    const gamesOut = severity.gamesOut >= 999
      ? 999
      : Math.max(1, Math.round(severity.gamesOut * Math.max(0.4, 1 + recoveryBonus * 0.06)));
    player.status.injury = { severity: severity.name, gamesRemaining: gamesOut };
  }
}

function decrementInjuriesForTeamGame(teamId) {
  _INJURY_DATA.league.getTeamRoster(teamId).forEach(function (p) {
    if (p.status.injury) {
      p.status.injury.gamesRemaining -= 1;
      if (p.status.injury.gamesRemaining <= 0) p.status.injury = null;
    }
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { INJURY_SEVERITIES: INJURY_SEVERITIES, rollInjury: rollInjury, decrementInjuriesForTeamGame: decrementInjuriesForTeamGame };
}
