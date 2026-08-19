// Shared UI helpers. Loaded first in index.html's ui/ block so every view can
// use these without an ordering dance.

// Every view in this app builds markup with string concatenation or template
// literals and assigns it via innerHTML. That's fine for values the game
// generates, but several strings are typed by the user — the career-mode player
// name (ui/playerCreation.js), commissioner-created player names, expansion and
// relocation team names (commissioner.js), and save slot names — and those flow
// through the same path. Without escaping, a '<' silently corrupts the rest of
// the view and an apostrophe breaks any inline onclick handler built around it.
//
// Returns '' for null/undefined so callers don't have to guard separately, and
// leaves numbers alone by stringifying them first.
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// A day label for a feed or headline row.
//
// Playoff games and anything filed outside the regular-season calendar carry
// `day: null`, and four separate call sites interpolated it raw — so every
// postseason headline in the game read "Day null". ui/liveFeed.js was the only
// one that guarded it, inline. One rule, one place, so the fifth call site
// cannot get it wrong again.
function dayLabel(day) {
  return (day === null || day === undefined) ? '—' : day;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    dayLabel: dayLabel, escapeHtml: escapeHtml };
}
