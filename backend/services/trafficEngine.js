const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db/pool');

const ARMS = ['North', 'South', 'East', 'West'];
const OPP  = { North:'South', South:'North', East:'West', West:'East' };

const VIOLATION_TYPES = [
  { type:'red_jump',     label:'Red light jump',     severity:'high',   prob:0.03 },
  { type:'no_helmet',    label:'No helmet',           severity:'medium', prob:0.05 },
  { type:'speeding',     label:'Speeding violation',  severity:'high',   prob:0.02 },
  { type:'wrong_lane',   label:'Wrong lane',          severity:'medium', prob:0.04 },
  { type:'no_seatbelt',  label:'No seatbelt',         severity:'low',    prob:0.03 },
  { type:'illegal_park', label:'Illegal parking',     severity:'medium', prob:0.02 },
  { type:'triple_ride',  label:'Triple riding',       severity:'medium', prob:0.03 },
];

const PLATES = ['MP09-AB-1234','MP09-XY-5678','MP09-CC-9012','MP09-MN-3456',
  'KA05-AB-7890','DL01-AA-2345','MH12-CD-6789','GJ05-EF-0123'];

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randf(min, max) { return Math.random() * (max - min) + min; }

function getHourMultiplier() {
  const h = new Date().getHours();
  const p = [0.25,0.2,0.15,0.15,0.2,0.4,0.7,1.0,1.3,1.1,0.9,1.0,1.1,1.0,0.9,0.85,0.95,1.2,1.4,1.2,1.0,0.8,0.6,0.4];
  return p[h] || 0.5;
}

// Get active signal profile for current hour
function getActiveProfile(junction) {
  const h = new Date().getHours();
  if (!junction.profiles || !junction.profiles.length) {
    return { min_phase: junction.min_phase_seconds || 15, max_phase: junction.max_phase_seconds || 120 };
  }
  const active = junction.profiles.find(p => {
    if (p.start_hour <= p.end_hour) return h >= p.start_hour && h < p.end_hour;
    return h >= p.start_hour || h < p.end_hour; // overnight profiles
  });
  return active || { min_phase: junction.min_phase_seconds || 15, max_phase: junction.max_phase_seconds || 120 };
}

class JunctionState {
  constructor(junction, cameras, profiles) {
    this.junction = { ...junction, profiles };
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
    this.emptyRoad = false;
    this.totalTimeSaved = 0;
    this.lastFixedTime = 60; // what a fixed timer would have used

    ARMS.forEach(arm => {
      this.arms[arm] = { vehicles: rand(2, 12), waitTime: randf(0.5, 2.5), congestionLevel: 'low' };
    });
  }

  tick(baseFlow) {
    const mult = getHourMultiplier();
    const profile = getActiveProfile(this.junction);

    ARMS.forEach(arm => {
      const drift = rand(-3, 5);
      const greenBonus = this.currentGreen === arm ? -rand(2, 6) : rand(0, 3);
      const v = Math.max(0, Math.min(50, Math.round(baseFlow * mult + drift + greenBonus)));
      this.arms[arm].vehicles = v;
      this.arms[arm].waitTime = parseFloat(randf(0.3, v > 20 ? 8 : 4).toFixed(1));
      this.arms[arm].congestionLevel = v >= 35 ? 'critical' : v >= 22 ? 'high' : v >= 10 ? 'medium' : 'low';
    });

    this.phaseTimer--;
    if (this.phaseTimer <= 0) {
      return this._makeDecision(profile);
    }

    const maxV = Math.max(...ARMS.map(a => this.arms[a].vehicles));
    this.status = maxV >= 35 ? 'critical' : maxV >= 22 ? 'warning' : 'normal';
    const waits = ARMS.map(a => this.arms[a].waitTime);
    this.avgWaitTime = parseFloat((waits.reduce((a, b) => a + b, 0) / waits.length).toFixed(1));
    return null;
  }

  _makeDecision(profile) {
    const minPhase = profile.min_phase || this.junction.min_phase_seconds || 15;
    const maxPhase = profile.max_phase || this.junction.max_phase_seconds || 120;
    const emptyThreshold = this.junction.empty_road_threshold || 3;
    const maxVehicles = 40; // scale reference

    // Find busiest arm
    let busiest = 'North', maxV = 0;
    ARMS.forEach(arm => { if (this.arms[arm].vehicles > maxV) { maxV = this.arms[arm].vehicles; busiest = arm; } });

    // Total vehicles on all arms
    const totalVehicles = ARMS.reduce((s, a) => s + this.arms[a].vehicles, 0);

    // Empty road detection
    this.emptyRoad = totalVehicles <= (emptyThreshold * 4);

    let phaseDuration;
    let reason;

    if (this.emptyRoad) {
      // All arms empty — run minimum phase
      phaseDuration = minPhase;
      reason = `Empty road detected (${totalVehicles} total vehicles). Running minimum phase: ${minPhase}s.`;
    } else {
      // AI calculates phase proportional to vehicle density
      const density = Math.min(1, maxV / maxVehicles);
      phaseDuration = Math.round(minPhase + (density * (maxPhase - minPhase)));
      phaseDuration = Math.max(minPhase, Math.min(maxPhase, phaseDuration));

      const waitNote = this.arms[busiest].waitTime > 5 ? ' (high wait time priority)' : '';
      reason = `${busiest}: ${maxV} vehicles (${(density * 100).toFixed(0)}% density). AI phase: ${phaseDuration}s [min:${minPhase}s max:${maxPhase}s]${waitNote}`;
    }

    // Calculate time saved vs fixed timer (assume 60s fixed)
    this.lastFixedTime = 60;
    const timeSaved = this.lastFixedTime - phaseDuration;
    if (timeSaved > 0) this.totalTimeSaved += timeSaved;

    this.currentGreen = busiest;
    this.phaseMax = phaseDuration;
    this.phaseTimer = phaseDuration;
    this.aiDecision = reason;
    this.aiConfidence = parseFloat(randf(0.87, 0.99).toFixed(3));
    this.processingMs = rand(45, 190);

    const maxV2 = Math.max(...ARMS.map(a => this.arms[a].vehicles));
    this.status = maxV2 >= 35 ? 'critical' : maxV2 >= 22 ? 'warning' : 'normal';

    return {
      greenArm: busiest,
      phaseDuration,
      reason,
      emptyRoad: this.emptyRoad,
      timeSaved: Math.max(0, timeSaved),
      vehicleCounts: { ...Object.fromEntries(ARMS.map(a => [a, this.arms[a].vehicles])) },
    };
  }

