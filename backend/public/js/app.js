// SignalSense AI — Main App JS

requireLogin();
const user = getUser();
let snapshot = null;
let allAlerts = [];
let allDecisions = [];
let charts = {};
let currentView = 'overview';

// ── BOOT ────────────────────────────────────────────────────────────────────
function boot() {
  document.getElementById('app').style.display = 'flex';
  document.getElementById('u-name').textContent = user?.name || '—';
  document.getElementById('u-role').textContent = user?.role || '—';
  document.getElementById('u-avatar').textContent = (user?.name || 'U').slice(0, 2).toUpperCase();

  // Show admin / superadmin nav sections
  if (['cityadmin', 'superadmin'].includes(user?.role)) document.getElementById('admin-nav').style.display = 'block';
  if (user?.role === 'superadmin') document.getElementById('superadmin-nav').style.display = 'block';

  startClock('clock');
  connectWS(handleSnapshot, handleAlert);

  // Default date ranges for reports
  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  ['pdf-from', 'csv-from'].forEach(id => { const el = document.getElementById(id); if (el) el.value = weekAgo; });
  ['pdf-to', 'csv-to'].forEach(id => { const el = document.getElementById(id); if (el) el.value = today; });
}

// ── WEBSOCKET HANDLERS ───────────────────────────────────────────────────────
function handleSnapshot(data) {
  snapshot = data;
  // Update KPIs
  document.getElementById('kpi-vehicles').textContent = data.stats.totalVehicles.toLocaleString('en-IN');
  document.getElementById('kpi-vio').textContent = data.stats.totalViolations;
  document.getElementById('kpi-cycles').textContent = data.stats.signalCycles.toLocaleString('en-IN');
  document.getElementById('kpi-junctions').textContent = `${data.stats.activeJunctions} / ${data.stats.activeJunctions}`;
  document.getElementById('last-tick').textContent = `Updated ${new Date().toLocaleTimeString('en-IN')}`;

  const newAlerts = data.alerts.filter(a => !allAlerts.find(x => x.id === a.id));
  newAlerts.forEach(a => allAlerts.unshift(a));
  allAlerts = allAlerts.slice(0, 150);
  document.getElementById('vio-count').textContent = data.alerts.filter(a => a.status === 'new').length;
  document.getElementById('alert-badge').textContent = data.alerts.filter(a => a.status === 'new').length;

  if (currentView === 'overview') {
    renderJunctionList(data.intersections);
    renderAlertFeed(data.alerts.slice(0, 15));
    trackDecisions(data.intersections);
  }
  if (currentView === 'signals') renderSignals(data.intersections);
  if (currentView === 'violations') renderVioTable();
  if (currentView === 'analytics') updateCharts(data);
}

function handleAlert(alert) {
  if (!allAlerts.find(a => a.id === alert.id)) {
    allAlerts.unshift(alert);
    alertToast(alert);
  }
}

// ── VIEWS ────────────────────────────────────────────────────────────────────
function gotoView(name) {
  currentView = name;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.sidebar-item').forEach(b => b.classList.remove('active'));
  const viewEl = document.getElementById(`view-${name}`);
  const navEl = document.getElementById(`nav-${name}`);
  if (viewEl) viewEl.classList.add('active');
  if (navEl) navEl.classList.add('active');

  if (name === 'junctions') loadJunctions();
  if (name === 'cameras') loadCameras();
  if (name === 'users') loadUsers();
  if (name === 'cities') loadCities();
  if (name === 'licenses') loadLicenses();
  if (name === 'analytics') initCharts();
  if (name === 'violations') renderVioTable();
}

// ── OVERVIEW ─────────────────────────────────────────────────────────────────
const statusColor = { normal: 'var(--green)', warning: 'var(--amber)', critical: 'var(--red)' };
const OPP = { North: 'South', South: 'North', East: 'West', West: 'East' };

