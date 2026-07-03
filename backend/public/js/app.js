// SignalSense AI v2 — Main App JS
requireLogin();
const user = getUser();
let snap = null, allAlerts = [], allDecisions = [], charts = {}, currentView = 'overview';
let allZones = [], allAreas = [], allJunctions = [];
const OPP = { North:'South', South:'North', East:'West', West:'East' };
const ICONS = { red_jump:'🚦', no_helmet:'⛑️', speeding:'⚡', wrong_lane:'🛣️', no_seatbelt:'🪑', illegal_park:'🅿️', triple_ride:'🏍️' };

// ── BOOT ──────────────────────────────────────────────────────────────────
function boot() {
  document.getElementById('app').style.display = 'flex';
  document.getElementById('u-av').textContent = (user?.name || 'U').slice(0,2).toUpperCase();
  document.getElementById('u-nm').textContent = user?.name || '—';
  document.getElementById('u-rl').textContent = user?.role || '—';
  document.getElementById('city-tag').textContent = user?.cityName || '—';
  if (['cityadmin','zoneadmin','superadmin'].includes(user?.role)) document.getElementById('admin-nav').style.display = 'block';
  if (user?.role === 'superadmin') document.getElementById('superadmin-nav').style.display = 'block';
  startClock('clock');
  connectWS(handleSnap, handleAlert);
  // Set default report dates
  const today = new Date().toISOString().split('T')[0];
  const week = new Date(Date.now()-7*86400000).toISOString().split('T')[0];
  ['vio-from','sig-from'].forEach(id => { const el=document.getElementById(id); if(el) el.value=week; });
  ['vio-to','sig-to'].forEach(id => { const el=document.getElementById(id); if(el) el.value=today; });
  // Preload zones for filters
  loadZonesForFilters();
}

// ── WS HANDLERS ───────────────────────────────────────────────────────────
function handleSnap(data) {
  snap = data;
  // KPIs
  document.getElementById('kpi-v').textContent = data.stats.totalVehicles.toLocaleString('en-IN');
  document.getElementById('kpi-ts').textContent = secToMin(data.stats.totalTimeSaved || 0);
  document.getElementById('kpi-er').textContent = data.stats.emptyRoadCycles || 0;
  document.getElementById('kpi-vio').textContent = data.stats.totalViolations;
  document.getElementById('kpi-cy').textContent = data.stats.signalCycles.toLocaleString('en-IN');
  document.getElementById('kpi-j').textContent = `${data.stats.activeJunctions}/${data.stats.activeJunctions}`;
  document.getElementById('vio-badge').textContent = data.alerts.filter(a=>a.status==='new').length;
  document.getElementById('alert-badge').textContent = data.alerts.filter(a=>a.status==='new').length;
  document.getElementById('last-tick').textContent = `Updated ${new Date().toLocaleTimeString('en-IN')}`;
  // Merge alerts
  data.alerts.forEach(a => { if(!allAlerts.find(x=>x.id===a.id)) allAlerts.unshift(a); });
  allAlerts = allAlerts.slice(0,200);
  // Render current view
  if (currentView==='overview') { renderZoneCards(data); renderJunctionList(data.intersections); renderAlertFeed(data.alerts); trackDecisions(data.intersections); }
  if (currentView==='signals') renderSignals(data.intersections);
  if (currentView==='map') updateMap(data.intersections);
  if (currentView==='violations') renderVioTable();
  if (currentView==='analytics') updateCharts(data);
}

function handleAlert(alert) {
  if (!allAlerts.find(a=>a.id===alert.id)) { allAlerts.unshift(alert); alertToast(alert); }
  if (currentView==='violations') renderVioTable();
}

// ── VIEWS ─────────────────────────────────────────────────────────────────
function gotoView(name) {
  currentView = name;
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.sidebar-item').forEach(b=>b.classList.remove('active'));
  const v = document.getElementById(`view-${name}`);
  const n = document.getElementById(`nav-${name}`);
  if (v) v.classList.add('active');
  if (n) n.classList.add('active');
  const loaders = { zones:loadZones, areas:loadAreas, junctions:loadJunctions, cameras:loadCameras, timing:loadTiming, users:loadUsers, cities:loadCities, licenses:loadLicenses, violations:renderVioTable, analytics:initCharts, map:initMap };
  if (loaders[name]) loaders[name]();
}

