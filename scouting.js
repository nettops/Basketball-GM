var _SCOUTING_DATA = (typeof require !== 'undefined')
  ? { traits: require('./traits.js'), data: require('./data.js') }
  : { traits: { TRAIT_TAXONOMY_BY_KEY: TRAIT_TAXONOMY_BY_KEY, TRAIT_TIERS: TRAIT_TIERS },
      data: { RATING_MIN: RATING_MIN, RATING_MAX: RATING_MAX } };

function weeklyScoutPointsForTeam(team) {
  return 100 + Math.floor(team.prestige / 2);
}

// The sim is day-indexed (no existing week concept) — a week is a fixed 7-day
// block, so passive rollover can trigger purely from the day counter.
function currentWeek(dayIndex) {
  return Math.floor(Math.max(0, dayIndex) / 7);
}

function initScoutingState() {
  return { lastRolloverWeek: -1, pointsAvailable: 0, targets: {} };
}

function ensureTarget(state, targetId) {
  if (!state.targets[targetId]) state.targets[targetId] = { confidence: 0, watchlisted: false };
  return state.targets[targetId];
}

function setWatchlisted(state, targetId, watchlisted) {
  ensureTarget(state, targetId).watchlisted = watchlisted;
}

function bumpConfidence(state, targetId, amount) {
  const target = ensureTarget(state, targetId);
  target.confidence = Math.max(0, Math.min(100, target.confidence + amount));
}

// Called once per real day advanced (see league.js's simulateDate onDayComplete
// hook, wired up in Batch B). Own roster gains confidence fastest, opponents
// only on days you actually play them, and draft prospects get a "draft buzz"
// speed-up inside the final 30 days before the draft.
function tickPassiveScouting(state, team, dayIndex, ownRosterIds, playedOpponentIds, prospectIds, daysUntilDraft) {
  const week = currentWeek(dayIndex);
  if (week > state.lastRolloverWeek) {
    state.pointsAvailable = weeklyScoutPointsForTeam(team);
    state.lastRolloverWeek = week;
  }
  ownRosterIds.forEach(function (id) { bumpConfidence(state, id, 0.4); });
  playedOpponentIds.forEach(function (id) { bumpConfidence(state, id, 0.2); });
  const prospectGain = (daysUntilDraft !== null && daysUntilDraft !== undefined && daysUntilDraft <= 30) ? 0.3 : 0.15;
  prospectIds.forEach(function (id) { bumpConfidence(state, id, prospectGain); });
}

function allocateScoutPoints(state, targetId, points) {
  const spend = Math.max(0, Math.min(points, state.pointsAvailable));
  if (spend <= 0) return 0;
  state.pointsAvailable -= spend;
  const gain = 4 * Math.sqrt(spend / 10);
  bumpConfidence(state, targetId, gain);
  return gain;
}

function personalityBucket(value) {
  if (value < 35) return 'Low';
  if (value < 65) return 'Medium';
  return 'High';
}

function fuzzyPersonality(personality) {
  const out = {};
  Object.keys(personality).forEach(function (k) { out[k] = personalityBucket(personality[k]); });
  return out;
}

function fuzzyTraitLabel(traitInfo) {
  const tiers = _SCOUTING_DATA.traits.TRAIT_TIERS;
  const idx = tiers.indexOf(traitInfo.tier);
  const lo = tiers[Math.max(0, idx - 1)];
  const hi = tiers[Math.min(tiers.length - 1, idx + 1)];
  const def = _SCOUTING_DATA.traits.TRAIT_TAXONOMY_BY_KEY[traitInfo.key];
  return { key: traitInfo.key, name: def ? def.name : traitInfo.key, rangeLabel: lo + '-' + hi };
}

