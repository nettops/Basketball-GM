// The badge reference. Every badge in the game, what it actually does, what it
// is worth at each tier, and how many players currently hold it.
//
// EVERYTHING IS READ FROM THE TAXONOMY. Nothing here restates a badge's effect
// in its own words: the category, the stat it moves, the direction and the tier
// values all come from TRAIT_TAXONOMY, and the sentence comes from
// TRAIT_DESCRIPTIONS. A badge whose effect is retuned updates this page for
// free, and a badge added without a description fails validate-traits.js rather
// than rendering a blank row.

const BADGE_CATEGORY_BLURB = {
  superstar: 'Reserved for the genuine elite. Roughly double a normal badge at every tier, and gated behind a rating band so most players can never roll one.',
  offensive: 'Scoring and creation.',
  defensive: 'Stopping the other team.',
  athletic: 'Physical tools, and what they actually translate into.',
  mental: 'Feel, temperament and development.',
  negative: 'Flaws. The tier is SEVERITY — a legendary flaw is the worst version of it, not the best.'
};

// Held-count and tier mix, computed live off the league rather than authored.
// A badge nobody holds is worth seeing as such: the superstar tier sat at zero
// holders for the entire life of the project before it was fixed.
function badgeHoldings() {
  const held = {};
  PLAYERS_2026.forEach(function (p) {
    (p.hiddenTraits || []).forEach(function (t) {
      const entry = held[t.key] || (held[t.key] = { total: 0, tiers: {}, examples: [] });
      entry.total += 1;
      entry.tiers[t.tier] = (entry.tiers[t.tier] || 0) + 1;
      if (entry.examples.length < 3) entry.examples.push({ name: p.name, tier: t.tier, overall: p.overall });
    });
  });
  return held;
}

function badgeTierLadderHtml(def) {
  return TRAIT_TIERS.map(function (tier) {
    const magnitude = def.tierValues[tier];
    const signed = (def.effect.direction < 0 ? '−' : '+') + magnitude;
    // Reuses the tier palette the player profile already established, so a
    // legendary here is the same purple-gold a legendary is everywhere else.
    return '<span class="badge-ref-tier tier-' + tier + '">' +
      '<span class="badge-ref-tier-name">' + tier + '</span>' +
      '<span class="badge-ref-tier-value">' + signed + '</span></span>';
  }).join('');
}

function badgeRarityHtml(entry) {
  if (!entry || !entry.total) {
    return '<span class="badge-ref-rarity badge-ref-rarity-none">Held by nobody in this league</span>';
  }
  const pct = (100 * entry.total / PLAYERS_2026.length).toFixed(1);
  const commonest = Object.keys(entry.tiers).sort(function (a, b) {
    return entry.tiers[b] - entry.tiers[a];
  })[0];
  const names = entry.examples.map(function (e) {
    return escapeHtml(e.name) + ' (' + e.tier + ')';
  }).join(', ');
  return '<span class="badge-ref-rarity">Held by <strong>' + entry.total + '</strong> ' +
    (entry.total === 1 ? 'player' : 'players') + ' (' + pct + '%) &middot; most often ' +
    commonest + '</span>' +
    (names ? '<span class="badge-ref-examples">e.g. ' + names + '</span>' : '');
}

// The secret form, shown on every badge that has one. Deliberately NOT hidden
// behind having seen one: knowing Sharpshooter can become Deadeye is what makes
// a legendary Sharpshooter on your roster interesting. What stays secret is
// WHETHER it happens, which is the part that is actually a surprise.
function badgeSecretHtml(def, secret) {
  const value = def.tierValues[SECRET_TIER];
  const signed = (def.effect.direction < 0 ? '−' : '+') + value;
  return '<div class="badge-ref-secret">' +
    '<div class="badge-ref-secret-head">' +
      '<span class="badge-ref-secret-label">Secret form</span>' +
      '<span class="badge-ref-secret-name">' + escapeHtml(secret.name) + '</span>' +
      '<span class="badge-ref-secret-value">' + signed + '</span>' +
    '</div>' +
    '<p class="badge-ref-secret-desc">' + escapeHtml(secret.description) + '</p>' +
  '</div>';
}