  maybeViolation() {
    const violations = [];
    VIOLATION_TYPES.forEach(vtype => {
      if (Math.random() < vtype.prob * 0.2) {
        const arm = ARMS[Math.floor(Math.random() * ARMS.length)];
        const cam = this.cameras.find(c => c.arm === arm);
        violations.push({
          id: uuidv4(),
          junctionId: this.junction.id,
          junctionName: this.junction.name,
          areaId: this.junction.area_id,
          zoneId: this.junction.zone_id,
          cityId: this.junction.city_id,
          cameraId: cam?.id || null,
          type: vtype.type,
          label: vtype.label,
          severity: vtype.severity,
          arm,
          plate: PLATES[Math.floor(Math.random() * PLATES.length)],
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
      latitude: this.junction.latitude,
      longitude: this.junction.longitude,
      areaId: this.junction.area_id,
      zoneId: this.junction.zone_id,
      cityId: this.junction.city_id,
      cameraMode: this.junction.camera_mode,
      aiEnabled: this.junction.ai_enabled,
      minPhase: this.junction.min_phase_seconds,
      maxPhase: this.junction.max_phase_seconds,
      status: this.status,
      currentGreen: this.currentGreen,
      phaseTimer: this.phaseTimer,
      phaseMax: this.phaseMax,
      aiDecision: this.aiDecision,
      aiConfidence: this.aiConfidence,
      processingMs: this.processingMs,
      avgWaitTime: this.avgWaitTime,
      emptyRoad: this.emptyRoad,
      totalTimeSaved: this.totalTimeSaved,
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
    this.totalTimeSaved = 0;
    this.emptyRoadCycles = 0;
    this.startTime = Date.now();
    this.initialized = false;
  }

  async init() {
    try {
      const jRes = await pool.query(`
        SELECT j.*, a.name as area_name, z.name as zone_name
        FROM junctions j
        JOIN areas a ON a.id = j.area_id
        JOIN zones z ON z.id = j.zone_id
        WHERE j.status = 'active'
        ORDER BY j.id
      `);

      for (const j of jRes.rows) {
        const camRes = await pool.query("SELECT * FROM cameras WHERE junction_id=$1", [j.id]);
        const profRes = await pool.query("SELECT * FROM signal_profiles WHERE junction_id=$1 AND is_active=true", [j.id]);
        this.junctions[j.id] = new JunctionState(j, camRes.rows, profRes.rows);
      }

      this.initialized = true;
      console.log(`[Engine] Initialized with ${Object.keys(this.junctions).length} junctions`);
    } catch (err) {
      console.error('[Engine] Init failed:', err.message);
      this.initialized = true;
    }
  }

  async reloadJunctions() { await this.init(); }

  async tick() {
    if (!this.initialized) return [];
    const newAlerts = [];

    for (const [id, state] of Object.entries(this.junctions)) {
      const decision = state.tick(20);

      if (decision) {
        this.signalCycles++;
        if (decision.emptyRoad) this.emptyRoadCycles++;
        if (decision.timeSaved > 0) this.totalTimeSaved += decision.timeSaved;

        pool.query(
          `INSERT INTO signal_logs (junction_id,green_arm,phase_duration,ai_decision,ai_confidence,processing_ms,vehicle_counts,fixed_time_would_be,time_saved,empty_road)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [id, decision.greenArm, decision.phaseDuration, decision.reason,
           state.aiConfidence, state.processingMs, JSON.stringify(decision.vehicleCounts),
           60, Math.max(0, decision.timeSaved), decision.emptyRoad]
        ).catch(() => {});
      }

      this.totalVehicles += rand(1, 4);

      const violations = state.maybeViolation();
      for (const v of violations) {
        this.alerts.unshift(v);
        newAlerts.push(v);
        this.totalViolations++;
        pool.query(
          `INSERT INTO alert_logs (junction_id,camera_id,type,label,severity,arm,plate_number,status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'new')`,
          [v.junctionId, v.cameraId, v.type, v.label, v.severity, v.arm, v.plate]
        ).catch(() => {});
      }
    }

    if (this.alerts.length > 150) this.alerts = this.alerts.slice(0, 150);
    return newAlerts;
  }

  snapshot() {
    return {
      timestamp: new Date().toISOString(),
      stats: {
        totalVehicles: this.totalVehicles,
        totalViolations: this.totalViolations,
        signalCycles: this.signalCycles,
        totalTimeSaved: this.totalTimeSaved,
        emptyRoadCycles: this.emptyRoadCycles,
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
        "UPDATE alert_logs SET status='acknowledged',acknowledged_by=$1,acknowledged_at=NOW() WHERE plate_number=$2 AND status='new'",
        [userId, alert.plate]
      ).catch(() => {});
    }
    return alert;
  }
}

module.exports = { TrafficEngine };
