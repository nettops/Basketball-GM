var _FATIGUE_DATA = (typeof require !== 'undefined')
  ? { league: require('./league.js'), traits: require('./traits.js') }
  : { league: { getTeamRoster: getTeamRoster }, traits: { getTraitBonus: getTraitBonus } };

function applyFatigueForGame(teamId, minutesByPlayerId, isBackToBack) {
  _FATIGUE_DATA.league.getTeamRoster(teamId).forEach(function (p) {
    const minutes = minutesByPlayerId[p.id] || 0;
    const traitBonus = _FATIGUE_DATA.traits.getTraitBonus(p, 'fatigue', 'accumulation');
    const fatigueMultiplier = Math.max(0.5, 1 + traitBonus * 0.05);
    const gain = (minutes * 0.3 + (isBackToBack ? 8 : 0)) * fatigueMultiplier;
    p.status.fatigue = Math.min(100, p.status.fatigue + gain);
  });
}

function decayFatigueForRest(teamId, restDays) {
  _FATIGUE_DATA.league.getTeamRoster(teamId).forEach(function (p) {
    p.status.fatigue = Math.max(0, p.status.fatigue - restDays * 15);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { applyFatigueForGame: applyFatigueForGame, decayFatigueForRest: decayFatigueForRest };
}
