// SignalSense AI v2 — Shared frontend utilities

const API = '/api';

function getToken() { return localStorage.getItem('ss_token'); }
function getUser() { try { return JSON.parse(localStorage.getItem('ss_user')); } catch { return null; } }
function logout() { localStorage.clear(); window.location.href = '/index.html'; }
function requireLogin() { if (!getToken()) { window.location.href = '/index.html'; } }
function hasRole(...roles) { const u = getUser(); return u && roles.includes(u.role); }

async function api(path, { method = 'GET', body = null } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { logout(); return; }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// Toast
function showToast(title, sub = '', type = 'info', icon = 'ℹ️') {
  let wrap = document.getElementById('toast-wrap');
  if (!wrap) { wrap = document.createElement('div'); wrap.id = 'toast-wrap'; wrap.className = 'toast-wrap'; document.body.appendChild(wrap); }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<div class="toast-icon">${icon}</div><div><div class="toast-title">${title}</div>${sub ? `<div class="toast-sub">${sub}</div>` : ''}</div>`;
  wrap.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(20px)'; t.style.transition = 'all 0.3s'; setTimeout(() => t.remove(), 300); }, 4500);
}

function alertToast(alert) {
  const icons = { red_jump:'🚦', no_helmet:'⛑️', speeding:'⚡', wrong_lane:'🛣️', no_seatbelt:'🪑', illegal_park:'🅿️', triple_ride:'🏍️' };
  showToast(alert.label, `${alert.junctionName} · ${alert.arm} · ${alert.plate}`, alert.severity, icons[alert.type] || '⚠️');
}

// Clock
function startClock(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  const u = () => el.textContent = new Date().toLocaleTimeString('en-IN', { hour12: false });
  u(); setInterval(u, 1000);
}

// WebSocket — auto-detects wss:// for HTTPS (Railway) or ws:// for local
function connectWS(onSnapshot, onAlert) {
  const token = getToken();
  // Use wss:// when page is served over HTTPS (production), ws:// for local dev
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/ws?token=${encodeURIComponent(token || '')}`);

  const connEl = document.getElementById('conn-pill');
  const setConn = (ok) => {
    if (connEl) {
      connEl.className = 'conn-pill' + (ok ? ' online' : '');
      connEl.querySelector('span').textContent = ok ? 'Live' : 'Reconnecting…';
    }
  };

  ws.onopen = () => {
    setConn(true);
    // Keepalive ping every 25 seconds
    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
      else clearInterval(ping);
    }, 25000);
  };

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'snapshot' && onSnapshot) onSnapshot(msg.payload);
      if (msg.type === 'alert' && onAlert) onAlert(msg.payload);
    } catch {}
  };

  ws.onclose = () => { setConn(false); setTimeout(() => connectWS(onSnapshot, onAlert), 3000); };
  ws.onerror = () => ws.close();
  return ws;
}

// Modal helpers
function openModal(id) { const el = document.getElementById(id); if (el) el.classList.add('open'); }
function closeModal(id) { const el = document.getElementById(id); if (el) el.classList.remove('open'); }

// Format helpers
function timeAgo(iso) {
  const d = Date.now() - new Date(iso).getTime();
  if (d < 60000) return `${Math.floor(d / 1000)}s ago`;
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
  return `${Math.floor(d / 3600000)}h ago`;
}
function fmtDate(iso) { return new Date(iso).toLocaleDateString('en-IN'); }
function fmtDateTime(iso) { return new Date(iso).toLocaleString('en-IN'); }
function secToMin(s) { return s >= 60 ? `${(s/60).toFixed(1)}m` : `${s}s`; }
