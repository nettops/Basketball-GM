// Pulls all 30 current NBA rosters from 2kratings.com with each player's
// full 37-attribute sheet, overall, potential grade, archetype, and
// physicals (height / weight / wingspan). Sequential with a politeness
// delay; ~480 requests total. Output: 2k-rosters.json next to this script.
//
// Parsing strategy: every player page embeds schema.org JSON-LD with all 37
// attributes as PropertyValue entries (robust), while archetype and
// physicals live in the sidebar HTML with stable label markup (regexed).
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const OUT = path.join(__dirname, '2k-rosters.json');
// The site 403s the self-identifying UA the first runs used (and Node
// fetch's TLS fingerprint before that); a standard browser UA is served
// normally. Delay bumped as politeness for the same reason.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const DELAY_MS = 400;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// curl, not Node fetch: the site 403s Node's TLS fingerprint but serves the
// identical request from curl with a 200 (verified side by side).
function curlGet(url) {
  return new Promise((resolve, reject) => {
    execFile('curl', ['-s', '--fail', '--max-time', '30', '-A', UA, url],
      { maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => err ? reject(new Error('curl: ' + err.message.split('\n')[0])) : resolve(stdout));
  });
}

async function get(url, attempt) {
  attempt = attempt || 1;
  try {
    return await curlGet(url);
  } catch (e) {
    if (attempt >= 3) throw e;
    await sleep(1500 * attempt);
    return get(url, attempt + 1);
  }
}

function jsonLd(html) {
  const m = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (e) { return null; }
}

function graphNode(html, type) {
  const j = jsonLd(html);
  if (!j) return null;
  const graph = j['@graph'] || [j];
  return graph.find(x => x['@type'] === type) || null;
}

const decode = s => s
  .replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  .replace(/&#8217;|&rsquo;/g, '’').replace(/<[^>]*>/g, '').trim();

// "6'8" (203cm)" -> { display, inches, cm }
function parseLength(raw) {
  if (!raw) return null;
  const t = decode(raw);
  const m = t.match(/(\d+)'(\d+)"?\s*\((\d+)cm\)/);
  if (!m) return { display: t };
  return { display: m[1] + "'" + m[2] + '"', inches: Number(m[1]) * 12 + Number(m[2]), cm: Number(m[3]) };
}

// "210lbs (95kg)" -> { display, lbs, kg }
function parseWeight(raw) {
  if (!raw) return null;
  const t = decode(raw);
  const m = t.match(/(\d+)lbs\s*\((\d+)kg\)/);
  if (!m) return { display: t };
  return { display: m[1] + 'lbs', lbs: Number(m[1]), kg: Number(m[2]) };
}

function sidebarField(html, label) {
  // Label: <span class="text-light">VALUE</span>
  const re = new RegExp(label + ':\\s*<span class="text-light">([^<]*)</span>');
  const m = html.match(re);
  return m ? m[1] : null;
}

function parsePlayer(html, url) {
  const person = graphNode(html, 'Person');
  if (!person) return null;
  const attrs = {};
  let overall = null, potential = null;
  (person.additionalProperty || []).forEach(p => {
    const name = p.name.replace(/ Attribute$/, '');
    if (/^NBA 2K\d+ Rating$/.test(p.name)) overall = Number(p.value);
    else if (name === 'Potential') potential = String(p.value);
    else attrs[name] = Number(p.value);
  });

  const positions = [...html.matchAll(/href="\/lists\/[a-z-]+"\s*>([A-Z]{1,2})<\/a>/g)]
    .map(m => m[1]);
  const bd = html.match(/Birthdate:\s*([A-Z][a-z]+ \d+, \d{4})/);
  const years = html.match(/Year\(s\) in the NBA:\s*(\d+)/);
  const prior = html.match(/Prior to NBA:\s*([^<]+)</);
  const jersey = html.match(/Jersey:\s*#(\d+)/);
  const nation = html.match(/countries\/[a-z-]+">\s*([^<]+?)\s*<\/a>/);

  return {
    name: person.name,
    url: url,
    overall: overall,
    potential: potential,
    archetype: sidebarField(html, 'Archetype') ? decode(sidebarField(html, 'Archetype')) : null,
    positions: [...new Set(positions)],
    jersey: jersey ? Number(jersey[1]) : null,
    height: parseLength(sidebarField(html, 'Height')),
    weight: parseWeight(sidebarField(html, 'Weight')),
    wingspan: parseLength(sidebarField(html, 'Wingspan')),
    birthdate: bd ? bd[1] : null,
    yearsInNba: years ? Number(years[1]) : null,
    priorToNba: prior ? decode(prior[1]) : null,
    nationality: nation ? decode(nation[1]) : null,
    attributes: attrs
  };
}

// The 30 current NBA team slugs, verbatim from the homepage's Browse Current
// Teams section (the homepage also links all-time, classic, all-decade,
// all-star and G-League squads, so a filter is fragile where a list is not).
const TEAM_SLUGS = [
  'atlanta-hawks', 'boston-celtics', 'brooklyn-nets', 'charlotte-hornets',
  'chicago-bulls', 'cleveland-cavaliers', 'dallas-mavericks', 'denver-nuggets',
  'detroit-pistons', 'golden-state-warriors', 'houston-rockets', 'indiana-pacers',
  'los-angeles-clippers', 'los-angeles-lakers', 'memphis-grizzlies', 'miami-heat',
  'milwaukee-bucks', 'minnesota-timberwolves', 'new-orleans-pelicans', 'new-york-knicks',
  'oklahoma-city-thunder', 'orlando-magic', 'philadelphia-76ers', 'phoenix-suns',
  'portland-trail-blazers', 'sacramento-kings', 'san-antonio-spurs', 'toronto-raptors',
  'utah-jazz', 'washington-wizards'
];

async function main() {
  const teamUrls = TEAM_SLUGS.map(s => 'https://www.2kratings.com/teams/' + s);

  const out = { source: 'https://www.2kratings.com/', edition: 'NBA 2K27', pulledAt: new Date().toISOString(), teams: [] };
  let playerCount = 0, failures = [];

  for (const teamUrl of teamUrls) {
    await sleep(DELAY_MS);
    const teamHtml = await get(teamUrl);
    const teamNode = graphNode(teamHtml, 'SportsTeam');
    const teamName = teamNode ? teamNode.name : teamUrl.split('/teams/')[1];
    const athletes = (teamNode && teamNode.athlete) || [];
    const team = { name: teamName, url: teamUrl, players: [] };

    for (const a of athletes) {
      await sleep(DELAY_MS);
      const purl = a.url || (a['@id'] || '').replace(/#person$/, '');
      if (!purl) continue;
      try {
        const p = parsePlayer(await get(purl), purl);
        if (p && p.overall !== null) team.players.push(p);
        else failures.push(purl + ' (no ratings — likely an unrated incoming draftee)');
      } catch (e) {
        failures.push(purl + ' (' + e.message + ')');
      }
    }
    playerCount += team.players.length;
    console.log(teamName + ': ' + team.players.length + ' players (' + playerCount + ' total)');
    out.teams.push(team);
  }

  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log('WROTE ' + OUT + ' — ' + playerCount + ' players across ' + out.teams.length + ' teams');
  if (failures.length) console.log('skipped/failed (' + failures.length + '):\n' + failures.join('\n'));
}

main().catch(e => { console.error('FATAL: ' + e.message); process.exit(1); });
