var _PROGRESSION_DATA = (typeof require !== 'undefined')
  ? { data: require('./data.js'), traits: require('./traits.js'), teams: require('./teams.js'), coaches: require('./coaches.js') }
  : {
      data: { ATTRIBUTE_KEYS: ATTRIBUTE_KEYS, RATING_MIN: RATING_MIN, RATING_MAX: RATING_MAX },
      traits: { getTraitBonus: getTraitBonus },
      teams: { getTeamById: getTeamById },
      coaches: { coachFitMultiplier: coachFitMultiplier }
    };

function clampRating(v) {
  return Math.max(_PROGRESSION_DATA.data.RATING_MIN, Math.min(_PROGRESSION_DATA.data.RATING_MAX, Math.round(v)));
}

// Formula-driven with randomness: young players trend toward their potential,
// veterans decline, and a small league-wide breakout/bust roll adds emergent
// variance on top of the age curve. `teammates` (optional) lets a Mentor on
// the roster nudge development for players 25 and under.
function progressPlayer(player, rng, teammates) {
  teammates = teammates || [];
  player.age += 1;
  player.yearsPro += 1;
  const potentialGap = player.potential - player.overall;

  let change;
  if (player.age <= 25) {
    change = potentialGap * 0.3 + (rng() - 0.3) * 4;
  } else if (player.age <= 29) {
    change = potentialGap * 0.1 + (rng() - 0.5) * 3;
  } else {
    const declineRate = (player.age - 29) * 0.8;
    change = -declineRate + (rng() - 0.5) * 3;
  }

  const breakoutRoll = rng();
  if (breakoutRoll < 0.03) {
    change += 8;
  } else if (breakoutRoll > 0.97) {
    change -= 8;
  }

  // Trait/personality modifiers, gated by coach fit: a player whose skill
  // lean matches their coach's specialty gets more out of being Coachable
  // (or is hurt less by being Stubborn) than a mismatched pairing would.
  const team = player.teamId ? _PROGRESSION_DATA.teams.getTeamById(player.teamId) : null;
  const fit = team ? _PROGRESSION_DATA.coaches.coachFitMultiplier(team.coach, player) : 1;
  change += _PROGRESSION_DATA.traits.getTraitBonus(player, 'progression', 'self') * 0.3;
  if (player.hiddenPersonality && player.hiddenPersonality.coachability !== undefined) {
    change += (player.hiddenPersonality.coachability - 50) / 50 * 1.5 * fit;
  }
  if (player.age <= 25) {
    const mentorBonus = teammates.reduce(function (sum, tm) {
      return sum + _PROGRESSION_DATA.traits.getTraitBonus(tm, 'progression', 'teammate');
    }, 0);
    change += Math.min(3, mentorBonus * 0.2);
  }

  const newOverall = clampRating(player.overall + change);
  player.overall = newOverall;
  player.potential = Math.max(player.potential, newOverall); // invariant: potential >= overall

  _PROGRESSION_DATA.data.ATTRIBUTE_KEYS.forEach(function (key) {
    player.attributes[key] = clampRating(player.attributes[key] + change);
  });

  applyCareerModeTraining(player);
}

// Player-career-mode-only: applies the most recent unconsumed "training"
// decision (recorded via PlayerCareerController.recordDecision) as a small
// bonus to the attributes that focus covers, then marks it consumed so it
// only ever applies once. Guarded by isCustomPlayer + a runtime GameState
// check so this is a no-op for every generated player and for the node
// validation scripts, which never define GameState.
function applyCareerModeTraining(player) {
  if (!player.isCustomPlayer) return;
  if (typeof GameState === 'undefined' || !GameState.playerCareerController) return;

  const history = GameState.playerCareerController.decisionHistory;
  const pending = history.find(function (d) { return d.type === 'training' && !d.applied; });
  if (!pending) return;

  const TRAINING_FOCUS_ATTRS = {
    focus_shooting: ['midRange', 'threePoint', 'freeThrow'],
    focus_defense: ['perimeterDefense', 'interiorDefense'],
    focus_athleticism: ['speed', 'acceleration', 'vertical'],
    focus_playmaking: ['passing', 'ballHandling']
  };
  const TRAINING_BONUS = 2;

  const attrs = TRAINING_FOCUS_ATTRS[pending.decision] || [];
  attrs.forEach(function (key) {
    player.attributes[key] = clampRating(player.attributes[key] + TRAINING_BONUS);
  });
  pending.applied = true;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { progressPlayer: progressPlayer, clampRating: clampRating };
}