// ── ZONE CARDS ────────────────────────────────────────────────────────────
function renderZoneCards(data) {
  const grid = document.getElementById('zone-grid');
  if (!allZones.length || !data.intersections.length) return;
  grid.innerHTML = allZones.map(zone => {
    const junctions = data.intersections.filter(j => j.zoneId === zone.id);
    const critical = junctions.filter(j=>j.status==='critical').length;
    const warning = junctions.filter(j=>j.status==='warning').length;
    const totalV = junctions.reduce((s,j)=>s+Object.values(j.arms||{}).reduce((a,b)=>a+(b.vehicles||0),0),0);
    const emptyCount = junctions.filter(j=>j.emptyRoad).length;
    const statusClass = critical>0?'badge-red':warning>0?'badge-amber':'badge-green';
    const statusText = critical>0?'Alert':warning>0?'Warning':'Normal';
    return `<div class="zone-card" onclick="filterByZone(${zone.id})">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div class="zone-name">${zone.name}</div>
        <span class="badge ${statusClass}">${statusText}</span>
      </div>
      <div class="zone-stats">
        <div class="zone-stat"><div class="zone-stat-val">${junctions.length}</div><div class="zone-stat-lbl">Junctions</div></div>
        <div class="zone-stat"><div class="zone-stat-val">${totalV}</div><div class="zone-stat-lbl">Vehicles now</div></div>
        <div class="zone-stat"><div class="zone-stat-val green">${emptyCount}</div><div class="zone-stat-lbl">Empty roads</div></div>
        <div class="zone-stat"><div class="zone-stat-val red">${critical}</div><div class="zone-stat-lbl">Critical</div></div>
      </div>
    </div>`;
  }).join('') || '<div style="color:var(--text3);font-size:13px">Loading zones…</div>';
}

function filterByZone(zoneId) {
  document.getElementById('sig-zone-filter').value = zoneId;
  gotoView('signals');
}

// ── JUNCTION LIST (overview) ───────────────────────────────────────────────
function renderJunctionList(intersections) {
  const el = document.getElementById('junction-list');
  el.innerHTML = intersections.map(int => {
    const greenArms = [int.currentGreen, OPP[int.currentGreen]].filter(Boolean);
    const armsHtml = ['North','South','East','West'].map(arm => {
      const v = int.arms?.[arm]?.vehicles??0;
      const pct = Math.min(100,Math.round((v/40)*100));
      const c = v>=30?'var(--red)':v>=18?'var(--amber)':'var(--green)';
      return `<td style="padding:7px 12px;border-bottom:1px solid var(--border)">
        <div style="font-size:10px;color:var(--text3);margin-bottom:2px">${arm[0]}${greenArms.includes(arm)?'🟢':''}</div>
        <div style="height:3px;background:var(--bg3);border-radius:2px;margin-bottom:2px"><div style="height:100%;width:${pct}%;background:${c};border-radius:2px;transition:width 0.5s"></div></div>
        <div style="font-size:11px;font-weight:600;font-family:var(--mono);color:${c}">${v}</div>
      </td>`;
    }).join('');
    const timeSaved = int.totalTimeSaved>0?`<span class="time-saved-tag">↓${secToMin(int.totalTimeSaved)} saved</span>`:'';
    const emptyTag = int.emptyRoad?`<span class="empty-road-badge">Empty road</span>`:'';
    return `<table style="width:100%;border-collapse:collapse"><tr>
      <td style="padding:9px 12px;border-bottom:1px solid var(--border);min-width:220px;cursor:pointer" onclick="gotoView('signals')">
        <div style="display:flex;align-items:center;gap:7px">
          <span style="width:7px;height:7px;border-radius:50%;background:${int.status==='critical'?'var(--red)':int.status==='warning'?'var(--amber)':'var(--green)'};display:inline-block;flex-shrink:0"></span>
          <div>
            <div style="font-size:12px;font-weight:600">${int.name}</div>
            <div style="font-size:10px;color:var(--text3)">${int.code} · Min:${int.minPhase}s Max:${int.maxPhase}s</div>
            <div style="margin-top:4px;display:flex;gap:5px">${timeSaved}${emptyTag}</div>
          </div>
        </div>
        ${int.aiDecision?`<div style="margin-top:5px;font-size:10px;color:var(--blue);background:var(--blue-dim);padding:4px 7px;border-radius:4px">${int.aiDecision.substring(0,80)}…</div>`:''}
      </td>
      ${armsHtml}
    </tr></table>`;
  }).join('');
}

// ── ALERTS ────────────────────────────────────────────────────────────────
function renderAlertFeed(alerts) {
  const el = document.getElementById('alert-feed');
  if (!alerts.length) { el.innerHTML='<div class="empty-state" style="padding:14px;font-size:12px">✅ No alerts</div>'; return; }
  el.innerHTML = alerts.slice(0,15).map(a=>`
    <div style="display:flex;gap:8px;padding:8px 13px;border-bottom:1px solid var(--border)">
      <div style="width:26px;height:26px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;background:var(--${a.severity==='high'?'red':a.severity==='medium'?'amber':'blue'}-dim)">${ICONS[a.type]||'⚠️'}</div>
      <div>
        <div style="font-size:12px;font-weight:600">${a.label}</div>
        <div style="font-size:11px;color:var(--text3)">${a.junctionName||''} · ${a.arm||''} · ${timeAgo(a.timestamp||a.created_at)}</div>
        <div style="font-size:10px;color:var(--blue);font-family:var(--mono);margin-top:1px">${a.plate||''}</div>
      </div>
    </div>`).join('');
}

