var _COACH_DATA = (typeof require !== 'undefined')
  ? { teams: require('./teams.js') }
  : { teams: { TEAMS: TEAMS, getTeamById: getTeamById } };

const COACH_SPECIALTIES = ['offense', 'defense', 'development'];

// Deliberately distinct from draftProspects.js's FIRST_NAMES/LAST_NAMES —
// both load as plain global scripts in the browser, so reusing those names
// here would shadow one or the other (see the clampRating collision this
// project already hit in commissioner.js/progression.js).
const COACH_FIRST_NAMES = ['Gregg', 'Erik', 'Steve', 'Nate', 'Monty', 'Chauncey', 'Ime', 'Mike', 'Joe', 'Will', 'Taylor', 'Charles', 'Quin', 'Frank', 'Dawn'];
const COACH_LAST_NAMES = ['Sorensen', 'Whitfield', 'Mercer', 'Bradley', 'Holloway', 'Vance', 'Griggs', 'Donovan', 'Castillo', 'Reyes', 'Pierce', 'Lindgren', 'Okafor', 'Mathis', 'Sanborn'];

function coachSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function generateCoachName(rng) {
  return COACH_FIRST_NAMES[Math.floor(rng() * COACH_FIRST_NAMES.length)] + ' ' + COACH_LAST_NAMES[Math.floor(rng() * COACH_LAST_NAMES.length)];
}

// specialty determines both the progression coach-fit gating (see
// progression.js's coachFitMultiplier) and the default playbook lean a newly
// hired coach nudges their team's strategy dials toward.
function generateCoach(rng) {
  const name = generateCoachName(rng);
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

function generateCoachCandidates(rng, count) {
  const candidates = [];
  for (let i = 0; i < count; i++) candidates.push(generateCoach(rng));
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
