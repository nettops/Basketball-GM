var _PROGRESSION_DATA = (typeof require !== 'undefined')
  ? require('./data.js')
  : { ATTRIBUTE_KEYS: ATTRIBUTE_KEYS, RATING_MIN: RATING_MIN, RATING_MAX: RATING_MAX };

function clampRating(v) {
  return Math.max(_PROGRESSION_DATA.RATING_MIN, Math.min(_PROGRESSION_DATA.RATING_MAX, Math.round(v)));
}

// Formula-driven with randomness: young players trend toward their potential,
// veterans decline, and a small league-wide breakout/bust roll adds emergent
// variance on top of the age curve.
function progressPlayer(player, rng) {
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

  const newOverall = clampRating(player.overall + change);
  player.overall = newOverall;
  player.potential = Math.max(player.potential, newOverall); // invariant: potential >= overall

  _PROGRESSION_DATA.ATTRIBUTE_KEYS.forEach(function (key) {
    player.attributes[key] = clampRating(player.attributes[key] + change);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { progressPlayer: progressPlayer, clampRating: clampRating };
}
