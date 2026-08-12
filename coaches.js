var _COACH_DATA = (typeof require !== 'undefined')
  ? { teams: require('./teams.js'), names: require('./names.js') }
  : {
      teams: { TEAMS: TEAMS, getTeamById: getTeamById },
      names: {
        takenNameSet: takenNameSet, pickUniqueName: pickUniqueName,
        COACH_NAME_POOLS: COACH_NAME_POOLS
      }
    };

const COACH_SPECIALTIES = ['offense', 'defense', 'development'];

function coachSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

// The pools live in names.js now — they used to be a fifteen-by-fifteen list
// here, drawn from without checking, which is 225 possible coaches for a league
// that hires thirty at once and replaces them for decades.
//
// The caller may pass a `taken` set to share across a batch. Without one, each
// call rebuilds it from the coaches currently on benches, which stops a new
// coach from duplicating a sitting one but NOT from duplicating another coach
// made in the same loop — so any code generating more than one at a time is
// expected to pass a set and thread it through.
function coachNamesTaken() {
  return _COACH_DATA.names.takenNameSet(
    _COACH_DATA.teams.TEAMS.map(function (t) { return t.coach; }));
}

function generateCoachName(rng, taken) {
  return _COACH_DATA.names.pickUniqueName(
    rng, taken || coachNamesTaken(), _COACH_DATA.names.COACH_NAME_POOLS);
}

// specialty determines both the progression coach-fit gating (see
// progression.js's coachFitMultiplier) and the default playbook lean a newly
// hired coach nudges their team's strategy dials toward.
function generateCoach(rng, taken) {
  const name = generateCoachName(rng, taken);
  return {
    id: 'coach-' + coachSlug(name) + '-' + Math.floor(Math.random() * 1000000),
    name: name,
    overall: Math.round(55 + rng() * 40),
    specialty: COACH_SPECIALTIES[Math.floor(rng() * COACH_SPECIALTIES.length)],
    hireSeason: null,
    seasonsWithTeam: 0,
    awardsWon: []
  };
}

function ensureTeamCoach(team, rng) {
  if (!team.coach) team.coach = generateCoach(rng);
  if (!team.strategy) team.strategy = { pace: 0, threePointRate: 0 };
  return team.coach;
}

function ensureAllTeamsHaveCoaches(rng) {
  _COACH_DATA.teams.TEAMS.forEach(function (team) { ensureTeamCoach(team, rng); });
}

// One shared taken-set across the batch. Rebuilding it per coach would only
// exclude the coaches already on benches, so a shortlist of five could offer
// you the same man twice.
function generateCoachCandidates(rng, count) {
  const taken = coachNamesTaken();
  const candidates = [];
  for (let i = 0; i < count; i++) candidates.push(generateCoach(rng, taken));
  return candidates;
}

function hireCoach(team, coach, leagueYear) {
  team.coach = coach;
  coach.hireSeason = leagueYear;
  coach.seasonsWithTeam = 0;
}

// Called once per team at season end (mirrors finances.js's applySeasonEndFinances)
// so tenure only advances for coaches who actually finished a season with the team.
function tickCoachTenure(team) {
  if (team.coach) team.coach.seasonsWithTeam += 1;
}

// Fit multiplier in roughly [0.7, 1.15]: how well a player's skill lean
// matches their coach's specialty. A 'development' coach fits everyone
// reasonably; an 'offense'/'defense' specialist fits best when the player's
// stronger side matches the coach's focus. Feeds progression.js's Coachable/
// Stubborn gating, which previously applied unconditionally with no coach
// entity to check fit against.
function coachFitMultiplier(coach, player) {
  if (!coach) return 1;
  const overallFactor = coach.overall / 400; // 0.14 - 0.25ish across the coach pool
  if (coach.specialty === 'development') return 0.95 + overallFactor;
  const a = player.attributes;
  const offenseSkew = (a.insideScoring + a.midRange + a.threePoint + a.passing) / 4;
  const defenseSkew = (a.perimeterDefense + a.interiorDefense + a.steal + a.block) / 4;
  const matches = coach.specialty === 'offense' ? offenseSkew >= defenseSkew : defenseSkew > offenseSkew;
  return (matches ? 0.9 + overallFactor : 0.7 + overallFactor * 0.5);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    COACH_SPECIALTIES: COACH_SPECIALTIES,
    generateCoach: generateCoach,
    ensureTeamCoach: ensureTeamCoach,
    ensureAllTeamsHaveCoaches: ensureAllTeamsHaveCoaches,
    generateCoachCandidates: generateCoachCandidates,
    hireCoach: hireCoach,
    tickCoachTenure: tickCoachTenure,
    coachFitMultiplier: coachFitMultiplier
  };
}
