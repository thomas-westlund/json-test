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

// ── Transformation (mapping + pipeline) ───────────────────────────────────

app.get('/api/transformation', (req, res) => {
  try { res.json(readJSON('transformation.json')); }
  catch (e) { res.json({ mappings: [], steps: [] }); }
});

app.post('/api/transformation', (req, res) => {
  try { writeJSON('transformation.json', req.body); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Draw.io diagram export ─────────────────────────────────────────────────

app.post('/api/export/drawio', (req, res) => {
  const { mappings = [], sourcePaths = [], targetPaths = [] } = req.body;
  const xml = generateDrawioXML(mappings, sourcePaths, targetPaths);
  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Content-Disposition', 'attachment; filename="mapping.drawio"');
  res.send(xml);
});

function escXml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function generateDrawioXML(mappings, sourcePaths, targetPaths) {
  const ROW_H = 26;
  const HEADER_H = 32;
  const COL_W = 240;
  const GAP = 180;
  const START_X = 60;
  const START_Y = 60;

  // Collect all unique fields that appear in mappings, merged with known paths
  const srcFields = [...new Set([...sourcePaths, ...mappings.map(m => m.src)])];
  const dstFields = [...new Set([...targetPaths, ...mappings.map(m => m.dst)])];

  const srcH = HEADER_H + srcFields.length * ROW_H;
  const dstH = HEADER_H + dstFields.length * ROW_H;
  const dstX = START_X + COL_W + GAP;

  const sanitize = (s) => 'id_' + s.replace(/[^a-zA-Z0-9]/g, '_');

  let cells = '';

  // Source swimlane
  cells += `<mxCell id="src_box" value="Source (source.json)" style="swimlane;startSize=${HEADER_H};fillColor=#dae8fc;strokeColor=#6c8ebf;fontStyle=1;fontSize=13;" vertex="1" parent="1"><mxGeometry x="${START_X}" y="${START_Y}" width="${COL_W}" height="${srcH}" as="geometry"/></mxCell>`;

  srcFields.forEach((field, i) => {
    const isMapped = mappings.some(m => m.src === field);
    const fill = isMapped ? '#d5e8d4' : 'none';
    const stroke = isMapped ? '#82b366' : '#6c8ebf';
    const id = `src_${sanitize(field)}_${i}`;
    cells += `<mxCell id="${id}" value="${escXml(field)}" style="text;align=left;verticalAlign=middle;spacingLeft=8;fontSize=11;fontFamily=Courier New;fillColor=${fill};strokeColor=${stroke};" vertex="1" parent="src_box"><mxGeometry y="${HEADER_H + i * ROW_H}" width="${COL_W}" height="${ROW_H}" as="geometry"/></mxCell>`;
  });

  // Target swimlane
  cells += `<mxCell id="dst_box" value="Target (target.json)" style="swimlane;startSize=${HEADER_H};fillColor=#d5e8d4;strokeColor=#82b366;fontStyle=1;fontSize=13;" vertex="1" parent="1"><mxGeometry x="${dstX}" y="${START_Y}" width="${COL_W}" height="${dstH}" as="geometry"/></mxCell>`;

  dstFields.forEach((field, i) => {
    const isMapped = mappings.some(m => m.dst === field);
    const fill = isMapped ? '#d5e8d4' : 'none';
    const stroke = isMapped ? '#82b366' : '#82b366';
    const id = `dst_${sanitize(field)}_${i}`;
    cells += `<mxCell id="${id}" value="${escXml(field)}" style="text;align=left;verticalAlign=middle;spacingLeft=8;fontSize=11;fontFamily=Courier New;fillColor=${fill};strokeColor=${stroke};" vertex="1" parent="dst_box"><mxGeometry y="${HEADER_H + i * ROW_H}" width="${COL_W}" height="${ROW_H}" as="geometry"/></mxCell>`;
  });

  // Edges for each mapping
  mappings.forEach((mapping, i) => {
    const srcIdx = srcFields.indexOf(mapping.src);
    const dstIdx = dstFields.indexOf(mapping.dst);
    if (srcIdx === -1 || dstIdx === -1) return;
    const srcId = `src_${sanitize(mapping.src)}_${srcIdx}`;
    const dstId = `dst_${sanitize(mapping.dst)}_${dstIdx}`;
    cells += `<mxCell id="edge_${i}" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;strokeColor=#6c63ff;strokeWidth=2;" edge="1" source="${srcId}" target="${dstId}" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>\n<mxGraphModel dx="1422" dy="762" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
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
