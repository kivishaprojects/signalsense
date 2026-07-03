const PDFDocument = require('pdfkit');
const { stringify } = require('csv-stringify');
const { pool } = require('../db/pool');

async function getAlertData(cityId, from, to) {
  const result = await pool.query(
    `SELECT al.*, j.name as junction_name, j.code as junction_code
     FROM alert_logs al
     JOIN junctions j ON j.id = al.junction_id
     WHERE j.city_id = $1
       AND al.created_at BETWEEN $2 AND $3
     ORDER BY al.created_at DESC`,
    [cityId, from, to]
  );
  return result.rows;
}

async function getSignalData(cityId, from, to) {
  const result = await pool.query(
    `SELECT sl.*, j.name as junction_name, j.code as junction_code
     FROM signal_logs sl
     JOIN junctions j ON j.id = sl.junction_id
     WHERE j.city_id = $1
       AND sl.created_at BETWEEN $2 AND $3
     ORDER BY sl.created_at DESC
     LIMIT 5000`,
    [cityId, from, to]
  );
  return result.rows;
}

async function getDailyStats(cityId, from, to) {
  const result = await pool.query(
    `SELECT ds.*, j.name as junction_name, j.code as junction_code
     FROM daily_stats ds
     JOIN junctions j ON j.id = ds.junction_id
     WHERE j.city_id = $1
       AND ds.stat_date BETWEEN $2 AND $3
     ORDER BY ds.stat_date DESC, j.code`,
    [cityId, from, to]
  );
  return result.rows;
}