// BADGES ARE NOT GATED for players on an NBA roster. They were, and it meant
// most players never saw most badges — you had to spend scout points to learn
// what your own signings were, which is a tax rather than a decision. Scouting
// keeps its job: personality and tendencies still unlock at 30% and 70%, and
// those are the things worth scouting because they are not visible from play.
//
// PROSPECTS ARE THE EXCEPTION. Seeing a draft pick's exact tier would remove
// most of draft night's risk, so they get the fuzzy path — WHICH badges, and a
// tier range, but never the exact tier.
//
// `level` means ONE thing: how far scouting has revealed PERSONALITY and
// TENDENCIES — hidden / fuzzy / exact, at the same 30% and 70% thresholds as
// before. Badge visibility is a SEPARATE axis with its own field.
//
// An earlier version of this change folded both into `level`: a rostered player
// got a new level 'badges', and a prospect got 'fuzzy' whatever the confidence.
// Every consumer branching on `level` to decide whether personality existed
// then broke — 'badges' fell through to the exact branch, and 'fuzzy' promised
// a personality object that was null, so ui/playerProfile.js threw
// Object.keys(null) on any unscouted player. Two meanings in one field caused
// that, so there are two fields.
function getRevealedView(player, confidence, isProspect) {
  const base = {
    traits: isProspect ? (player.hiddenTraits || []).map(fuzzyTraitLabel) : (player.hiddenTraits || []),
    traitsAreFuzzy: !!isProspect
  };
  if (confidence < 30) {
    return Object.assign(base, { level: 'hidden', personality: null, tendencies: null });
  }
  if (confidence < 70) {
    return Object.assign(base, {
      level: 'fuzzy',
      personality: fuzzyPersonality(player.hiddenPersonality || {}),
      tendencies: null
    });
  }
  return Object.assign(base, {
    level: 'exact',
    personality: player.hiddenPersonality,
    tendencies: player.hiddenTendencies
  });
}


// ---------------------------------------------------------------------------
// What a scout can actually tell you the player is worth.
//
// getRevealedView above fogs personality, tendencies and traits, and until now
// that was the whole of scouting — the OVERALL RATING was never fogged at all.
// The draft board printed the true number in a column beside a pill reading
// "Unscouted", and then sorted the board by that same true number, so the best
// prospect available was always the top row whether you had spent a scouting
// point or not. Every part of the scouting system was decorative next to that.
//
// Two properties matter here:
//
// 1. The band is NOT centred on the truth. A range that always brackets the
//    real number symmetrically hands you the answer as its midpoint, which is
//    the same leak wearing a disguise. Each player carries a stable bias, so
//    an unscouted read can be genuinely wrong in a direction.
// 2. It is DETERMINISTIC per player. Scouting reports must not reshuffle every
//    time the table repaints, and a re-rollable number could be averaged out
//    by opening and closing the view.
const SCOUT_BAND_HIDDEN = 8;
const SCOUT_BAND_FUZZY = 4;

function _scoutHash(id) {
  const str = String(id);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h;
}

// { level, low, high, exact } — exact is the true rating and is non-null only
// when the player is fully scouted. Callers must display low..high otherwise,
// and must sort by the midpoint rather than by the true rating.
function scoutedOverallRange(player, confidence) {
  // `overall`, not `rawOverall`. They are different scales — A.J. Dybantsa
  // shows 81 on the draft board and carries a rawOverall of 38 — and this
  // function has to fog the number the column actually prints, or a fully
  // scouted prospect reads 38 where the board used to say 81. Caught in the
  // browser against real prospects; the first fixtures held the two equal and
  // could not see it, which is why the validator now sets them apart.
  const truth = typeof player.overall === 'number' ? player.overall : (player.rawOverall || 0);
  const min = _SCOUTING_DATA.data.RATING_MIN;
  const max = _SCOUTING_DATA.data.RATING_MAX;
  if (confidence >= 70) {
    return { level: 'exact', low: truth, high: truth, exact: truth };
  }
  const band = confidence >= 30 ? SCOUT_BAND_FUZZY : SCOUT_BAND_HIDDEN;
  const bias = (_scoutHash(player.id) % (band + 1)) - Math.round(band / 2);
  const mid = truth + bias;
  return {
    level: confidence >= 30 ? 'fuzzy' : 'hidden',
    low: Math.max(min, mid - band),
    high: Math.min(max, mid + band),
    exact: null
  };
}

// What to print in an OVR column. One place, so no view can accidentally
// render the truth next to an "Unscouted" pill again.
function scoutedOverallLabel(range) {
  return range.exact !== null ? String(range.exact) : range.low + '–' + range.high;
}

// What to SORT by. The midpoint of what the club believes, never the truth.
function scoutedOverallSortKey(range) {
  return range.exact !== null ? range.exact : (range.low + range.high) / 2;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    weeklyScoutPointsForTeam: weeklyScoutPointsForTeam,
    currentWeek: currentWeek,
    initScoutingState: initScoutingState,
    setWatchlisted: setWatchlisted,
    tickPassiveScouting: tickPassiveScouting,
    allocateScoutPoints: allocateScoutPoints,
    getRevealedView: getRevealedView,
    scoutedOverallRange: scoutedOverallRange,
    scoutedOverallLabel: scoutedOverallLabel,
    scoutedOverallSortKey: scoutedOverallSortKey,
    SCOUT_BAND_HIDDEN: SCOUT_BAND_HIDDEN,
    SCOUT_BAND_FUZZY: SCOUT_BAND_FUZZY,
    personalityBucket: personalityBucket
  };
}
