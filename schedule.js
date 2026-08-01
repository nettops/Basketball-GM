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
  // guaranteeing exactly 3 four-game + 2 three-game partners per team per other division
  // (6 four-game + 4 three-game total across both other divisions).
  CONFS.forEach(function (conf) {
    const divs = DIVS[conf];
    for (let d1 = 0; d1 < divs.length; d1++) {
      for (let d2 = d1 + 1; d2 < divs.length; d2++) {
        const teamsA = TEAMS_LIST.filter(function (t) { return t.conference === conf && t.division === divs[d1]; });
        const teamsB = TEAMS_LIST.filter(function (t) { return t.conference === conf && t.division === divs[d2]; });
        const r = Math.floor(rng() * 5);
        for (let a = 0; a < 5; a++) {
          for (let b = 0; b < 5; b++) {
            const isFourGame = (b - a - r + 25) % 5 <= 2;
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
