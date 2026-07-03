const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db/pool');

const ARMS = ['North', 'South', 'East', 'West'];
const OPP = { North: 'South', South: 'North', East: 'West', West: 'East' };

const VIOLATION_TYPES = [
  { type: 'red_jump',     label: 'Red light jump',     severity: 'high',   prob: 0.035 },
  { type: 'no_helmet',    label: 'No helmet',          severity: 'medium', prob: 0.055 },
  { type: 'speeding',     label: 'Speeding violation', severity: 'high',   prob: 0.025 },
  { type: 'wrong_lane',   label: 'Wrong lane',         severity: 'medium', prob: 0.040 },
  { type: 'no_seatbelt',  label: 'No seatbelt',        severity: 'low',    prob: 0.035 },
  { type: 'illegal_park', label: 'Illegal parking',    severity: 'medium', prob: 0.020 },
  { type: 'triple_ride',  label: 'Triple riding',      severity: 'medium', prob: 0.030 },
];

const FAKE_PLATES = [
  'MP09-AB-1234','MP09-XY-5678','MP09-CC-9012','MP09-MN-3456',
  'KA05-AB-7890','DL01-AA-2345','MH12-CD-6789','GJ05-EF-0123',
];

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randf(min, max) { return Math.random() * (max - min) + min; }

function getHourMultiplier() {
  const h = new Date().getHours();
  const pattern = [0.3,0.2,0.15,0.15,0.2,0.4,0.7,1.0,1.2,1.0,0.9,0.95,1.1,1.0,0.9,0.85,0.9,1.1,1.3,1.2,1.0,0.8,0.6,0.4];
  return pattern[h] || 0.5;
}

class JunctionState {
  constructor(junction, cameras) {
    this.junction = junction;
    this.cameras = cameras;
    this.arms = {};
    this.currentGreen = 'North';
    this.phaseTimer = rand(20, 35);
    this.phaseMax = 30;
    this.aiDecision = '';
    this.aiConfidence = 0.95;
    this.processingMs = 120;
    this.status = 'normal';
    this.avgWaitTime = 0;

    ARMS.forEach(arm => {
      this.arms[arm] = { vehicles: rand(3, 15), waitTime: randf(0.5, 2.5), congestionLevel: 'low' };
    });
  }

  tick(baseFlow) {
    const mult = getHourMultiplier();
    ARMS.forEach(arm => {
      const drift = rand(-3, 5);
      const greenBonus = this.currentGreen === arm ? -rand(2, 6) : rand(0, 3);
      const v = Math.max(0, Math.min(45, Math.round(baseFlow * mult + drift + greenBonus)));
      this.arms[arm].vehicles = v;
      this.arms[arm].waitTime = parseFloat(randf(0.3, v > 20 ? 8 : 4).toFixed(1));
      this.arms[arm].congestionLevel = v >= 30 ? 'critical' : v >= 20 ? 'high' : v >= 10 ? 'medium' : 'low';
    });

    this.phaseTimer--;
    if (this.phaseTimer <= 0) {
      const decision = this._makeDecision();
      this.currentGreen = decision.greenArm;
      this.phaseMax = decision.phaseDuration;
      this.phaseTimer = decision.phaseDuration;
      this.aiDecision = decision.reason;
      this.aiConfidence = parseFloat(randf(0.87, 0.99).toFixed(3));
      this.processingMs = rand(45, 190);
      return decision;
    }

    const maxV = Math.max(...ARMS.map(a => this.arms[a].vehicles));
    this.status = maxV >= 35 ? 'critical' : maxV >= 22 ? 'warning' : 'normal';
    const waits = ARMS.map(a => this.arms[a].waitTime);
    this.avgWaitTime = parseFloat((waits.reduce((a, b) => a + b, 0) / waits.length).toFixed(1));
    return null;
  }

  _makeDecision() {
    let busiest = 'North', maxV = 0;
    ARMS.forEach(arm => { if (this.arms[arm].vehicles > maxV) { maxV = this.arms[arm].vehicles; busiest = arm; } });
    const waitBonus = this.arms[busiest].waitTime > 4 ? ' (wait time priority override)' : '';
    const phaseDuration = Math.min(50, Math.max(15, Math.round(maxV * 1.5)));
    return {
      greenArm: busiest,
      phaseDuration,
      reason: `${busiest} arm: ${maxV} vehicles — highest density. Phase: ${phaseDuration}s${waitBonus}.`,
    };
  }

