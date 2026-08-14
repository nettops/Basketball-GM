function hexLuminance(hex) {
  const h = (hex || '').replace('#', '');
  if (h.length !== 6) return 0;
  const rgb = [0, 2, 4].map(function (i) {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

// Team primaries include pure black (BKN) and very dark navies, which vanish
// against --bg. Fall back through secondary, then to the default info blue.
const MIN_ACCENT_LUMINANCE = 0.09;

function resolveAccent(team) {
  if (!team || !team.colors) return '#58A6FF';
  if (hexLuminance(team.colors.primary) >= MIN_ACCENT_LUMINANCE) return team.colors.primary;
  if (hexLuminance(team.colors.secondary) >= MIN_ACCENT_LUMINANCE) return team.colors.secondary;
  return '#58A6FF';
}

function hexToRgba(hex, alpha) {
  const h = (hex || '').replace('#', '');
  if (h.length !== 6) return 'rgba(88,166,255,' + alpha + ')';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

function applyTeamAccent(team) {
  const accent = resolveAccent(team);
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--accent-soft', hexToRgba(accent, 0.14));
  // The RAW hexes, unguarded on purpose: the ribbon gradient may run a pure
  // black (BKN) because its text sits on a scrim, never on the color itself.
  // Interactive elements keep reading the luminance-guarded --accent above.
  const colors = (team && team.colors) || {};
  document.documentElement.style.setProperty('--team-primary', colors.primary || '#007A33');
  document.documentElement.style.setProperty('--team-secondary', colors.secondary || '#BA9653');
}

function statusChip(label, value, valueClass) {
  return '<div class="status-chip"><span class="chip-label">' + label + '</span>' +
    '<span class="chip-value ' + (valueClass || '') + '">' + value + '</span></div>';
}

function renderTopBar(container) {
  if (!container) return;
  if (!GameState.userTeamId) { container.innerHTML = ''; return; }

  const team = getTeamById(GameState.userTeamId);
  applyTeamAccent(team);

  const payroll = getTeamPayroll(team.id);
  const cap = getEffectiveSalaryCap(GameState.settings && GameState.settings.capLevel);
  const pct = Math.min(100, Math.round((payroll / cap) * 100));
  const overCap = payroll > cap;
  const day = GameState.season && GameState.season.currentDay >= 0 ? GameState.season.currentDay : '—';
  const stage = GameState.playoffBracket ? 'Playoffs' : (GameState.offseasonStage ? 'Offseason' : 'Regular Season');

  // The root keeps the .topbar class alongside .ribbon so anything that ever
  // selected .topbar (smoke, tests, stray CSS) keeps binding.
  function tick(label, value, valueClass) {
    return '<div class="tick"><span class="tick-k">' + label + '</span>' +
      '<span class="tick-v ' + (valueClass || '') + '">' + value + '</span></div>';
  }
  container.innerHTML =
    '<div class="topbar ribbon">' +
      '<div class="ribbon-scrim">' +
        teamLogoImgHtml(team.id, 36) +
        '<div class="identity-text">' +
          '<div class="ribbon-name cond identity-name">' + escapeHtml(team.name) + '</div>' +
          '<div class="ribbon-sub identity-meta">' + team.record.wins + '–' + team.record.losses +
            ' · ' + team.conference + ' · ' + team.division + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="ribbon-ticker topbar-status">' +
        tick('Season', GameState.leagueYear || 2026, '') +
        tick('Day', day, '') +
        tick('Stage', stage, '') +
        '<div class="tick chip-cap">' +
          '<span class="tick-k">Payroll</span>' +
          '<span class="tick-v ' + (overCap ? 'is-over' : '') + '">$' + Math.round(payroll / 1e6) + 'M <em>/ $' + Math.round(cap / 1e6) + 'M</em></span>' +
          '<div class="meter"><div class="meter-fill ' + (overCap ? 'is-over' : '') + '" style="width:' + pct + '%"></div></div>' +
        '</div>' +
        tick('Chemistry', team.chemistry, '') +
        '<div class="mode-pill mode-' + GameState.playMode + '">' + GameState.playMode + '</div>' +
      '</div>' +
    '</div>';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderTopBar: renderTopBar, resolveAccent: resolveAccent, hexLuminance: hexLuminance };
}
