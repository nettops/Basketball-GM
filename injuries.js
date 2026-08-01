var _INJURY_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js') }
  : { league: { getTeamRoster: getTeamRoster } };

const INJURY_SEVERITIES = [
  { name: 'Day-to-Day', gamesOut: 1 },
  { name: 'Two Weeks', gamesOut: 6 },
  { name: 'One Month', gamesOut: 13 },
  { name: 'Season Ending', gamesOut: 999 }
];

// Flat base rate, scaled up by current fatigue (no hidden-trait modifiers —
// those don't exist until Phase 5).
function rollInjury(player, rng) {
  if (player.status.injury) return;
  const baseChance = 0.003;
  const fatigueMultiplier = 1 + player.status.fatigue / 100;
  if (rng() < baseChance * fatigueMultiplier) {
    const roll = rng();
    let severity;
    if (roll < 0.5) severity = INJURY_SEVERITIES[0];
    else if (roll < 0.8) severity = INJURY_SEVERITIES[1];
    else if (roll < 0.95) severity = INJURY_SEVERITIES[2];
    else severity = INJURY_SEVERITIES[3];
    player.status.injury = { severity: severity.name, gamesRemaining: severity.gamesOut };
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
