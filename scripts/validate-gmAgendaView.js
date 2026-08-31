// The panel is markup-only, so it is asserted as a string. The one thing this
// file really guards is ESCAPING: every headline it renders is built from
// player and team names, which on this roster are real people's names and on a
// custom league are whatever the user typed.
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rq = function (f) { return require(path.join(ROOT, f)); };

const agenda = rq('gmAgenda.js');
const view = rq('ui/gmAgendaView.js');

// ui/util.js's escapeHtml is a browser global the view picks up at call time.
// Node has no such global, so install it the way index.html would.
global.escapeHtml = function (v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
};

function item(over) {
  return agenda.makeItem(Object.assign({
    id: 'i1', urgency: 'critical', category: 'relationship', source: 'player',
    entities: [{ kind: 'player', id: 'p1', name: 'Marcus Johnson' }],
    headline: 'Marcus Johnson is unhappy here',
    explanation: 'Morale 30. He is good enough that losing him would cost you games.',
    responses: [{ label: 'Look at his minutes', view: 'roster' }],
    consequence: 'An unhappy player is harder to re-sign.'
  }, over || {}));
}

function checkThePanelLeadsWithMeaningNotNumbers() {
  const html = view.agendaPanelHtml([item()]);
  const headlineAt = html.indexOf('Marcus Johnson is unhappy here');
  const moraleAt = html.indexOf('Morale 30');
  assert.ok(headlineAt !== -1, 'the headline must render');
  assert.ok(moraleAt !== -1, 'the number must still be available');
  assert.ok(headlineAt < moraleAt, 'the meaning must come before the number, not after it');
  console.log('checkThePanelLeadsWithMeaningNotNumbers: OK');
}

function checkAnEmptyAgendaSaysSoRatherThanVanishing() {
  const html = view.agendaPanelHtml([]);
  assert.ok(html.indexOf('agenda-panel') !== -1, 'the panel must still render when empty');
  assert.ok(/Nothing needs you/.test(html), 'it must say the desk is clear');
  console.log('checkAnEmptyAgendaSaysSoRatherThanVanishing: OK');
}

function checkNamesAreEscaped() {
  // A player called <script> is the whole reason ui/liveFeed.js escapes its
  // feed text. Every field this panel prints comes from the same places.
  const nasty = item({
    entities: [{ kind: 'player', id: 'x', name: '<script>alert(1)</script>' }],
    headline: '<img src=x onerror=alert(1)> is unhappy',
    explanation: 'Morale "30" & falling <b>fast</b>',
    consequence: "He'll remember <this>",
    responses: [{ label: '<b>Go</b>', view: 'roster"><script>' }]
  });
  const html = view.agendaPanelHtml([nasty]);
  // What matters is that nothing survives as MARKUP. The literal text
  // "onerror=alert(1)" does still appear — inside "&lt;img src=x
  // onerror=alert(1)&gt;" — and that is correct and inert: with the angle
  // brackets escaped it can never be a tag, so it is just an odd player name
  // rendered faithfully. Asserting on that substring is what a first draft of
  // this check did, and it fails on safe output.
  assert.ok(html.indexOf('<script') === -1, 'no raw script tag may survive');
  assert.ok(html.indexOf('<img') === -1, 'no raw img tag may survive');
  assert.ok(html.indexOf('&lt;script&gt;') !== -1, 'it must be escaped, not stripped');
  assert.ok(html.indexOf('&lt;img src=x') !== -1, 'the headline must survive as escaped text');
  // Attribute break-out: the value must contain no raw quote that could end it.
  const dv = html.match(/data-view="([^"]*)"/);
  assert.ok(dv, 'the data-view attribute must still parse');
  assert.ok(dv[1].indexOf('<') === -1 && dv[1].indexOf('"') === -1,
    'a data attribute must not be escapable: ' + dv[1]);
  console.log('checkNamesAreEscaped: OK');
}