// ── PDF REPORT ──────────────────────────────────────────────────────────────
async function generatePDF(res, { cityId, cityName, from, to, reportType }) {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="SignalSense_Report_${from}_${to}.pdf"`);
  doc.pipe(res);

  const NAVY = '#0D1B3E';
  const RED = '#C8102E';
  const GRAY = '#64748B';

  // Header
  doc.rect(0, 0, doc.page.width, 80).fill(NAVY);
  doc.fontSize(22).fillColor('#FFFFFF').font('Helvetica-Bold')
    .text('SignalSense AI', 50, 22);
  doc.fontSize(10).fillColor('rgba(255,255,255,0.7)').font('Helvetica')
    .text('Traffic Analytics Report', 50, 48);
  doc.fillColor('#FFFFFF').text(`${cityName} · ${from} to ${to}`, 50, 62);

  doc.moveDown(3);

  // Summary section
  const alerts = await getAlertData(cityId, from, to);
  const signals = await getSignalData(cityId, from, to);

  doc.fontSize(14).fillColor(NAVY).font('Helvetica-Bold').text('Executive Summary');
  doc.moveDown(0.5);

  const summaryItems = [
    ['Report Period', `${from} — ${to}`],
    ['City', cityName],
    ['Total Violations Detected', alerts.length.toString()],
    ['Total Signal Cycles (AI)', signals.length.toString()],
    ['High Severity Violations', alerts.filter(a => a.severity === 'high').length.toString()],
    ['Acknowledged Violations', alerts.filter(a => a.status === 'acknowledged').length.toString()],
  ];

  summaryItems.forEach(([label, value], i) => {
    const y = doc.y;
    if (i % 2 === 0) doc.rect(50, y, doc.page.width - 100, 22).fill(i === 0 ? '#F4F7FC' : '#F9FAFB');
    doc.fontSize(10).fillColor(GRAY).font('Helvetica').text(label, 60, y + 6);
    doc.fillColor(NAVY).font('Helvetica-Bold').text(value, 300, y + 6);
    doc.y = y + 22;
  });

  doc.moveDown(1.5);

  // Violations breakdown
  doc.fontSize(14).fillColor(NAVY).font('Helvetica-Bold').text('Violations by Type');
  doc.moveDown(0.5);

  const vByType = {};
  alerts.forEach(a => { vByType[a.type] = (vByType[a.type] || 0) + 1; });

  // Table header
  doc.rect(50, doc.y, doc.page.width - 100, 22).fill(NAVY);
  const headerY = doc.y;
  doc.fontSize(9).fillColor('#FFFFFF').font('Helvetica-Bold');
  doc.text('Violation Type', 60, headerY + 7);
  doc.text('Count', 280, headerY + 7);
  doc.text('% of Total', 360, headerY + 7);
  doc.y = headerY + 22;

  Object.entries(vByType).forEach(([type, count], i) => {
    const y = doc.y;
    doc.rect(50, y, doc.page.width - 100, 20).fill(i % 2 === 0 ? '#FFFFFF' : '#F9FAFB');
    doc.fontSize(9).fillColor(NAVY).font('Helvetica')
      .text(type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), 60, y + 6)
      .text(count.toString(), 280, y + 6)
      .text(`${((count / alerts.length) * 100).toFixed(1)}%`, 360, y + 6);
    doc.y = y + 20;
  });

  doc.moveDown(1.5);

  // Recent violations log (up to 20)
  if (alerts.length > 0) {
    doc.fontSize(14).fillColor(NAVY).font('Helvetica-Bold').text('Recent Violations Log (last 20)');
    doc.moveDown(0.5);

    doc.rect(50, doc.y, doc.page.width - 100, 22).fill(NAVY);
    const th = doc.y;
    doc.fontSize(8).fillColor('#FFFFFF').font('Helvetica-Bold');
    ['Date/Time','Junction','Type','Severity','Plate'].forEach((h, i) => {
      doc.text(h, 60 + i * 90, th + 7);
    });
    doc.y = th + 22;

    alerts.slice(0, 20).forEach((a, i) => {
      if (doc.y > 720) { doc.addPage(); }
      const y = doc.y;
      doc.rect(50, y, doc.page.width - 100, 18).fill(i % 2 === 0 ? '#FFFFFF' : '#F9FAFB');
      doc.fontSize(7.5).fillColor(NAVY).font('Helvetica');
      doc.text(new Date(a.created_at).toLocaleString('en-IN'), 60, y + 5);
      doc.text((a.junction_code || '').substring(0, 10), 150, y + 5);
      doc.text((a.label || '').substring(0, 14), 240, y + 5);
      doc.fontSize(7).fillColor(a.severity === 'high' ? RED : a.severity === 'medium' ? '#D29922' : '#2A78D6')
        .text((a.severity || '').toUpperCase(), 330, y + 5);
      doc.fillColor(NAVY).fontSize(7.5).text(a.plate_number || '—', 390, y + 5);
      doc.y = y + 18;
    });
  }

  // Footer
  doc.rect(0, doc.page.height - 40, doc.page.width, 40).fill(NAVY);
  doc.fontSize(8).fillColor('rgba(255,255,255,0.6)').font('Helvetica')
    .text(`Generated by SignalSense AI · ${new Date().toLocaleString('en-IN')} · Confidential`, 50, doc.page.height - 26);

  doc.end();
}

// ── CSV EXPORT ───────────────────────────────────────────────────────────────
async function generateCSV(res, { cityId, from, to, type }) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="SignalSense_${type}_${from}_${to}.csv"`);

  if (type === 'violations') {
    const data = await getAlertData(cityId, from, to);
    stringify(data.map(a => ({
      'Date/Time': new Date(a.created_at).toLocaleString('en-IN'),
      'Junction': a.junction_name,
      'Junction Code': a.junction_code,
      'Violation Type': a.type,
      'Violation Label': a.label,
      'Severity': a.severity,
      'Arm': a.arm,
      'Plate Number': a.plate_number || '',
      'Status': a.status,
      'Acknowledged At': a.acknowledged_at ? new Date(a.acknowledged_at).toLocaleString('en-IN') : '',
    })), { header: true }).pipe(res);
  }

  if (type === 'signals') {
    const data = await getSignalData(cityId, from, to);
    stringify(data.map(s => ({
      'Date/Time': new Date(s.created_at).toLocaleString('en-IN'),
      'Junction': s.junction_name,
      'Junction Code': s.junction_code,
      'Green Arm': s.green_arm,
      'Phase Duration (s)': s.phase_duration,
      'AI Decision': s.ai_decision,
      'AI Confidence': s.ai_confidence,
      'Processing Time (ms)': s.processing_ms,
    })), { header: true }).pipe(res);
  }

  if (type === 'stats') {
    const data = await getDailyStats(cityId, from, to);
    stringify(data.map(s => ({
      'Date': s.stat_date,
      'Junction': s.junction_name,
      'Junction Code': s.junction_code,
      'Total Vehicles': s.total_vehicles,
      'Total Violations': s.total_violations,
      'Signal Cycles': s.signal_cycles,
      'Avg Wait Time (min)': s.avg_wait_time,
      'Peak Hour': s.peak_hour,
      'Peak Vehicle Count': s.peak_vehicle_count,
    })), { header: true }).pipe(res);
  }
}

module.exports = { generatePDF, generateCSV };
