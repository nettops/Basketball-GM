// The agenda, on screen.
//
// Markup only — this builds a string and hands it back, exactly like
// playerSpriteHtml does, so it can be asserted in Node without a DOM. Wiring
// the buttons is a separate call (bindAgendaPanel) that the dashboard makes
// after it has assigned innerHTML.
//
// The brief's UI rule is the one thing this file exists to honour: lead with
// what it MEANS, keep the number available underneath. So a row says "Marcus
// is becoming frustrated with his role" and carries "Morale 38" as the small
// print, rather than showing a stat and leaving the player to infer a story
// from it.

var AGENDA_URGENCY_LABEL = { critical: 'Needs attention', developing: 'Developing', opportunity: 'Opportunity' };
var AGENDA_CATEGORY_LABEL = { relationship: 'Locker room', basketball: 'Basketball', business: 'Business', league: 'League' };

// How many rows before the panel stops being a briefing and starts being a
// spreadsheet. Eight is the point at which the dashboard column stops fitting
// on a laptop screen; the rest are reachable but not shouted.
var AGENDA_PANEL_LIMIT = 5;

function agendaEntityNames(item) {
  return (item.entities || [])
    .map(function (e) { return e.name || e.id; })
    .filter(Boolean);
}

// Only worth printing when it tells you something the headline did not. Seen
// on screen, "Jayson Tatum is unhappy here" followed by a line reading "Jayson
// Tatum" is just the same fact twice, and it cost ~20px on every row.
function agendaWhoLine(item) {
  // Named entities only. A team entity carries an id and no name, and the
  // whole panel is about your club, so a row reading "BOS" under "Payroll is
  // over the tax line" is a line of noise. People have names; render those.
  const names = (item.entities || [])
    .map(function (e) { return e.name; })
    .filter(Boolean);
  if (!names.length) return '';
  const head = String(item.headline || '');
  const unnamed = names.filter(function (n) { return head.indexOf(n) === -1; });
  if (!unnamed.length) return '';
  return unnamed.join(', ');
}

function agendaItemHtml(item) {
  const esc = typeof escapeHtml === 'function' ? escapeHtml : function (v) { return String(v); };
  const who = agendaWhoLine(item);
  const responses = (item.responses || []).map(function (r) {
    return '<button class="agenda-act" data-view="' + esc(r.view) + '">' + esc(r.label) + '</button>';
  }).join('');
  return '' +
    '<li class="agenda-item agenda-' + esc(item.urgency) + '" data-item-id="' + esc(item.id) + '">' +
      '<div class="agenda-head">' +
        '<span class="agenda-dot" aria-hidden="true"></span>' +
        '<b class="agenda-headline">' + esc(item.headline) + '</b>' +
      '</div>' +
      '<div class="agenda-why">' + esc(item.explanation) + '</div>' +
      (who ? '<div class="agenda-who">' + esc(who) + '</div>' : '') +
      (item.consequence ? '<div class="agenda-conseq">' + esc(item.consequence) + '</div>' : '') +
      (responses ? '<div class="agenda-acts">' + responses + '</div>' : '') +
      '<div class="agenda-tag">' + esc(AGENDA_URGENCY_LABEL[item.urgency] || item.urgency) +
        ' &middot; ' + esc(AGENDA_CATEGORY_LABEL[item.category] || item.category) + '</div>' +
    '</li>';
}

// `items` is whatever gmAgenda.buildAgenda returned. An empty agenda is a
// real, good state — a quiet week — and says so rather than rendering nothing,
// because a panel that vanishes reads as a bug.
function agendaPanelHtml(items, opts) {
  const o = opts || {};
  const limit = o.limit || AGENDA_PANEL_LIMIT;
  const list = items || [];
  if (!list.length) {
    return '<section class="agenda-panel"><h3 class="agenda-title">Your desk</h3>' +
      '<div class="empty-state">Nothing needs you right now. Quiet weeks are worth using.</div></section>';
  }
  const shown = list.slice(0, limit);
  const hidden = list.length - shown.length;
  return '<section class="agenda-panel">' +
    '<h3 class="agenda-title">Your desk <span class="agenda-count">' + list.length + '</span></h3>' +
    '<ul class="agenda-list">' + shown.map(agendaItemHtml).join('') + '</ul>' +
    (hidden > 0 ? '<div class="agenda-more">and ' + hidden + ' more</div>' : '') +
  '</section>';
}

// Buttons carry the view they open in a data attribute rather than a closure,
// so the markup stays a pure string and the binding is one delegated pass.
function bindAgendaPanel(container, go) {
  if (!container || typeof container.querySelectorAll !== 'function') return 0;
  const nodes = container.querySelectorAll('.agenda-act[data-view]');
  let n = 0;
  Array.prototype.forEach.call(nodes, function (btn) {
    btn.addEventListener('click', function () {
      const view = btn.getAttribute('data-view');
      if (view && typeof go === 'function') go(view);
    });
    n++;
  });
  return n;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AGENDA_URGENCY_LABEL: AGENDA_URGENCY_LABEL,
    AGENDA_CATEGORY_LABEL: AGENDA_CATEGORY_LABEL,
    AGENDA_PANEL_LIMIT: AGENDA_PANEL_LIMIT,
    agendaEntityNames: agendaEntityNames,
    agendaWhoLine: agendaWhoLine,
    agendaItemHtml: agendaItemHtml,
    agendaPanelHtml: agendaPanelHtml,
    bindAgendaPanel: bindAgendaPanel
  };
}
