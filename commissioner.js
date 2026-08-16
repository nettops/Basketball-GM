var _COMMISSIONER_DATA = (typeof require !== 'undefined')
  ? {
      league: require('./league.js'),
      data: require('./data.js'),
      players: require('./players-2026.js'),
      teams: require('./teams.js'),
      prospects: require('./draftProspects.js'),
      traits: require('./traits.js'),
      trade: require('./trade.js'),
      tradeEvaluator: require('./tradeEvaluator.js'),
      coaches: require('./coaches.js'),
      rosterMoves: require('./rosterMoves.js'),
      faces: require('./faces.js'),
      ratings: require('./ratings.js'),
      names: require('./names.js'),
      history: require('./history.js')
    }
  : {
      league: { getPlayerById: getPlayerById, getTeamRoster: getTeamRoster },
      data: { RATING_MIN: RATING_MIN, RATING_MAX: RATING_MAX, ATTRIBUTE_KEYS: ATTRIBUTE_KEYS, CONFERENCES: CONFERENCES, DIVISIONS: DIVISIONS, POSITIONS: POSITIONS },
      players: { PLAYERS_2026: PLAYERS_2026 },
      teams: { TEAMS: TEAMS },
      prospects: { mkProspect: mkProspect },
      traits: { ensureHiddenPlayerData: ensureHiddenPlayerData },
      faces: { ensurePlayerFace: ensurePlayerFace },
      ratings: { scaleAttributesToOverall: scaleAttributesToOverall, toRawRating: toRawRating },
      coaches: { ensureTeamCoach: ensureTeamCoach },
      rosterMoves: { getFreeAgents: getFreeAgents },
      trade: { validateRosterSizes: validateRosterSizes, executeTrade: executeTrade },
      tradeEvaluator: { adjustedPlayerValue: adjustedPlayerValue, invalidateLeagueAvgCache: invalidateLeagueAvgCache },
      names: { takenNameSet: takenNameSet, pickUniqueName: pickUniqueName },
      history: { LEAGUE_HISTORY: LEAGUE_HISTORY }
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
  // `overall` is derived from the attributes (ratings.js), so "set this player
  // to a 90" has to move the attributes that produce a 90. Applied FIRST, so
  // an edit that also names specific attributes still wins on those.
  if (changes.overall !== undefined) {
    _COMMISSIONER_DATA.ratings.scaleAttributesToOverall(player, commissionerClampRating(changes.overall));
  }
  // `potential` is stored RAW while the commissioner UI shows and accepts the
  // DISPLAY scale, so this converts at the boundary — exactly as createPlayer
  // does. Writing the display number straight in would inflate the player's
  // ceiling by roughly 20 points.
  if (changes.potential !== undefined) {
    player.potential = Math.round(_COMMISSIONER_DATA.ratings.toRawRating(
      commissionerClampRating(changes.potential)));
  }
  if (changes.attributes) {
    Object.keys(changes.attributes).forEach(function (key) {
      if (_COMMISSIONER_DATA.data.ATTRIBUTE_KEYS.indexOf(key) === -1) return;
      player.attributes[key] = commissionerClampRating(changes.attributes[key]);
    });
  }
  // An edited sheet moves the trade evaluator's cached league average.
  _COMMISSIONER_DATA.tradeEvaluator.invalidateLeagueAvgCache();
  return { success: true };
}

// Direct contract override — bypasses estimateFairSalary/tradeEvaluator
// entirely, same "sandbox is consequence-free" spirit as forceTrade.
function editPlayerContract(playerId, changes) {
  const player = _COMMISSIONER_DATA.league.getPlayerById(playerId);
  if (!player) return { success: false, reason: 'Player not found.' };
  if (changes.salary !== undefined) player.contract.salary = Math.max(0, Math.round(changes.salary));
  if (changes.yearsRemaining !== undefined) player.contract.yearsRemaining = Math.max(0, Math.round(changes.yearsRemaining));
  if (changes.playerOption !== undefined) player.contract.playerOption = !!changes.playerOption;
  if (changes.teamOption !== undefined) player.contract.teamOption = !!changes.teamOption;
  return { success: true };
}

const TEAM_EDITABLE_FIELDS = ['prestige', 'fanHappiness', 'ownerHappiness', 'chemistry', 'marketSize'];

