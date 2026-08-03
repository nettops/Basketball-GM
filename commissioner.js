var _COMMISSIONER_DATA = (typeof require !== 'undefined')
  ? {
      league: require('./league.js'),
      data: require('./data.js'),
      players: require('./players-2026.js'),
      teams: require('./teams.js'),
      prospects: require('./draftProspects.js'),
      traits: require('./traits.js'),
      trade: require('./trade.js'),
      tradeEvaluator: require('./tradeEvaluator.js')
    }
  : {
      league: { getPlayerById: getPlayerById, getTeamRoster: getTeamRoster },
      data: { RATING_MIN: RATING_MIN, RATING_MAX: RATING_MAX, ATTRIBUTE_KEYS: ATTRIBUTE_KEYS, CONFERENCES: CONFERENCES, DIVISIONS: DIVISIONS },
      players: { PLAYERS_2026: PLAYERS_2026 },
      teams: { TEAMS: TEAMS },
      prospects: { mkProspect: mkProspect },
      traits: { ensureHiddenPlayerData: ensureHiddenPlayerData },
      trade: { validateRosterSizes: validateRosterSizes, executeTrade: executeTrade },
      tradeEvaluator: { adjustedPlayerValue: adjustedPlayerValue }
    };

// Named distinctly from progression.js's clampRating (not commissionerClampRating2
// or similar) because both files load as plain global scripts in the browser —
// a same-named `function` declaration here previously shadowed progression.js's
// rounding version for every caller, including progressPlayer, silently leaving
// every rostered player's overall/potential as an un-rounded float after any
// offseason. Keep these two names distinct.
function commissionerClampRating(v) {
  return Math.max(_COMMISSIONER_DATA.data.RATING_MIN, Math.min(_COMMISSIONER_DATA.data.RATING_MAX, Math.round(v)));
}