function badgeCardHtml(def, held) {
  const effectKey = def.effect.system + '/' + def.effect.stat;
  const label = TRAIT_EFFECT_LABELS[effectKey] || effectKey;
  // A negative direction on a "bad thing" stat is a GOOD badge — Iron Man
  // lowers injury risk, High Motor lowers fatigue. Saying "reduces" rather than
  // showing a bare minus is the difference between readable and misleading.
  const verb = def.effect.direction < 0 ? 'Reduces' : 'Raises';
  const secret = SECRET_FORMS[def.key];
  return '<div class="badge-ref-card badge-ref-' + def.category +
      (secret ? ' badge-ref-has-secret' : '') + '">' +
    '<div class="badge-ref-head">' +
      '<span class="badge-ref-name">' + escapeHtml(def.name) + '</span>' +
      '<span class="badge-ref-effect">' + verb + ' <strong>' + escapeHtml(label) + '</strong></span>' +
    '</div>' +
    '<p class="badge-ref-desc">' + escapeHtml(TRAIT_DESCRIPTIONS[def.key] || '') + '</p>' +
    '<div class="badge-ref-ladder">' + badgeTierLadderHtml(def) + '</div>' +
    (secret ? badgeSecretHtml(def, secret) : '') +
    '<div class="badge-ref-foot">' + badgeRarityHtml(held[def.key]) + '</div>' +
  '</div>';
}

function renderBadges(container) {
  const held = badgeHoldings();
  let html = '<div class="view-header"><h2>Badges</h2>' +
    '<span class="view-sub">' + TRAIT_TAXONOMY.length + ' badges &middot; ' +
    'every effect below is read straight from the engine\'s own table</span></div>';

  html += '<div class="panel"><div class="panel-body">' +
    '<p class="kpi-sub">Each player carries a handful of badges, drawn when he enters the league and ' +
    'weighted by his attributes. Tier sets the size of the effect &mdash; and on a flaw, its severity. ' +
    'Badges are visible on every player on an NBA roster; draft prospects show a fuzzy tier range instead.</p>' +
    '<p class="kpi-sub"><strong style="color:#FFD36E">Secret forms.</strong> A badge already held at ' +
    '<em>legendary</em> can evolve over the summer into the form shown on its card &mdash; once per player, ' +
    'ever. The chance is small and rises with work ethic, with Coachable or Film Junkie, and with having ' +
    'development years left; Stubborn cuts it. Roughly one happens every three seasons league-wide. ' +
    'You will see it in the feed when it does.</p>' +
    '</div></div>';

  TRAIT_CATEGORY_ORDER.forEach(function (cat) {
    const inCat = TRAIT_TAXONOMY.filter(function (t) { return t.category === cat; });
    if (!inCat.length) return;
    const heldInCat = inCat.reduce(function (s, d) { return s + (held[d.key] ? held[d.key].total : 0); }, 0);
    html += '<div class="panel"><div class="panel-body">' +
      '<div class="badge-ref-cat-head">' +
        '<h3 class="badge-ref-cat-title">' + TRAIT_CATEGORY_LABELS[cat] + '</h3>' +
        '<span class="badge-ref-cat-count">' + inCat.length + ' badges &middot; ' +
          heldInCat + ' held league-wide</span>' +
      '</div>' +
      '<p class="badge-ref-cat-blurb">' + BADGE_CATEGORY_BLURB[cat] + '</p>' +
      '<div class="badge-ref-grid">' +
        inCat.map(function (d) { return badgeCardHtml(d, held); }).join('') +
      '</div>' +
    '</div></div>';
  });

  container.innerHTML = html;
}
