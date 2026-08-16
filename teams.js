const TEAMS = [
  // Eastern Conference — Atlantic
  { id: 'BOS', name: 'Boston Harbormen', conference: 'Eastern', division: 'Atlantic', colors: { primary: '#007A33', secondary: '#BA9653' }, prestige: 88, fanHappiness: 80, ownerHappiness: 80, chemistry: 75, timeline: 'win-now', marketSize: 78, record: { wins: 0, losses: 0 }, draftPicks: [
    { round: 1, originalTeamId: 'BOS', currentOwnerId: 'BOS' },
    { round: 2, originalTeamId: 'BOS', currentOwnerId: 'BOS' }
  ] },
  { id: 'BKN', name: 'Brooklyn Ironworks', conference: 'Eastern', division: 'Atlantic', colors: { primary: '#000000', secondary: '#FFFFFF' }, prestige: 45, fanHappiness: 50, ownerHappiness: 55, chemistry: 60, timeline: 'rebuilding', marketSize: 95, record: { wins: 0, losses: 0 }, draftPicks: [
    { round: 1, originalTeamId: 'BKN', currentOwnerId: 'BKN' },
    { round: 2, originalTeamId: 'BKN', currentOwnerId: 'BKN' }
  ] },
  { id: 'NYK', name: 'New York Empire', conference: 'Eastern', division: 'Atlantic', colors: { primary: '#006BB6', secondary: '#F58426' }, prestige: 80, fanHappiness: 75, ownerHappiness: 70, chemistry: 72, timeline: 'win-now', marketSize: 98, record: { wins: 0, losses: 0 }, draftPicks: [
    { round: 1, originalTeamId: 'NYK', currentOwnerId: 'NYK' },
    { round: 2, originalTeamId: 'NYK', currentOwnerId: 'NYK' }
  ] },
  { id: 'PHI', name: 'Philadelphia Keystones', conference: 'Eastern', division: 'Atlantic', colors: { primary: '#006BB6', secondary: '#ED174C' }, prestige: 70, fanHappiness: 60, ownerHappiness: 60, chemistry: 62, timeline: 'win-now', marketSize: 75, record: { wins: 0, losses: 0 }, draftPicks: [
    { round: 1, originalTeamId: 'PHI', currentOwnerId: 'PHI' },
    { round: 2, originalTeamId: 'PHI', currentOwnerId: 'PHI' }
  ] },
  { id: 'TOR', name: 'Toronto Sentinels', conference: 'Eastern', division: 'Atlantic', colors: { primary: '#CE1141', secondary: '#000000' }, prestige: 55, fanHappiness: 60, ownerHappiness: 60, chemistry: 65, timeline: 'retooling', marketSize: 68, record: { wins: 0, losses: 0 }, draftPicks: [
    { round: 1, originalTeamId: 'TOR', currentOwnerId: 'TOR' },
    { round: 2, originalTeamId: 'TOR', currentOwnerId: 'TOR' }
  ] },

  // Eastern Conference — Central
  { id: 'CHI', name: 'Chicago Blaze', conference: 'Eastern', division: 'Central', colors: { primary: '#CE1141', secondary: '#000000' }, prestige: 55, fanHappiness: 55, ownerHappiness: 55, chemistry: 60, timeline: 'retooling', marketSize: 85, record: { wins: 0, losses: 0 }, draftPicks: [
    { round: 1, originalTeamId: 'CHI', currentOwnerId: 'CHI' },
    { round: 2, originalTeamId: 'CHI', currentOwnerId: 'CHI' }
  ] },
  { id: 'CLE', name: 'Cleveland Ironmen', conference: 'Eastern', division: 'Central', colors: { primary: '#860038', secondary: '#FDBB30' }, prestige: 78, fanHappiness: 75, ownerHappiness: 75, chemistry: 74, timeline: 'win-now', marketSize: 48, record: { wins: 0, losses: 0 }, draftPicks: [
    { round: 1, originalTeamId: 'CLE', currentOwnerId: 'CLE' },
    { round: 2, originalTeamId: 'CLE', currentOwnerId: 'CLE' }
  ] },
  { id: 'DET', name: 'Detroit Dynamos', conference: 'Eastern', division: 'Central', colors: { primary: '#C8102E', secondary: '#1D42BA' }, prestige: 60, fanHappiness: 65, ownerHappiness: 65, chemistry: 68, timeline: 'retooling', marketSize: 50, record: { wins: 0, losses: 0 }, draftPicks: [
    { round: 1, originalTeamId: 'DET', currentOwnerId: 'DET' },
    { round: 2, originalTeamId: 'DET', currentOwnerId: 'DET' }
  ] },
  { id: 'IND', name: 'Indiana Motors', conference: 'Eastern', division: 'Central', colors: { primary: '#002D62', secondary: '#FDBB30' }, prestige: 68, fanHappiness: 65, ownerHappiness: 65, chemistry: 70, timeline: 'win-now', marketSize: 40, record: { wins: 0, losses: 0 }, draftPicks: [
    { round: 1, originalTeamId: 'IND', currentOwnerId: 'IND' },
    { round: 2, originalTeamId: 'IND', currentOwnerId: 'IND' }
  ] },
  { id: 'MIL', name: 'Milwaukee Barons', conference: 'Eastern', division: 'Central', colors: { primary: '#00471B', secondary: '#EEE1C6' }, prestige: 75, fanHappiness: 68, ownerHappiness: 68, chemistry: 70, timeline: 'win-now', marketSize: 42, record: { wins: 0, losses: 0 }, draftPicks: [
    { round: 1, originalTeamId: 'MIL', currentOwnerId: 'MIL' },
    { round: 2, originalTeamId: 'MIL', currentOwnerId: 'MIL' }
  ] },

  // Eastern Conference — Southeast
  { id: 'ATL', name: 'Atlanta Firebirds', conference: 'Eastern', division: 'Southeast', colors: { primary: '#E03A3E', secondary: '#C1D32F' }, prestige: 55, fanHappiness: 55, ownerHappiness: 55, chemistry: 62, timeline: 'retooling', marketSize: 58, record: { wins: 0, losses: 0 }, draftPicks: [
    { round: 1, originalTeamId: 'ATL', currentOwnerId: 'ATL' },
    { round: 2, originalTeamId: 'ATL', currentOwnerId: 'ATL' }
  ] },
  { id: 'CHA', name: 'Charlotte Crown', conference: 'Eastern', division: 'Southeast', colors: { primary: '#1D1160', secondary: '#00788C' }, prestige: 42, fanHappiness: 45, ownerHappiness: 50, chemistry: 55, timeline: 'rebuilding', marketSize: 38, record: { wins: 0, losses: 0 }, draftPicks: [
    { round: 1, originalTeamId: 'CHA', currentOwnerId: 'CHA' },
    { round: 2, originalTeamId: 'CHA', currentOwnerId: 'CHA' }
  ] },
  { id: 'MIA', name: 'Miami Tarpons', conference: 'Eastern', division: 'Southeast', colors: { primary: '#98002E', secondary: '#F9A01B' }, prestige: 76, fanHappiness: 70, ownerHappiness: 72, chemistry: 74, timeline: 'win-now', marketSize: 70, record: { wins: 0, losses: 0 }, draftPicks: [
    { round: 1, originalTeamId: 'MIA', currentOwnerId: 'MIA' },
    { round: 2, originalTeamId: 'MIA', currentOwnerId: 'MIA' }
  ] },
  { id: 'ORL', name: 'Orlando Solar', conference: 'Eastern', division: 'Southeast', colors: { primary: '#0077C0', secondary: '#C4CED4' }, prestige: 68, fanHappiness: 65, ownerHappiness: 65, chemistry: 70, timeline: 'retooling', marketSize: 44, record: { wins: 0, losses: 0 }, draftPicks: [
    { round: 1, originalTeamId: 'ORL', currentOwnerId: 'ORL' },
    { round: 2, originalTeamId: 'ORL', currentOwnerId: 'ORL' }
  ] },
  { id: 'WAS', name: 'Washington Monuments', conference: 'Eastern', division: 'Southeast', colors: { primary: '#002B5C', secondary: '#E31837' }, prestige: 38, fanHappiness: 45, ownerHappiness: 50, chemistry: 55, timeline: 'rebuilding', marketSize: 60, record: { wins: 0, losses: 0 }, draftPicks: [
    { round: 1, originalTeamId: 'WAS', currentOwnerId: 'WAS' },
    { round: 2, originalTeamId: 'WAS', currentOwnerId: 'WAS' }
  ] },

  // Western Conference — Northwest
  { id: 'DEN', name: 'Denver Summit', conference: 'Western', division: 'Northwest', colors: { primary: '#0E2240', secondary: '#FEC524' }, prestige: 82, fanHappiness: 75, ownerHappiness: 75, chemistry: 76, timeline: 'win-now', marketSize: 55, record: { wins: 0, losses: 0 }, draftPicks: [
    { round: 1, originalTeamId: 'DEN', currentOwnerId: 'DEN' },
    { round: 2, originalTeamId: 'DEN', currentOwnerId: 'DEN' }
  ] },
  { id: 'MIN', name: 'Minnesota Loons', conference: 'Western', division: 'Northwest', colors: { primary: '#0C2340', secondary: '#236192' }, prestige: 70, fanHappiness: 68, ownerHappiness: 68, chemistry: 70, timeline: 'win-now', marketSize: 46, record: { wins: 0, losses: 0 }, draftPicks: [
    { round: 1, originalTeamId: 'MIN', currentOwnerId: 'MIN' },
    { round: 2, originalTeamId: 'MIN', currentOwnerId: 'MIN' }
  ] },
  { id: 'OKC', name: 'Oklahoma City Twisters', conference: 'Western', division: 'Northwest', colors: { primary: '#007AC1', secondary: '#EF3B24' }, prestige: 88, fanHappiness: 82, ownerHappiness: 82, chemistry: 78, timeline: 'win-now', marketSize: 32, record: { wins: 0, losses: 0 }, draftPicks: [
    { round: 1, originalTeamId: 'OKC', currentOwnerId: 'OKC' },
    { round: 2, originalTeamId: 'OKC', currentOwnerId: 'OKC' }
  ] },
  { id: 'POR', name: 'Portland Pioneers', conference: 'Western', division: 'Northwest', colors: { primary: '#E03A3E', secondary: '#000000' }, prestige: 45, fanHappiness: 50, ownerHappiness: 55, chemistry: 58, timeline: 'rebuilding', marketSize: 45, record: { wins: 0, losses: 0 }, draftPicks: [
    { round: 1, originalTeamId: 'POR', currentOwnerId: 'POR' },
    { round: 2, originalTeamId: 'POR', currentOwnerId: 'POR' }
  ] },
  { id: 'UTA', name: 'Utah Arches', conference: 'Western', division: 'Northwest', colors: { primary: '#002B5C', secondary: '#F9A01B' }, prestige: 40, fanHappiness: 48, ownerHappiness: 52, chemistry: 55, timeline: 'rebuilding', marketSize: 36, record: { wins: 0, losses: 0 }, draftPicks: [
    { round: 1, originalTeamId: 'UTA', currentOwnerId: 'UTA' },
    { round: 2, originalTeamId: 'UTA', currentOwnerId: 'UTA' }
  ] },

  // Western Conference — Pacific
  { id: 'GSW', name: 'Golden State Miners', conference: 'Western', division: 'Pacific', colors: { primary: '#1D428A', secondary: '#FFC72C' }, prestige: 78, fanHappiness: 70, ownerHappiness: 72, chemistry: 72, timeline: 'win-now', marketSize: 88, record: { wins: 0, losses: 0 }, draftPicks: [
    { round: 1, originalTeamId: 'GSW', currentOwnerId: 'GSW' },
    { round: 2, originalTeamId: 'GSW', currentOwnerId: 'GSW' }
  ] },
  { id: 'LAC', name: 'LA Surf', conference: 'Western', division: 'Pacific', colors: { primary: '#C8102E', secondary: '#1D428A' }, prestige: 62, fanHappiness: 58, ownerHappiness: 60, chemistry: 62, timeline: 'win-now', marketSize: 90, record: { wins: 0, losses: 0 }, draftPicks: [
    { round: 1, originalTeamId: 'LAC', currentOwnerId: 'LAC' },
    { round: 2, originalTeamId: 'LAC', currentOwnerId: 'LAC' }
  ] },
  { id: 'LAL', name: 'Los Angeles Monarchs', conference: 'Western', division: 'Pacific', colors: { primary: '#552583', secondary: '#FDB927' }, prestige: 85, fanHappiness: 75, ownerHappiness: 75, chemistry: 72, timeline: 'win-now', marketSize: 97, record: { wins: 0, losses: 0 }, draftPicks: [
    { round: 1, originalTeamId: 'LAL', currentOwnerId: 'LAL' },
    { round: 2, originalTeamId: 'LAL', currentOwnerId: 'LAL' }
  ] },
  { id: 'PHX', name: 'Phoenix Sidewinders', conference: 'Western', division: 'Pacific', colors: { primary: '#1D1160', secondary: '#E56020' }, prestige: 62, fanHappiness: 58, ownerHappiness: 58, chemistry: 60, timeline: 'retooling', marketSize: 55, record: { wins: 0, losses: 0 }, draftPicks: [
    { round: 1, originalTeamId: 'PHX', currentOwnerId: 'PHX' },
    { round: 2, originalTeamId: 'PHX', currentOwnerId: 'PHX' }
  ] },
  { id: 'SAC', name: 'Sacramento Gold', conference: 'Western', division: 'Pacific', colors: { primary: '#5A2D81', secondary: '#63727A' }, prestige: 58, fanHappiness: 60, ownerHappiness: 60, chemistry: 65, timeline: 'retooling', marketSize: 52, record: { wins: 0, losses: 0 }, draftPicks: [
    { round: 1, originalTeamId: 'SAC', currentOwnerId: 'SAC' },
    { round: 2, originalTeamId: 'SAC', currentOwnerId: 'SAC' }
  ] },

  // Western Conference — Southwest
  { id: 'DAL', name: 'Dallas Wranglers', conference: 'Western', division: 'Southwest', colors: { primary: '#00538C', secondary: '#B8C4CA' }, prestige: 68, fanHappiness: 62, ownerHappiness: 62, chemistry: 64, timeline: 'win-now', marketSize: 72, record: { wins: 0, losses: 0 }, draftPicks: [
    { round: 1, originalTeamId: 'DAL', currentOwnerId: 'DAL' },
    { round: 2, originalTeamId: 'DAL', currentOwnerId: 'DAL' }
  ] },
  { id: 'HOU', name: 'Houston Apollos', conference: 'Western', division: 'Southwest', colors: { primary: '#CE1141', secondary: '#000000' }, prestige: 74, fanHappiness: 68, ownerHappiness: 68, chemistry: 70, timeline: 'win-now', marketSize: 70, record: { wins: 0, losses: 0 }, draftPicks: [
    { round: 1, originalTeamId: 'HOU', currentOwnerId: 'HOU' },
    { round: 2, originalTeamId: 'HOU', currentOwnerId: 'HOU' }
  ] },
  { id: 'MEM', name: 'Memphis Rhythm', conference: 'Western', division: 'Southwest', colors: { primary: '#5D76A9', secondary: '#12173F' }, prestige: 62, fanHappiness: 60, ownerHappiness: 60, chemistry: 62, timeline: 'retooling', marketSize: 30, record: { wins: 0, losses: 0 }, draftPicks: [
    { round: 1, originalTeamId: 'MEM', currentOwnerId: 'MEM' },
    { round: 2, originalTeamId: 'MEM', currentOwnerId: 'MEM' }
  ] },
  { id: 'NOP', name: 'New Orleans Krewe', conference: 'Western', division: 'Southwest', colors: { primary: '#0C2340', secondary: '#C8102E' }, prestige: 50, fanHappiness: 52, ownerHappiness: 55, chemistry: 58, timeline: 'rebuilding', marketSize: 35, record: { wins: 0, losses: 0 }, draftPicks: [
    { round: 1, originalTeamId: 'NOP', currentOwnerId: 'NOP' },
    { round: 2, originalTeamId: 'NOP', currentOwnerId: 'NOP' }
  ] },
  { id: 'SAS', name: 'San Antonio Vaqueros', conference: 'Western', division: 'Southwest', colors: { primary: '#C4CED4', secondary: '#000000' }, prestige: 65, fanHappiness: 65, ownerHappiness: 65, chemistry: 68, timeline: 'rebuilding', marketSize: 45, record: { wins: 0, losses: 0 }, draftPicks: [
    { round: 1, originalTeamId: 'SAS', currentOwnerId: 'SAS' },
    { round: 2, originalTeamId: 'SAS', currentOwnerId: 'SAS' }
  ] }
];

function getTeamById(teamId) {
  return TEAMS.find(function (t) { return t.id === teamId; });
}

// Convention: a logo lives at assets/logos/{team.id}.png (e.g. assets/logos/BOS.png).
// No files ship with the repo — drop your own in and the UI picks them up automatically;
// missing files fall back to the existing colored badge (see ui/teamLogo.js).
function getTeamLogoUrl(teamId) {
  return 'assets/logos/' + teamId + '.png';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TEAMS: TEAMS, getTeamById: getTeamById, getTeamLogoUrl: getTeamLogoUrl };
}
