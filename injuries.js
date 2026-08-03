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
  // GameState is a browser global from script.js — guarded since injuries.js
  // also runs standalone under Node in scripts/validate-*.js.
  const injurySetting = typeof GameState !== 'undefined' && GameState.settings ? GameState.settings.injuryFrequency : undefined;
  const injuryFrequency = injurySetting === undefined ? 1 : injurySetting;
  const fatigueMultiplier = 1 + player.status.fatigue / 100;
  const traitBonus = _INJURY_DATA.traits.getTraitBonus(player, 'injury', 'chance');
  const durabilityFactor = (player.hiddenPersonality && player.hiddenPersonality.durabilityMindset !== undefined)
    ? (50 - player.hiddenPersonality.durabilityMindset) / 100
    : 0;
  const chanceMultiplier = Math.max(0.2, 1 + traitBonus * 0.08 + durabilityFactor * 0.3);
  if (rng() < baseChance * injuryFrequency * fatigueMultiplier * chanceMultiplier) {
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
    player.status.injury = { severity: severity.name, gamesRemaining: gamesOut, gamesOut: gamesOut };
  }
}

// Maps a sim severity name to the minor/moderate/major/severe tier the
// career-history UI (ui/playerProfile.js's SEVERITY_PILL) expects.
const INJURY_SEVERITY_TIER = {
  'Day-to-Day': 'minor',
  'Two Weeks': 'moderate',
  'One Month': 'major',
  'Season Ending': 'severe'
};

// Rough games-missed -> calendar-days approximation (NBA teams play roughly
// every other day across an 82-game season) — good enough for the career
// history "Est. Days"/"Actual Days" columns since the sim doesn't track a
// real calendar.
const GAMES_TO_DAYS = 2;

function decrementInjuriesForTeamGame(teamId) {
  _INJURY_DATA.league.getTeamRoster(teamId).forEach(function (p) {
    if (p.status.injury) {
      p.status.injury.gamesRemaining -= 1;
      if (p.status.injury.gamesRemaining <= 0) p.status.injury = null;
    }
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    INJURY_SEVERITIES: INJURY_SEVERITIES,
    INJURY_SEVERITY_TIER: INJURY_SEVERITY_TIER,
    GAMES_TO_DAYS: GAMES_TO_DAYS,
    rollInjury: rollInjury,
    decrementInjuriesForTeamGame: decrementInjuriesForTeamGame
  };
}
