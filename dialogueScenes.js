// Dialogue scene definitions and selection.
//
// Deliberately PURE: no DOM, no game imports, no _X_DATA bridge. A scene's
// `when` reads a flat fact object and a choice's `effect` RETURNS a
// description of a change rather than applying one. That is what lets the
// whole library be tested with no game state, and it is why dialogueContext.js
// exists as the single place that knows both worlds.
//
// Adding a scene is appending an object to SCENES. validate-dialogueScenes.js
// then checks its tokens, emotions, effect channels and morale scale for you.

const FALLBACK_SCENE_ID = 'generic-media';

// Used only when the caller supplies none. dialogueContext.js passes the
// media_standard pool from narrativeSystem.js, which is where the game's
// existing generic press lines already live.
const DEFAULT_FALLBACK_LINES = [
  'How are you feeling about your performance?',
  "What's your take on the team's direction?",
  'Any message for the fans tonight?'
];

const TOKEN_RE = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

function tokensIn(text) {
  const out = [];
  const re = new RegExp(TOKEN_RE.source, 'g');
  let m;
  while ((m = re.exec(String(text))) !== null) {
    if (out.indexOf(m[1]) === -1) out.push(m[1]);
  }
  return out;
}

// A missing token is left verbatim rather than printed as "undefined": a
// visible {brace} in the game gets reported as a bug, and "undefined" gets
// shrugged at. Single-pass, so a value that is itself brace-shaped is not
// re-scanned.
function interpolate(text, ctx) {
  return String(text).replace(new RegExp(TOKEN_RE.source, 'g'), function (whole, key) {
    const v = ctx ? ctx[key] : undefined;
    return (v === undefined || v === null) ? whole : String(v);
  });
}

function buildFallbackScene(ctx, rand, fallbackLines) {
  const pool = (fallbackLines && fallbackLines.length) ? fallbackLines : DEFAULT_FALLBACK_LINES;
  const line = pool[Math.floor(rand() * pool.length)];
  return {
    id: FALLBACK_SCENE_ID,
    moment: ctx.moment,
    roles: [ctx.role],
    priority: -1,
    when: function () { return true; },
    speaker: { kind: 'reporter' },
    lines: [{ emotion: 'neutral', text: line }],
    // Nothing interesting happened, so nothing is at stake. Every reply here
    // is flavour by construction.
    choices: [
      { text: 'Give the honest answer.', emotion: 'neutral', effect: null },
      { text: 'Keep it short.', emotion: 'neutral', effect: null }
    ]
  };
}

function selectScene(ctx, opts) {
  opts = opts || {};
  const pool = opts.scenes || SCENES;
  const recent = opts.recent || [];
  const rand = opts.rand || Math.random;

  const eligible = [];
  for (let i = 0; i < pool.length; i++) {
    const s = pool[i];
    if (s.moment !== ctx.moment) continue;
    if (s.roles.indexOf(ctx.role) === -1) continue;
    if (recent.indexOf(s.id) !== -1) continue;
    let ok = false;
    try {
      ok = !!s.when(ctx);
    } catch (err) {
      // One bad predicate must not cost the user their post-game.
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('dialogue scene "' + s.id + '" predicate threw: ' + err.message);
      }
      continue;
    }
    if (ok) eligible.push(s);
  }

  if (eligible.length === 0) return buildFallbackScene(ctx, rand, opts.fallbackLines);

  let top = eligible[0].priority;
  for (let i = 1; i < eligible.length; i++) {
    if (eligible[i].priority > top) top = eligible[i].priority;
  }
  const tied = eligible.filter(function (s) { return s.priority === top; });
  return tied[Math.floor(rand() * tied.length)];
}