function renderJunctionList(intersections) {
  const el = document.getElementById('junction-list');
  el.innerHTML = intersections.map(int => {
    const greenArms = [int.currentGreen, OPP[int.currentGreen]].filter(Boolean);
    const arms = ['North','South','East','West'].map(arm => {
      const v = int.arms?.[arm]?.vehicles ?? 0;
      const pct = Math.min(100, Math.round((v / 35) * 100));
      const c = v >= 25 ? 'var(--red)' : v >= 15 ? 'var(--amber)' : 'var(--green)';
      return `<td style="padding:8px 14px;border-bottom:1px solid var(--border)">
        <div style="font-size:10px;color:var(--text3);margin-bottom:3px">${arm[0]}${greenArms.includes(arm) ? '🟢' : ''}</div>
        <div style="height:3px;background:var(--bg3);border-radius:2px;margin-bottom:3px"><div style="height:100%;width:${pct}%;background:${c};border-radius:2px;transition:width 0.5s"></div></div>
        <div style="font-size:11px;font-weight:600;font-family:var(--mono);color:${c}">${v}</div>
      </td>`;
    }).join('');

    return `<table style="width:100%;border-collapse:collapse">
      <tr>
        <td style="padding:10px 14px;border-bottom:1px solid var(--border);min-width:200px">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="width:8px;height:8px;border-radius:50%;background:${statusColor[int.status] || 'var(--green)'};display:inline-block;flex-shrink:0"></span>
            <div>
              <div style="font-size:12px;font-weight:600">${int.name}</div>
              <div style="font-size:10px;color:var(--text3)">${int.code || ''}</div>
            </div>
          </div>
          ${int.aiDecision ? `<div style="margin-top:6px;font-size:10px;color:var(--blue);background:var(--blue-dim);padding:4px 8px;border-radius:4px">${int.aiDecision.substring(0, 70)}…</div>` : ''}
        </td>
        ${arms}
      </tr>
    </table>`;
  }).join('');
}

function renderAlertFeed(alerts) {
  const icons = { red_jump:'🚦', no_helmet:'⛑️', speeding:'⚡', wrong_lane:'🛣️', no_seatbelt:'🪑', illegal_park:'🅿️', triple_ride:'🏍️' };
  const el = document.getElementById('alert-feed');
  if (!alerts.length) { el.innerHTML = '<div class="empty-state" style="padding:16px;font-size:12px">No alerts — all clear ✅</div>'; return; }
  el.innerHTML = alerts.map(a => `
    <div style="display:flex;gap:8px;padding:9px 14px;border-bottom:1px solid var(--border)">
      <div style="width:28px;height:28px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;background:var(--${a.severity === 'high' ? 'red' : a.severity === 'medium' ? 'amber' : 'blue'}-dim)">${icons[a.type] || '⚠️'}</div>
      <div>
        <div style="font-size:12px;font-weight:600">${a.label}</div>
        <div style="font-size:11px;color:var(--text3)">${a.junctionName || a.intersectionName || ''} · ${a.arm || ''} · ${timeAgo(a.timestamp || a.created_at)}</div>
        <div style="font-size:10px;color:var(--blue);font-family:var(--mono);margin-top:2px">${a.plate || a.plate_number || ''}</div>
      </div>
    </div>
  `).join('');
}

function trackDecisions(intersections) {
  intersections.forEach(int => {
    if (int.aiDecision && !allDecisions.find(d => d.text === int.aiDecision && d.int === int.name)) {
      allDecisions.unshift({ int: int.name, text: int.aiDecision, conf: int.aiConfidence, ms: int.processingMs, time: new Date().toISOString() });
      allDecisions = allDecisions.slice(0, 30);
    }
  });
  const el = document.getElementById('decision-feed');
  el.innerHTML = allDecisions.slice(0, 8).map(d => `
    <div style="padding:7px 14px;border-bottom:1px solid var(--border);font-size:11px">
      <div style="color:var(--text3);margin-bottom:2px">${d.int}</div>
      <div style="color:var(--blue)">${d.text}</div>
      <div style="color:var(--text3);margin-top:2px;font-family:var(--mono);font-size:10px">Conf: ${((d.conf||0)*100).toFixed(1)}% · ${d.ms||0}ms · ${timeAgo(d.time)}</div>
    </div>
  `).join('') || '<div class="empty-state" style="padding:16px;font-size:12px">Awaiting decisions…</div>';
}

// ── SIGNAL CONTROL ───────────────────────────────────────────────────────────
function renderSignals(intersections) {
  const grid = document.getElementById('sig-grid');
  grid.innerHTML = intersections.map(int => buildSigCard(int)).join('');
}

