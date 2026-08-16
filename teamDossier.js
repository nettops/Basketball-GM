// The summary a GM sees about a franchise BEFORE taking the job — best player,
// where the roster ranks, what the books look like, and a one-line read on what
// the job actually is.
//
// Lives at the root rather than in ui/ because it derives from game data
// (PLAYERS_2026, TEAMS, the cap constants) and holds no markup. ui/teamSelect.js
// is its only caller today, but nothing here knows that.
//
// Two of these numbers are shaped by what the data actually looks like rather
// than what seemed natural to show:
//
//   - Roster strength is reported as a RANK, not a rating. Average top-8
//     overall spans just 79.8 to 85.3 across all thirty teams, so a bar or a
//     score would look near-identical for every club and carry no information.
//     "2nd of 30" separates them; "84.9" does not.
//   - The books are reported as PAYROLL, not cap space. 26 of 30 teams open
//     over the cap, so a cap-space figure would be a negative number almost
//     everywhere — technically true and useless to read.

// How many of a team's best players count toward its strength. Eight is roughly
// a playoff rotation: deep enough that one star cannot carry the number, shallow
// enough that the 14th man cannot drag it.
const DOSSIER_ROTATION_SIZE = 8;

// The rank table depends only on the league's starting rosters, which never
// change during team select, so it is built once on first use.
let _dossierRanks = null;

function rosterStrength(teamId) {
  const rotation = getTeamRoster(teamId)
    .slice()
    .sort(function (a, b) { return b.overall - a.overall; })
    .slice(0, DOSSIER_ROTATION_SIZE);
  if (!rotation.length) return 0;
  return rotation.reduce(function (sum, p) { return sum + p.overall; }, 0) / rotation.length;
}

function getRosterRanks() {
  if (_dossierRanks) return _dossierRanks;
  const ranked = TEAMS.map(function (t) {
    return { id: t.id, strength: rosterStrength(t.id) };
  }).sort(function (a, b) { return b.strength - a.strength; });
  _dossierRanks = {};
  ranked.forEach(function (row, i) { _dossierRanks[row.id] = i + 1; });
  return _dossierRanks;
}

function capStatus(payroll, capLevel) {
  if (payroll > getEffectiveLuxuryTaxLine(capLevel)) {
    return { level: 'bad', label: 'Over the tax line' };
  }
  if (payroll > getEffectiveSalaryCap(capLevel)) {
    return { level: 'warn', label: 'Over the cap' };
  }
  return { level: 'ok', label: 'Room to spend' };
}

// Six reads, keyed on the two things that actually decide what the job is:
// how good the roster is and whether the books let you change it.
function teamVerdict(d) {
  const broke = d.cap.level === 'bad';
  if (d.rank <= 6) {
    return broke
      ? 'Loaded and expensive. You inherit a genuine contender and a payroll that punishes every mistake — there is no cheap way to fix this roster if it stalls.'
      : 'One of the best rosters in the league with the books still under control. The rare job where you can win now and keep your options.';
  }
  if (d.rank <= 18) {
    return d.timeline === 'rebuilding'
      ? 'Middling on paper and already pointed at the future. Nobody expects a run this year, which is exactly the freedom you want.'
      : 'Squarely in the middle, which is the hardest place to be — not good enough to scare anyone, not bad enough for a top pick. One correct move either way decides the next five seasons.';
  }
  return broke
    ? 'A hard job. Bottom of the league on talent and over the tax line for the privilege. Getting out of this takes patience and at least one painful trade.'
    : 'A teardown, and everyone knows it. Nothing is expected for three years — so whatever this becomes is entirely yours.';
}

function getTeamDossier(teamId, capLevel) {
  const team = getTeamById(teamId);
  const roster = getTeamRoster(teamId).slice().sort(function (a, b) { return b.overall - a.overall; });
  const payroll = getTeamPayroll(teamId);
  const best = roster[0] || null;
  const dossier = {
    team: team,
    best: best ? { name: best.name, overall: best.overall, age: best.age } : null,
    rank: getRosterRanks()[teamId],
    size: roster.length,
    payroll: payroll,
    cap: capStatus(payroll, capLevel || 1),
    timeline: team.timeline,
    // Guarded: a team with no players would divide by zero, and an empty roster
    // is reachable through the commissioner tools.
    avgAge: roster.length
      ? Math.round((roster.reduce(function (s, p) { return s + p.age; }, 0) / roster.length) * 10) / 10
      : 0
  };
  dossier.verdict = teamVerdict(dossier);
  return dossier;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getTeamDossier: getTeamDossier,
    getRosterRanks: getRosterRanks,
    rosterStrength: rosterStrength,
    teamVerdict: teamVerdict,
    capStatus: capStatus
  };
}
