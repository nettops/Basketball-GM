// The franchise-select screen: a list of the thirty jobs on the left, and a
// dossier on whichever one you're pointing at filling the right.
//
// The old version was a grid of thirty cards, each painted with a full-bleed
// two-colour gradient of that team's palette and a border in its secondary
// colour. Thirty of those at once had no calm anywhere: the logos, which are
// the actual identity, were competing with the backgrounds behind them, and the
// names needed a drop shadow to stay legible on top. Colour is now carried by
// the logo and a single accent per panel, not by every surface at once.
//
// One deliberate change in behaviour: clicking a team SELECTS it (fills the
// panel) rather than starting the game. Committing is the button in the panel.
// The old screen started a multi-season career on a single click of a small
// card, with no confirmation and no chance to read anything about the roster.

function renderTeamSelect(container, onSelect, onLoadGame, onSpectate, onPlayerCareer) {
  // Held here rather than read back out of the DOM: the mode used to live in a
  // radio group that had to be re-queried at click time, which meant the value
  // and the highlighted button could in principle disagree.
  let mode = 'gm';
  let sort = 'conference';
  let selectedId = TEAMS[0].id;

  container.innerHTML =
    '<div class="fs-wrap">' +
      '<aside class="fs-rail">' +
        '<div class="fs-railhead">' +
          '<div class="fs-kicker">New career</div>' +
          '<div class="fs-title">Choose your franchise</div>' +
          '<label class="fs-field"><span>GM</span>' +
          '<input id="gm-name-input" type="text" maxlength="28" placeholder="Your name" autocomplete="off"></label>' +
          '<div class="fs-seg" id="fs-mode">' +
            '<button type="button" data-mode="gm" class="is-on">GM</button>' +
            '<button type="button" data-mode="commissioner">Commissioner</button>' +
          '</div>' +
        '</div>' +
        '<div class="fs-sortbar" id="fs-sort">' +
          '<span>Order</span>' +
          '<button type="button" data-sort="conference" class="is-on">Conference</button>' +
          '<button type="button" data-sort="rank">Roster rank</button>' +
        '</div>' +
        '<div class="fs-scroll" id="fs-list"></div>' +
        '<div class="fs-railfoot">' +
          '<button type="button" class="fs-ghost" id="fs-spectate">Spectate</button>' +
          '<button type="button" class="fs-ghost" id="fs-load">Load game</button>' +
          (onPlayerCareer ? '<button type="button" class="fs-ghost" id="fs-career">Player career</button>' : '') +
        '</div>' +
      '</aside>' +
      '<section class="fs-panel" id="fs-panel"></section>' +
    '</div>';

  const listEl = container.querySelector('#fs-list');
  const panelEl = container.querySelector('#fs-panel');

  function rowHtml(team, rank) {
    return '<button type="button" class="fs-row" data-team="' + team.id + '" ' +
      'style="--tc:' + resolveAccent(team) + '">' +
      '<span class="fs-tick"></span>' +
      teamLogoImgHtml(team.id, 27) +
      '<span class="fs-rowname">' + escapeHtml(team.name) + '</span>' +
      '<span class="fs-rowdiv">' + escapeHtml(team.division) + '</span>' +
      '<span class="fs-rowrank">' + rank + '</span>' +
      '</button>';
  }

  function renderList() {
    const ranks = getRosterRanks();
    let html = '';
    if (sort === 'rank') {
      // One flat run, best to worst — the point of this order is being able to
      // read straight down it, which conference headers would interrupt.
      TEAMS.slice()
        .sort(function (a, b) { return ranks[a.id] - ranks[b.id]; })
        .forEach(function (t) { html += rowHtml(t, ranks[t.id]); });
    } else {
      ['Eastern', 'Western'].forEach(function (conf) {
        html += '<div class="fs-confhead"><span>' + conf + '</span><i></i></div>';
        TEAMS.filter(function (t) { return t.conference === conf; })
          .forEach(function (t) { html += rowHtml(t, ranks[t.id]); });
      });
    }
    listEl.innerHTML = html;
    listEl.querySelectorAll('.fs-row').forEach(function (row) {
      const id = row.getAttribute('data-team');
      row.addEventListener('mouseenter', function () { showTeam(id); });
      row.addEventListener('focus', function () { showTeam(id); });
      row.addEventListener('click', function () { showTeam(id); });
    });
    markSelected();
  }

  function markSelected() {
    listEl.querySelectorAll('.fs-row').forEach(function (row) {
      row.classList.toggle('is-on', row.getAttribute('data-team') === selectedId);
    });
  }

  function showTeam(teamId) {
    selectedId = teamId;
    markSelected();
    const d = getTeamDossier(teamId);
    const team = d.team;
    const parts = team.name.split(' ');
    const nick = parts.slice(-1)[0];
    const city = parts.slice(0, -1).join(' ');

    setPanelAccent(panelEl, team);
    panelEl.innerHTML =
      '<div class="fs-wash"></div>' +
      '<div class="fs-ghostlogo">' + teamLogoImgHtml(team.id, 470) + '</div>' +
      '<div class="fs-inner">' +
        '<div class="fs-eyebrow"><i></i><span>' + escapeHtml(team.conference) + ' Conference &middot; ' +
          escapeHtml(team.division) + ' Division</span></div>' +
        '<div class="fs-city">' + escapeHtml(city) + '</div>' +
        '<h2 class="fs-team">' + escapeHtml(nick) + '</h2>' +
        (d.best
          ? '<div class="fs-star"><u>Best player</u><b>' + escapeHtml(d.best.name) + '</b>' +
            '<em><i>' + d.best.overall + '</i> overall &middot; age ' + d.best.age + '</em></div>'
          : '<div class="fs-star"><u>Best player</u><b>No players</b></div>') +
        '<div class="fs-stats">' +
          '<div class="fs-stat"><u>Roster rank</u><b>' + ordinal(d.rank) + '<small>/' + TEAMS.length + '</small></b>' +
            '<em>' + d.size + ' players</em></div>' +
          '<div class="fs-stat"><u>Payroll</u><b class="is-' + d.cap.level + '">' + millions(d.payroll) + '</b>' +
            '<em>' + d.cap.label + '</em></div>' +
          '<div class="fs-stat"><u>Direction</u><b>' + timelineLabel(d.timeline) + '</b>' +
            '<em>avg age ' + d.avgAge + '</em></div>' +
        '</div>' +
        '<p class="fs-verdict">' + d.verdict + '</p>' +
        '<button type="button" class="fs-cta" id="fs-take">Take the job <em>' + escapeHtml(nick) + '</em></button>' +
      '</div>';

    panelEl.querySelector('#fs-take').addEventListener('click', function () {
      onSelect(teamId, mode);
    });
  }

  function showLoad() {
    panelEl.style.setProperty('--tc', '#58A6FF');
    panelEl.style.setProperty('--tc-ink', '#fff');
    panelEl.innerHTML =
      '<div class="fs-inner is-wide">' +
        '<div class="fs-loadhead"><h2>Load a saved game</h2>' +
        '<p>Pick up a career where you left it.</p></div>' +
        '<div id="fs-savelist"></div>' +
        '<button type="button" class="fs-back" id="fs-back">Back to franchises</button>' +
      '</div>';
    // Reuses the existing save-list renderer rather than restating it: that one
    // already owns slot labelling, escaping and the load wiring.
    renderSaveList(panelEl.querySelector('#fs-savelist'), onLoadGame);
    panelEl.querySelector('#fs-back').addEventListener('click', function () { showTeam(selectedId); });
  }

  container.querySelector('#fs-mode').addEventListener('click', function (e) {
    const btn = e.target.closest('button[data-mode]');
    if (!btn) return;
    mode = btn.getAttribute('data-mode');
    container.querySelectorAll('#fs-mode button').forEach(function (b) {
      b.classList.toggle('is-on', b === btn);
    });
  });

  container.querySelector('#fs-sort').addEventListener('click', function (e) {
    const btn = e.target.closest('button[data-sort]');
    if (!btn) return;
    sort = btn.getAttribute('data-sort');
    container.querySelectorAll('#fs-sort button').forEach(function (b) {
      b.classList.toggle('is-on', b === btn);
    });
    renderList();
  });

  container.querySelector('#fs-spectate').addEventListener('click', onSpectate);
  container.querySelector('#fs-load').addEventListener('click', showLoad);
  if (onPlayerCareer) {
    container.querySelector('#fs-career').addEventListener('click', onPlayerCareer);
  }

  renderList();
  showTeam(selectedId);
}