function buildSigCard(int) {
  const greenArms = [int.currentGreen, OPP[int.currentGreen]].filter(Boolean);
  const pct = int.phaseMax > 0 ? Math.round((int.phaseTimer / int.phaseMax) * 100) : 0;
  const armPos = {
    North: 'top:10px;left:calc(50% - 26px)',
    South: 'bottom:10px;right:calc(50% - 26px)',
    East: 'top:calc(50% - 26px);right:10px',
    West: 'bottom:calc(50% - 26px);left:10px',
  };
  const countPos = {
    North: 'top:36px;left:50%;transform:translateX(-50%)',
    South: 'bottom:36px;left:50%;transform:translateX(-50%)',
    East: 'right:36px;top:50%;transform:translateY(-50%)',
    West: 'left:36px;top:50%;transform:translateY(-50%)',
  };

  const sigHtml = ['North','South','East','West'].map(arm => {
    const isG = greenArms.includes(arm);
    const v = int.arms?.[arm]?.vehicles ?? 0;
    return `
      <div class="sig-light-box" style="${armPos[arm]}">
        <div class="sig-l ${isG ? '' : 'on-r'}"></div>
        <div class="sig-l"></div>
        <div class="sig-l ${isG ? 'on-g' : ''}"></div>
      </div>
      <div class="sig-arm-count" style="${countPos[arm]}">${v}</div>
      <div class="sig-arm-label" style="${arm === 'North' ? 'top:3px;left:50%;transform:translateX(-50%)' : arm === 'South' ? 'bottom:3px;left:50%;transform:translateX(-50%)' : arm === 'East' ? 'right:3px;top:50%;transform:translateY(-50%)' : 'left:3px;top:50%;transform:translateY(-50%)'}">${arm[0]}</div>
    `;
  }).join('');

  const totalV = ['North','South','East','West'].reduce((s, a) => s + (int.arms?.[a]?.vehicles ?? 0), 0);
  const badgeClass = int.status === 'critical' ? 'badge-red' : int.status === 'warning' ? 'badge-amber' : 'badge-green';

  return `<div class="sig-card">
    <div class="sig-card-hdr"><span style="font-size:12px;font-weight:600">${int.name}</span><span class="badge ${badgeClass}">${int.status}</span></div>
    <div class="sig-intersection"><div class="road-h"></div><div class="road-v"></div><div class="road-center"></div>${sigHtml}</div>
    <div class="sig-card-body">
      <div class="phase-row"><span class="phase-lbl">Green: ${greenArms.join(' / ')}</span><span class="phase-cd">${int.phaseTimer ?? '--'}s</span></div>
      <div class="phase-bar"><div class="phase-fill" style="width:${pct}%;background:${pct < 25 ? 'var(--red)' : 'var(--green)'}"></div></div>
      ${int.aiDecision ? `<div class="ai-box">${int.aiDecision}</div>` : ''}
      <div class="sig-stats">
        <div class="sig-stat"><div class="sig-stat-val">${totalV}</div><div class="sig-stat-lbl">Vehicles</div></div>
        <div class="sig-stat"><div class="sig-stat-val">${int.avgWaitTime ?? '--'}m</div><div class="sig-stat-lbl">Avg wait</div></div>
        <div class="sig-stat"><div class="sig-stat-val">${int.aiConfidence ? (int.aiConfidence * 100).toFixed(0) + '%' : '--'}</div><div class="sig-stat-lbl">AI conf</div></div>
      </div>
    </div>
  </div>`;
}

// ── VIOLATIONS ───────────────────────────────────────────────────────────────
function renderVioTable() {
  const typeF = document.getElementById('vio-type-filter')?.value || '';
  const sevF = document.getElementById('vio-sev-filter')?.value || '';
  let data = allAlerts;
  if (typeF) data = data.filter(a => a.type === typeF);
  if (sevF) data = data.filter(a => a.severity === sevF);

  const tbody = document.getElementById('vio-tbody');
  if (!tbody) return;
  tbody.innerHTML = data.slice(0, 80).map(a => `<tr>
    <td class="mono" style="font-size:11px">${fmtDateTime(a.timestamp || a.created_at)}</td>
    <td style="font-size:12px">${a.junctionName || a.junction_name || '—'}</td>
    <td>${a.label}</td>
    <td><span class="badge ${a.severity === 'high' ? 'badge-red' : a.severity === 'medium' ? 'badge-amber' : 'badge-blue'}">${a.severity}</span></td>
    <td class="mono blue">${a.plate || a.plate_number || '—'}</td>
    <td style="font-size:11px;color:var(--text3)">${a.cameraId || a.camera_id || '—'}</td>
    <td><span class="badge ${a.status === 'new' ? 'badge-red' : 'badge-gray'}">${a.status}</span></td>
    <td>${a.status === 'new' ? `<button class="btn btn-ghost" style="padding:3px 10px;font-size:11px" onclick="ackAlert('${a.id}')">Acknowledge</button>` : ''}</td>
  </tr>`).join('') || '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text3)">No violations logged yet</td></tr>';
}