  maybeViolation() {
    const violations = [];
    VIOLATION_TYPES.forEach(vtype => {
      if (Math.random() < vtype.prob * 0.25) {
        const arm = ARMS[Math.floor(Math.random() * ARMS.length)];
        const cam = this.cameras.find(c => c.arm === arm);
        violations.push({
          id: uuidv4(),
          junctionId: this.junction.id,
          junctionName: this.junction.name,
          cameraId: cam?.id || null,
          type: vtype.type,
          label: vtype.label,
          severity: vtype.severity,
          arm,
          plate: FAKE_PLATES[Math.floor(Math.random() * FAKE_PLATES.length)],
          timestamp: new Date().toISOString(),
          status: 'new',
        });
      }
    });
    return violations;
  }

  snapshot() {
    return {
      id: this.junction.id,
      code: this.junction.code,
      name: this.junction.name,
      location: this.junction.location,
      cameraMode: this.junction.camera_mode,
      aiEnabled: this.junction.ai_enabled,
      status: this.status,
      currentGreen: this.currentGreen,
      phaseTimer: this.phaseTimer,
      phaseMax: this.phaseMax,
      aiDecision: this.aiDecision,
      aiConfidence: this.aiConfidence,
      processingMs: this.processingMs,
      avgWaitTime: this.avgWaitTime,
      arms: this.arms,
      cameras: this.cameras,
    };
  }
}

class TrafficEngine {
  constructor() {
    this.junctions = {};
    this.alerts = [];
    this.totalVehicles = 0;
    this.totalViolations = 0;
    this.signalCycles = 0;
    this.startTime = Date.now();
    this.initialized = false;
  }

  async init() {
    try {
      const jRes = await pool.query(
        "SELECT * FROM junctions WHERE status = 'active' ORDER BY id"
      );
      for (const j of jRes.rows) {
        const camRes = await pool.query("SELECT * FROM cameras WHERE junction_id = $1", [j.id]);
        this.junctions[j.id] = new JunctionState(j, camRes.rows);
      }
      this.initialized = true;
      console.log(`[Engine] Initialized with ${Object.keys(this.junctions).length} junctions`);
    } catch (err) {
      console.error('[Engine] DB init failed, running with empty state:', err.message);
      this.initialized = true;
    }
  }

  async reloadJunctions() {
    await this.init();
  }

  async tick() {
    if (!this.initialized) return;

    const newAlerts = [];

    for (const [id, state] of Object.entries(this.junctions)) {
      const baseFlow = 20;
      const decision = state.tick(baseFlow);

      if (decision) {
        this.signalCycles++;
        // Persist signal decision to DB (non-blocking)
        pool.query(
          `INSERT INTO signal_logs (junction_id, green_arm, phase_duration, ai_decision, ai_confidence, processing_ms, vehicle_counts)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [id, decision.greenArm, decision.phaseDuration, decision.reason,
           state.aiConfidence, state.processingMs, JSON.stringify(state.arms)]
        ).catch(e => console.error('[Engine] Signal log insert error:', e.message));
      }

      this.totalVehicles += rand(1, 4);

      // Check for violations
      const violations = state.maybeViolation();
      for (const v of violations) {
        this.alerts.unshift(v);
        newAlerts.push(v);
        this.totalViolations++;

        // Persist to DB (non-blocking)
        pool.query(
          `INSERT INTO alert_logs (junction_id, camera_id, type, label, severity, arm, plate_number, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'new')`,
          [v.junctionId, v.cameraId, v.type, v.label, v.severity, v.arm, v.plate]
        ).catch(e => console.error('[Engine] Alert log insert error:', e.message));
      }
    }

    if (this.alerts.length > 100) this.alerts = this.alerts.slice(0, 100);
    return newAlerts;
  }

  snapshot() {
    return {
      timestamp: new Date().toISOString(),
      stats: {
        totalVehicles: this.totalVehicles,
        totalViolations: this.totalViolations,
        signalCycles: this.signalCycles,
        activeJunctions: Object.keys(this.junctions).length,
        uptimeMs: Date.now() - this.startTime,
      },
      intersections: Object.values(this.junctions).map(s => s.snapshot()),
      alerts: this.alerts.slice(0, 30),
    };
  }

  acknowledgeAlert(alertId, userId) {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.status = 'acknowledged';
      pool.query(
        "UPDATE alert_logs SET status = 'acknowledged', acknowledged_by = $1, acknowledged_at = NOW() WHERE plate_number = $2 AND status = 'new'",
        [userId, alert.plate]
      ).catch(() => {});
    }
    return alert;
  }
}

module.exports = { TrafficEngine };