function editPlayerRatings(playerId, changes) {
  const player = _COMMISSIONER_DATA.league.getPlayerById(playerId);
  if (!player) return { success: false, reason: 'Player not found.' };
  if (changes.overall !== undefined) player.overall = commissionerClampRating(changes.overall);
  if (changes.potential !== undefined) player.potential = commissionerClampRating(changes.potential);
  if (changes.attributes) {
    Object.keys(changes.attributes).forEach(function (key) {
      if (_COMMISSIONER_DATA.data.ATTRIBUTE_KEYS.indexOf(key) === -1) return;
      player.attributes[key] = commissionerClampRating(changes.attributes[key]);
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
  const overall = commissionerClampRating(details.overall);
  const potential = Math.max(overall, commissionerClampRating(details.potential));
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

// Skips evaluateTrade's value/salary check entirely (Commissioner sandbox is
// explicitly consequence-free on trade fairness) but still enforces the same
// 12-15 roster-size band every other trade path enforces — an unchecked
// Force Trade could otherwise drop a team below the floor other systems
// (box-score sim, waivePlayer) assume always holds.
function forceTrade(proposal, historySink) {
  const rosterErrors = _COMMISSIONER_DATA.trade.validateRosterSizes(proposal);
  if (rosterErrors.length > 0) {
    return { success: false, rosterErrors: rosterErrors };
  }
  _COMMISSIONER_DATA.trade.executeTrade(proposal, historySink);
  return { success: true, rosterErrors: [] };
}

function shuffleTeamIds(ids, rng) {
  const a = ids.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

// Same "highest adjustedPlayerValue wins" selection draft.js's selectAIPick
// already uses for the real draft, reused here so the expansion team's picks
// are evaluated the same way every other roster decision in the game is.
function pickBestAvailable(available, team) {
  let best = available[0];
  let bestValue = _COMMISSIONER_DATA.tradeEvaluator.adjustedPlayerValue(best, team);
  for (let i = 1; i < available.length; i++) {
    const value = _COMMISSIONER_DATA.tradeEvaluator.adjustedPlayerValue(available[i], team);
    if (value > bestValue) { best = available[i]; bestValue = value; }
  }
  return best;
}

// Auto-balanced: a 31st team unbalances the existing 3-division/5-team-per-
// conference structure no matter where it lands, so this just picks
// whichever conference+division currently has the fewest teams.
function balancedConferenceDivision() {
  const counts = {};
  _COMMISSIONER_DATA.teams.TEAMS.forEach(function (t) {
    const key = t.conference + '|' + t.division;
    counts[key] = (counts[key] || 0) + 1;
  });
  let bestKey = null;
  let bestCount = Infinity;
  _COMMISSIONER_DATA.data.CONFERENCES.forEach(function (conf) {
    _COMMISSIONER_DATA.data.DIVISIONS[conf].forEach(function (div) {
      const key = conf + '|' + div;
      const count = counts[key] || 0;
      if (count < bestCount) { bestCount = count; bestKey = key; }
    });
  });
  const parts = bestKey.split('|');
  return { conference: parts[0], division: parts[1] };
}

const EXPANSION_ROSTER_TARGET = 14;
const EXPANSION_PROTECTED_COUNT = 8;
const EXPANSION_DONOR_FLOOR = 12; // never take a donor team below the game's existing roster-size floor

// 1. Appends a new team (fresh id, prestige 40, rebuilding, empty record).
// 2. Simplified expansion draft: every existing team auto-protects its top 8
//    by overall; the new team drafts one unprotected player from each other
//    team per round (rng-shuffled order) via pickBestAvailable, until it
//    reaches EXPANSION_ROSTER_TARGET. Donor teams already at the 12-player
//    floor are skipped so no other team's roster-size invariant breaks.
// 3. Takes effect starting the next generateNewSeason() call — schedule
//    generation already reads TEAMS fresh each time, so this is picked up
//    automatically; no retroactive mid-season schedule regeneration.
function createExpansionTeam(details, rng) {
  const placement = balancedConferenceDivision();
  const id = 'EXP-' + details.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now();

  const team = {
    id: id, name: details.name, conference: placement.conference, division: placement.division,
    colors: { primary: details.primaryColor, secondary: details.secondaryColor },
    prestige: 40, fanHappiness: 60, ownerHappiness: 60, chemistry: 60,
    timeline: 'rebuilding', marketSize: commissionerClampRating(details.marketSize),
    record: { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 },
    draftPicks: [
      { round: 1, originalTeamId: id, currentOwnerId: id },
      { round: 2, originalTeamId: id, currentOwnerId: id }
    ]
  };
  _COMMISSIONER_DATA.teams.TEAMS.push(team);

  const donorIds = _COMMISSIONER_DATA.teams.TEAMS
    .filter(function (t) { return t.id !== id; })
    .map(function (t) { return t.id; });

  let guardCounter = 0; // safety valve — real 30-team rosters always satisfy the target well within a few rounds
  while (_COMMISSIONER_DATA.league.getTeamRoster(id).length < EXPANSION_ROSTER_TARGET && guardCounter < 10) {
    guardCounter += 1;
    let draftedThisRound = false;
    shuffleTeamIds(donorIds, rng).forEach(function (donorId) {
      if (_COMMISSIONER_DATA.league.getTeamRoster(id).length >= EXPANSION_ROSTER_TARGET) return;
      const donorRoster = _COMMISSIONER_DATA.league.getTeamRoster(donorId);
      if (donorRoster.length <= EXPANSION_DONOR_FLOOR) return;
      const byOverall = donorRoster.slice().sort(function (a, b) { return b.overall - a.overall; });
      const protectedIds = {};
      byOverall.slice(0, EXPANSION_PROTECTED_COUNT).forEach(function (p) { protectedIds[p.id] = true; });
      const available = byOverall.filter(function (p) { return !protectedIds[p.id]; });
      if (available.length === 0) return;
      const picked = pickBestAvailable(available, team);
      picked.teamId = id;
      picked.jerseyNumber = nextAvailableJersey(id, picked.id);
      draftedThisRound = true;
    });
    if (!draftedThisRound) break;
  }

  return team;
}

// Renames/rebrands a team in place — conference, division, roster, and
// record are untouched (changing those would mean regenerating the season
// schedule mid-season, which nothing else in this codebase does). Fan
// sentiment resets to a neutral "new market, clean slate" baseline rather
// than carrying over the old city's dissatisfaction.
function relocateTeam(teamId, details) {
  const team = _COMMISSIONER_DATA.teams.TEAMS.find(function (t) { return t.id === teamId; });
  if (!team) return { success: false, reason: 'Team not found.' };
  team.name = details.name;
  team.colors = { primary: details.primaryColor, secondary: details.secondaryColor };
  team.marketSize = commissionerClampRating(details.marketSize);
  team.fanHappiness = 60;
  team.ownerHappiness = Math.min(99, team.ownerHappiness + 10);
  return { success: true, team: team };
}

const AUTO_EXPANSION_CITY_NAMES = ['Seattle Sasquatch', 'Vancouver Voyagers', 'Kansas City Kings', 'St. Louis Statesmen', 'Louisville Legends'];
const AUTO_EXPANSION_MAX_TEAMS = 32;
const AUTO_EXPANSION_MIN_AVG_FAN_HAPPINESS = 70;
const AUTO_EXPANSION_CHANCE_WHEN_ELIGIBLE = 0.15;

// Checked once per season (history.js's finalizeSeasonHistory, gated behind
// settings.autoExpansionEnabled — off by default so existing saves aren't
// surprised by a new team appearing). A simple leaguewide-health gate, not a
// real franchise-value simulation: healthy average fan sentiment, room under
// the team cap, and a random per-season chance so it's a rare event even
// once eligible, not a guaranteed trigger the moment the bar is cleared.
function checkAutoExpansion(rng) {
  if (_COMMISSIONER_DATA.teams.TEAMS.length >= AUTO_EXPANSION_MAX_TEAMS) return null;
  const avgFanHappiness = _COMMISSIONER_DATA.teams.TEAMS.reduce(function (s, t) { return s + t.fanHappiness; }, 0) / _COMMISSIONER_DATA.teams.TEAMS.length;
  if (avgFanHappiness < AUTO_EXPANSION_MIN_AVG_FAN_HAPPINESS) return null;
  if (rng() > AUTO_EXPANSION_CHANCE_WHEN_ELIGIBLE) return null;
  const usedNames = new Set(_COMMISSIONER_DATA.teams.TEAMS.map(function (t) { return t.name; }));
  const cityName = AUTO_EXPANSION_CITY_NAMES.find(function (n) { return !usedNames.has(n); });
  if (!cityName) return null;
  const details = {
    name: cityName,
    primaryColor: '#' + Math.floor(rng() * 0xffffff).toString(16).padStart(6, '0'),
    secondaryColor: '#' + Math.floor(rng() * 0xffffff).toString(16).padStart(6, '0'),
    marketSize: 40 + Math.round(rng() * 40)
  };
  return createExpansionTeam(details, rng);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    editPlayerRatings: editPlayerRatings,
    deletePlayer: deletePlayer,
    createPlayer: createPlayer,
    CREATE_PLAYER_ARCHETYPES: CREATE_PLAYER_ARCHETYPES,
    forceTrade: forceTrade,
    createExpansionTeam: createExpansionTeam,
    relocateTeam: relocateTeam,
    checkAutoExpansion: checkAutoExpansion,
    AUTO_EXPANSION_MAX_TEAMS: AUTO_EXPANSION_MAX_TEAMS
  };
}
