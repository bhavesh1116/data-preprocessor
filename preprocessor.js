// ── PREPROCESSOR.JS ──────────────────────────────────────
// Data cleaning pipeline: type inference, null filling, dedup, outliers
// Supports custom strategies: nulls (median/mean/mode/drop/unknown),
//   dups (remove_all/keep_first/keep), outliers (keep/cap/mean/median/remove)

const Preprocessor = (() => {

  // ── Type Inference ──────────────────────────────────────
  function inferType(values) {
    const nonEmpty = values.filter(v => v !== '' && v !== null && v !== undefined);
    if (!nonEmpty.length) return 'empty';
    const numericCount = nonEmpty.filter(v => !isNaN(parseFloat(v)) && isFinite(v)).length;
    const ratio = numericCount / nonEmpty.length;
    if (ratio >= 0.85) return 'numeric';
    const dateCount = nonEmpty.filter(v => {
      const d = new Date(v);
      return !isNaN(d.getTime()) && v.length > 3;
    }).length;
    if (dateCount / nonEmpty.length >= 0.7) return 'date';
    if (nonEmpty.every(v => v.length <= 2 && nonEmpty.filter(x => x === v).length > 1)) return 'categorical';
    return 'text';
  }

  // ── Semantic Detection ──────────────────────────────────
  const SEMANTIC_PATTERNS = [
    { name: '📧 Email',    re: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
    { name: '📞 Phone',    re: /^[\+\d][\d\s\-\(\)]{7,}$/ },
    { name: '💰 Currency', re: /^[\$₹€£¥][\d,\.]+$|^\d[\d,\.]+[\$₹€£¥]$/ },
    { name: '🌐 URL',      re: /^https?:\/\//i },
    { name: '🔒 ID/Code',  re: /^[A-Z0-9\-_]{4,20}$/ },
    { name: '🗓️ Date',     re: /\d{4}[-\/]\d{1,2}[-\/]\d{1,2}|\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}/ },
    { name: '📍 ZIP/PIN',  re: /^\d{5,6}$/ },
  ];

  function detectSemantic(values) {
    const sample = values.filter(v => v !== '').slice(0, 50);
    for (const { name, re } of SEMANTIC_PATTERNS) {
      const matches = sample.filter(v => re.test(String(v).trim())).length;
      if (sample.length > 0 && matches / sample.length >= 0.7) return name;
    }
    return null;
  }

  // ── Column Statistics ───────────────────────────────────
  function colStats(values, type) {
    const nonEmpty = values.filter(v => v !== '');
    const nullCount = values.length - nonEmpty.length;
    const nullPct = values.length ? (nullCount / values.length * 100) : 0;
    const unique = new Set(nonEmpty).size;
    let stats = { count: nonEmpty.length, nullCount, nullPct, unique };
    if (type === 'numeric') {
      const nums = nonEmpty.map(Number).filter(n => !isNaN(n));
      if (nums.length) {
        const sorted = [...nums].sort((a, b) => a - b);
        stats.min = sorted[0];
        stats.max = sorted[sorted.length - 1];
        stats.mean = nums.reduce((a, b) => a + b, 0) / nums.length;
        const mid = Math.floor(sorted.length / 2);
        stats.median = sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
        const variance = nums.reduce((s, v) => s + Math.pow(v - stats.mean, 2), 0) / nums.length;
        stats.std = Math.sqrt(variance);
        const q1 = sorted[Math.floor(sorted.length * 0.25)];
        const q3 = sorted[Math.floor(sorted.length * 0.75)];
        const iqr = q3 - q1;
        stats.outliers = nums.filter(n => n < q1 - 1.5 * iqr || n > q3 + 1.5 * iqr).length;
        stats.q1 = q1; stats.q3 = q3; stats.iqr = iqr;
      }
    } else {
      const freq = {};
      nonEmpty.forEach(v => { freq[v] = (freq[v] || 0) + 1; });
      stats.topValues = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5);
    }
    return stats;
  }

  // ── Analyze (before processing) ─────────────────────────
  function analyze(headers, rows) {
    const columns = {};
    headers.forEach(h => {
      const values = rows.map(r => r[h] !== undefined ? String(r[h]).trim() : '');
      const type = inferType(values);
      const semantic = detectSemantic(values);
      const stats = colStats(values, type);
      columns[h] = { type, semantic, stats, values };
    });
    return { columns, totalRows: rows.length, totalCols: headers.length };
  }

  // ── Processing Steps (with strategy support) ─────────────

  function fillMissingValues(rows, headers, analysis, strategy = 'median') {
    let filled = 0;
    const dropIndices = new Set();

    if (strategy === 'drop') {
      // Find rows with any null
      return {
        rows: rows.filter((r, i) => {
          const hasNull = headers.some(h => r[h] === '' || r[h] === null || r[h] === undefined);
          return !hasNull;
        }),
        filled: 0
      };
    }

    const newRows = rows.map(r => {
      const nr = { ...r };
      headers.forEach(h => {
        if (nr[h] === '' || nr[h] === null || nr[h] === undefined) {
          const { type, stats } = analysis.columns[h];
          if (strategy === 'unknown') {
            nr[h] = type === 'numeric' ? '0' : 'Unknown';
            filled++;
          } else if (type === 'numeric') {
            if (strategy === 'mean' && stats.mean !== undefined) {
              nr[h] = String(parseFloat(stats.mean.toFixed(4)));
            } else if (stats.median !== undefined) {
              nr[h] = String(parseFloat(stats.median.toFixed(4)));
            } else {
              nr[h] = '0';
            }
            filled++;
          } else if (type === 'text' || type === 'categorical') {
            if (strategy === 'mode') {
              const top = analysis.columns[h].stats.topValues;
              nr[h] = top && top.length ? top[0][0] : 'Unknown';
            } else {
              nr[h] = 'Unknown';
            }
            filled++;
          } else {
            nr[h] = 'N/A';
            filled++;
          }
        }
      });
      return nr;
    });
    return { rows: newRows, filled };
  }

  function removeDuplicates(rows, strategy = 'remove_all') {
    if (strategy === 'keep') return { rows, removed: 0 };
    const seen = new Set();
    const unique = [];
    rows.forEach(r => {
      const key = JSON.stringify(r);
      if (!seen.has(key)) { seen.add(key); unique.push(r); }
      else if (strategy === 'keep_first') { /* skip */ }
    });
    return { rows: unique, removed: rows.length - unique.length };
  }

  function handleOutliers(rows, headers, analysis, strategy = 'keep') {
    if (strategy === 'keep') return rows;
    return rows.filter((r, ri) => {
      let shouldRemove = false;
      const newR = { ...r };
      headers.forEach(h => {
        const { type, stats } = analysis.columns[h];
        if (type !== 'numeric' || stats.q1 === undefined) return;
        const val = parseFloat(r[h]);
        if (isNaN(val)) return;
        const lo = stats.q1 - 1.5 * stats.iqr;
        const hi = stats.q3 + 1.5 * stats.iqr;
        const isOut = val < lo || val > hi;
        if (!isOut) return;
        if (strategy === 'remove') { shouldRemove = true; }
        else if (strategy === 'cap') { newR[h] = String(val < lo ? lo.toFixed(4) : hi.toFixed(4)); }
        else if (strategy === 'mean') { newR[h] = String(parseFloat(stats.mean.toFixed(4))); }
        else if (strategy === 'median') { newR[h] = String(parseFloat(stats.median.toFixed(4))); }
      });
      if (shouldRemove) return false;
      Object.assign(r, newR);
      return true;
    });
  }

  function fixDataTypes(rows, headers, analysis) {
    return rows.map(r => {
      const nr = { ...r };
      headers.forEach(h => {
        const { type } = analysis.columns[h];
        if (type === 'numeric') {
          const cleaned = String(nr[h]).replace(/[,$₹€£¥\s]/g, '');
          if (!isNaN(parseFloat(cleaned))) nr[h] = cleaned;
        }
      });
      return nr;
    });
  }

  // ── Main Pipeline ────────────────────────────────────────
  async function process(headers, rows, onStep, strategy = {}) {
    const nullStrat = strategy.nulls || 'median';
    const dupStrat = strategy.dups || 'remove_all';
    const outStrat = strategy.outliers || 'keep';

    const steps = [];
    const log = (msg, detail) => { steps.push({ msg, detail }); if (onStep) onStep(steps); };

    log('Analyzing data types', 'Inferring column types and semantics');
    await sleep(350);
    const analysis = analyze(headers, rows);

    log('Removing duplicates', `Strategy: ${dupStrat}`);
    await sleep(400);
    const { rows: deduped, removed: dupRemoved } = removeDuplicates(rows, dupStrat);

    log('Filling missing values', `Strategy: ${nullStrat}`);
    await sleep(450);
    const { rows: filled, filled: fillCount } = fillMissingValues(deduped, headers, analysis, nullStrat);

    log('Normalizing data types', 'Cleaning numeric columns');
    await sleep(300);
    let normalized = fixDataTypes(filled, headers, analysis);

    // Handle outliers
    if (outStrat !== 'keep') {
      normalized = handleOutliers(normalized, headers, analysis, outStrat);
    }

    log('Preprocessing complete', `${dupRemoved} dups removed, ${fillCount} values filled, strategy: nulls=${nullStrat}`);

    return {
      headers, rows: normalized, analysis: analyze(headers, normalized),
      stats: { dupRemoved, fillCount, totalRows: normalized.length, steps }
    };
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  return { analyze, process };
})();
