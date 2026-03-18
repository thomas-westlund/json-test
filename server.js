const express = require('express');
const path = require('path');
const fs = require('fs');
const { runPipeline, extractPaths } = require('./transforms');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── File helpers ────────────────────────────────────────────────────────────

function readJSON(filename) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, filename), 'utf8'));
}

function writeJSON(filename, data) {
  fs.writeFileSync(path.join(__dirname, filename), JSON.stringify(data, null, 2));
}

// ── Source / Target file endpoints ─────────────────────────────────────────

app.get('/api/source', (req, res) => {
  try { res.json({ data: readJSON('source.json') }); }
  catch (e) { res.json({ data: null, error: e.message }); }
});

app.get('/api/target', (req, res) => {
  try { res.json({ data: readJSON('target.json') }); }
  catch (e) { res.json({ data: null, error: e.message }); }
});

app.post('/api/source', (req, res) => {
  try { writeJSON('source.json', req.body.data); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/target', (req, res) => {
  try { writeJSON('target.json', req.body.data); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Origin endpoint ─────────────────────────────────────────────────────────

app.get('/api/origin', (req, res) => {
  try { res.json({ data: readJSON('origin.json') }); }
  catch (e) { res.json({ data: [], error: e.message }); }
});

app.post('/api/origin', (req, res) => {
  try { writeJSON('origin.json', req.body.data); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Transformation (mapping + pipeline) ───────────────────────────────────

app.get('/api/transformation', (req, res) => {
  try { res.json(readJSON('transformation.json')); }
  catch (e) { res.json({ mappings: [], steps: [], fieldMeta: {}, originMappings: [] }); }
});

app.post('/api/transformation', (req, res) => {
  try { writeJSON('transformation.json', req.body); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Draw.io diagram export (3-column: Origin → Source → Target) ────────────

app.post('/api/export/drawio', (req, res) => {
  const { mappings = [], sourcePaths = [], targetPaths = [],
          originData = [], originMappings = [], requiredFields = [] } = req.body;
  const xml = generateDrawioXML(mappings, sourcePaths, targetPaths, originData, originMappings, requiredFields);
  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Content-Disposition', 'attachment; filename="mapping.drawio"');
  res.send(xml);
});

function escXml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function generateDrawioXML(mappings, sourcePaths, targetPaths, originData = [], originMappings = [], requiredFields = []) {
  const ROW_H   = 28;
  const HDR_H   = 36;
  const START_Y = 60;

  const reqSet = new Set(requiredFields);

  const srcFields = [...new Set([...sourcePaths, ...mappings.map(m => m.src)])];
  const dstFields = [...new Set([...targetPaths, ...mappings.map(m => m.dst)])];

  // ── Dynamic column width: fit the longest label ──────────────────────────
  // Origin labels = "System / Table / Field"  (+ optional " ★ required" suffix is dst only)
  const CHARS_PER_PX = 6.8;  // approx width of monospace 11px char
  const PADDING      = 40;   // spacingLeft + right margin
  const origLabels = originData.map(r => [r.sourceSystem, r.table, r.field].filter(Boolean).join(' / ') || '(empty)');
  const dstLabels  = dstFields.map(f => reqSet.has(f) ? f + '  ★ required' : f);
  const allLabels  = [...origLabels, ...srcFields, ...dstLabels];
  const maxChars   = Math.max(20, ...allLabels.map(l => l.length));
  const COL_W      = Math.max(260, Math.ceil(maxChars * CHARS_PER_PX) + PADDING);

  // ── Gaps: 50% wider than the former 130px baseline ───────────────────────
  const GAP   = 195;

  const origX = 50;
  const srcX  = origX + COL_W + GAP;
  const dstX  = srcX  + COL_W + GAP;

  const san = s => 'id_' + String(s).replace(/[^a-zA-Z0-9]/g, '_');

  const row = (id, val, y, fill, stroke, extra, parent) => {
    const style = [
      'text', 'align=left', 'verticalAlign=middle', 'spacingLeft=8',
      'fontSize=11', 'fontFamily=Courier New',
      `fillColor=${fill}`, `strokeColor=${stroke}`,
      extra,
    ].filter(Boolean).join(';');
    return `<mxCell id="${id}" value="${escXml(val)}" style="${style};" vertex="1" parent="${parent}"><mxGeometry y="${y}" width="${COL_W}" height="${ROW_H}" as="geometry"/></mxCell>`;
  };

  const origH = HDR_H + Math.max(originData.length, 1) * ROW_H;
  const srcH  = HDR_H + Math.max(srcFields.length,  1) * ROW_H;
  const dstH  = HDR_H + Math.max(dstFields.length,  1) * ROW_H;

  let cells = '';

  // ── Origin swimlane ──
  if (originData.length > 0) {
    cells += `<mxCell id="orig_box" value="Origin" style="swimlane;startSize=${HDR_H};fillColor=#ecebff;strokeColor=#7b68ee;fontStyle=1;fontSize=13;" vertex="1" parent="1"><mxGeometry x="${origX}" y="${START_Y}" width="${COL_W}" height="${origH}" as="geometry"/></mxCell>`;
    originData.forEach((r, i) => {
      const label  = origLabels[i];
      const mapped = originMappings.some(m => m.originId === r.id);
      cells += row(`orig_${i}`, label, HDR_H + i * ROW_H,
        mapped ? '#d5e8d4' : 'none', '#7b68ee', '', 'orig_box');
    });
  }

  // ── Source swimlane ──
  cells += `<mxCell id="src_box" value="Source (source.json)" style="swimlane;startSize=${HDR_H};fillColor=#dde8fc;strokeColor=#6c8ebf;fontStyle=1;fontSize=13;" vertex="1" parent="1"><mxGeometry x="${srcX}" y="${START_Y}" width="${COL_W}" height="${srcH}" as="geometry"/></mxCell>`;
  srcFields.forEach((f, i) => {
    const mapped = mappings.some(m => m.src === f) || originMappings.some(m => m.srcPath === f);
    cells += row(`src_${san(f)}_${i}`, f, HDR_H + i * ROW_H,
      mapped ? '#d5e8d4' : 'none', '#6c8ebf', '', 'src_box');
  });

  // ── Target swimlane ──
  cells += `<mxCell id="dst_box" value="Target (target.json)" style="swimlane;startSize=${HDR_H};fillColor=#d5e8d4;strokeColor=#82b366;fontStyle=1;fontSize=13;" vertex="1" parent="1"><mxGeometry x="${dstX}" y="${START_Y}" width="${COL_W}" height="${dstH}" as="geometry"/></mxCell>`;
  dstFields.forEach((f, i) => {
    const mapped   = mappings.some(m => m.dst === f);
    const required = reqSet.has(f);
    // Label: append annotation tags
    let label = f;
    if (!mapped)   label += '  ⚠ unmapped';
    if (required)  label += '  ★ required';
    // Fill: required-unmapped = pale red, required-mapped = pale gold, unmapped = pale orange, mapped = pale green
    let fill   = mapped ? '#d5e8d4' : '#fff2cc';        // green or yellow
    let stroke = '#82b366';
    let extra  = '';
    if (required && mapped)   { fill = '#ffe6cc'; stroke = '#d6b656'; }  // gold
    if (required && !mapped)  { fill = '#ffd7d7'; stroke = '#ae4132'; extra = 'fontStyle=1'; }  // red, bold
    cells += row(`dst_${san(f)}_${i}`, label, HDR_H + i * ROW_H, fill, stroke, extra, 'dst_box');
  });

  // ── Origin → Source edges (dashed) ──
  originMappings.forEach((om, i) => {
    const origIdx = originData.findIndex(r => r.id === om.originId);
    const srcIdx  = srcFields.indexOf(om.srcPath);
    if (origIdx === -1 || srcIdx === -1) return;
    cells += `<mxCell id="oe_${i}" style="curved=1;rounded=1;dashed=1;strokeColor=#7b68ee;strokeWidth=1.5;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;" edge="1" source="orig_${origIdx}" target="src_${san(srcFields[srcIdx])}_${srcIdx}" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>`;
  });

  // ── Source → Target edges (solid) ──
  mappings.forEach((m, i) => {
    const si = srcFields.indexOf(m.src);
    const di = dstFields.indexOf(m.dst);
    if (si === -1 || di === -1) return;
    cells += `<mxCell id="se_${i}" style="curved=1;rounded=1;strokeColor=#6c63ff;strokeWidth=2;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;" edge="1" source="src_${san(m.src)}_${si}" target="dst_${san(m.dst)}_${di}" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>`;
  });

  const totalW = dstX + COL_W + 50;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<mxGraphModel dx="1422" dy="762" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${totalW}" pageHeight="1169" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
}

// ── Existing pipeline endpoints ─────────────────────────────────────────────

app.post('/api/transform', (req, res) => {
  const { source, steps } = req.body;
  if (source === undefined) return res.status(400).json({ error: 'Missing source' });
  if (!Array.isArray(steps)) return res.status(400).json({ error: 'steps must be an array' });
  try {
    const { result, logs } = runPipeline(source, steps);
    res.json({ result, logs });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/fields', (req, res) => {
  const { source } = req.body;
  if (source === undefined) return res.status(400).json({ error: 'Missing source' });
  try { res.json({ fields: extractPaths(source) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/suggest-mapping', (req, res) => {
  const { sourceFields = [], destFields = [] } = req.body;
  const normalize = (s) => s.toLowerCase().replace(/[_\-. \[\]]/g, '');
  const mapping = {};
  for (const dest of destFields) {
    const nd = normalize(dest);
    let match = sourceFields.find(s => s === dest)
      || sourceFields.find(s => normalize(s) === nd)
      || sourceFields.find(s => normalize(s).endsWith(nd))
      || sourceFields.find(s => nd.endsWith(normalize(s)));
    if (match) mapping[dest] = match;
  }
  res.json({ mapping });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`JSON ETL Studio running at http://localhost:${PORT}`));
