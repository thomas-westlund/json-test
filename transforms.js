/**
 * Core ETL transform functions
 */

/**
 * Flatten a nested object using dot-notation keys.
 * { a: { b: { c: 1 } } } => { "a.b.c": 1 }
 */
function flatten(obj, separator = '.', prefix = '', result = {}) {
  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}${separator}${key}` : key;
    const val = obj[key];
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      flatten(val, separator, fullKey, result);
    } else {
      result[fullKey] = val;
    }
  }
  return result;
}

/**
 * Get a nested value by dot-path: get({ a: { b: 1 } }, 'a.b') => 1
 */
function getPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc != null ? acc[key] : undefined), obj);
}

/**
 * Set a nested value by dot-path: set({}, 'a.b', 1) => { a: { b: 1 } }
 */
function setPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null || typeof cur[keys[i]] !== 'object') {
      cur[keys[i]] = {};
    }
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
  return obj;
}

/**
 * Map/rename fields according to a mapping config.
 * mapping: { "destField": "sourcePath" }
 * Works on a single record or an array of records.
 * If destPath is a dot-path, it creates nested structure.
 * If sourcePath contains a template like "{first} {last}", it interpolates.
 */
function mapFields(data, mapping) {
  const applyMapping = (record) => {
    const out = {};
    for (const [dest, src] of Object.entries(mapping)) {
      // Template interpolation: "{field1} {field2}"
      if (typeof src === 'string' && src.includes('{')) {
        const interpolated = src.replace(/\{([^}]+)\}/g, (_, path) => {
          const v = getPath(record, path.trim());
          return v != null ? v : '';
        });
        setPath(out, dest, interpolated.trim());
      } else if (typeof src === 'string') {
        const val = getPath(record, src);
        if (val !== undefined) setPath(out, dest, val);
      } else if (typeof src === 'object' && src !== null) {
        // Support { _const: "value" } for static values
        if (src._const !== undefined) {
          setPath(out, dest, src._const);
        }
      }
    }
    return out;
  };

  return Array.isArray(data) ? data.map(applyMapping) : applyMapping(data);
}

/**
 * Aggregate records by a groupBy field.
 * aggregations: [{ field: "price", op: "sum"|"avg"|"min"|"max"|"count", as: "totalPrice" }]
 */
function aggregate(data, groupByField, aggregations) {
  if (!Array.isArray(data)) throw new Error('Aggregate requires an array of records');

  const groups = {};
  for (const record of data) {
    const key = groupByField ? String(getPath(record, groupByField) ?? '__all__') : '__all__';
    if (!groups[key]) groups[key] = { _key: key, _records: [] };
    groups[key]._records.push(record);
  }

  return Object.values(groups).map(({ _key, _records }) => {
    const out = {};
    if (groupByField) setPath(out, groupByField, _key === '__all__' ? null : _key);

    for (const agg of aggregations) {
      const values = _records
        .map((r) => getPath(r, agg.field))
        .filter((v) => v != null && !isNaN(Number(v)))
        .map(Number);

      const destKey = agg.as || `${agg.op}_${agg.field}`;
      if (agg.op === 'count') {
        out[destKey] = _records.length;
      } else if (agg.op === 'sum') {
        out[destKey] = values.reduce((a, b) => a + b, 0);
      } else if (agg.op === 'avg') {
        out[destKey] = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
      } else if (agg.op === 'min') {
        out[destKey] = values.length ? Math.min(...values) : null;
      } else if (agg.op === 'max') {
        out[destKey] = values.length ? Math.max(...values) : null;
      }
    }
    return out;
  });
}

/**
 * Filter records by conditions.
 * conditions: [{ field: "age", op: "gt"|"lt"|"eq"|"neq"|"contains"|"exists", value: 18 }]
 */
function filterRecords(data, conditions) {
  if (!Array.isArray(data)) throw new Error('Filter requires an array of records');

  return data.filter((record) => {
    return conditions.every((cond) => {
      const val = getPath(record, cond.field);
      switch (cond.op) {
        case 'eq':    return val == cond.value;
        case 'neq':   return val != cond.value;
        case 'gt':    return Number(val) > Number(cond.value);
        case 'gte':   return Number(val) >= Number(cond.value);
        case 'lt':    return Number(val) < Number(cond.value);
        case 'lte':   return Number(val) <= Number(cond.value);
        case 'contains': return String(val ?? '').includes(String(cond.value));
        case 'exists': return val != null;
        case 'missing': return val == null;
        default:      return true;
      }
    });
  });
}

/**
 * Extract all leaf key paths from a JSON object (for field discovery).
 */
function extractPaths(obj, prefix = '') {
  const paths = [];
  if (obj === null || typeof obj !== 'object') return [prefix || '.'];
  if (Array.isArray(obj)) {
    if (obj.length > 0) return extractPaths(obj[0], prefix);
    return [prefix];
  }
  for (const key of Object.keys(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    const child = obj[key];
    if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
      paths.push(...extractPaths(child, full));
    } else if (Array.isArray(child) && child.length > 0 && typeof child[0] === 'object') {
      paths.push(...extractPaths(child[0], full));
    } else {
      paths.push(full);
    }
  }
  return paths;
}

/**
 * Run a pipeline of steps against source data.
 * steps: Array of { type, ...config }
 *   - { type: "flatten", separator: "." }
 *   - { type: "mapFields", mapping: { dest: src } }
 *   - { type: "filter", conditions: [...] }
 *   - { type: "aggregate", groupBy: "field", aggregations: [...] }
 */
function runPipeline(data, steps) {
  let result = data;
  const logs = [];

  for (const step of steps) {
    try {
      if (step.type === 'flatten') {
        const sep = step.separator || '.';
        if (Array.isArray(result)) {
          result = result.map((r) => flatten(r, sep));
        } else {
          result = flatten(result, sep);
        }
        logs.push({ step: step.type, status: 'ok' });
      } else if (step.type === 'mapFields') {
        result = mapFields(result, step.mapping || {});
        logs.push({ step: step.type, status: 'ok' });
      } else if (step.type === 'filter') {
        result = filterRecords(result, step.conditions || []);
        logs.push({ step: step.type, status: 'ok', recordsOut: result.length });
      } else if (step.type === 'aggregate') {
        result = aggregate(result, step.groupBy, step.aggregations || []);
        logs.push({ step: step.type, status: 'ok', groups: result.length });
      } else {
        logs.push({ step: step.type, status: 'skipped', reason: 'unknown step type' });
      }
    } catch (err) {
      logs.push({ step: step.type, status: 'error', error: err.message });
      throw err;
    }
  }

  return { result, logs };
}

module.exports = { flatten, mapFields, filterRecords, aggregate, runPipeline, extractPaths, getPath };
