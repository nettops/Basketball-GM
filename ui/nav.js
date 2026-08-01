const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'roster', label: 'Roster' },
  { id: 'standings', label: 'Standings' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'trade', label: 'Trade Center' },
  { id: 'freeagency', label: 'Free Agency' },
  { id: 'draft', label: 'Draft' },
  { id: 'scouting', label: 'Scouting' },
  { id: 'saveload', label: 'Save/Load' },
  { id: 'feed', label: 'Live Feed' },
  { id: 'salarycap', label: 'Salary Cap' },
  { id: 'news', label: 'League News' },
  { id: 'awards', label: 'Awards' },
  { id: 'history', label: 'History' },
  { id: 'settings', label: 'Settings' }
];

function renderNav(container, activeView, onNavigate) {
  container.innerHTML = '';
  NAV_ITEMS.forEach(function (item) {
    const btn = document.createElement('button');
    btn.textContent = item.label;
    if (item.id === activeView) {
      btn.className = 'active';
    }
    btn.addEventListener('click', function () { onNavigate(item.id); });
    container.appendChild(btn);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NAV_ITEMS: NAV_ITEMS, renderNav: renderNav };
}
