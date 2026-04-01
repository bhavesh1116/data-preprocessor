// ── NLQ.JS ───────────────────────────────────────────────
// Natural Language Query engine for filtering data

const NLQ = (() => {
  const EXAMPLES = [
    'Show rows where age is missing',
    'Filter salary greater than 50000',
    'Count unique values in city',
    'Show top 10 rows',
    'Find duplicates',
    'Show rows where country is India',
    'Find outliers in price',
  ];

  function parse(query, headers, rows, analysis) {
    const q = query.toLowerCase().trim();
    let result = { type: null, rows: null, message: '', query };

    // NULL / MISSING ─────────────────────────────────────
    const nullMatch = q.match(/(?:where\s+)?(\w[\w\s]*?)\s+(?:is\s+)?(?:missing|null|empty|blank)/i);
    if (nullMatch) {
      const colName = findCol(nullMatch[1].trim(), headers);
      if (colName) {
        const filtered = rows.filter(r => !r[colName] || r[colName] === '' || r[colName] === 'N/A');
        return { type: 'filter', rows: filtered, message: `Found <b>${filtered.length}</b> rows where <b>${colName}</b> is missing`, query };
      }
    }

    // GREATER THAN ───────────────────────────────────────
    const gtMatch = q.match(/(\w[\w\s]*?)\s+(?:greater than|more than|above|>)\s+([\d\.]+)/i);
    if (gtMatch) {
      const colName = findCol(gtMatch[1].trim(), headers);
      const val = parseFloat(gtMatch[2]);
      if (colName && !isNaN(val)) {
        const filtered = rows.filter(r => parseFloat(r[colName]) > val);
        return { type: 'filter', rows: filtered, message: `Found <b>${filtered.length}</b> rows where <b>${colName}</b> &gt; ${val}`, query };
      }
    }

    // LESS THAN ──────────────────────────────────────────
    const ltMatch = q.match(/(\w[\w\s]*?)\s+(?:less than|below|<)\s+([\d\.]+)/i);
    if (ltMatch) {
      const colName = findCol(ltMatch[1].trim(), headers);
      const val = parseFloat(ltMatch[2]);
      if (colName && !isNaN(val)) {
        const filtered = rows.filter(r => parseFloat(r[colName]) < val);
        return { type: 'filter', rows: filtered, message: `Found <b>${filtered.length}</b> rows where <b>${colName}</b> &lt; ${val}`, query };
      }
    }

    // EQUALS / IS ────────────────────────────────────────
    const eqMatch = q.match(/(?:where\s+)?(\w[\w\s]*?)\s+(?:is|=|equals?)\s+["""']?([^"""']+)["""']?/i);
    if (eqMatch) {
      const colName = findCol(eqMatch[1].trim(), headers);
      const val = eqMatch[2].trim();
      if (colName && val && val !== 'missing' && val !== 'null') {
        const filtered = rows.filter(r => String(r[colName]).toLowerCase() === val.toLowerCase());
        return { type: 'filter', rows: filtered, message: `Found <b>${filtered.length}</b> rows where <b>${colName}</b> = "${val}"`, query };
      }
    }

    // CONTAINS ───────────────────────────────────────────
    const containsMatch = q.match(/(\w[\w\s]*?)\s+contains?\s+["""']?([^"""']+)["""']?/i);
    if (containsMatch) {
      const colName = findCol(containsMatch[1].trim(), headers);
      const val = containsMatch[2].trim();
      if (colName) {
        const filtered = rows.filter(r => String(r[colName]).toLowerCase().includes(val.toLowerCase()));
        return { type: 'filter', rows: filtered, message: `Found <b>${filtered.length}</b> rows where <b>${colName}</b> contains "${val}"`, query };
      }
    }

    // COUNT UNIQUE ───────────────────────────────────────
    const countUniqueMatch = q.match(/(?:count\s+)?unique\s+(?:values?\s+)?(?:in\s+)?(\w[\w\s]*)/i);
    if (countUniqueMatch) {
      const colName = findCol(countUniqueMatch[1].trim(), headers);
      if (colName) {
        const unique = new Set(rows.map(r => r[colName])).size;
        const freq = {};
        rows.forEach(r => { freq[r[colName]] = (freq[r[colName]] || 0) + 1; });
        const top5 = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5);
        return { type: 'count', rows: null, count: unique, colName, top5, message: `<b>${colName}</b> has <b>${unique}</b> unique values`, query };
      }
    }

    // TOP N ──────────────────────────────────────────────
    const topMatch = q.match(/(?:show\s+)?top\s+(\d+)/i);
    if (topMatch) {
      const n = parseInt(topMatch[1]);
      return { type: 'filter', rows: rows.slice(0, n), message: `Showing top <b>${n}</b> rows`, query };
    }

    // DUPLICATES ─────────────────────────────────────────
    if (q.includes('duplicate')) {
      const seen = new Set(), dupes = [];
      rows.forEach(r => {
        const key = JSON.stringify(r);
        if (seen.has(key)) dupes.push(r);
        else seen.add(key);
      });
      return { type: 'filter', rows: dupes, message: `Found <b>${dupes.length}</b> duplicate rows`, query };
    }

    // OUTLIERS ─────────────────────────────────────────
    const outlierMatch = q.match(/(?:find\s+)?outliers?\s+(?:in\s+)?(\w[\w\s]*)/i);
    if (outlierMatch) {
      const colName = findCol(outlierMatch[1].trim(), headers);
      if (colName && analysis && analysis.columns[colName]) {
        const { q1, q3, iqr } = analysis.columns[colName].stats;
        if (q1 !== undefined) {
          const filtered = rows.filter(r => {
            const n = parseFloat(r[colName]);
            return !isNaN(n) && (n < q1 - 1.5 * iqr || n > q3 + 1.5 * iqr);
          });
          return { type: 'filter', rows: filtered, message: `Found <b>${filtered.length}</b> outlier rows in <b>${colName}</b>`, query };
        }
      }
    }

    return { type: 'error', rows: null, message: `Could not understand query. Try: "${EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)]}"`, query };
  }

  function findCol(name, headers) {
    // Exact match
    let match = headers.find(h => h.toLowerCase() === name.toLowerCase());
    if (match) return match;
    // Partial match
    match = headers.find(h => h.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(h.toLowerCase()));
    return match || null;
  }

  return { parse, EXAMPLES };
})();