function filterVio() { renderVioTable(); }

async function ackAlert(id) {
  try {
    await api(`/alerts/${id}/acknowledge`, { method: 'POST' });
    const a = allAlerts.find(x => x.id === id);
    if (a) a.status = 'acknowledged';
    renderVioTable();
    showToast('Alert acknowledged', '', 'info', '✅');
  } catch (err) { showToast('Error', err.message, 'high', '❌'); }
}

// ── ANALYTICS CHARTS ─────────────────────────────────────────────────────────
function initCharts() {
  if (charts.flow) return;
  const grid = 'rgba(255,255,255,0.06)', tick = '#6E7681';
  const scaleDefaults = { grid: { color: grid }, ticks: { color: tick, font: { size: 10 } } };
  const opts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: scaleDefaults, y: scaleDefaults } };

  charts.flow = new Chart(document.getElementById('ch-flow'), {
    type: 'line',
    data: { labels: ['N','S','E','W'], datasets: [{ data: [12,8,15,5], borderColor: '#388BFD', backgroundColor: 'rgba(56,139,253,0.1)', tension: 0.4, fill: true }] },
    options: { ...opts },
  });
  charts.vio = new Chart(document.getElementById('ch-vio'), {
    type: 'bar',
    data: { labels: ['Red jump','No helmet','Speeding','Wrong lane','No belt','Parking'], datasets: [{ data: [0,0,0,0,0,0], backgroundColor: ['#F85149','#D29922','#F85149','#D29922','#388BFD','#D29922'], borderRadius: 4 }] },
    options: { ...opts },
  });
  charts.cmp = new Chart(document.getElementById('ch-cmp'), {
    type: 'bar',
    data: { labels: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], datasets: [{ label: 'Manual', data: [5.2,4.8,5.5,5.1,4.9,6.1,3.8], backgroundColor: 'rgba(248,81,73,0.6)', borderRadius: 3 }, { label: 'AI', data: [3.1,2.9,3.4,3.0,2.8,3.7,2.5], backgroundColor: 'rgba(63,185,80,0.7)', borderRadius: 3 }] },
    options: { ...opts, plugins: { legend: { display: true, labels: { color: tick, font: { size: 11 } } } } },
  });
  charts.hr = new Chart(document.getElementById('ch-hr'), {
    type: 'bar',
    data: { labels: ['6am','8am','10am','12pm','2pm','4pm','6pm','8pm'], datasets: [{ data: [450,820,1100,1350,1280,1600,1820,1200], backgroundColor: (ctx) => ctx.raw > 1700 ? 'rgba(248,81,73,0.7)' : ctx.raw > 1300 ? 'rgba(210,153,34,0.7)' : 'rgba(56,139,253,0.7)', borderRadius: 3 }] },
    options: { ...opts },
  });
}

function updateCharts(data) {
  if (!charts.flow) return;
  const int = data.intersections[0];
  if (int) { charts.flow.data.datasets[0].data = ['North','South','East','West'].map(a => int.arms?.[a]?.vehicles ?? 0); charts.flow.update('none'); }
  const vtypes = ['red_jump','no_helmet','speeding','wrong_lane','no_seatbelt','illegal_park'];
  charts.vio.data.datasets[0].data = vtypes.map(t => allAlerts.filter(a => a.type === t).length);
  charts.vio.update('none');
}

