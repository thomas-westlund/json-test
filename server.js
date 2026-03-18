const express = require('express');
const path = require('path');
const { runPipeline, extractPaths } = require('./transforms');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/**
 * POST /api/transform
 * Body: { source: any, steps: Step[] }
 * Returns: { result, logs }
 */
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

/**
 * POST /api/fields
 * Body: { source: any }
 * Returns: { fields: string[] }  — all leaf paths in the source
 */
app.post('/api/fields', (req, res) => {
  const { source } = req.body;
  if (source === undefined) return res.status(400).json({ error: 'Missing source' });
  try {
    const fields = extractPaths(source);
    res.json({ fields });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/suggest-mapping
 * Body: { sourceFields: string[], destFields: string[] }
 * Returns: { mapping: { dest: src } }
 * Simple heuristic: exact match → normalized match → fuzzy match
 */
app.post('/api/suggest-mapping', (req, res) => {
  const { sourceFields = [], destFields = [] } = req.body;

  const normalize = (s) => s.toLowerCase().replace(/[_\-. ]/g, '');

  const mapping = {};
  for (const dest of destFields) {
    const normDest = normalize(dest);
    // 1. Exact match
    let match = sourceFields.find((s) => s === dest);
    // 2. Normalized match
    if (!match) match = sourceFields.find((s) => normalize(s) === normDest);
    // 3. Suffix match (e.g. "user.name" matches "name")
    if (!match) match = sourceFields.find((s) => normalize(s).endsWith(normDest));
    // 4. Prefix match
    if (!match) match = sourceFields.find((s) => normDest.endsWith(normalize(s)));

    if (match) mapping[dest] = match;
  }

  res.json({ mapping });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`JSON ETL running at http://localhost:${PORT}`));
