const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', group: 'Team' },
  { id: 'roster', label: 'Roster', group: 'Team' },
  { id: 'schedule', label: 'Schedule', group: 'Team' },
  { id: 'standings', label: 'Standings', group: 'League' },
  { id: 'awards', label: 'Awards', group: 'League' },
  { id: 'history', label: 'History', group: 'League' },
  { id: 'news', label: 'League News', group: 'League' },
  { id: 'feed', label: 'Live Feed', group: 'League' },
  { id: 'trade', label: 'Trade Center', group: 'Transactions' },
  { id: 'freeagency', label: 'Free Agency', group: 'Transactions' },
  { id: 'draft', label: 'Draft', group: 'Transactions' },
  { id: 'scouting', label: 'Scouting', group: 'Transactions' },
  { id: 'salarycap', label: 'Salary Cap', group: 'Transactions' },
  { id: 'saveload', label: 'Save/Load', group: 'System' },
  { id: 'settings', label: 'Settings', group: 'System' },
  { id: 'commissioner', label: 'Commissioner', group: 'System' }
];

const NAV_GROUP_ORDER = ['Team', 'League', 'Transactions', 'System'];

function renderNav(container, activeView, onNavigate, playMode) {
  container.innerHTML = '';
  NAV_GROUP_ORDER.forEach(function (group) {
    const items = NAV_ITEMS.filter(function (item) {
      if (item.group !== group) return false;
      if (item.id === 'commissioner' && playMode !== 'commissioner') return false;
      return true;
    });
    if (items.length === 0) return;

    const groupEl = document.createElement('div');
    groupEl.className = 'nav-group';
    const label = document.createElement('div');
    label.className = 'nav-group-label';
    label.textContent = group;
    groupEl.appendChild(label);

    items.forEach(function (item) {
      const btn = document.createElement('button');
      btn.textContent = item.label;
      btn.className = item.id === activeView ? 'nav-item active' : 'nav-item';
      btn.addEventListener('click', function () { onNavigate(item.id); });
      groupEl.appendChild(btn);
    });

    container.appendChild(groupEl);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NAV_ITEMS: NAV_ITEMS, renderNav: renderNav };
}