// ── REPORTS ──────────────────────────────────────────────────────────────────
function downloadReport(format, type = '') {
  const from = document.getElementById(`${format}-from`)?.value || '';
  const to = document.getElementById(`${format}-to`)?.value || '';
  const token = getToken();
  const url = format === 'pdf'
    ? `/api/reports/pdf?from=${from}&to=${to}&token=${token}`
    : `/api/reports/csv/${type}?from=${from}&to=${to}&token=${token}`;
  // Pass token as header via a hidden form since download links can't set headers easily
  const a = document.createElement('a');
  a.href = url;
  a.download = `SignalSense_${from}_${to}.${format}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ── ADMIN: JUNCTIONS ──────────────────────────────────────────────────────────
async function loadJunctions() {
  try {
    const data = await api('/junctions');
    document.getElementById('junctions-tbody').innerHTML = data.map(j => `<tr>
      <td class="mono">${j.code}</td><td>${j.name}</td><td style="color:var(--text3)">${j.location || '—'}</td>
      <td><span class="badge ${j.camera_mode === 'rtsp' ? 'badge-blue' : 'badge-gray'}">${j.camera_mode}</span></td>
      <td><span class="badge ${j.status === 'active' ? 'badge-green' : 'badge-red'}">${j.status}</span></td>
      <td><span class="badge ${j.ai_enabled ? 'badge-green' : 'badge-gray'}">${j.ai_enabled ? 'AI on' : 'Manual'}</span></td>
      <td></td>
    </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text3)">No junctions yet</td></tr>';
  } catch (e) { showToast('Error', e.message, 'high', '❌'); }
}

async function saveJunction() {
  try {
    await api('/junctions', { method: 'POST', body: { code: document.getElementById('j-code').value, name: document.getElementById('j-name').value, location: document.getElementById('j-location').value, cameraMode: document.getElementById('j-mode').value, latitude: document.getElementById('j-lat').value, longitude: document.getElementById('j-lng').value } });
    closeModal('modal-junction');
    loadJunctions();
    showToast('Junction added', '', 'info', '✅');
  } catch (e) { showToast('Error', e.message, 'high', '❌'); }
}

// ── ADMIN: CAMERAS ────────────────────────────────────────────────────────────
async function loadCameras() {
  try {
    const [cameras, junctions] = await Promise.all([api('/cameras'), api('/junctions')]);
    // Populate junction dropdown in modal
    const sel = document.getElementById('c-junction');
    if (sel) sel.innerHTML = junctions.map(j => `<option value="${j.id}">${j.code} — ${j.name}</option>`).join('');

    document.getElementById('cameras-tbody').innerHTML = cameras.map(c => `<tr>
      <td class="mono">${c.code}</td><td style="font-size:12px">${c.junction_name || '—'}</td><td>${c.arm}</td>
      <td><span class="badge badge-gray">${c.resolution}</span></td>
      <td style="font-size:11px;color:var(--text3);max-width:160px;overflow:hidden;text-overflow:ellipsis">${c.rtsp_url || '—'}</td>
      <td><span class="badge ${c.status === 'online' ? 'badge-green' : 'badge-red'}">${c.status}</span></td>
      <td></td>
    </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text3)">No cameras yet</td></tr>';
  } catch (e) { showToast('Error', e.message, 'high', '❌'); }
}

async function saveCamera() {
  try {
    await api('/cameras', { method: 'POST', body: { junctionId: document.getElementById('c-junction').value, code: document.getElementById('c-code').value, arm: document.getElementById('c-arm').value, label: document.getElementById('c-label').value, rtspUrl: document.getElementById('c-rtsp').value, resolution: document.getElementById('c-res').value, fps: document.getElementById('c-fps').value } });
    closeModal('modal-camera');
    loadCameras();
    showToast('Camera added', '', 'info', '✅');
  } catch (e) { showToast('Error', e.message, 'high', '❌'); }
}

// ── ADMIN: USERS ──────────────────────────────────────────────────────────────
async function loadUsers() {
  try {
    const data = await api('/users');
    document.getElementById('users-tbody').innerHTML = data.map(u => `<tr>
      <td>${u.name}</td><td style="font-family:var(--mono);font-size:12px">${u.email}</td>
      <td><span class="badge ${u.role === 'superadmin' ? 'badge-red' : u.role === 'cityadmin' ? 'badge-amber' : 'badge-blue'}">${u.role}</span></td>
      <td><span class="badge ${u.status === 'active' ? 'badge-green' : 'badge-red'}">${u.status}</span></td>
      <td style="font-size:11px;color:var(--text3)">${u.last_login ? fmtDateTime(u.last_login) : 'Never'}</td>
      <td></td>
    </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text3)">No users yet</td></tr>';
  } catch (e) { showToast('Error', e.message, 'high', '❌'); }
}