// Team primaries break a coloured button in two opposite directions, and the
// screen hits both: Brooklyn's is pure black, which vanishes against the panel,
// and San Antonio's is a pale silver that leaves white text at 1.6:1 — legible
// to nobody.
//
// resolveAccent (ui/topbar.js) already owns the too-dark half of that problem
// for the whole app — primary, else secondary, else the info blue — so this
// defers to it rather than inventing a second, disagreeing policy. Brooklyn
// therefore lands on its own white secondary, which is on-brand anyway.
//
// The too-light half is new here, because the topbar only uses the accent for
// borders and fills, never as a button under white text. --tc-ink flips the
// label to near-black once the button is bright enough that white would fail.
// 0.2 is the crossover where both directions clear 4:1 against this text.
const ACCENT_INK_FLIP = 0.2;

function setPanelAccent(el, team) {
  const accent = resolveAccent(team);
  el.style.setProperty('--tc', accent);
  el.style.setProperty('--tc-ink', hexLuminance(accent) >= ACCENT_INK_FLIP ? '#0B0E14' : '#FFFFFF');
}

function millions(value) {
  return '$' + Math.round(value / 1e6) + 'M';
}

function timelineLabel(timeline) {
  if (timeline === 'win-now') return 'Win now';
  if (timeline === 'rebuilding') return 'Rebuilding';
  if (timeline === 'retooling') return 'Retooling';
  return timeline;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    renderTeamSelect: renderTeamSelect,
    millions: millions,
    timelineLabel: timelineLabel
  };
}
