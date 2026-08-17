// The shot chart. Three zones, drawn as three regions of a half court.
//
// The engine knows zones, not coordinates — pickShotZone returns inside, mid,
// or three and nothing finer. Scattering dots inside a zone would draw a
// precision the model does not have, so the regions are filled whole and the
// chart says exactly what is known.
//
// The pure part lives at file scope so scripts/validate-shotZones.js can reach
// it. Three real defects once hid inside a render closure in
// ui/pixelGameView.js where no validator could see them; ui/pixelMotion.js
// exists because of it.

// Where a zone's colour comes from. Compared against the LEAGUE rate for that
// zone rather than an absolute scale, because 45% is a poor night at the rim
// and an excellent one from three — one shared scale would paint every centre
// hot and every guard cold.
const SHOT_ZONE_BASELINE = { inside: 0.60, mid: 0.41, three: 0.36 };

// +/- this much either side of the baseline saturates the colour. 8 points of
// field-goal percentage is roughly the gap between a poor and an elite shooter
// from a given spot, so the full range of the scale covers the range of players
// actually in the league rather than being spent on outliers.
const SHOT_ZONE_SPREAD = 0.08;

// -1 (cold) through 0 (league average) to +1 (hot). Returns 0 for an unshot
// zone so an empty chart reads neutral instead of ice cold — a centre who has
// never taken a three is not a bad three-point shooter, he is not a
// three-point shooter.
function shotZoneHeat(zone, made, attempted) {
  if (!attempted) return 0;
  const baseline = SHOT_ZONE_BASELINE[zone];
  if (baseline === undefined) return 0;
  const diff = (made / attempted) - baseline;
  return Math.max(-1, Math.min(1, diff / SHOT_ZONE_SPREAD));
}

// Heat to fill. Blue-through-grey-through-red would be the obvious choice and
// is the one to avoid: --win/--loss are already the app's good/bad pair and
// reusing them keeps one vocabulary across the game.
function shotZoneFill(heat, attempted) {
  if (!attempted) return 'rgba(100,116,139,.10)';
  const strength = 0.14 + Math.abs(heat) * 0.34;
  return heat >= 0
    ? 'rgba(63,185,80,' + strength.toFixed(3) + ')'
    : 'rgba(248,81,73,' + strength.toFixed(3) + ')';
}

// Reads a season line (or any object carrying the same keys) into the three
// zones the chart draws. Accepts a raw stat line rather than the output of
// getPlayerAverages so it can also be handed a team total, which has no
// gamesPlayed to average over.
function shotZoneSplit(stats) {
  const s = stats || {};
  const inside = { zone: 'inside', label: 'At the rim', fgm: s.insideFgm || 0, fga: s.insideFga || 0 };
  const mid = { zone: 'mid', label: 'Mid-range', fgm: s.midFgm || 0, fga: s.midFga || 0 };
  const three = { zone: 'three', label: 'Three', fgm: s.tpm || 0, fga: s.tpa || 0 };
  const total = inside.fga + mid.fga + three.fga;
  return [inside, mid, three].map(function (z) {
    z.pct = z.fga > 0 ? z.fgm / z.fga : 0;
    z.share = total > 0 ? z.fga / total : 0;
    z.heat = shotZoneHeat(z.zone, z.fgm, z.fga);
    z.fill = shotZoneFill(z.heat, z.fga);
    return z;
  });
}

function shotZonePctText(z) {
  return z.fga > 0 ? (z.pct * 100).toFixed(1) + '%' : '—';
}

