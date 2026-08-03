var _FIN_DATA = (typeof require !== 'undefined')
  ? { data: require('./data.js') }
  : { data: { CAP_CONSTANTS: CAP_CONSTANTS, getEffectiveLuxuryTaxLine: getEffectiveLuxuryTaxLine, getEffectiveSalaryFloor: getEffectiveSalaryFloor } };

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Base capacity scales with marketSize (30-98 across the league); arenaTier
// upgrades (see upgradeArena) add on top of that base.
const ARENA_BASE_CAPACITY = 14000;
const ARENA_MARKET_SCALER = 110;
const ARENA_TIER_BONUS = 1800;
const ARENA_MAX_TIER = 5;

function ensureTeamFinances(team) {
  if (!team.finances) {
    team.finances = {
      cash: 0,
      arenaTier: 1,
      lastAttendance: 0,
      lastGateRevenue: 0,
      seasonGateRevenue: 0,
      seasonLuxuryTaxPaid: 0,
      seasonFloorTaxPaid: 0
    };
  }
  return team.finances;
}

function arenaCapacity(team) {
  const finances = ensureTeamFinances(team);
  return Math.round(ARENA_BASE_CAPACITY + team.marketSize * ARENA_MARKET_SCALER + (finances.arenaTier - 1) * ARENA_TIER_BONUS);
}

function upgradeArenaCost(team) {
  const finances = ensureTeamFinances(team);
  if (finances.arenaTier >= ARENA_MAX_TIER) return null;
  // Each tier costs more than the last — mirrors draftPickValue.js's decay-
  // curve style for a simple, tunable cost progression.
  return 8000000 * Math.pow(1.6, finances.arenaTier - 1);
}

function upgradeArena(team) {
  const finances = ensureTeamFinances(team);
  const cost = upgradeArenaCost(team);
  if (cost === null || finances.cash < cost) return false;
  finances.cash -= cost;
  finances.arenaTier += 1;
  return true;
}

// Owner-set spending posture, driven by ownerHappiness — feeds
// freeAgency.js's generateAIOffer so a sour owner visibly signs fewer/
// cheaper free agents than a happy one, instead of every AI team spending
// identically up to the cap.
function budgetTier(team) {
  if (team.ownerHappiness >= 70) return 'high';
  if (team.ownerHappiness >= 45) return 'medium';
  return 'low';
}

const BUDGET_TIER_SPEND_MULTIPLIER = { low: 0.6, medium: 0.85, high: 1.0 };

function budgetSpendMultiplier(team) {
  return BUDGET_TIER_SPEND_MULTIPLIER[budgetTier(team)];
}

function computeAttendanceRate(team) {
  const happinessFactor = team.fanHappiness / 100;
  const prestigeFactor = team.prestige / 100;
  const gamesPlayed = team.record.wins + team.record.losses;
  const winPct = gamesPlayed > 0 ? team.record.wins / gamesPlayed : 0.5;
  const rate = 0.45 + happinessFactor * 0.25 + prestigeFactor * 0.15 + winPct * 0.15;
  return clamp(rate, 0.25, 1);
}

function ticketPrice(team) {
  return 80 + team.marketSize * 1.5 + team.prestige;
}

// Called once per team per game (mirrors morale.js's tickMoraleForTeamGame /
// fatigue.js's applyFatigueForGame). Small per-game gate revenue accrues into
// team.finances.cash, and a win/loss nudges fanHappiness — the first thing
// that writes to fanHappiness after initialization, making it a live signal
// instead of the write-once decorative field it was before.
function tickFinancesForTeamGame(teamId, won, getTeamByIdFn) {
  const team = getTeamByIdFn(teamId);
  const finances = ensureTeamFinances(team);
  const capacity = arenaCapacity(team);
  const rate = computeAttendanceRate(team);
  const attendance = Math.round(capacity * rate);
  const revenue = Math.round(attendance * ticketPrice(team));

  finances.lastAttendance = attendance;
  finances.lastGateRevenue = revenue;
  finances.seasonGateRevenue += revenue;
  finances.cash += revenue;

  team.fanHappiness = clamp(team.fanHappiness + (won ? 0.3 : -0.2), 20, 99);
}

// Called once per team at season end (from history.js's finalizeSeasonHistory,
// alongside its existing per-team allTimeWins/allTimeLosses rollup). Deducts
// luxury tax or floor-shortfall tax from team.finances.cash and lets the
// season's tax outcome move ownerHappiness — previously a write-once field,
// now reacting to whether the team stayed financially disciplined.
function applySeasonEndFinances(team, payroll, capLevel) {
  const finances = ensureTeamFinances(team);
  const taxLine = _FIN_DATA.data.getEffectiveLuxuryTaxLine(capLevel);
  const floor = _FIN_DATA.data.getEffectiveSalaryFloor(capLevel);

  let luxuryTax = 0;
  let floorTax = 0;
  if (payroll > taxLine) {
    luxuryTax = Math.round((payroll - taxLine) * _FIN_DATA.data.CAP_CONSTANTS.LUXURY_TAX_RATE);
    finances.cash -= luxuryTax;
  } else if (payroll < floor) {
    floorTax = floor - payroll;
    finances.cash -= floorTax;
  }
  finances.seasonLuxuryTaxPaid = luxuryTax;
  finances.seasonFloorTaxPaid = floorTax;

  if (luxuryTax > 0) {
    team.ownerHappiness = clamp(team.ownerHappiness - Math.min(15, luxuryTax / 5000000), 20, 99);
  } else if (floorTax > 0) {
    team.ownerHappiness = clamp(team.ownerHappiness - 10, 20, 99);
  } else {
    team.ownerHappiness = clamp(team.ownerHappiness + 2, 20, 99);
  }

  finances.seasonGateRevenue = 0;

  return { luxuryTax: luxuryTax, floorTax: floorTax };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ensureTeamFinances: ensureTeamFinances,
    arenaCapacity: arenaCapacity,
    upgradeArenaCost: upgradeArenaCost,
    upgradeArena: upgradeArena,
    budgetTier: budgetTier,
    budgetSpendMultiplier: budgetSpendMultiplier,
    computeAttendanceRate: computeAttendanceRate,
    ticketPrice: ticketPrice,
    tickFinancesForTeamGame: tickFinancesForTeamGame,
    applySeasonEndFinances: applySeasonEndFinances,
    ARENA_MAX_TIER: ARENA_MAX_TIER
  };
}
