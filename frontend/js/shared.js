// SignalSense AI — Shared frontend utilities

const API = '/api';

function getToken() { return localStorage.getItem('ss_token'); }
function getUser() { try { return JSON.parse(localStorage.getItem('ss_user')); } catch { return null; } }
function logout() { localStorage.clear(); window.location.href = '/index.html'; }
function requireLogin() { if (!getToken()) window.location.href = '/index.html'; }
function hasRole(...roles) { const u = getUser(); return u && roles.includes(u.role); }

async function api(path, { method = 'GET', body = null } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { logout(); return; }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// Toast notifications
function showToast(title, sub = '', type = 'info', icon = 'ℹ️') {
  let wrap = document.getElementById('toast-wrap');
  if (!wrap) { wrap = document.createElement('div'); wrap.id = 'toast-wrap'; wrap.className = 'toast-wrap'; document.body.appendChild(wrap); }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<div class="toast-icon">${icon}</div><div><div class="toast-title">${title}</div>${sub ? `<div class="toast-sub">${sub}</div>` : ''}</div>`;
  wrap.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(20px)'; t.style.transition = 'all 0.3s'; setTimeout(() => t.remove(), 300); }, 4000);
}

function alertToast(alert) {
  const icons = { red_jump: '🚦', no_helmet: '⛑️', speeding: '⚡', wrong_lane: '🛣️', no_seatbelt: '🪑', illegal_park: '🅿️', triple_ride: '🏍️' };
  showToast(alert.label, `${alert.junctionName} · ${alert.arm} · ${alert.plate}`, alert.severity, icons[alert.type] || '⚠️');
}

// Clock
function startClock(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  const update = () => el.textContent = new Date().toLocaleTimeString('en-IN', { hour12: false });
  update(); setInterval(update, 1000);
}

// WebSocket
function connectWS(onSnapshot, onAlert) {
  const token = getToken();
  const ws = new WebSocket(`ws://${location.host}/ws?token=${encodeURIComponent(token)}`);
  const connEl = document.getElementById('conn-pill');
  const setConn = ok => { if (connEl) { connEl.className = 'conn-pill' + (ok ? ' online' : ''); connEl.querySelector('span').textContent = ok ? 'Connected' : 'Reconnecting…'; } };

  ws.onopen = () => { setConn(true); setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'ping' })), 30000); };
  ws.onmessage = (e) => { try { const msg = JSON.parse(e.data); if (msg.type === 'snapshot' && onSnapshot) onSnapshot(msg.payload); if (msg.type === 'alert' && onAlert) onAlert(msg.payload); } catch {} };
  ws.onclose = () => { setConn(false); setTimeout(() => connectWS(onSnapshot, onAlert), 3000); };
  return ws;
}

// Modal helpers
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// Format helpers
function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}
function fmtDate(iso) { return new Date(iso).toLocaleDateString('en-IN'); }
function fmtDateTime(iso) { return new Date(iso).toLocaleString('en-IN'); }
function pluralise(n, word) { return `${n.toLocaleString('en-IN')} ${word}${n !== 1 ? 's' : ''}`; }