function trackDecisions(intersections) {
  intersections.forEach(int => {
    if (int.aiDecision && !allDecisions.find(d=>d.text===int.aiDecision&&d.int===int.name)) {
      allDecisions.unshift({ int:int.name, text:int.aiDecision, conf:int.aiConfidence, ms:int.processingMs, time:new Date().toISOString(), empty:int.emptyRoad, saved:int.totalTimeSaved });
      allDecisions = allDecisions.slice(0,40);
    }
  });
  const el = document.getElementById('decision-feed');
  el.innerHTML = allDecisions.slice(0,8).map(d=>`
    <div style="padding:7px 13px;border-bottom:1px solid var(--border);font-size:11px">
      <div style="color:var(--text3);margin-bottom:1px">${d.int}${d.empty?' <span class="empty-road-badge">Empty</span>':''}</div>
      <div style="color:var(--blue)">${d.text}</div>
      <div style="color:var(--text3);margin-top:2px;font-family:var(--mono);font-size:10px">Conf:${((d.conf||0)*100).toFixed(1)}% · ${d.ms||0}ms · ${timeAgo(d.time)}</div>
    </div>`).join('') || '<div style="padding:12px;font-size:11px;color:var(--text3)">Awaiting cycles…</div>';
}

// ── SIGNAL CONTROL ────────────────────────────────────────────────────────
function filterSignals() {
  if (!snap) return;
  const zf = document.getElementById('sig-zone-filter')?.value;
  const ints = zf ? snap.intersections.filter(i=>String(i.zoneId)===zf) : snap.intersections;
  renderSignals(ints);
}

function renderSignals(intersections) {
  const grid = document.getElementById('sig-grid');
  grid.innerHTML = intersections.map(int=>buildSigCard(int)).join('');
}

function buildSigCard(int) {
  const greenArms = [int.currentGreen, OPP[int.currentGreen]].filter(Boolean);
  const pct = int.phaseMax>0?Math.round((int.phaseTimer/int.phaseMax)*100):0;
  const bc = int.status==='critical'?'badge-red':int.status==='warning'?'badge-amber':'badge-green';
  const pos = {
    North:'top:9px;left:calc(50% - 24px)', South:'bottom:9px;right:calc(50% - 24px)',
    East:'top:calc(50% - 24px);right:9px', West:'bottom:calc(50% - 24px);left:9px'
  };
  const cp = {
    North:'top:34px;left:50%;transform:translateX(-50%)', South:'bottom:34px;left:50%;transform:translateX(-50%)',
    East:'right:34px;top:50%;transform:translateY(-50%)', West:'left:34px;top:50%;transform:translateY(-50%)'
  };
  const lp = {
    North:'top:2px;left:50%;transform:translateX(-50%)', South:'bottom:2px;left:50%;transform:translateX(-50%)',
    East:'right:2px;top:50%;transform:translateY(-50%)', West:'left:2px;top:50%;transform:translateY(-50%)'
  };
  const sigHtml = ['North','South','East','West'].map(arm=>{
    const isG = greenArms.includes(arm);
    const v = int.arms?.[arm]?.vehicles??0;
    return `<div class="sig-lb" style="${pos[arm]}"><div class="sl ${isG?'':'on-r'}"></div><div class="sl"></div><div class="sl ${isG?'on-g':''}"></div></div>
    <div class="arm-count" style="${cp[arm]}">${v}</div>
    <div class="arm-lbl" style="${lp[arm]}">${arm[0]}</div>`;
  }).join('');
  const totalV = ['North','South','East','West'].reduce((s,a)=>s+(int.arms?.[a]?.vehicles??0),0);
  return `<div class="sig-card">
    <div class="sig-card-hdr"><span style="font-size:12px;font-weight:600">${int.name}</span><span class="badge ${bc}">${int.status}</span></div>
    <div class="sig-intersection">
      <div class="road-h"></div><div class="road-v"></div><div class="road-center"></div>
      ${sigHtml}
      ${int.emptyRoad?'<div class="empty-road-tag">EMPTY ROAD</div>':''}
    </div>
    <div class="sig-body">
      <div class="phase-row">
        <span class="phase-lbl">Green: ${greenArms.join('/')} · Min:${int.minPhase}s Max:${int.maxPhase}s</span>
        <span class="phase-cd">${int.phaseTimer??'--'}s</span>
      </div>
      <div class="phase-bar"><div class="phase-fill" style="width:${pct}%;background:${pct<25?'var(--red)':'var(--green)'}"></div></div>
      ${int.aiDecision?`<div class="ai-box">${int.aiDecision}</div>`:''}
      <div class="sig-stats">
        <div class="ss"><div class="ss-val">${totalV}</div><div class="ss-lbl">Vehicles</div></div>
        <div class="ss"><div class="ss-val">${int.avgWaitTime??'--'}m</div><div class="ss-lbl">Avg wait</div></div>
        <div class="ss"><div class="ss-val ${int.emptyRoad?'purple':''}">${int.emptyRoad?'Yes':'No'}</div><div class="ss-lbl">Empty</div></div>
        <div class="ss"><div class="ss-val green">${secToMin(int.totalTimeSaved||0)}</div><div class="ss-lbl">Saved</div></div>
      </div>
    </div>
  </div>`;
}

