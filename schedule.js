var _SCHED_DATA = (typeof require !== 'undefined')
  ? { data: require('./data.js'), teams: require('./teams.js') }
  : { data: { CONFERENCES: CONFERENCES, DIVISIONS: DIVISIONS }, teams: { TEAMS: TEAMS } };

function generateMatchupCounts(rng) {
  const TEAMS_LIST = _SCHED_DATA.teams.TEAMS;
  const CONFS = _SCHED_DATA.data.CONFERENCES;
  const DIVS = _SCHED_DATA.data.DIVISIONS;

  const gamesCount = {};
  TEAMS_LIST.forEach(function (t) { gamesCount[t.id] = {}; });

  function setGames(a, b, n) {
    gamesCount[a][b] = n;
    gamesCount[b][a] = n;
  }

  // 1. Division rivals: 4 games each.
  CONFS.forEach(function (conf) {
    DIVS[conf].forEach(function (div) {
      const divTeams = TEAMS_LIST.filter(function (t) { return t.conference === conf && t.division === div; });
      for (let i = 0; i < divTeams.length; i++) {
        for (let j = i + 1; j < divTeams.length; j++) {
          setGames(divTeams[i].id, divTeams[j].id, 4);
        }
      }
    });
  });

  // 2. Non-division conference opponents: circulant construction per division-pair,
  // guaranteeing a fixed 4-game/3-game split per team per other division (at the
  // standard 5-team division: 3 four-game + 2 three-game partners, i.e. 6 and 4
  // across both other divisions).
  //
  // Sized off the actual division lengths rather than a hardcoded 5. An
  // expansion team (commissioner.js's createExpansionTeam) puts 6 teams in one
  // division, and the old `a < 5 / b < 5` bounds left gamesCount undefined for
  // every pair involving that 6th team — which expandToGameList below then read
  // as `Math.floor(undefined / 2)`, i.e. NaN, silently emitting zero games
  // instead of throwing. The circulant works for unequal division sizes too:
  // indexing the offset modulo the OTHER division's length keeps each team's
  // partner count well-defined in both directions.
  CONFS.forEach(function (conf) {
    const divs = DIVS[conf];
    for (let d1 = 0; d1 < divs.length; d1++) {
      for (let d2 = d1 + 1; d2 < divs.length; d2++) {
        const teamsA = TEAMS_LIST.filter(function (t) { return t.conference === conf && t.division === divs[d1]; });
        const teamsB = TEAMS_LIST.filter(function (t) { return t.conference === conf && t.division === divs[d2]; });
        if (teamsA.length === 0 || teamsB.length === 0) continue;
        const span = Math.max(teamsA.length, teamsB.length);
        // 3 of every 5 partners play four games — preserves the exact 3/2 split
        // at the standard size and degrades sensibly at any other size.
        const fourGameCutoff = Math.floor(span * 0.6);
        const r = Math.floor(rng() * span);
        for (let a = 0; a < teamsA.length; a++) {
          for (let b = 0; b < teamsB.length; b++) {
            const isFourGame = (((b - a - r) % span) + span) % span < fourGameCutoff;
            setGames(teamsA[a].id, teamsB[b].id, isFourGame ? 4 : 3);
          }
        }
      }
    }
  });

  // 3. Inter-conference: 2 games each.
  TEAMS_LIST.forEach(function (a) {
    TEAMS_LIST.forEach(function (b) {
      if (a.conference !== b.conference && a.id < b.id) {
        setGames(a.id, b.id, 2);
      }
    });
  });

  return gamesCount;
}

const SEASON_DAYS = 175; // late-Oct to mid-Apr, generously bounds the ~127 days the
                          // verified prototype actually needed to fit all 1,230 games

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
}

function expandToGameList(gamesCount, teamsList, rng) {
  const gameList = [];
  let gid = 0;
  teamsList.forEach(function (a) {
    teamsList.forEach(function (b) {
      if (a.id < b.id) {
        const n = gamesCount[a.id][b.id];
        // Fail loudly rather than silently emitting zero games. A missing count
        // used to flow through as NaN here and drop the matchup entirely, which
        // is how an expansion team ended up playing a partial schedule with no
        // error anywhere.
        if (typeof n !== 'number' || !isFinite(n)) {
          throw new Error('expandToGameList: no matchup count for ' + a.id + ' vs ' + b.id);
        }
        const aHome = Math.floor(n / 2) + (n % 2 === 1 ? Math.round(rng()) : 0);
        const bHome = n - aHome;
        for (let i = 0; i < aHome; i++) gameList.push({ id: gid++, home: a.id, away: b.id });
        for (let i = 0; i < bHome; i++) gameList.push({ id: gid++, home: b.id, away: a.id });
      }
    });
  });
  return gameList;
}

// Greedily assigns each game to the earliest day where neither team would end up
// with 2 games in the trailing 3-day window (i.e. no team plays 3 games in 3 days).
function assignDates(gameList, teamsList, rng) {
  shuffle(gameList, rng);
  const teamIdx = {};
  teamsList.forEach(function (t, i) { teamIdx[t.id] = i; });
  const lastGameDays = teamsList.map(function () { return []; });

  function eligible(teamId, day) {
    const recent = lastGameDays[teamIdx[teamId]].filter(function (d) { return d >= day - 2; });
    return recent.length < 2;
  }

  let pending = gameList.slice();
  const assigned = [];

  for (let day = 0; day < SEASON_DAYS && pending.length > 0; day++) {
    const scheduledToday = {};
    const stillPending = [];
    pending.forEach(function (g) {
      if (!scheduledToday[g.home] && !scheduledToday[g.away] && eligible(g.home, day) && eligible(g.away, day)) {
        assigned.push({ id: g.id, home: g.home, away: g.away, day: day });
        scheduledToday[g.home] = true;
        scheduledToday[g.away] = true;
        [g.home, g.away].forEach(function (teamId) {
          lastGameDays[teamIdx[teamId]] = lastGameDays[teamIdx[teamId]].filter(function (d) { return d >= day - 2; }).concat([day]);
        });
      } else {
        stillPending.push(g);
      }
    });
    pending = stillPending;
  }

  if (pending.length > 0) {
    throw new Error('assignDates: ' + pending.length + ' games could not be scheduled within ' + SEASON_DAYS + ' days');
  }
  return assigned;
}

function generateSeasonGames(rng, teamsList) {
  const gamesCount = generateMatchupCounts(rng);
  const gameList = expandToGameList(gamesCount, teamsList, rng);
  return assignDates(gameList, teamsList, rng);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { generateMatchupCounts: generateMatchupCounts, generateSeasonGames: generateSeasonGames };
}
