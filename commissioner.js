var _COMMISSIONER_DATA = (typeof require !== 'undefined')
  ? {
      league: require('./league.js'),
      data: require('./data.js'),
      players: require('./players-2026.js'),
      teams: require('./teams.js'),
      prospects: require('./draftProspects.js'),
      traits: require('./traits.js')
    }
  : {
      league: { getPlayerById: getPlayerById, getTeamRoster: getTeamRoster },
      data: { RATING_MIN: RATING_MIN, RATING_MAX: RATING_MAX, ATTRIBUTE_KEYS: ATTRIBUTE_KEYS, CONFERENCES: CONFERENCES, DIVISIONS: DIVISIONS },
      players: { PLAYERS_2026: PLAYERS_2026 },
      teams: { TEAMS: TEAMS },
      prospects: { mkProspect: mkProspect },
      traits: { ensureHiddenPlayerData: ensureHiddenPlayerData }
    };

function clampRating(v) {
  return Math.max(_COMMISSIONER_DATA.data.RATING_MIN, Math.min(_COMMISSIONER_DATA.data.RATING_MAX, v));
}

function editPlayerRatings(playerId, changes) {
  const player = _COMMISSIONER_DATA.league.getPlayerById(playerId);
  if (!player) return { success: false, reason: 'Player not found.' };
  if (changes.overall !== undefined) player.overall = clampRating(changes.overall);
  if (changes.potential !== undefined) player.potential = clampRating(changes.potential);
  if (changes.attributes) {
    Object.keys(changes.attributes).forEach(function (key) {
      if (_COMMISSIONER_DATA.data.ATTRIBUTE_KEYS.indexOf(key) === -1) return;
      player.attributes[key] = clampRating(changes.attributes[key]);
    });
  }
  return { success: true };
}

function deletePlayer(playerId) {
  const idx = _COMMISSIONER_DATA.players.PLAYERS_2026.findIndex(function (p) { return p.id === playerId; });
  if (idx === -1) return { success: false, reason: 'Player not found.' };
  _COMMISSIONER_DATA.players.PLAYERS_2026.splice(idx, 1);
  return { success: true };
}

// Same 7 archetypes draftProspects.js's PROSPECT_ARCHETYPES defines — kept as
// its own list here (not imported) so the create-player form has a stable,
// explicit set of choices independent of that file's internal keys changing.
const CREATE_PLAYER_ARCHETYPES = ['primary_scorer', 'playmaker', 'three_and_d', 'rim_protector', 'stretch_big', 'slasher', 'raw_prospect'];

function nextAvailableJersey(teamId, excludePlayerId) {
  const roster = _COMMISSIONER_DATA.league.getTeamRoster(teamId).filter(function (p) { return p.id !== excludePlayerId; });
  const usedNumbers = new Set(roster.map(function (p) { return p.jerseyNumber; }));
  let jersey = 0;
  while (usedNumbers.has(jersey)) jersey++;
  return jersey;
}

// Same "fair salary anchor" tradeEvaluator.js's contractBurden uses for a
// given overall, reused here so a commissioner-created rostered player starts
// with a plausible salary instead of $0.
function fairSalaryForOverall(overall) {
  return Math.max(1000000, (overall - 50) * 1000000);
}

// Builds a full player record via draftProspects.js's mkProspect — the same
// procedural attribute derivation (archetype offsets from overall) every
// prospect in the game already gets, so a commissioner-created player never
// has hand-rolled attributes. Hidden traits/personality/tendencies are
// generated the normal way via ensureHiddenPlayerData rather than left as
// empty stubs — this project's recurring "truthy empty object" bug pattern
// starts with exactly that kind of stub.
function createPlayer(details) {
  const overall = clampRating(details.overall);
  const potential = Math.max(overall, clampRating(details.potential));
  const player = _COMMISSIONER_DATA.prospects.mkProspect(
    details.name, details.age, 78, 210, details.position, overall, potential, details.archetype, 0, 'Commissioner-created'
  );
  _COMMISSIONER_DATA.traits.ensureHiddenPlayerData([player]);
  player.yearsPro = Math.max(0, details.age - 19);

  if (details.teamId) {
    player.teamId = details.teamId;
    player.jerseyNumber = nextAvailableJersey(details.teamId, player.id);
    player.contract = { salary: fairSalaryForOverall(overall), yearsRemaining: 2, playerOption: false, teamOption: false };
  }

  _COMMISSIONER_DATA.players.PLAYERS_2026.push(player);
  return player;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    editPlayerRatings: editPlayerRatings,
    deletePlayer: deletePlayer,
    createPlayer: createPlayer,
    CREATE_PLAYER_ARCHETYPES: CREATE_PLAYER_ARCHETYPES
  };
}