const SCENES = [
  // ---- post-game ----
  {
    id: 'blown-fourth-lead',
    moment: 'postgame',
    roles: ['gm', 'player'],
    priority: 70,
    when: function (c) { return c.userLost && c.leadBlown >= 8; },
    speaker: { kind: 'reporter' },
    lines: [
      { emotion: 'neutral', text: 'Up {leadBlown} going into the fourth.' },
      { emotion: 'angry', text: 'You lose by {margin}. What happened to the {teamName} in those twelve minutes?' }
    ],
    choices: [
      { text: 'That one is on me.', emotion: 'shaken',
        effect: function (c) {
          return { teamMorale: 1.5, reputation: 1,
            chronicle: 'Took the blame for a blown lead against the ' + c.opponentName + '.' };
        } },
      { text: 'Ask the guys who stopped competing.', emotion: 'angry',
        effect: function (c) {
          return { teamMorale: -2.5, reputation: -2,
            chronicle: 'Called out the roster in the press after losing to the ' + c.opponentName + '.' };
        } },
      { text: "It's a long season.", emotion: 'neutral', effect: null }
    ]
  },
  {
    id: 'star-carried-a-loss',
    moment: 'postgame',
    roles: ['gm'],
    priority: 55,
    when: function (c) { return c.userLost && c.topScorerPoints >= 35; },
    speaker: { kind: 'reporter' },
    lines: [
      { emotion: 'neutral', text: '{topScorerName} goes for {topScorerPoints} and you still lose by {margin}.' },
      { emotion: 'neutral', text: 'How long can one man carry this roster?' }
    ],
    choices: [
      { text: 'He deserves better. We will get him help.', emotion: 'confident',
        effect: function () { return { teamMorale: 1, reputation: 1 }; } },
      { text: 'Basketball is a five-man game. Ask the other four.', emotion: 'angry',
        effect: function () { return { teamMorale: -2, reputation: -1 }; } },
      { text: 'We are evaluating everything.', emotion: 'neutral', effect: null }
    ]
  },
  {
    id: 'my-night-in-a-loss',
    moment: 'postgame',
    roles: ['player'],
    priority: 55,
    when: function (c) { return c.userLost && c.topScorerPoints >= 30; },
    speaker: { kind: 'reporter' },
    lines: [
      { emotion: 'neutral', text: '{topScorerPoints} points in a {margin}-point loss.' },
      { emotion: 'neutral', text: 'Does a night like that mean anything to you?' }
    ],
    choices: [
      { text: 'Not one bit. We lost.', emotion: 'neutral',
        effect: function () { return { teamMorale: 1, reputation: 1, recordDecision: 'deflected-credit' }; } },
      { text: 'I did my job out there.', emotion: 'confident',
        effect: function () { return { playerMorale: 1, teamMorale: -1.5, reputation: -1 }; } },
      { text: 'Ask me after the next one.', emotion: 'neutral', effect: null }
    ]
  },
  {
    id: 'statement-win',
    moment: 'postgame',
    roles: ['gm', 'player'],
    priority: 50,
    when: function (c) { return c.userWon && c.margin >= 20; },
    speaker: { kind: 'reporter' },
    lines: [
      { emotion: 'confident', text: 'Twenty-plus over the {opponentName}. That is the most complete game you have played.' }
    ],
    choices: [
      { text: 'The group has been building to this.', emotion: 'confident',
        effect: function () { return { teamMorale: 1.5, reputation: 1 }; } },
      { text: 'One game. We have not done anything yet.', emotion: 'neutral',
        effect: function () { return { reputation: 1 }; } },
      { text: 'We are the best team in this league.', emotion: 'confident',
        effect: function (c) {
          return { teamMorale: 1, reputation: -1,
            chronicle: 'Declared the ' + c.teamName + ' the best team in the league after a ' + c.margin + '-point win.' };
        } }
    ]
  },
  {
    id: 'skid',
    moment: 'postgame',
    roles: ['gm', 'player'],
    priority: 45,
    when: function (c) { return c.userLost && c.streak <= -4; },
    speaker: { kind: 'reporter' },
    lines: [
      { emotion: 'neutral', text: 'That is four in a row now. {seasonWins}-{seasonLosses} on the season.' },
      { emotion: 'neutral', text: 'At what point does this stop being a slump?' }
    ],
    choices: [
      { text: 'We are closer than the record says.', emotion: 'confident',
        effect: function () { return { teamMorale: 1, reputation: -1 }; } },
      { text: 'Nobody in that room is comfortable. Good.', emotion: 'angry',
        effect: function () { return { teamMorale: -1, reputation: 1 }; } },
      { text: 'We keep working.', emotion: 'neutral', effect: null }
    ]
  },
  {
    id: 'playoff-elimination-edge',
    moment: 'postgame',
    roles: ['gm', 'player'],
    priority: 80,
    when: function (c) { return c.isPlayoff && c.userLost; },
    speaker: { kind: 'reporter' },
    lines: [
      { emotion: 'neutral', text: 'A {margin}-point loss to the {opponentName}, in the playoffs.' },
      { emotion: 'angry', text: 'Is this group good enough?' }
    ],
    choices: [
      { text: 'This group is good enough. Tonight was not.', emotion: 'confident',
        effect: function () { return { teamMorale: 1.5, reputation: 1 }; } },
      { text: 'Clearly something has to change.', emotion: 'angry',
        effect: function (c) {
          return { teamMorale: -2.5, reputation: -1,
            chronicle: 'Questioned the roster publicly after a playoff loss to the ' + c.opponentName + '.' };
        } },
      { text: 'We will be ready for the next one.', emotion: 'neutral', effect: null }
    ]
  },

  // ---- halftime ----
  {
    // The payoff for the hint the studio panel just planted. It outranks the
    // other halftime scenes so that a planted hint always has somewhere to go.
    //
    // The coach never names the problem — he asks an open question, and one of
    // the three answers happens to be the one the panel spent two minutes
    // describing. Nothing marks it. Noticing is the mechanic, so do NOT add a
    // tell here; validate-studioShow.js guards the other half of that contract.
    //
    // The wrong answers cost nothing. Missing the boost is the cost, and
    // punishing inattention on a cutaway you cannot replay would be harsh.
    // Gated on boostId, NOT slumpId: the payoff only works on a player who can
    // actually take over, and offering it otherwise pays out nothing.
    id: 'halftime-slump-hint',
    moment: 'halftime',
    roles: ['gm', 'player'],
    priority: 95,
    when: function (c) { return !!c.boostId; },
    speaker: { kind: 'coach' },
    lines: [
      { emotion: 'neutral', text: "Twelve minutes gone. I've got one adjustment in me before we go back out." },
      { emotion: 'neutral', text: 'What do you want it to be?' }
    ],
    choices: [
      // The one the panel described: get him downhill, to the rim.
      { text: 'Run everything through {slumpName} at the rim.', emotion: 'confident',
        effect: function (c) { return { boostPlayer: c.boostId, teamMorale: 0.5 }; } },
      // Plausible, and wrong — it is the shot selection, not the shooter.
      { text: 'Sit {slumpName} down. He is hurting us.', emotion: 'neutral',
        effect: function () { return { teamMorale: -1 }; } },
      // Also plausible, also wrong: it treats the symptom.
      { text: 'Push the pace and outrun them.', emotion: 'confident',
        effect: function () { return { teamMorale: 0.5 }; } },
      { text: 'Nothing. Let them play.', emotion: 'neutral', effect: null }
    ]
  },
  {
    id: 'halftime-trailing-badly',
    moment: 'halftime',
    roles: ['gm', 'player'],
    priority: 60,
    when: function (c) { return c.trailing && c.margin >= 12; },
    speaker: { kind: 'coach' },
    lines: [
      { emotion: 'angry', text: 'Down {margin} at the half to the {opponentName}.' },
      { emotion: 'angry', text: 'I need to know what you want me to do with this second half.' }
    ],
    choices: [
      { text: 'Ride the starters. Win it now.', emotion: 'confident',
        effect: function () { return { teamMorale: -0.5 }; } },
      { text: 'Get the young guys minutes.', emotion: 'neutral',
        effect: function () { return { teamMorale: 1 }; } },
      { text: 'You are the coach. Coach.', emotion: 'neutral', effect: null }
    ]
  },
  {
    id: 'halftime-big-lead',
    moment: 'halftime',
    roles: ['gm', 'player'],
    priority: 55,
    when: function (c) { return c.leading && c.margin >= 15; },
    speaker: { kind: 'coach' },
    lines: [
      { emotion: 'confident', text: 'Up {margin}. {topScorerName} has {topScorerPoints} already.' },
      { emotion: 'neutral', text: 'Do I keep the foot down or start resting people?' }
    ],
    choices: [
      { text: 'Rest them. We need them in April.', emotion: 'neutral',
        effect: function () { return { teamMorale: 1 }; } },
      { text: 'Bury them. Send a message.', emotion: 'angry',
        effect: function () { return { teamMorale: 0.5, reputation: -1 }; } },
      { text: 'Your call.', emotion: 'neutral', effect: null }
    ]
  },
  {
    id: 'halftime-close-game',
    moment: 'halftime',
    roles: ['gm', 'player'],
    priority: 30,
    when: function (c) { return c.margin <= 4; },
    speaker: { kind: 'coach' },
    lines: [
      { emotion: 'neutral', text: 'Dead even with the {opponentName}. This comes down to the last four minutes.' }
    ],
    choices: [
      { text: 'Keep the rotation tight.', emotion: 'confident',
        effect: function () { return { teamMorale: 0.5 }; } },
      { text: 'Trust the group.', emotion: 'neutral', effect: null }
    ]
  },
  // ---- mid-season ----
  //
  // These fire BETWEEN games, during an unwatched Continue run — the stretch
  // that previously contained nothing at all. Every other scene in this file
  // needs a game you were watching; a batch-simmed day never produces one, so
  // sixty games of a season had no dialogue in them by construction.
  //
  // Each one keys off something that actually happened to the club rather than
  // firing on a timer, so an answer is a response to a situation and not a
  // random interruption. ui/simControls.js refuses the fallback for this
  // moment: if nothing real is going on, the game stays quiet.
  {
    id: 'losing-slide',
    moment: 'season',
    roles: ['gm'],
    priority: 60,
    when: function (c) { return c.streak <= -4; },
    speaker: { kind: 'reporter' },
    lines: [
      { emotion: 'neutral', text: 'Four straight, and the {teamName} are {seasonWins}-{seasonLosses}.' },
      { emotion: 'angry', text: 'Is anybody in that building worried yet?' }
    ],
    choices: [
      { text: 'I back this group. We are not changing course.', emotion: 'confident',
        effect: function () { return { teamMorale: 2, reputation: 1, ownerHappiness: -2,
          chronicle: 'Publicly backed the roster through a losing run.' }; } },
      { text: 'Nobody in that room is safe. Including me.', emotion: 'shaken',
        effect: function () { return { teamMorale: -2, ownerHappiness: 3,
          chronicle: 'Put the roster on notice mid-season.' }; } },
      { text: 'Ask me in ten games.', emotion: 'neutral', effect: null }
    ]
  },
  {
    id: 'unhappy-star',
    moment: 'season',
    roles: ['gm'],
    priority: 75,
    when: function (c) { return !!c.unhappyName && c.gamesLeft > 10; },
    speaker: { kind: 'reporter' },
    lines: [
      { emotion: 'neutral', text: 'The word out of the locker room is that {unhappyName} is unhappy.' },
      { emotion: 'neutral', text: 'Is he going to finish the season with the {teamName}?' }
    ],
    choices: [
      { text: 'He is going nowhere. I will fix what is bothering him.', emotion: 'confident',
        effect: function (c) { return { teamMorale: 3, reputation: -1,
          chronicle: 'Committed publicly to ' + c.unhappyName + ' mid-season.' }; } },
      { text: 'Everyone is available for the right price.', emotion: 'neutral',
        effect: function (c) { return { teamMorale: -3, reputation: 2, ownerHappiness: 1,
          chronicle: 'Told the press ' + c.unhappyName + ' was available.' }; } },
      { text: 'I do not negotiate through reporters.', emotion: 'angry',
        effect: function () { return { reputation: 1 }; } }
    ]
  },
  {
    id: 'mandate-slipping',
    moment: 'season',
    roles: ['gm'],
    priority: 85,
    // Only when the owner's number is genuinely in danger: more wins still
    // needed than three quarters of the remaining games can comfortably give.
    when: function (c) {
      return c.mandateType === 'wins' && c.gamesLeft > 5 && c.gamesLeft <= 40 &&
        c.winsNeeded > c.gamesLeft * 0.75;
    },
    speaker: { kind: 'owner' },
    lines: [
      { emotion: 'angry', text: 'I asked you to {mandateLabel}. You need {winsNeeded} more with {gamesLeft} to play.' },
      { emotion: 'neutral', text: 'Talk me through how that happens.' }
    ],
    choices: [
      { text: 'We will get there. Watch the next month.', emotion: 'confident',
        effect: function () { return { ownerHappiness: 2, reputation: -1,
          chronicle: 'Promised the owner a run the season still had to deliver.' }; } },
      { text: 'It does not. Better you hear that now than in April.', emotion: 'neutral',
        effect: function () { return { ownerHappiness: -3, reputation: 3, teamMorale: -1,
          chronicle: 'Told the owner to his face that the target was gone.' }; } },
      { text: 'Injuries. You saw the same games I did.', emotion: 'shaken',
        effect: function () { return { ownerHappiness: -1, teamMorale: -2 }; } }
    ]
  },
  {
    id: 'injury-pileup',
    moment: 'season',
    roles: ['gm'],
    priority: 65,
    // Two, not three. Measured mid-season: eleven injured men across the whole
    // thirty-club league and NOT ONE club carrying three at once, so a bar of
    // three was a scene that could never fire.
    when: function (c) { return c.injuredCount >= 2; },
    speaker: { kind: 'reporter' },
    lines: [
      { emotion: 'neutral', text: '{injuredCount} men in the treatment room, {injuredName} among them.' },
      { emotion: 'neutral', text: 'Do you ride it out, or go and get help?' }
    ],
    choices: [
      { text: 'The guys behind them have waited for this.', emotion: 'confident',
        effect: function () { return { teamMorale: 2,
          chronicle: 'Backed the bench through an injury crisis.' }; } },
      { text: 'We push the healthy bodies harder. Nobody rests.', emotion: 'angry',
        effect: function () { return { teamMorale: -3, ownerHappiness: 2 }; } },
      { text: 'This stretch is written off. We get people right.', emotion: 'neutral',
        effect: function () { return { teamMorale: 1, ownerHappiness: -3,
          chronicle: 'Wrote off a stretch of the season to get players healthy.' }; } }
    ]
  },
  {
    id: 'tax-bill-looming',
    moment: 'season',
    roles: ['gm'],
    priority: 55,
    when: function (c) { return c.overTaxLine && c.gamesPlayed >= 20; },
    speaker: { kind: 'owner' },
    lines: [
      { emotion: 'angry', text: 'I have seen the projection. We are over the tax line.' },
      { emotion: 'neutral', text: 'Tell me what I am buying for it.' }
    ],
    choices: [
      { text: 'A contender. You knew the bill when we built it.', emotion: 'confident',
        effect: function () { return { ownerHappiness: -2, reputation: 2, teamMorale: 1,
          chronicle: 'Defended the payroll to the owner.' }; } },
      { text: 'I will get us under it before the deadline.', emotion: 'neutral',
        effect: function () { return { ownerHappiness: 4, teamMorale: -2,
          chronicle: 'Promised the owner a payroll cut before the deadline.' }; } },
      { text: 'Every club is spending. That is the market.', emotion: 'neutral',
        effect: function () { return { ownerHappiness: -1 }; } }
    ]
  },
  {
    id: 'running-hot',
    moment: 'season',
    roles: ['gm'],
    priority: 50,
    when: function (c) { return c.streak >= 5; },
    speaker: { kind: 'reporter' },
    lines: [
      { emotion: 'neutral', text: 'Five in a row. Nobody had the {teamName} down for this.' },
      { emotion: 'confident', text: 'Has this changed what the season is about?' }
    ],
    choices: [
      { text: 'We are chasing something now. Say it out loud.', emotion: 'confident',
        effect: function () { return { teamMorale: 2, ownerHappiness: 3, reputation: -1,
          chronicle: 'Raised expectations publicly during a winning run.' }; } },
      { text: 'Five games. Ask me in March.', emotion: 'neutral',
        effect: function () { return { reputation: 1 }; } },
      { text: 'That is the players. I just signed them.', emotion: 'neutral',
        effect: function () { return { teamMorale: 3, reputation: 1,
          chronicle: 'Gave the roster the credit for a winning run.' }; } }
    ]
  }
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SCENES: SCENES,
    FALLBACK_SCENE_ID: FALLBACK_SCENE_ID,
    DEFAULT_FALLBACK_LINES: DEFAULT_FALLBACK_LINES,
    tokensIn: tokensIn,
    interpolate: interpolate,
    selectScene: selectScene
  };
}