// Direct team attribute override — the team-level counterpart to
// editPlayerRatings, for the same sandbox purposes (testing how a struggling
// team's finances/free-agency behavior responds to a healthier prestige/
// happiness baseline, without having to grind through seasons to get there).
function editTeamAttributes(teamId, changes) {
  const team = _COMMISSIONER_DATA.teams.TEAMS.find(function (t) { return t.id === teamId; });
  if (!team) return { success: false, reason: 'Team not found.' };
  TEAM_EDITABLE_FIELDS.forEach(function (key) {
    if (changes[key] !== undefined) team[key] = commissionerClampRating(changes[key]);
  });
  return { success: true };
}

function deletePlayer(playerId) {
  const idx = _COMMISSIONER_DATA.players.PLAYERS_2026.findIndex(function (p) { return p.id === playerId; });
  if (idx === -1) return { success: false, reason: 'Player not found.' };
  _COMMISSIONER_DATA.players.PLAYERS_2026.splice(idx, 1);
  _COMMISSIONER_DATA.tradeEvaluator.invalidateLeagueAvgCache();
  return { success: true };
}

// Same 7 archetypes draftProspects.js's PROSPECT_ARCHETYPES defines — kept as
// its own list here (not imported) so the create-player form has a stable,
// explicit set of choices independent of that file's internal keys changing.
const CREATE_PLAYER_ARCHETYPES = ['primary_scorer', 'playmaker', 'three_and_d', 'rim_protector', 'stretch_big', 'slasher', 'raw_prospect'];

function nextAvailableJersey(teamId, excludePlayerId) {
  const roster = _COMMISSIONER_DATA.league.getTeamRoster(teamId).filter(function (p) { return p.id !== excludePlayerId; });
  const team = _COMMISSIONER_DATA.teams.TEAMS.find(function (t) { return t.id === teamId; });
  const usedNumbers = new Set(roster.map(function (p) { return p.jerseyNumber; }).concat((team && team.retiredNumbers) || []));
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
  // details.overall and details.potential arrive from the commissioner UI on
  // the DISPLAY scale — the user asks for a 90. Both mkProspect (which derives
  // attributes from them) and fairSalaryForOverall consume the RAW scale, so
  // the conversion happens once, here at the boundary, rather than being
  // rediscovered by each consumer.
  const toRaw = function (v) {
    return Math.round(_COMMISSIONER_DATA.ratings.toRawRating(commissionerClampRating(v)));
  };
  const overall = toRaw(details.overall);
  const potential = Math.max(overall, toRaw(details.potential));
  const player = _COMMISSIONER_DATA.prospects.mkProspect(
    details.name, details.age, 78, 210, details.position, overall, potential, details.archetype, 0, 'Commissioner-created'
  );
  _COMMISSIONER_DATA.traits.ensureHiddenPlayerData([player]);
  _COMMISSIONER_DATA.faces.ensurePlayerFace([player]);
  player.yearsPro = Math.max(0, details.age - 19);

  if (details.teamId) {
    player.teamId = details.teamId;
    player.jerseyNumber = nextAvailableJersey(details.teamId, player.id);
    player.contract = { salary: fairSalaryForOverall(overall), yearsRemaining: 2, playerOption: false, teamOption: false };
  }

  _COMMISSIONER_DATA.players.PLAYERS_2026.push(player);
  // A new body in the pool moves the trade evaluator's cached league average.
  _COMMISSIONER_DATA.tradeEvaluator.invalidateLeagueAvgCache();
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
    ],
    // Explicit rather than left undefined: every consumer defaults these with
    // `|| 0` today, but they're in save.js's TEAM_SAVE_FIELDS, and undefined
    // values are dropped entirely by JSON.stringify on the way into a slot.
    allTimeWins: 0,
    allTimeLosses: 0,
    lastSeasonWins: 0,
    retiredNumbers: []
  };
  // A team created mid-save never passes through initSeason, which is the only
  // other place coaches are assigned. Without this the expansion team plays out
  // the rest of the league's life with no coach and no strategy dials.
  _COMMISSIONER_DATA.coaches.ensureTeamCoach(team, rng);
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
      const byOverall = donorRoster.slice().sort(function (a, b) { return b.rawOverall - a.rawOverall; });
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

  // The expansion draft alone can't always reach the target: every donor is
  // protected down to EXPANSION_DONOR_FLOOR, so a league that has already
  // expanded once has almost nobody left to give (measured: a second expansion
  // team landed with 8 players). Anything below the 12-man floor is not a
  // cosmetic shortfall — validateRosterSizes rejects every trade that team ever
  // proposes, permanently, and simulateTeamBoxScore starts handing out 30
  // minutes a night to everyone. Top up the same way a real expansion franchise
  // does: free agents first, then minimum-contract fringe signings.
  fillRosterToTarget(team, EXPANSION_ROSTER_TARGET, rng);

  return team;
}

