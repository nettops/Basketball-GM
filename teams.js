const TEAMS = [
  // Eastern Conference — Atlantic
  { id: 'BOS', name: 'Boston Celtics', conference: 'Eastern', division: 'Atlantic', colors: { primary: '#007A33', secondary: '#BA9653' }, prestige: 88, fanHappiness: 80, ownerHappiness: 80, chemistry: 75, record: { wins: 0, losses: 0 }, draftPicks: [] },
  { id: 'BKN', name: 'Brooklyn Nets', conference: 'Eastern', division: 'Atlantic', colors: { primary: '#000000', secondary: '#FFFFFF' }, prestige: 45, fanHappiness: 50, ownerHappiness: 55, chemistry: 60, record: { wins: 0, losses: 0 }, draftPicks: [] },
  { id: 'NYK', name: 'New York Knicks', conference: 'Eastern', division: 'Atlantic', colors: { primary: '#006BB6', secondary: '#F58426' }, prestige: 80, fanHappiness: 75, ownerHappiness: 70, chemistry: 72, record: { wins: 0, losses: 0 }, draftPicks: [] },
  { id: 'PHI', name: 'Philadelphia 76ers', conference: 'Eastern', division: 'Atlantic', colors: { primary: '#006BB6', secondary: '#ED174C' }, prestige: 70, fanHappiness: 60, ownerHappiness: 60, chemistry: 62, record: { wins: 0, losses: 0 }, draftPicks: [] },
  { id: 'TOR', name: 'Toronto Raptors', conference: 'Eastern', division: 'Atlantic', colors: { primary: '#CE1141', secondary: '#000000' }, prestige: 55, fanHappiness: 60, ownerHappiness: 60, chemistry: 65, record: { wins: 0, losses: 0 }, draftPicks: [] },

  // Eastern Conference — Central
  { id: 'CHI', name: 'Chicago Bulls', conference: 'Eastern', division: 'Central', colors: { primary: '#CE1141', secondary: '#000000' }, prestige: 55, fanHappiness: 55, ownerHappiness: 55, chemistry: 60, record: { wins: 0, losses: 0 }, draftPicks: [] },
  { id: 'CLE', name: 'Cleveland Cavaliers', conference: 'Eastern', division: 'Central', colors: { primary: '#860038', secondary: '#FDBB30' }, prestige: 78, fanHappiness: 75, ownerHappiness: 75, chemistry: 74, record: { wins: 0, losses: 0 }, draftPicks: [] },
  { id: 'DET', name: 'Detroit Pistons', conference: 'Eastern', division: 'Central', colors: { primary: '#C8102E', secondary: '#1D42BA' }, prestige: 60, fanHappiness: 65, ownerHappiness: 65, chemistry: 68, record: { wins: 0, losses: 0 }, draftPicks: [] },
  { id: 'IND', name: 'Indiana Pacers', conference: 'Eastern', division: 'Central', colors: { primary: '#002D62', secondary: '#FDBB30' }, prestige: 68, fanHappiness: 65, ownerHappiness: 65, chemistry: 70, record: { wins: 0, losses: 0 }, draftPicks: [] },
  { id: 'MIL', name: 'Milwaukee Bucks', conference: 'Eastern', division: 'Central', colors: { primary: '#00471B', secondary: '#EEE1C6' }, prestige: 75, fanHappiness: 68, ownerHappiness: 68, chemistry: 70, record: { wins: 0, losses: 0 }, draftPicks: [] },

  // Eastern Conference — Southeast
  { id: 'ATL', name: 'Atlanta Hawks', conference: 'Eastern', division: 'Southeast', colors: { primary: '#E03A3E', secondary: '#C1D32F' }, prestige: 55, fanHappiness: 55, ownerHappiness: 55, chemistry: 62, record: { wins: 0, losses: 0 }, draftPicks: [] },
  { id: 'CHA', name: 'Charlotte Hornets', conference: 'Eastern', division: 'Southeast', colors: { primary: '#1D1160', secondary: '#00788C' }, prestige: 42, fanHappiness: 45, ownerHappiness: 50, chemistry: 55, record: { wins: 0, losses: 0 }, draftPicks: [] },
  { id: 'MIA', name: 'Miami Heat', conference: 'Eastern', division: 'Southeast', colors: { primary: '#98002E', secondary: '#F9A01B' }, prestige: 76, fanHappiness: 70, ownerHappiness: 72, chemistry: 74, record: { wins: 0, losses: 0 }, draftPicks: [] },
  { id: 'ORL', name: 'Orlando Magic', conference: 'Eastern', division: 'Southeast', colors: { primary: '#0077C0', secondary: '#C4CED4' }, prestige: 68, fanHappiness: 65, ownerHappiness: 65, chemistry: 70, record: { wins: 0, losses: 0 }, draftPicks: [] },
  { id: 'WAS', name: 'Washington Wizards', conference: 'Eastern', division: 'Southeast', colors: { primary: '#002B5C', secondary: '#E31837' }, prestige: 38, fanHappiness: 45, ownerHappiness: 50, chemistry: 55, record: { wins: 0, losses: 0 }, draftPicks: [] },

  // Western Conference — Northwest
  { id: 'DEN', name: 'Denver Nuggets', conference: 'Western', division: 'Northwest', colors: { primary: '#0E2240', secondary: '#FEC524' }, prestige: 82, fanHappiness: 75, ownerHappiness: 75, chemistry: 76, record: { wins: 0, losses: 0 }, draftPicks: [] },
  { id: 'MIN', name: 'Minnesota Timberwolves', conference: 'Western', division: 'Northwest', colors: { primary: '#0C2340', secondary: '#236192' }, prestige: 70, fanHappiness: 68, ownerHappiness: 68, chemistry: 70, record: { wins: 0, losses: 0 }, draftPicks: [] },
  { id: 'OKC', name: 'Oklahoma City Thunder', conference: 'Western', division: 'Northwest', colors: { primary: '#007AC1', secondary: '#EF3B24' }, prestige: 88, fanHappiness: 82, ownerHappiness: 82, chemistry: 78, record: { wins: 0, losses: 0 }, draftPicks: [] },
  { id: 'POR', name: 'Portland Trail Blazers', conference: 'Western', division: 'Northwest', colors: { primary: '#E03A3E', secondary: '#000000' }, prestige: 45, fanHappiness: 50, ownerHappiness: 55, chemistry: 58, record: { wins: 0, losses: 0 }, draftPicks: [] },
  { id: 'UTA', name: 'Utah Jazz', conference: 'Western', division: 'Northwest', colors: { primary: '#002B5C', secondary: '#F9A01B' }, prestige: 40, fanHappiness: 48, ownerHappiness: 52, chemistry: 55, record: { wins: 0, losses: 0 }, draftPicks: [] },

  // Western Conference — Pacific
  { id: 'GSW', name: 'Golden State Warriors', conference: 'Western', division: 'Pacific', colors: { primary: '#1D428A', secondary: '#FFC72C' }, prestige: 78, fanHappiness: 70, ownerHappiness: 72, chemistry: 72, record: { wins: 0, losses: 0 }, draftPicks: [] },
  { id: 'LAC', name: 'LA Clippers', conference: 'Western', division: 'Pacific', colors: { primary: '#C8102E', secondary: '#1D428A' }, prestige: 62, fanHappiness: 58, ownerHappiness: 60, chemistry: 62, record: { wins: 0, losses: 0 }, draftPicks: [] },
  { id: 'LAL', name: 'Los Angeles Lakers', conference: 'Western', division: 'Pacific', colors: { primary: '#552583', secondary: '#FDB927' }, prestige: 85, fanHappiness: 75, ownerHappiness: 75, chemistry: 72, record: { wins: 0, losses: 0 }, draftPicks: [] },
  { id: 'PHX', name: 'Phoenix Suns', conference: 'Western', division: 'Pacific', colors: { primary: '#1D1160', secondary: '#E56020' }, prestige: 62, fanHappiness: 58, ownerHappiness: 58, chemistry: 60, record: { wins: 0, losses: 0 }, draftPicks: [] },
  { id: 'SAC', name: 'Sacramento Kings', conference: 'Western', division: 'Pacific', colors: { primary: '#5A2D81', secondary: '#63727A' }, prestige: 58, fanHappiness: 60, ownerHappiness: 60, chemistry: 65, record: { wins: 0, losses: 0 }, draftPicks: [] },

  // Western Conference — Southwest
  { id: 'DAL', name: 'Dallas Mavericks', conference: 'Western', division: 'Southwest', colors: { primary: '#00538C', secondary: '#B8C4CA' }, prestige: 68, fanHappiness: 62, ownerHappiness: 62, chemistry: 64, record: { wins: 0, losses: 0 }, draftPicks: [] },
  { id: 'HOU', name: 'Houston Rockets', conference: 'Western', division: 'Southwest', colors: { primary: '#CE1141', secondary: '#000000' }, prestige: 74, fanHappiness: 68, ownerHappiness: 68, chemistry: 70, record: { wins: 0, losses: 0 }, draftPicks: [] },
  { id: 'MEM', name: 'Memphis Grizzlies', conference: 'Western', division: 'Southwest', colors: { primary: '#5D76A9', secondary: '#12173F' }, prestige: 62, fanHappiness: 60, ownerHappiness: 60, chemistry: 62, record: { wins: 0, losses: 0 }, draftPicks: [] },
  { id: 'NOP', name: 'New Orleans Pelicans', conference: 'Western', division: 'Southwest', colors: { primary: '#0C2340', secondary: '#C8102E' }, prestige: 50, fanHappiness: 52, ownerHappiness: 55, chemistry: 58, record: { wins: 0, losses: 0 }, draftPicks: [] },
  { id: 'SAS', name: 'San Antonio Spurs', conference: 'Western', division: 'Southwest', colors: { primary: '#C4CED4', secondary: '#000000' }, prestige: 65, fanHappiness: 65, ownerHappiness: 65, chemistry: 68, record: { wins: 0, losses: 0 }, draftPicks: [] }
];

function getTeamById(teamId) {
  return TEAMS.find(function (t) { return t.id === teamId; });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TEAMS: TEAMS, getTeamById: getTeamById };
}