// ── MAP VIEW ──────────────────────────────────────────────────────────────
function initMap() { if (snap) updateMap(snap.intersections); }

function updateMap(intersections) {
  const container = document.getElementById('map-container');
  const dotsEl = document.getElementById('map-dots');
  if (!dotsEl || !intersections.length) return;
  const valid = intersections.filter(i=>i.latitude&&i.longitude);
  if (!valid.length) { dotsEl.innerHTML='<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:var(--text3);font-size:13px">No GPS coordinates set for junctions</div>'; return; }
  const lats = valid.map(i=>parseFloat(i.latitude)), lngs = valid.map(i=>parseFloat(i.longitude));
  const minLat=Math.min(...lats), maxLat=Math.max(...lats), minLng=Math.min(...lngs), maxLng=Math.max(...lngs);
  const pad=0.15, w=container.clientWidth||700, h=container.clientHeight||420;
  function toX(lng) { return ((lng-minLng)/(maxLng-minLng||1))*(w*(1-2*pad))+w*pad; }
  function toY(lat) { return (1-((lat-minLat)/(maxLat-minLat||1)))*(h*(1-2*pad))+h*pad; }
  dotsEl.innerHTML = valid.map(int=>{
    const x=toX(parseFloat(int.longitude)), y=toY(parseFloat(int.latitude));
    const totalV = ['North','South','East','West'].reduce((s,a)=>s+(int.arms?.[a]?.vehicles??0),0);
    return `<div class="map-dot ${int.status}" style="left:${x}px;top:${y}px" 
      onmouseenter="showMapTip(event,'${int.name}','${int.status}',${totalV},${int.emptyRoad||false})"
      onmouseleave="hideMapTip()"
      onclick="showMapDetail(${int.id})"></div>`;
  }).join('');
}

function showMapTip(e, name, status, vehicles, empty) {
  const tip = document.getElementById('map-tooltip');
  tip.style.display='block';
  tip.style.left=(e.clientX+12)+'px';
  tip.style.top=(e.clientY-40)+'px';
  tip.innerHTML=`<strong>${name}</strong><br>Status: ${status}<br>Vehicles: ${vehicles}${empty?' · Empty road':''}`; 
}
function hideMapTip() { document.getElementById('map-tooltip').style.display='none'; }
function showMapDetail(id) {
  if (!snap) return;
  const int = snap.intersections.find(i=>i.id===id);
  if (!int) return;
  const el = document.getElementById('map-detail');
  el.innerHTML=`<div class="panel"><div class="panel-hdr"><span class="panel-title">${int.name}</span><span class="badge ${int.status==='critical'?'badge-red':int.status==='warning'?'badge-amber':'badge-green'}">${int.status}</span></div><div class="panel-body">${buildSigCard(int)}</div></div>`;
}

// ── VIOLATIONS ────────────────────────────────────────────────────────────
function filterVio() { renderVioTable(); }

function renderVioTable() {
  const zf = document.getElementById('vf-zone')?.value || '';
  const tf = document.getElementById('vf-type')?.value || '';
  const sf = document.getElementById('vf-sev')?.value || '';
  let data = allAlerts;
  if (zf) data = data.filter(a=>String(a.zoneId)===zf);
  if (tf) data = data.filter(a=>a.type===tf);
  if (sf) data = data.filter(a=>a.severity===sf);
  const tbody = document.getElementById('vio-tbody');
  if (!tbody) return;
  tbody.innerHTML = data.slice(0,100).map(a=>`<tr>
    <td class="mono" style="font-size:11px">${fmtDateTime(a.timestamp||a.created_at)}</td>
    <td style="font-size:11px;color:var(--text3)">${a.zoneId||'—'}</td>
    <td style="font-size:12px">${a.junctionName||'—'}</td>
    <td>${ICONS[a.type]||'⚠️'} ${a.label}</td>
    <td><span class="badge ${a.severity==='high'?'badge-red':a.severity==='medium'?'badge-amber':'badge-blue'}">${a.severity}</span></td>
    <td class="mono blue" style="font-size:12px">${a.plate||'—'}</td>
    <td><span class="badge ${a.status==='new'?'badge-red':'badge-gray'}">${a.status}</span></td>
    <td>${a.status==='new'?`<button class="btn btn-ghost btn-sm" onclick="ackAlert('${a.id}')">Ack</button>`:''}</td>
  </tr>`).join('') || '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--text3)">No violations yet</td></tr>';
}