// Filler players used to draw from a twelve-by-twelve list of their own — 144
// possible people for a mechanism that can fire dozens of times in one
// offseason. They use the shared pool now, and check it.

// Roster-filler player: fringe-NBA ratings, minimum money, short deal. Built
// through mkProspect for the same reason createPlayer above uses it — it's the
// one path that derives a full 20-attribute spread from an overall, so a filler
// signing is a real player to every system rather than a stub.
function generateFringePlayer(team, rng) {
  const taken = _COMMISSIONER_DATA.names.takenNameSet(
    _COMMISSIONER_DATA.players.PLAYERS_2026,
    (_COMMISSIONER_DATA.history.LEAGUE_HISTORY || {}).retiredPlayers);
  const name = _COMMISSIONER_DATA.names.pickUniqueName(rng, taken);
  const overall = 48 + Math.round(rng() * 10);
  const position = _COMMISSIONER_DATA.data.POSITIONS[Math.floor(rng() * _COMMISSIONER_DATA.data.POSITIONS.length)];
  const archetype = CREATE_PLAYER_ARCHETYPES[Math.floor(rng() * CREATE_PLAYER_ARCHETYPES.length)];
  const player = _COMMISSIONER_DATA.prospects.mkProspect(
    name, 24 + Math.floor(rng() * 5), 78, 210, position, overall, overall + Math.round(rng() * 6), archetype, 0, 'Undrafted free agent'
  );
  _COMMISSIONER_DATA.traits.ensureHiddenPlayerData([player]);
  _COMMISSIONER_DATA.faces.ensurePlayerFace([player]);
  player.yearsPro = Math.max(1, player.age - 22);
  _COMMISSIONER_DATA.players.PLAYERS_2026.push(player);
  // A new body in the pool moves the trade evaluator's cached league average.
  _COMMISSIONER_DATA.tradeEvaluator.invalidateLeagueAvgCache();
  return player;
}

// Signs the best available free agents (same adjustedPlayerValue ranking the
// expansion and real drafts use), then generates fringe players for whatever
// gap remains — a brand-new league has no free agents at all, since nobody has
// reached the end of a contract yet.
function fillRosterToTarget(team, target, rng) {
  const signed = [];
  const available = _COMMISSIONER_DATA.rosterMoves.getFreeAgents()
    .slice()
    .sort(function (a, b) {
      return _COMMISSIONER_DATA.tradeEvaluator.adjustedPlayerValue(b, team) - _COMMISSIONER_DATA.tradeEvaluator.adjustedPlayerValue(a, team);
    });

  while (_COMMISSIONER_DATA.league.getTeamRoster(team.id).length < target) {
    const player = available.length > 0 ? available.shift() : generateFringePlayer(team, rng);
    player.teamId = team.id;
    player.jerseyNumber = nextAvailableJersey(team.id, player.id);
    player.contract = { salary: fairSalaryForOverall(player.rawOverall), yearsRemaining: 2, playerOption: false, teamOption: false };
    signed.push(player.id);
  }
  return signed;
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

const AUTO_EXPANSION_CITY_NAMES = ['Seattle Sasquatch', 'Vancouver Voyagers', 'Kansas City Cattlemen', 'St. Louis Statesmen', 'Louisville Legends'];
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
    editPlayerContract: editPlayerContract,
    editTeamAttributes: editTeamAttributes,
    TEAM_EDITABLE_FIELDS: TEAM_EDITABLE_FIELDS,
    deletePlayer: deletePlayer,
    createPlayer: createPlayer,
    CREATE_PLAYER_ARCHETYPES: CREATE_PLAYER_ARCHETYPES,
    forceTrade: forceTrade,
    createExpansionTeam: createExpansionTeam,
    fillRosterToTarget: fillRosterToTarget,
    EXPANSION_ROSTER_TARGET: EXPANSION_ROSTER_TARGET,
    relocateTeam: relocateTeam,
    checkAutoExpansion: checkAutoExpansion,
    AUTO_EXPANSION_MAX_TEAMS: AUTO_EXPANSION_MAX_TEAMS
  };
}