function checkUrgencyReachesTheMarkup() {
  ['critical', 'developing', 'opportunity'].forEach(function (u) {
    const html = view.agendaPanelHtml([item({ urgency: u })]);
    assert.ok(html.indexOf('agenda-' + u) !== -1, u + ' must carry its class so the CSS can colour it');
  });
  console.log('checkUrgencyReachesTheMarkup: OK');
}

function checkResponsesBecomeRealButtons() {
  const html = view.agendaPanelHtml([item()]);
  assert.ok(/data-view="roster"/.test(html), 'a response must carry the view it opens');
  assert.ok(/class="agenda-act"/.test(html), 'and be a button the binder can find');
  const none = view.agendaPanelHtml([item({ responses: [] })]);
  assert.ok(none.indexOf('agenda-acts') === -1, 'no responses, no empty button row');
  console.log('checkResponsesBecomeRealButtons: OK');
}

function checkThePanelIsCappedAndSaysWhatItHid() {
  const many = [];
  for (let i = 0; i < 9; i++) many.push(item({ id: 'i' + i }));
  const html = view.agendaPanelHtml(many);
  const shown = (html.match(/class="agenda-item/g) || []).length;
  assert.strictEqual(shown, view.AGENDA_PANEL_LIMIT, 'the panel must cap its rows');
  assert.ok(/and 4 more/.test(html), 'and must admit what it did not show: ' + html.slice(-200));
  console.log('checkThePanelIsCappedAndSaysWhatItHid: OK');
}

function checkBindingIsSafeWithoutADom() {
  assert.strictEqual(view.bindAgendaPanel(null, function () {}), 0, 'no container, no crash');
  assert.strictEqual(view.bindAgendaPanel({}, function () {}), 0, 'a non-element must not throw');
  // A minimal fake element, since Node has no DOM.
  let clicked = null;
  const btn = {
    getAttribute: function () { return 'tradeCenter'; },
    addEventListener: function (ev, fn) { this._fire = fn; }
  };
  const container = { querySelectorAll: function () { return [btn]; } };
  const n = view.bindAgendaPanel(container, function (v) { clicked = v; });
  assert.strictEqual(n, 1, 'one button must be bound');
  btn._fire();
  assert.strictEqual(clicked, 'tradeCenter', 'clicking must route to the named view');
  console.log('checkBindingIsSafeWithoutADom: OK');
}

function checkItRendersARealAgenda() {
  const league = rq('league.js');
  rq('data.js'); rq('rng.js'); rq('teams.js');
  const traits = rq('traits.js'); rq('scouting.js');
  const { PLAYERS_2026 } = rq('players-2026.js');
  rq('ratings.js'); traits.ensureHiddenPlayerData(PLAYERS_2026);

  const roster = league.getActiveRoster('BOS') || [];
  const best = roster.slice().sort(function (a, b) { return (b.overall || 0) - (a.overall || 0); })[0];
  const saved = best.status.morale;
  best.status.morale = 18;
  const items = agenda.buildAgenda({ userTeamId: 'BOS', leagueYear: 2026 });
  const html = view.agendaPanelHtml(items);
  best.status.morale = saved;

  assert.ok(items.length > 0, 'the real league must produce items once something is wrong');
  assert.ok(html.indexOf(best.name.split(' ')[0]) !== -1,
    'the panel must name the actual unhappy player');
  assert.ok(html.indexOf('agenda-critical') !== -1, 'and mark him critical');
  console.log('checkItRendersARealAgenda: OK (' + items.length + ' items rendered)');
}

checkThePanelLeadsWithMeaningNotNumbers();
checkAnEmptyAgendaSaysSoRatherThanVanishing();
checkNamesAreEscaped();
checkUrgencyReachesTheMarkup();
checkResponsesBecomeRealButtons();
checkThePanelIsCappedAndSaysWhatItHid();
checkBindingIsSafeWithoutADom();
checkItRendersARealAgenda();

console.log('All gmAgendaView validations passed');
