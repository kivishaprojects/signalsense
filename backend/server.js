require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const WebSocket = require('ws');

const { migrate } = require('./db/pool');
const { TrafficEngine } = require('./services/trafficEngine');
const { router: apiRouter, setEngine } = require('./routes/api');
const { JWT_SECRET } = require('./middleware/auth');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 8080;

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', apiRouter);

app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// WebSocket
const wss = new WebSocket.Server({ server, path: '/ws' });
const clients = new Set();

wss.on('connection', (ws, req) => {
  try {
    const url = new URL(req.url, `http://localhost`);
    const token = url.searchParams.get('token');
    if (token) {
      const jwt = require('jsonwebtoken');
      ws.user = jwt.verify(token, JWT_SECRET);
    }
  } catch { ws.close(1008, 'Invalid token'); return; }

  clients.add(ws);

  ws.on('message', msg => {
    try {
      const data = JSON.parse(msg);
      if (data.type === 'ping') ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
    } catch {}
  });

  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));

  // Send initial snapshot immediately on connect
  if (engine) {
    try { ws.send(JSON.stringify({ type: 'snapshot', payload: engine.snapshot() })); } catch {}
  }
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(msg); } catch { clients.delete(ws); }
    }
  });
}

let engine;
const TICK_MS = parseInt(process.env.TICK_INTERVAL_MS || '2000');

async function start() {
  try {
    await migrate();
    console.log('[DB] Ready');

    engine = new TrafficEngine();
    await engine.init();
    setEngine(engine);

    setInterval(async () => {
      try {
        const newAlerts = await engine.tick();
        const snapshot = engine.snapshot();
        broadcast({ type: 'snapshot', payload: snapshot });
        if (newAlerts && newAlerts.length > 0) {
          newAlerts.forEach(alert => broadcast({ type: 'alert', payload: alert }));
        }
      } catch (e) { console.error('[Engine tick error]', e.message); }
    }, TICK_MS);

    server.listen(PORT, () => {
      console.log(`\n✅ SignalSense AI v2 running on http://localhost:${PORT}`);
      console.log(`📡 WebSocket: ws://localhost:${PORT}/ws`);
      console.log(`🔑 Login: ${process.env.ADMIN_EMAIL || 'admin@signalsense.ai'}\n`);
    });
  } catch (err) {
    console.error('Startup error:', err);
    process.exit(1);
  }
}

start();
