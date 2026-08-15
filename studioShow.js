// The halftime studio show: four analysts on a desk, talking about your game.
//
// Watch-only by design. There are no choices and no effects here — the payoff
// is hearing the panel react to what you just did, not answering for it. That
// is also why this is its own file rather than more entries in
// dialogueScenes.js: those scenes exist to be ANSWERED, and every check in
// validate-dialogueScenes.js is about choices and effect channels.
//
// Pure data, like dialogueScenes.js: no DOM, no game imports, no _X_DATA
// bridge. Selection takes its rng by argument so a save replays the same show.

// Who throws to the break. Every segment opens and closes on him.
const STUDIO_HOST_KEY = 'ernie';

// The desk, in seating order. Traits change the OUTLINE, not just the palette
// — see ui/pixelBust.js. Four men who differ only by colour read as one man in
// four suits at this size, which validate-studioShow.js asserts against.
const STUDIO_CREW = [
  {
    key: 'ernie',
    name: 'Ernie',
    colors: { skin: '#e0b48f', hair: '#c9cdd2', jersey: '#242c3a', trim: '#8fa3bd', glasses: '#cdd6e2' },
    traits: { hair: 'receding', glasses: true, build: 'normal', facialHair: 'none' }
  },
  {
    key: 'kenny',
    name: 'Kenny',
    colors: { skin: '#8d5a3c', hair: '#241f1c', jersey: '#3a2f45', trim: '#b39ccc' },
    traits: { hair: 'short', glasses: false, build: 'normal', facialHair: 'none' }
  },
  {
    key: 'charles',
    name: 'Charles',
    colors: { skin: '#6f4429', hair: '#241f1c', jersey: '#2c3a2f', trim: '#9dc4a8' },
    traits: { hair: 'bald', glasses: false, build: 'broad', facialHair: 'none' }
  },
  {
    key: 'shaq',
    name: 'Shaq',
    colors: { skin: '#5d3a22', hair: '#1a1614', jersey: '#3a2b24', trim: '#c9a17a' },
    traits: { hair: 'bald', glasses: false, build: 'huge', facialHair: 'goatee' }
  }
];

const STUDIO_CREW_BY_KEY = {};
STUDIO_CREW.forEach(function (m) { STUDIO_CREW_BY_KEY[m.key] = m; });

function studioCrewMember(key) {
  return STUDIO_CREW_BY_KEY[key] || null;
}