async function saveUser() {
  try {
    await api('/users', { method: 'POST', body: { name: document.getElementById('u-name-f').value, email: document.getElementById('u-email-f').value, password: document.getElementById('u-pass-f').value, role: document.getElementById('u-role-f').value } });
    closeModal('modal-user');
    loadUsers();
    showToast('User added', '', 'info', '✅');
  } catch (e) { showToast('Error', e.message, 'high', '❌'); }
}

// ── SUPERADMIN: CITIES ────────────────────────────────────────────────────────
async function loadCities() {
  try {
    const data = await api('/cities');
    document.getElementById('cities-tbody').innerHTML = data.map(c => `<tr>
      <td style="font-weight:600">${c.name}</td><td>${c.state || '—'}</td>
      <td><span class="badge badge-blue">${c.plan}</span></td>
      <td><span class="badge ${c.status === 'active' ? 'badge-green' : 'badge-red'}">${c.status}</span></td>
      <td>${c.junction_count}</td><td>${c.user_count}</td>
      <td></td>
    </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text3)">No cities yet</td></tr>';
  } catch (e) { showToast('Error', e.message, 'high', '❌'); }
}

async function saveCity() {
  try {
    await api('/cities', { method: 'POST', body: { name: document.getElementById('city-name-f').value, state: document.getElementById('city-state-f').value, country: document.getElementById('city-country-f').value, plan: document.getElementById('city-plan-f').value } });
    closeModal('modal-city');
    loadCities();
    showToast('City added', '', 'info', '✅');
  } catch (e) { showToast('Error', e.message, 'high', '❌'); }
}

// ── SUPERADMIN: LICENSE KEYS ──────────────────────────────────────────────────
async function loadLicenses() {
  try {
    const [licenses, cities] = await Promise.all([api('/licenses'), api('/cities')]);
    const licSel = document.getElementById('lic-city');
    if (licSel) licSel.innerHTML = cities.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

    document.getElementById('licenses-tbody').innerHTML = licenses.map(l => `<tr>
      <td class="mono blue" style="font-size:12px;letter-spacing:0.04em">${l.license_key}</td>
      <td>${l.city_name}</td>
      <td><span class="badge badge-blue">${l.plan}</span></td>
      <td><span class="badge ${l.status === 'active' ? 'badge-green' : l.status === 'revoked' ? 'badge-red' : 'badge-amber'}">${l.status}</span></td>
      <td style="font-size:11px;color:var(--text3)">${l.expires_at ? fmtDate(l.expires_at) : 'Never'}</td>
      <td>${l.max_junctions}</td>
      <td>${l.status !== 'revoked' ? `<button class="btn btn-danger" style="padding:3px 10px;font-size:11px" onclick="revokeLicense(${l.id})">Revoke</button>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text3)">No license keys yet</td></tr>';
  } catch (e) { showToast('Error', e.message, 'high', '❌'); }
}

async function generateLicense() {
  try {
    const data = await api('/licenses', { method: 'POST', body: { cityId: document.getElementById('lic-city').value, plan: document.getElementById('lic-plan').value, validityDays: document.getElementById('lic-days').value, notes: document.getElementById('lic-notes').value } });
    closeModal('modal-license');
    document.getElementById('new-key-text').textContent = data.license_key;
    document.getElementById('new-key-display').style.display = 'block';
    loadLicenses();
    showToast('License key generated', data.license_key, 'info', '🔑');
  } catch (e) { showToast('Error', e.message, 'high', '❌'); }
}

async function revokeLicense(id) {
  if (!confirm('Revoke this license key? This cannot be undone.')) return;
  try { await api(`/licenses/${id}/revoke`, { method: 'PUT' }); loadLicenses(); showToast('License revoked', '', 'info', '🔒'); }
  catch (e) { showToast('Error', e.message, 'high', '❌'); }
}

// ── INIT ──────────────────────────────────────────────────────────────────────
boot();