// A half court, 300x280, hoop at the top. The three regions are drawn back to
// front: beyond the arc fills the whole floor, the mid-range band sits on top
// of it, the paint on top of that. Cheaper than clipping three exact shapes
// and the boundaries land in the same places.
function shotChartSvg(zones) {
  const byZone = {};
  zones.forEach(function (z) { byZone[z.zone] = z; });
  const three = byZone.three, mid = byZone.mid, inside = byZone.inside;

  return '<svg class="shot-chart-svg" viewBox="0 0 300 280" role="img" aria-label="Shot chart by zone">' +
    // Beyond the arc — everything outside the mid-range dome.
    '<rect x="2" y="2" width="296" height="276" rx="4" fill="' + three.fill + '" stroke="var(--line)"/>' +
    // Mid-range: a dome from the baseline out to the arc.
    '<path d="M 42 2 L 42 96 A 108 108 0 0 0 258 96 L 258 2 Z" fill="' + mid.fill + '" stroke="var(--line)"/>' +
    // The paint, hoop at the top centre.
    '<rect x="102" y="2" width="96" height="112" fill="' + inside.fill + '" stroke="var(--line)"/>' +
    '<circle cx="150" cy="22" r="9" fill="none" stroke="var(--line-strong)" stroke-width="2"/>' +
    '<line x1="132" y1="10" x2="168" y2="10" stroke="var(--line-strong)" stroke-width="3"/>' +
    zoneLabelSvg(inside, 150, 70) +
    zoneLabelSvg(mid, 150, 150) +
    zoneLabelSvg(three, 150, 244) +
  '</svg>';
}

function zoneLabelSvg(z, x, y) {
  return '<text x="' + x + '" y="' + y + '" class="shot-chart-pct" text-anchor="middle">' + shotZonePctText(z) + '</text>' +
    '<text x="' + x + '" y="' + (y + 16) + '" class="shot-chart-sub" text-anchor="middle">' +
      z.fgm + '/' + z.fga + ' &middot; ' + (z.share * 100).toFixed(0) + '% of shots</text>';
}

// The whole panel: chart plus the same numbers as a table, because a colour is
// an impression and a reader chasing a specific number should not have to
// squint at a fill.
function shotChartPanelHtml(title, stats) {
  const zones = shotZoneSplit(stats);
  const totalFga = zones.reduce(function (sum, z) { return sum + z.fga; }, 0);
  if (!totalFga) {
    return '<div class="panel"><div class="panel-header">' + title + '</div>' +
      '<div class="panel-body"><p class="kpi-sub">No shots taken yet this season.</p></div></div>';
  }
  return '<div class="panel"><div class="panel-header">' + title + '</div>' +
    '<div class="panel-body shot-chart-body">' +
      shotChartSvg(zones) +
      '<table class="data-table shot-chart-table"><thead><tr><th>Zone</th><th class="num">FG</th>' +
        '<th class="num">FG%</th><th class="num">Share</th></tr></thead><tbody>' +
        zones.map(function (z) {
          return '<tr><td>' + z.label + '</td>' +
            '<td class="num">' + z.fgm + '/' + z.fga + '</td>' +
            '<td class="num">' + shotZonePctText(z) + '</td>' +
            '<td class="num">' + (z.share * 100).toFixed(1) + '%</td></tr>';
        }).join('') +
      '</tbody></table>' +
    '</div></div>';
}

// Sums a roster's season lines into one object shaped like a season line, so a
// team chart goes through exactly the same code as a player's.
function teamShotTotals(players) {
  const total = { insideFga: 0, insideFgm: 0, midFga: 0, midFgm: 0, tpa: 0, tpm: 0 };
  (players || []).forEach(function (p) {
    const s = p.seasonStats;
    if (!s) return;
    Object.keys(total).forEach(function (k) { total[k] += s[k] || 0; });
  });
  return total;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SHOT_ZONE_BASELINE: SHOT_ZONE_BASELINE,
    SHOT_ZONE_SPREAD: SHOT_ZONE_SPREAD,
    shotZoneHeat: shotZoneHeat,
    shotZoneFill: shotZoneFill,
    shotZoneSplit: shotZoneSplit,
    shotZonePctText: shotZonePctText,
    shotChartSvg: shotChartSvg,
    shotChartPanelHtml: shotChartPanelHtml,
    teamShotTotals: teamShotTotals
  };
}