async function ackAlert(id) {
  try { await api(`/alerts/${id}/acknowledge`,{method:'POST'}); const a=allAlerts.find(x=>x.id===id); if(a) a.status='acknowledged'; renderVioTable(); showToast('Acknowledged','','info','✅'); }
  catch(e) { showToast('Error',e.message,'high','❌'); }
}

// ── ANALYTICS ─────────────────────────────────────────────────────────────
function initCharts() {
  if (charts.flow) return;
  const g='rgba(255,255,255,0.06)', t='#6E7681';
  const s={grid:{color:g},ticks:{color:t,font:{size:10}}};
  const o={responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:s,y:s}};
  charts.flow=new Chart(document.getElementById('ch-flow'),{type:'line',data:{labels:['N','S','E','W'],datasets:[{data:[12,8,15,5],borderColor:'#388BFD',backgroundColor:'rgba(56,139,253,0.1)',tension:0.4,fill:true}]},options:{...o}});
  charts.vio=new Chart(document.getElementById('ch-vio'),{type:'bar',data:{labels:['Red jump','No helmet','Speed','Wrong lane','No belt','Parking'],datasets:[{data:[0,0,0,0,0,0],backgroundColor:['#F85149','#D29922','#F85149','#D29922','#388BFD','#D29922'],borderRadius:4}]},options:{...o}});
  charts.cmp=new Chart(document.getElementById('ch-cmp'),{type:'bar',data:{labels:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],datasets:[{label:'Fixed timer',data:[60,60,60,60,60,60,60],backgroundColor:'rgba(248,81,73,0.5)',borderRadius:3},{label:'AI phase',data:[38,42,35,40,28,55,32],backgroundColor:'rgba(63,185,80,0.7)',borderRadius:3}]},options:{...o,plugins:{legend:{display:true,labels:{color:t,font:{size:11}}}}}});
  charts.empty=new Chart(document.getElementById('ch-empty'),{type:'bar',data:{labels:['6am','8am','10am','12pm','2pm','4pm','6pm','8pm','10pm'],datasets:[{data:[12,3,8,15,20,10,5,8,25],backgroundColor:'rgba(163,113,247,0.7)',borderRadius:3}]},options:{...o}});
}

function updateCharts(data) {
  if (!charts.flow) return;
  const int = data.intersections[0];
  if (int) { charts.flow.data.datasets[0].data=['North','South','East','West'].map(a=>int.arms?.[a]?.vehicles??0); charts.flow.update('none'); }
  const vt=['red_jump','no_helmet','speeding','wrong_lane','no_seatbelt','illegal_park'];
  charts.vio.data.datasets[0].data=vt.map(t=>allAlerts.filter(a=>a.type===t).length);
  charts.vio.update('none');
}

// ── REPORTS ───────────────────────────────────────────────────────────────
function dlCSV(type) {
  const from = document.getElementById(`${type==='violations'?'vio':'sig'}-from`)?.value||'';
  const to = document.getElementById(`${type==='violations'?'vio':'sig'}-to`)?.value||'';
  window.location.href=`/api/reports/csv/${type}?from=${from}&to=${to}`;
}

// ── LOAD ZONES FOR FILTERS ─────────────────────────────────────────────────
async function loadZonesForFilters() {
  try {
    allZones = await api('/zones');
    const selects = ['sig-zone-filter','vf-zone','area-zone-filter','junc-zone-filter','u-zone-f'];
    selects.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const first = el.options[0]?.text || 'All zones';
      el.innerHTML = `<option value="">${first}</option>` + allZones.map(z=>`<option value="${z.id}">${z.name}</option>`).join('');
    });
  } catch {}
}

