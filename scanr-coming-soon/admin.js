(() => {
  const loginView = document.querySelector('#login-view');
  const dashboard = document.querySelector('#dashboard');
  const message = document.querySelector('#login-message');
  const adminMessage = document.querySelector('#admin-message');
  const signOut = document.querySelector('#logout');
  let subscribers = [];

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const formatDate = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? '—' : date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  async function loadData() {
    adminMessage.textContent = 'Refreshing dashboard…';
    try {
      const response = await fetch('/api/admin/data', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { dashboard.hidden = true; signOut.hidden = true; loginView.hidden = false; return; }
      if (!response.ok) throw new Error(data.error || 'Could not load dashboard data.');
      subscribers = data.subscribers || [];
      render(data);
      loginView.hidden = true; dashboard.hidden = false; signOut.hidden = false;
      adminMessage.textContent = 'Updated just now.';
    } catch (error) { adminMessage.textContent = error.message; }
  }

  function render(data) {
    const views = data.views || { total: 0, last7Days: 0, last30Days: 0, pages: [], countries: [], daily: [] };
    document.querySelector('#subscriber-total').textContent = subscribers.length.toLocaleString();
    document.querySelector('#views-total').textContent = Number(views.total || 0).toLocaleString();
    document.querySelector('#views-month').textContent = Number(views.last30Days || 0).toLocaleString();
    document.querySelector('#views-week').textContent = `${Number(views.last7Days || 0).toLocaleString()} in the last 7 days`;
    document.querySelector('#country-total').textContent = (views.countries || []).filter((row) => !['Unknown', 'Development'].includes(row.country)).length.toLocaleString();
    drawChart(views.daily || []);
    drawTable('#page-table', (views.pages || []).map((row) => [pageName(row.page), row.count]), 'No page views recorded yet.');
    drawTable('#country-table', (views.countries || []).map((row) => [row.country, row.count]), 'Country data is still being collected.');
    renderSubscribers();
  }

  function pageName(path) {
    return ({ '/': 'Overview', '/features': 'Features', '/about': 'About', '/privacy': 'Privacy notice' })[path] || path;
  }

  function drawTable(selector, rows, emptyText) {
    const holder = document.querySelector(selector);
    holder.innerHTML = rows.length ? rows.map(([name, count]) => `<div class="data-row"><span>${esc(name)}</span><b>${Number(count).toLocaleString()}</b></div>`).join('') : `<div class="empty-state">${esc(emptyText)}</div>`;
  }

  function drawChart(points) {
    const svg = document.querySelector('#views-chart');
    const NS = 'http://www.w3.org/2000/svg';
    svg.replaceChildren();
    const values = points.map((item) => Number(item.views || 0));
    const max = Math.max(1, ...values); const left = 14; const right = 710; const top = 14; const bottom = 180;
    for (let i = 0; i < 5; i++) {
      const line = document.createElementNS(NS, 'line'); line.setAttribute('x1', left); line.setAttribute('x2', right); line.setAttribute('y1', top + (bottom - top) * i / 4); line.setAttribute('y2', top + (bottom - top) * i / 4); line.setAttribute('class', 'grid-line'); svg.append(line);
    }
    if (!values.length) return;
    const coords = values.map((value, index) => {
      const x = left + (values.length === 1 ? 0 : (right - left) * index / (values.length - 1));
      const y = bottom - (bottom - top) * value / max;
      return [x, y];
    });
    const defs = document.createElementNS(NS, 'defs'); defs.innerHTML = '<linearGradient id="viewsFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2b7fff" stop-opacity=".27"/><stop offset="1" stop-color="#2b7fff" stop-opacity="0"/></linearGradient>'; svg.append(defs);
    const area = document.createElementNS(NS, 'path'); area.setAttribute('class', 'area'); area.setAttribute('d', `M${coords[0][0]},${bottom} ${coords.map((point) => `L${point[0]},${point[1]}`).join(' ')} L${coords.at(-1)[0]},${bottom} Z`); svg.append(area);
    const line = document.createElementNS(NS, 'polyline'); line.setAttribute('class', 'line'); line.setAttribute('points', coords.map((point) => point.join(',')).join(' ')); svg.append(line);
    for (const point of coords.filter((_, index) => index % 5 === 0 || index === coords.length - 1)) { const circle = document.createElementNS(NS, 'circle'); circle.setAttribute('cx', point[0]); circle.setAttribute('cy', point[1]); circle.setAttribute('r', '3.5'); svg.append(circle); }
  }

  function renderSubscribers() {
    const query = document.querySelector('#subscriber-search').value.trim().toLowerCase();
    const matching = subscribers.filter((item) => String(item.email).toLowerCase().includes(query));
    const holder = document.querySelector('#subscriber-table');
    holder.innerHTML = matching.length ? matching.map((item) => `<div class="data-row"><span>${esc(item.email)}</span><b>${esc(formatDate(item.subscribedAt))}</b></div>`).join('') : `<div class="empty-state">${query ? 'No email matches that search.' : 'No subscribers yet. New signups will appear here.'}</div>`;
  }

  const loginForm = document.querySelector('#login-form');
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault(); message.textContent = 'Signing in…'; message.classList.remove('error');
    const password = loginForm.elements.password.value;
    try {
      const response = await fetch('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Sign-in failed.');
      loginForm.reset(); await loadData();
    } catch (error) { message.textContent = error.message; message.classList.add('error'); }
  });
  document.querySelector('#refresh').addEventListener('click', loadData);
  document.querySelector('#subscriber-search').addEventListener('input', renderSubscribers);
  document.querySelector('#export-csv').addEventListener('click', () => {
    const lines = [['Email', 'Subscribed at'], ...subscribers.map((item) => [item.email, item.subscribedAt])];
    const csv = lines.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `scanr-subscribers-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
  });
  signOut.addEventListener('click', async () => { await fetch('/api/admin/logout', { method: 'POST' }); dashboard.hidden = true; signOut.hidden = true; loginView.hidden = false; });
  loadData();
})();
