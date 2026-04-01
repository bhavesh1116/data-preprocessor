// ── INSIGHTS.JS ──────────────────────────────────────────
// Generates Health Score, Data Story, Column insights, Noise Summary

const Insights = (() => {

  // ── Health Score ─────────────────────────────────────────
  function healthScore(headers, rows, analysis) {
    const total = rows.length;
    const totalCells = total * headers.length;

    let nullCells = 0;
    headers.forEach(h => { nullCells += analysis.columns[h].stats.nullCount || 0; });
    const completeness = Math.max(0, 100 - (nullCells / Math.max(totalCells, 1)) * 100);

    const seen = new Set(rows.map(r => JSON.stringify(r)));
    const uniqueness = (seen.size / Math.max(total, 1)) * 100;

    let validCells = 0, checkCells = 0;
    headers.forEach(h => {
      const { stats } = analysis.columns[h];
      checkCells += stats.count;
      validCells += stats.count;
    });
    const validity = checkCells > 0 ? (validCells / checkCells) * 100 : 100;
    const uniformity = Math.min(100, validity - headers.filter(h => analysis.columns[h].type === 'text').length * 2);

    let totalOutliers = 0, numericCols = 0;
    headers.forEach(h => {
      const {type, stats} = analysis.columns[h];
      if (type === 'numeric' && stats.outliers !== undefined) { totalOutliers += stats.outliers; numericCols++; }
    });
    const outlierPct = numericCols > 0 ? (totalOutliers / Math.max(total * numericCols, 1)) * 100 : 0;
    const outlierSafety = Math.max(0, 100 - outlierPct * 2);

    const overall = Math.round((completeness * 0.3 + uniqueness * 0.25 + validity * 0.2 + uniformity * 0.15 + outlierSafety * 0.1));

    return {
      overall,
      axes: {
        Completeness: Math.round(completeness),
        Uniqueness: Math.round(uniqueness),
        Validity: Math.round(validity),
        Uniformity: Math.round(Math.min(100, Math.max(0, uniformity))),
        'Outlier Safety': Math.round(Math.min(100, Math.max(0, outlierSafety)))
      }
    };
  }

  // ── Noise Summary (NEW) ───────────────────────────────────
  function getNoiseSummary(headers, rows, analysis) {
    const total = rows.length;

    // --- Nulls ---
    const nullDetails = [];
    let totalNulls = 0;
    headers.forEach(h => {
      const n = analysis.columns[h].stats.nullCount || 0;
      if (n > 0) { nullDetails.push({ col: h, count: n, pct: (n / total * 100).toFixed(1) }); totalNulls += n; }
    });
    nullDetails.sort((a, b) => b.count - a.count);
    const nullPct = (totalNulls / Math.max(total * headers.length, 1) * 100);

    // --- Duplicates ---
    const seen = new Set();
    let dupCount = 0;
    rows.forEach(r => { const k = JSON.stringify(r); if (seen.has(k)) dupCount++; else seen.add(k); });
    const dupPct = (dupCount / Math.max(total, 1) * 100);

    // --- Outliers ---
    const outlierDetails = [];
    let totalOutliers = 0;
    headers.forEach(h => {
      const { type, stats } = analysis.columns[h];
      if (type === 'numeric' && stats.outliers > 0) {
        outlierDetails.push({ col: h, count: stats.outliers, pct: (stats.outliers / total * 100).toFixed(1) });
        totalOutliers += stats.outliers;
      }
    });
    outlierDetails.sort((a, b) => b.count - a.count);
    const outlierPct = (totalOutliers / Math.max(total * headers.filter(h => analysis.columns[h].type === 'numeric').length || 1, 1) * 100);

    // --- Type Issues (mixed/empty columns) ---
    const typeIssues = [];
    headers.forEach(h => {
      if (analysis.columns[h].type === 'empty') typeIssues.push({ col: h, issue: 'All empty' });
      else if (analysis.columns[h].stats.unique === 1 && analysis.columns[h].stats.count > 10)
        typeIssues.push({ col: h, issue: 'Constant column' });
    });

    // Noise score (0=clean, 100=terrible)
    const noiseScore = Math.min(100, Math.round(
      nullPct * 0.35 + dupPct * 0.3 + outlierPct * 0.25 + typeIssues.length * 3
    ));

    return {
      noiseScore,
      nulls: { totalNulls, pct: nullPct.toFixed(1), details: nullDetails },
      duplicates: { count: dupCount, pct: dupPct.toFixed(1) },
      outliers: { total: totalOutliers, pct: outlierPct.toFixed(1), details: outlierDetails },
      typeIssues: { count: typeIssues.length, details: typeIssues },
      totalRows: total, totalCols: headers.length
    };
  }

  // ── Data Story Narrator ──────────────────────────────────
  function generateStory(headers, rows, analysis, processStats) {
    const total = rows.length;
    const cols = headers.length;

    let worstCol = null, worstNulls = 0;
    headers.forEach(h => {
      const n = analysis.columns[h].stats.nullCount || 0;
      if (n > worstNulls) { worstNulls = n; worstCol = h; }
    });

    const numericCols = headers.filter(h => analysis.columns[h].type === 'numeric');
    const textCols = headers.filter(h => analysis.columns[h].type !== 'numeric');

    const semantics = headers.filter(h => analysis.columns[h].semantic).map(h =>
      `<span class="story-highlight">${h}</span> (${analysis.columns[h].semantic})`);

    const dupStr = processStats?.dupRemoved
      ? `<span class="story-warn">⚠ ${processStats.dupRemoved} duplicate row${processStats.dupRemoved > 1 ? 's' : ''} were removed.</span> `
      : '';

    const nullStr = worstCol && worstNulls > 0
      ? `The column <span class="story-highlight">"${worstCol}"</span> had the most missing values (<span class="story-warn">${worstNulls} nulls, ${(worstNulls/total*100).toFixed(1)}%</span>), which were auto-filled using intelligent defaults. `
      : `<span class="story-good">✓ No significant null values detected.</span> `;

    const semanticStr = semantics.length > 0
      ? `Smart detection identified: ${semantics.join(', ')}. `
      : '';

    const outlierCol = numericCols.find(h => (analysis.columns[h].stats.outliers || 0) > 0);
    const outlierStr = outlierCol
      ? `The numeric column <span class="story-highlight">"${outlierCol}"</span> contains <span class="story-warn">${analysis.columns[outlierCol].stats.outliers} outlier${analysis.columns[outlierCol].stats.outliers > 1 ? 's' : ''}</span> (detected via IQR method). `
      : '';

    const fillStr = processStats?.fillCount > 0
      ? `<span class="story-good">✓ ${processStats.fillCount} missing value${processStats.fillCount > 1 ? 's' : ''} were filled automatically.</span> `
      : '';

    return `Your dataset contains <span class="story-highlight">${total.toLocaleString()} rows</span> across <span class="story-highlight">${cols} columns</span> — with ${numericCols.length} numeric and ${textCols.length} categorical/text columns.
${dupStr}${nullStr}${outlierStr}${fillStr}${semanticStr}Data is now <span class="story-good">cleaned and ready for analysis</span>.`;
  }

  // ── DNA Fingerprint colors ───────────────────────────────
  function getDNAColors(values, type) {
    const segments = 20;
    const nonEmpty = values.filter(v => v !== '');
    const colors = [];
    if (type === 'numeric') {
      const nums = nonEmpty.map(Number).filter(n => !isNaN(n));
      if (!nums.length) return Array(segments).fill('#333');
      const min = Math.min(...nums), max = Math.max(...nums);
      const buckets = Array(segments).fill(0);
      nums.forEach(n => {
        const idx = Math.min(segments - 1, Math.floor(((n - min) / Math.max(max - min, 1)) * segments));
        buckets[idx]++;
      });
      const maxB = Math.max(...buckets);
      return buckets.map((b) => {
        const intensity = maxB > 0 ? b / maxB : 0;
        const r = Math.round(124 + (6 - 124) * intensity);
        const g = Math.round(58 + (182 - 58) * intensity);
        const b2 = Math.round(237 + (212 - 237) * intensity);
        return `rgba(${r},${g},${b2},${0.3 + intensity * 0.7})`;
      });
    } else {
      const freq = {};
      nonEmpty.forEach(v => { freq[v] = (freq[v] || 0) + 1; });
      const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
      const palette = ['#7c3aed','#06b6d4','#10b981','#f59e0b','#ef4444','#a855f7','#0ea5e9','#34d399'];
      let seg = 0;
      for (let i = 0; i < Math.min(sorted.length, palette.length); i++) {
        const share = sorted[i][1] / nonEmpty.length;
        const count = Math.max(1, Math.round(share * segments));
        for (let j = 0; j < count && seg < segments; j++, seg++) colors.push(palette[i]);
      }
      while (colors.length < segments) colors.push('#1e2030');
      return colors.slice(0, segments);
    }
  }

  return { healthScore, generateStory, getDNAColors, getNoiseSummary };
})();