// ── ADMIN: ZONES ──────────────────────────────────────────────────────────
async function loadZones() {
  try {
    allZones = await api('/zones');
    document.getElementById('zones-tbody').innerHTML = allZones.map(z=>`<tr>
      <td class="mono">${z.code||'—'}</td><td style="font-weight:600">${z.name}</td>
      <td>${z.area_count||0}</td><td>${z.junction_count||0}</td>
      <td><span class="badge ${z.status==='active'?'badge-green':'badge-red'}">${z.status}</span></td>
      <td><button class="btn btn-danger btn-sm" onclick="deleteZone(${z.id})">Delete</button></td>
    </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text3)">No zones yet</td></tr>';
  } catch(e) { showToast('Error',e.message,'high','❌'); }
}
async function saveZone() {
  try {
    await api('/zones',{method:'POST',body:{name:document.getElementById('z-name').value,code:document.getElementById('z-code').value,description:document.getElementById('z-desc').value}});
    closeModal('modal-zone'); loadZones(); loadZonesForFilters(); showToast('Zone added','','info','✅');
  } catch(e) { showToast('Error',e.message,'high','❌'); }
}
async function deleteZone(id) {
  if (!confirm('Delete this zone?')) return;
  try { await api(`/zones/${id}`,{method:'DELETE'}); loadZones(); } catch(e) { showToast('Error',e.message,'high','❌'); }
}

// ── ADMIN: AREAS ──────────────────────────────────────────────────────────
async function loadAreas() {
  try {
    const zf = document.getElementById('area-zone-filter')?.value||'';
    allAreas = await api(`/areas${zf?`?zoneId=${zf}`:''}`);
    document.getElementById('areas-tbody').innerHTML = allAreas.map(a=>`<tr>
      <td class="mono">${a.code||'—'}</td><td style="font-weight:600">${a.name}</td><td style="color:var(--text3)">${a.zone_name||'—'}</td>
      <td>${a.junction_count||0}</td>
      <td><span class="badge ${a.status==='active'?'badge-green':'badge-red'}">${a.status}</span></td>
      <td><button class="btn btn-danger btn-sm" onclick="deleteArea(${a.id})">Delete</button></td>
    </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text3)">No areas yet</td></tr>';
    // Populate zone select in modal
    const sel = document.getElementById('a-zone');
    if (sel && allZones.length) sel.innerHTML = allZones.map(z=>`<option value="${z.id}">${z.name}</option>`).join('');
  } catch(e) { showToast('Error',e.message,'high','❌'); }
}
async function saveArea() {
  try {
    const zoneId = document.getElementById('a-zone').value;
    const zone = allZones.find(z=>String(z.id)===zoneId);
    await api('/areas',{method:'POST',body:{name:document.getElementById('a-name').value,code:document.getElementById('a-code').value,zoneId,cityId:zone?.city_id||user?.cityId}});
    closeModal('modal-area'); loadAreas(); showToast('Area added','','info','✅');
  } catch(e) { showToast('Error',e.message,'high','❌'); }
}
async function deleteArea(id) {
  if (!confirm('Delete this area?')) return;
  try { await api(`/areas/${id}`,{method:'DELETE'}); loadAreas(); } catch(e) { showToast('Error',e.message,'high','❌'); }
}

// ── ADMIN: JUNCTIONS ──────────────────────────────────────────────────────
async function loadJunctions() {
  try {
    const zf=document.getElementById('junc-zone-filter')?.value||'', af=document.getElementById('junc-area-filter')?.value||'';
    let q='/junctions?';
    if (zf) q+=`zoneId=${zf}&`;
    if (af) q+=`areaId=${af}`;
    allJunctions = await api(q);
    document.getElementById('junctions-tbody').innerHTML = allJunctions.map(j=>`<tr>
      <td class="mono">${j.code}</td><td style="font-weight:600">${j.name}</td>
      <td style="font-size:11px;color:var(--text3)">${j.zone_name||'—'} / ${j.area_name||'—'}</td>
      <td class="mono green">${j.min_phase_seconds}s</td><td class="mono amber">${j.max_phase_seconds}s</td>
      <td><span class="badge ${j.camera_mode==='rtsp'?'badge-blue':'badge-gray'}">${j.camera_mode}</span></td>
      <td><span class="badge ${j.ai_enabled?'badge-green':'badge-gray'}">${j.ai_enabled?'AI on':'Manual'}</span></td>
      <td><span class="badge ${j.status==='active'?'badge-green':'badge-red'}">${j.status}</span></td>
      <td><button class="btn btn-danger btn-sm" onclick="deleteJunction(${j.id})">Disable</button></td>
    </tr>`).join('') || '<tr><td colspan="9" style="text-align:center;padding:20px;color:var(--text3)">No junctions yet</td></tr>';
    // Populate area select in modal
    const sel = document.getElementById('j-area');
    if (sel && allAreas.length) sel.innerHTML = allAreas.map(a=>`<option value="${a.id}" data-zone="${a.zone_id}">${a.zone_name} → ${a.name}</option>`).join('');
    // Populate zone/area filter with area sub-filter
    const af2 = document.getElementById('junc-area-filter');
    if (af2) af2.innerHTML='<option value="">All areas</option>'+allAreas.map(a=>`<option value="${a.id}">${a.name}</option>`).join('');
  } catch(e) { showToast('Error',e.message,'high','❌'); }
}
async function saveJunction() {
  try {
    const areaId = document.getElementById('j-area').value;
    const area = allAreas.find(a=>String(a.id)===areaId);
    await api('/junctions',{method:'POST',body:{
      code:document.getElementById('j-code').value, name:document.getElementById('j-name').value,
      location:document.getElementById('j-loc').value, areaId, zoneId:area?.zone_id, cityId:area?.city_id||user?.cityId,
      latitude:document.getElementById('j-lat').value, longitude:document.getElementById('j-lng').value,
      cameraMode:document.getElementById('j-mode').value,
      minPhase:document.getElementById('j-min').value, maxPhase:document.getElementById('j-max').value,
      emptyRoadThreshold:document.getElementById('j-empty').value,
    }});
    closeModal('modal-junction'); loadJunctions(); showToast('Junction added','','info','✅');
  } catch(e) { showToast('Error',e.message,'high','❌'); }
}
async function deleteJunction(id) {
  if (!confirm('Disable this junction?')) return;
  try { await api(`/junctions/${id}`,{method:'DELETE'}); loadJunctions(); showToast('Junction disabled','','info','✅'); } catch(e) { showToast('Error',e.message,'high','❌'); }
}