// Segments. `when` reads the same flat halftime context the coach scenes do.
//
// No two adjacent beats share a speaker: two lines from one man in a row reads
// as one long line rather than as a panel, and the validator enforces it.
const STUDIO_SEGMENTS = [
  {
    id: 'studio-blowout-against',
    priority: 70,
    when: function (c) { return c.trailing && c.margin >= 15; },
    beats: [
      { who: 'ernie', emotion: 'neutral', text: "Halftime, and it is not close — the {teamName} are down {margin} to the {opponentName}. Kenny, what are you seeing?" },
      { who: 'kenny', emotion: 'neutral', text: "They're settling, Ernie. Everything's a jumper. Nobody is getting downhill." },
      { who: 'charles', emotion: 'angry', text: "Nobody is getting BACK, Kenny! They guarded nobody for twenty-four minutes." },
      { who: 'shaq', emotion: 'confident', text: "He's right. That ain't scheme. That's effort, and effort is free." },
      { who: 'charles', emotion: 'angry', text: "Turrible. Just turrible." },
      { who: 'ernie', emotion: 'confident', text: "Well, they've got twenty-four more to answer that. Second half coming up." }
    ]
  },
  {
    id: 'studio-trailing',
    priority: 45,
    when: function (c) { return c.trailing && c.margin >= 6; },
    beats: [
      { who: 'ernie', emotion: 'neutral', text: "Down {margin} at the half in a game the {teamName} needed. Shaq?" },
      { who: 'shaq', emotion: 'neutral', text: "It's manageable. One run and we're right back in this thing." },
      { who: 'charles', emotion: 'angry', text: "Manageable? They've been 'one run away' all season and the run never comes!" },
      { who: 'kenny', emotion: 'confident', text: "It comes when they stop settling. Get to the rim once and the whole thing opens up." },
      { who: 'ernie', emotion: 'neutral', text: "We'll find out shortly. Back after this." }
    ]
  },
  {
    id: 'studio-big-lead',
    priority: 60,
    when: function (c) { return c.leading && c.margin >= 15; },
    beats: [
      { who: 'ernie', emotion: 'confident', text: "The {teamName} are up {margin} and it has been a clinic. {topScorerName} with {topScorerPoints} already." },
      { who: 'charles', emotion: 'confident', text: "I like it. When they play like that they're a problem for anybody." },
      { who: 'kenny', emotion: 'neutral', text: "The question is whether they keep the foot down. Leads like this disappear." },
      { who: 'shaq', emotion: 'angry', text: "Not if you keep punishing them inside, they don't. You don't get cute with a lead." },
      { who: 'ernie', emotion: 'confident', text: "Second half on the way. Stay with us." }
    ]
  },
  {
    id: 'studio-leading',
    priority: 40,
    when: function (c) { return c.leading; },
    beats: [
      { who: 'ernie', emotion: 'neutral', text: "The {teamName} take a {margin}-point lead into the locker room. Charles?" },
      { who: 'charles', emotion: 'neutral', text: "It's a lead. It ain't safe. Ask me again in twelve minutes." },
      { who: 'shaq', emotion: 'confident', text: "That's a first — Chuck being careful." },
      { who: 'kenny', emotion: 'confident', text: "He's been burned before, Shaq. We all have." },
      { who: 'ernie', emotion: 'neutral', text: "Back in a moment with the second half." }
    ]
  },
  {
    id: 'studio-playoff-tight',
    priority: 85,
    when: function (c) { return c.isPlayoff && c.margin <= 6; },
    beats: [
      { who: 'ernie', emotion: 'neutral', text: "Playoff basketball, {margin} points in it at the half. This is what we came for." },
      { who: 'kenny', emotion: 'confident', text: "Whoever gets the first stop of the third quarter wins this game. I mean that." },
      { who: 'charles', emotion: 'angry', text: "You always say that! But this time — yeah, alright, this time you're right." },
      { who: 'shaq', emotion: 'confident', text: "Somebody's gotta want it more. That simple." },
      { who: 'ernie', emotion: 'confident', text: "Twenty-four minutes to decide it. Don't move." }
    ]
  },
  {
    // The catch-all. There is no generic pool to fall back on the way the
    // interview scenes have, so one segment must accept ANY halftime or the
    // show silently does nothing on an ordinary night.
    id: 'studio-even',
    priority: 0,
    when: function () { return true; },
    beats: [
      { who: 'ernie', emotion: 'neutral', text: "Dead even at the half between the {teamName} and the {opponentName}. Kenny, who has the edge?" },
      { who: 'kenny', emotion: 'neutral', text: "Nobody yet. That's why you watch the third quarter." },
      { who: 'charles', emotion: 'confident', text: "I'll tell you who has the edge — whoever decides to guard somebody." },
      { who: 'shaq', emotion: 'confident', text: "For once, I agree with him." },
      { who: 'ernie', emotion: 'neutral', text: "Mark the moment. Second half, straight ahead." }
    ]
  }
];

// Same shape as dialogueScenes.selectScene, minus the fallback pool: the
// catch-all segment above plays that role, so this never returns null.
//
// The recent-segments list is a PREFERENCE, not a veto — if everything has
// aired recently the show still goes on rather than silently skipping.
function studioSelectSegment(ctx, opts) {
  opts = opts || {};
  const pool = opts.segments || STUDIO_SEGMENTS;
  const recent = opts.recent || [];
  const rand = opts.rand || Math.random;

  function eligible(skipRecent) {
    const out = [];
    for (let i = 0; i < pool.length; i++) {
      const s = pool[i];
      if (skipRecent && recent.indexOf(s.id) !== -1) continue;
      let ok = false;
      try {
        ok = !!s.when(ctx);
      } catch (err) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('studio segment "' + s.id + '" predicate threw: ' + err.message);
        }
        continue;
      }
      if (ok) out.push(s);
    }
    return out;
  }

  let candidates = eligible(true);
  if (candidates.length === 0) candidates = eligible(false);
  if (candidates.length === 0) return null;

  let top = candidates[0].priority;
  for (let i = 1; i < candidates.length; i++) {
    if (candidates[i].priority > top) top = candidates[i].priority;
  }
  const tied = candidates.filter(function (s) { return s.priority === top; });
  return tied[Math.floor(rand() * tied.length)];
}

// The declarations above carry STUDIO_ prefixes because in the browser every
// root file shares ONE global scope, and bare names like CREW or SEGMENTS are
// exactly the kind that collide silently later (see commissioner.js's
// clampRating shadowing progression.js's). The export KEYS are scoped to this
// object and can stay plain.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    HOST_KEY: STUDIO_HOST_KEY,
    CREW: STUDIO_CREW,
    SEGMENTS: STUDIO_SEGMENTS,
    crewMember: studioCrewMember,
    selectSegment: studioSelectSegment
  };
}
