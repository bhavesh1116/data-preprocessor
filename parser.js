// ── PARSER.JS ─────────────────────────────────────────────
// Handles CSV, TSV, JSON, Excel parsing via PapaParse + SheetJS

const Parser = (() => {
  const FORMATS = {
    csv:  { icon: '📄', label: 'CSV', mime: 'text/csv' },
    tsv:  { icon: '📑', label: 'TSV', mime: 'text/tab-separated-values' },
    json: { icon: '📋', label: 'JSON', mime: 'application/json' },
    xlsx: { icon: '📊', label: 'Excel', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    xls:  { icon: '📊', label: 'Excel', mime: 'application/vnd.ms-excel' },
  };

  function getExt(name) { return name.split('.').pop().toLowerCase(); }

  function getFormatInfo(ext) { return FORMATS[ext] || { icon: '📄', label: ext.toUpperCase(), mime: 'text/plain' }; }

  async function parse(file) {
    const ext = getExt(file.name);
    let rows = [], headers = [];
    if (ext === 'csv' || ext === 'tsv') {
      const text = await file.text();
      const result = Papa.parse(text, { header: true, skipEmptyLines: true, dynamicTyping: false, delimiter: ext === 'tsv' ? '\t' : '' });
      headers = result.meta.fields || [];
      rows = result.data;
    } else if (ext === 'json') {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const arr = Array.isArray(parsed) ? parsed : (parsed.data || Object.values(parsed)[0] || [parsed]);
      headers = arr.length ? Object.keys(arr[0]) : [];
      rows = arr;
    } else if (ext === 'xlsx' || ext === 'xls') {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (data.length) {
        headers = data[0].map(String);
        rows = data.slice(1).map(r => {
          const obj = {};
          headers.forEach((h, i) => { obj[h] = r[i] !== undefined ? r[i] : ''; });
          return obj;
        });
      }
    } else {
      throw new Error(`Unsupported format: .${ext}`);
    }
    // Normalize: convert all to strings for uniform processing
    rows = rows.map(r => {
      const n = {};
      headers.forEach(h => { n[h] = r[h] === null || r[h] === undefined ? '' : String(r[h]).trim(); });
      return n;
    });
    return { headers, rows, ext, formatInfo: getFormatInfo(ext) };
  }

  return { parse, getExt, getFormatInfo };
})();