// ── ADMIN: CAMERAS ────────────────────────────────────────────────────────
async function loadCameras() {
  try {
    const jf = document.getElementById('cam-junc-filter')?.value||'';
    const data = await api(`/cameras${jf?`?junctionId=${jf}`:''}`);
    document.getElementById('cameras-tbody').innerHTML = data.map(c=>`<tr>
      <td class="mono">${c.code}</td><td style="font-size:12px">${c.junction_name||'—'}</td><td>${c.arm}</td>
      <td><span class="badge badge-gray">${c.resolution}</span></td>
      <td style="font-size:11px;color:var(--text3);max-width:150px;overflow:hidden;text-overflow:ellipsis">${c.rtsp_url||'—'}</td>
      <td><span class="badge ${c.status==='online'?'badge-green':'badge-red'}">${c.status}</span></td>
      <td><button class="btn btn-danger btn-sm" onclick="deleteCamera(${c.id})">Delete</button></td>
    </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text3)">No cameras yet</td></tr>';
    const sel1 = document.getElementById('c-junc'), sel2 = document.getElementById('cam-junc-filter');
    const jOpts = allJunctions.length ? allJunctions.map(j=>`<option value="${j.id}">${j.code} — ${j.name}</option>`).join('') : '';
    if (sel1) sel1.innerHTML=jOpts;
    if (sel2) sel2.innerHTML='<option value="">All junctions</option>'+jOpts;
  } catch(e) { showToast('Error',e.message,'high','❌'); }
}
async function saveCamera() {
  try {
    await api('/cameras',{method:'POST',body:{junctionId:document.getElementById('c-junc').value,code:document.getElementById('c-code').value,arm:document.getElementById('c-arm').value,label:document.getElementById('c-label').value,rtspUrl:document.getElementById('c-rtsp').value,resolution:document.getElementById('c-res').value,fps:document.getElementById('c-fps').value}});
    closeModal('modal-camera'); loadCameras(); showToast('Camera added','','info','✅');
  } catch(e) { showToast('Error',e.message,'high','❌'); }
}
async function deleteCamera(id) {
  try { await api(`/cameras/${id}`,{method:'DELETE'}); loadCameras(); } catch(e) { showToast('Error',e.message,'high','❌'); }
}

// ── ADMIN: SIGNAL TIMING ──────────────────────────────────────────────────
async function loadTiming() {
  try {
    const jf = document.getElementById('timing-junc-filter')?.value||'';
    const jOpts = allJunctions.map(j=>`<option value="${j.id}">${j.code} — ${j.name}</option>`).join('');
    const sel = document.getElementById('timing-junc-filter');
    if (sel && allJunctions.length) sel.innerHTML='<option value="">Select junction</option>'+jOpts;
    const sel2 = document.getElementById('tp-junc');
    if (sel2) sel2.innerHTML=jOpts;
    if (!jf) { document.getElementById('timing-tbody').innerHTML='<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text3)">Select a junction above</td></tr>'; return; }
    const data = await api(`/signal-profiles/${jf}`);
    document.getElementById('timing-tbody').innerHTML = data.map(p=>{
      const j = allJunctions.find(j=>j.id===p.junction_id);
      return `<tr>
        <td style="font-size:12px">${j?.name||'—'}</td>
        <td><span class="badge badge-blue">${p.profile_name}</span></td>
        <td class="mono" style="font-size:11px">${p.start_hour}:00 – ${p.end_hour}:00</td>
        <td class="mono green">${p.min_phase}s</td><td class="mono amber">${p.max_phase}s</td>
        <td><span class="badge ${p.is_active?'badge-green':'badge-gray'}">${p.is_active?'Active':'Inactive'}</span></td>
        <td><button class="btn btn-danger btn-sm" onclick="deleteTiming(${p.id})">Delete</button></td>
      </tr>`;
    }).join('') || '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text3)">No profiles for this junction</td></tr>';
  } catch(e) { showToast('Error',e.message,'high','❌'); }
}
async function saveTiming() {
  try {
    await api('/signal-profiles',{method:'POST',body:{junctionId:document.getElementById('tp-junc').value,profileName:document.getElementById('tp-name').value,startHour:document.getElementById('tp-start').value,endHour:document.getElementById('tp-end').value,minPhase:document.getElementById('tp-min').value,maxPhase:document.getElementById('tp-max').value}});
    closeModal('modal-timing'); loadTiming(); showToast('Profile added','','info','✅');
  } catch(e) { showToast('Error',e.message,'high','❌'); }
}
async function deleteTiming(id) {
  try { await api(`/signal-profiles/${id}`,{method:'DELETE'}); loadTiming(); } catch(e) { showToast('Error',e.message,'high','❌'); }
}

// ── ADMIN: USERS ──────────────────────────────────────────────────────────
async function loadUsers() {
  try {
    const data = await api('/users');
    document.getElementById('users-tbody').innerHTML = data.map(u=>`<tr>
      <td style="font-weight:600">${u.name}</td><td class="mono" style="font-size:12px">${u.email}</td>
      <td><span class="badge ${u.role==='superadmin'?'badge-red':u.role==='cityadmin'?'badge-amber':u.role==='zoneadmin'?'badge-purple':'badge-blue'}">${u.role}</span></td>
      <td><span class="badge ${u.status==='active'?'badge-green':'badge-red'}">${u.status}</span></td>
      <td style="font-size:11px;color:var(--text3)">${u.last_login?fmtDateTime(u.last_login):'Never'}</td>
      <td></td>
    </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text3)">No users yet</td></tr>';
  } catch(e) { showToast('Error',e.message,'high','❌'); }
}
async function saveUser() {
  try {
    await api('/users',{method:'POST',body:{name:document.getElementById('u-name-f').value,email:document.getElementById('u-email-f').value,password:document.getElementById('u-pass-f').value,role:document.getElementById('u-role-f').value,zoneId:document.getElementById('u-zone-f').value||null}});
    closeModal('modal-user'); loadUsers(); showToast('User added','','info','✅');
  } catch(e) { showToast('Error',e.message,'high','❌'); }
}

