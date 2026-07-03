require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const WebSocket = require('ws');

const { pool, migrate } = require('./db/pool');
const { TrafficEngine } = require('./services/trafficEngine');
const { router: apiRouter, setEngine } = require('./routes/api');
const { JWT_SECRET } = require('./middleware/auth');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 8080;

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());

// Serve frontend from backend/public folder
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api', apiRouter);

// Catch-all — serve index.html for any non-API route
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// WebSocket server
const wss = new WebSocket.Server({ server, path: '/ws' });
const clients = new Set();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://localhost`);
  const token = url.searchParams.get('token');
  if (token) {
    try {
      const jwt = require('jsonwebtoken');
      ws.user = jwt.verify(token, JWT_SECRET);
    } catch {
      ws.close(1008, 'Invalid token');
      return;
    }
  }

  clients.add(ws);
  console.log(`[WS] Client connected (${clients.size} total)`);

  ws.on('message', msg => {
    try {
      const data = JSON.parse(msg);
      if (data.type === 'ping') ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
    } catch {}
  });

  ws.on('close', () => { clients.delete(ws); });
  ws.on('error', () => { clients.delete(ws); });

  if (engine) ws.send(JSON.stringify({ type: 'snapshot', payload: engine.snapshot() }));
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
      const newAlerts = await engine.tick();
      const snapshot = engine.snapshot();
      broadcast({ type: 'snapshot', payload: snapshot });
      if (newAlerts && newAlerts.length > 0) {
        newAlerts.forEach(alert => broadcast({ type: 'alert', payload: alert }));
      }
    }, TICK_MS);

    server.listen(PORT, () => {
      console.log(`\n✅ SignalSense AI running on http://localhost:${PORT}`);
      console.log(`📡 WebSocket: ws://localhost:${PORT}/ws`);
      console.log(`🔑 Login: ${process.env.ADMIN_EMAIL || 'admin@signalsense.ai'}\n`);
    });
  } catch (err) {
    console.error('Startup error:', err);
    process.exit(1);
  }
}

start();