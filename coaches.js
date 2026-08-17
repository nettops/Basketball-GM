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

// The playbook a coach believes in, which is what makes his specialty visible
// on the floor instead of only in progression maths.
//
// An offensive coach wants to run and to shoot from range; a defensive one
// wants a half-court game and shots closer in; a development coach has no
// axe to grind either way. Those are the three specialties that already exist,
// so the lean is derived from the coach rather than being a fourth thing to
// generate and keep consistent.
//
// The three leans sum to zero across the pool, which is deliberate and load
// bearing: specialty is drawn uniformly, so the LEAGUE's average pace and shot
// mix stay exactly where they were calibrated. Thirty coaches with opinions
// should make the league varied, not faster.
const COACH_LEAN_BY_SPECIALTY = {
  offense: { pace: 1, threePointRate: 1 },
  defense: { pace: -1, threePointRate: -1 },
  development: { pace: 0, threePointRate: 0 }
};

// How often a coach actually acts on his lean rather than sitting balanced.
// Below 1 so two offensive coaches are not the same coach — some believe in it
// and some are pragmatists — and so roughly a third of the league sits neutral
// on any given dial, which keeps a Balanced setting normal rather than odd.
const COACH_CONVICTION = 0.6;

// Rolled once, when the coach is created, and stored on him. Deriving it on
// every read would need an rng at every call site and would let the same coach
// change his mind between screens.
function rollCoachLean(specialty, rng) {
  const base = COACH_LEAN_BY_SPECIALTY[specialty] || COACH_LEAN_BY_SPECIALTY.development;
  return {
    pace: rng() < COACH_CONVICTION ? base.pace : 0,
    threePointRate: rng() < COACH_CONVICTION ? base.threePointRate : 0
  };
}

// A sentence for the coach card, so hiring is an informed choice rather than a
// number and a label. Reads the lean rather than the specialty, because a
// pragmatic offensive coach genuinely does play balanced and the card should
// say so.
function coachLeanLabel(coach) {
  if (!coach || !coach.lean) return 'Balanced';
  const parts = [];
  if (coach.lean.pace > 0) parts.push('runs');
  else if (coach.lean.pace < 0) parts.push('slows it down');
  if (coach.lean.threePointRate > 0) parts.push('shoots threes');
  else if (coach.lean.threePointRate < 0) parts.push('works inside');
  return parts.length ? parts.join(', ') : 'Balanced';
}

// Applies a coach's playbook to the team he is now in charge of. Separate from
// hireCoach so ensureTeamCoach can use it too, and so the one place that
// overwrites a user's dials is easy to find.
function applyCoachLean(team, coach) {
  if (!team || !coach || !coach.lean) return;
  team.strategy = { pace: coach.lean.pace, threePointRate: coach.lean.threePointRate };
}

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
  const specialty = COACH_SPECIALTIES[Math.floor(rng() * COACH_SPECIALTIES.length)];
  return {
    id: 'coach-' + coachSlug(name) + '-' + Math.floor(Math.random() * 1000000),
    name: name,
    overall: Math.round(55 + rng() * 40),
    specialty: specialty,
    // Rolled after specialty, from the same stream, so a coach's playbook is
    // fixed the moment he exists and never drifts.
    lean: rollCoachLean(specialty, rng),
    hireSeason: null,
    seasonsWithTeam: 0,
    awardsWon: []
  };
}

function ensureTeamCoach(team, rng) {
  if (!team.coach) team.coach = generateCoach(rng);
  // A coach loaded from a save made before playbooks existed has no lean.
  // Backfilled here rather than left null so an existing league gets the
  // variety too, instead of thirty permanently balanced benches.
  if (!team.coach.lean) team.coach.lean = rollCoachLean(team.coach.specialty, rng);
  // Only when the team has no dials at all. This runs on every draw of the
  // coaching screen, and a coach re-imposing his playbook over a GM who had
  // just changed it would make the control unusable.
  if (!team.strategy) applyCoachLean(team, team.coach);
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
  // Hiring a coach IS choosing a playbook — that is what makes the choice
  // between three candidates a decision rather than a comparison of one
  // number. It overwrites whatever the dials were set to, deliberately, and the
  // coaching screen redraws immediately so the change is visible in the two
  // dropdowns. A GM who disagrees can move them straight back.
  applyCoachLean(team, coach);
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
    coachFitMultiplier: coachFitMultiplier,
    COACH_LEAN_BY_SPECIALTY: COACH_LEAN_BY_SPECIALTY,
    COACH_CONVICTION: COACH_CONVICTION,
    rollCoachLean: rollCoachLean,
    coachLeanLabel: coachLeanLabel,
    applyCoachLean: applyCoachLean
  };
}