// ── SUPERADMIN: CITIES ────────────────────────────────────────────────────
async function loadCities() {
  try {
    const data = await api('/cities');
    document.getElementById('cities-tbody').innerHTML = data.map(c=>`<tr>
      <td style="font-weight:600">${c.name}</td><td>${c.state||'—'}</td>
      <td><span class="badge badge-blue">${c.plan}</span></td>
      <td>${c.zone_count||0}</td><td>${c.junction_count||0}</td>
      <td><span class="badge ${c.status==='active'?'badge-green':'badge-red'}">${c.status}</span></td>
      <td></td>
    </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text3)">No cities yet</td></tr>';
  } catch(e) { showToast('Error',e.message,'high','❌'); }
}
async function saveCity() {
  try {
    await api('/cities',{method:'POST',body:{name:document.getElementById('ct-name').value,state:document.getElementById('ct-state').value,country:document.getElementById('ct-country').value,plan:document.getElementById('ct-plan').value}});
    closeModal('modal-city'); loadCities(); showToast('City added','','info','✅');
  } catch(e) { showToast('Error',e.message,'high','❌'); }
}

// ── SUPERADMIN: LICENSES ──────────────────────────────────────────────────
async function loadLicenses() {
  try {
    const [lics, cities] = await Promise.all([api('/licenses'), api('/cities')]);
    const licSel = document.getElementById('lic-city');
    if (licSel) licSel.innerHTML=cities.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
    document.getElementById('licenses-tbody').innerHTML = lics.map(l=>`<tr>
      <td class="mono blue" style="font-size:12px;letter-spacing:0.04em">${l.license_key}</td>
      <td>${l.city_name}</td>
      <td><span class="badge badge-blue">${l.plan}</span></td>
      <td><span class="badge ${l.status==='active'?'badge-green':l.status==='revoked'?'badge-red':'badge-amber'}">${l.status}</span></td>
      <td style="font-size:11px;color:var(--text3)">${l.expires_at?fmtDate(l.expires_at):'Never'}</td>
      <td>${l.max_junctions}</td>
      <td>${l.status!=='revoked'?`<button class="btn btn-danger btn-sm" onclick="revokeLic(${l.id})">Revoke</button>`:''}</td>
    </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text3)">No keys yet</td></tr>';
  } catch(e) { showToast('Error',e.message,'high','❌'); }
}
async function genLicense() {
  try {
    const data = await api('/licenses',{method:'POST',body:{cityId:document.getElementById('lic-city').value,plan:document.getElementById('lic-plan').value,validityDays:document.getElementById('lic-days').value,notes:document.getElementById('lic-notes').value}});
    closeModal('modal-license');
    document.getElementById('new-key-text').textContent=data.license_key;
    document.getElementById('new-key-box').style.display='block';
    loadLicenses(); showToast('Key generated',data.license_key,'info','🔑');
  } catch(e) { showToast('Error',e.message,'high','❌'); }
}
async function revokeLic(id) {
  if (!confirm('Revoke this license key?')) return;
  try { await api(`/licenses/${id}/revoke`,{method:'PUT'}); loadLicenses(); showToast('Revoked','','info','🔒'); } catch(e) { showToast('Error',e.message,'high','❌'); }
}

// ── INIT ──────────────────────────────────────────────────────────────────
boot();
