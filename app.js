// ── APP.JS ────────────────────────────────────────────────
// Updated to communicate with Python Flask Backend (server.py)

const API_URL = 'http://localhost:5000/api';

const App = (() => {
  let state = {
    file: null, analysis: null, processedAnalysis: null,
    activeDataTab: 'original', activeInsightTab: 'story',
    activeChartType: 'bar', chartColX: null, chartColY: null,
    strategy: { nulls: 'median', dups: 'remove_all', outliers: 'keep', scale: 'none', encode: 'none' }
  };

  function toast(msg, type = 'info') {
    const icons = { 
      info: '<svg class="svg-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>', 
      success: '<svg class="svg-icon" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>', 
      error: '<svg class="svg-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>', 
      warning: '<svg class="svg-icon" viewBox="0 0 24 24"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>' 
    };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  // ── Upload ───────────────────────────────────────────────
  function initUpload() {
    const zone = document.getElementById('upload-zone');
    const fileInput = document.getElementById('file-input');

    zone.addEventListener('click', () => fileInput.click());
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('dragover');
      if (e.dataTransfer.files[0]) uploadToBackend(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) uploadToBackend(fileInput.files[0]); });

    document.getElementById('btn-reset').addEventListener('click', resetAll);
    document.getElementById('btn-process').addEventListener('click', runPreprocess);
    
    document.querySelectorAll('input[name="handle-null"]').forEach(r => r.addEventListener('change', e => { state.strategy.nulls = e.target.value; }));
    document.querySelectorAll('input[name="handle-dup"]').forEach(r => r.addEventListener('change', e => { state.strategy.dups = e.target.value; }));
    document.querySelectorAll('input[name="handle-out"]').forEach(r => r.addEventListener('change', e => { state.strategy.outliers = e.target.value; }));
    document.querySelectorAll('input[name="handle-scale"]').forEach(r => r.addEventListener('change', e => { state.strategy.scale = e.target.value; }));
    document.querySelectorAll('input[name="handle-encode"]').forEach(r => r.addEventListener('change', e => { state.strategy.encode = e.target.value; }));
  }

  async function uploadToBackend(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const allowed = ['csv', 'tsv', 'json', 'xlsx', 'xls'];
    if (!allowed.includes(ext)) { toast(`Unsupported format: .${ext}`, 'error'); return; }

    state.file = file;
    document.getElementById('upload-zone').innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:12px"><div class="spinner" style="width:32px;height:32px;border-width:3px"></div><p style="color:var(--text2)">Uploading and analyzing via Pandas...</p></div>`;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${API_URL}/upload`, { method: 'POST', body: formData });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || 'Server error');

      state.analysis = data;
      state.processedAnalysis = null;

      document.getElementById('upload-zone').innerHTML = getUploadZoneHTML();
      initUploadZoneInternal();

      showFileInfoBar(file, data);
      showWorkspace();
      
      const formatLabel = {csv:'CSV Document', xlsx:'Excel Workbook', json:'JSON Data'}[ext] || 'Data Document';
      document.querySelector('.file-sub').textContent = `${formatBytes(file.size)} · ${formatLabel}`;

      renderTable('original-table', data.headers, data.rows, data.columns, null);
      renderColumnCards(data);
      renderNoiseDashboard(data, false);
      renderHealthChart(data.health);
      
      // Story text
      document.getElementById('story-text').innerHTML = `Analyzed <b>${data.totalRows} rows</b> and <b>${data.totalCols} columns</b> using Pandas engine. Data score is ${data.health.overall}/100.`;

      initChartPanel();
      toast('Analyzed successfully by Pandas backend', 'success');
    } catch (err) {
      console.error(err);
      document.getElementById('upload-zone').innerHTML = getUploadZoneHTML();
      initUploadZoneInternal();
      toast(`Backend error: ${err.message}. Is server.py running?`, 'error');
    }
  }

  // ── Preprocessing via Backend ────────────────────────────
  async function runPreprocess() {
    if (!state.analysis) return;
    const btn = document.getElementById('btn-process');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Processing in Python...';

    try {
      const res = await fetch(`${API_URL}/preprocess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.strategy)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      state.processedAnalysis = data;

      switchDataTab('processed');
      renderTable('processed-table', data.headers, data.rows, data.columns, null);
      renderNoiseDashboard(data, true);
      renderHealthChart(data.health);
      renderChartPanel(); // Refresh seaborn charts
      
      // Update story
      document.getElementById('story-text').innerHTML = `<b>Cleaning Complete!</b> Removed ${data.stats.dupRemoved} duplicates and filled ${data.stats.fillCount} missing values. Final dataset has ${data.stats.finalRows} rows.`;

      document.getElementById('download-area').style.display = 'block';

      btn.disabled = false;
      btn.innerHTML = '<svg class="svg-icon" viewBox="0 0 24 24" style="margin-right:6px"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg> Re-Process';
      toast('Processing complete via Pandas!', 'success');
      
    } catch(err) {
      console.error(err);
      toast(`Error processing: ${err.message}`, 'error');
      btn.disabled = false;
      btn.innerHTML = '<svg class="svg-icon" viewBox="0 0 24 24" style="margin-right:6px"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/></svg> Preprocess';
    }
  }

  // ── Render Noise Dashboard ───────────────────────────────
  function renderNoiseDashboard(data, isProcessed) {
    const dash = document.getElementById('noise-dashboard');
    dash.style.display = 'block';
    
    document.getElementById('transform-options').style.display = isProcessed ? 'none' : 'block';
    
    const title = isProcessed ? 'Post-Processing Report' : 'Data Quality Report';
    document.querySelector('.noise-title').textContent = title;

    const noise = data.noise;
    const score = noise.noiseScore;
    
    // Ring
    const ring = document.getElementById('noise-ring-fill');
    ring.style.strokeDashoffset = 314 - (score / 100) * 314;
    ring.style.stroke = score < 30 ? '#10b981' : score < 60 ? '#f59e0b' : '#ef4444';
    document.getElementById('noise-score-num').textContent = score;
    document.getElementById('noise-score-text').textContent = score < 20 ? '✓ Clean' : score < 50 ? '~ Moderate' : '✗ Noisy';

    // Nulls
    document.getElementById('issue-nulls-count').textContent = `${noise.nulls.totalNulls} missing cells`;
    document.getElementById('issue-nulls-pct').textContent = `${noise.nulls.pct}%`;
    document.getElementById('null-cols').innerHTML = noise.nulls.details.length
      ? noise.nulls.details.map(d => `<div class="issue-col-row"><span class="issue-col-name">${d.col}</span><span class="issue-col-bar-wrap"><div class="issue-col-bar" style="width:${d.pct}%;background:rgba(239,68,68,0.6)"></div></span><span class="issue-col-val">${d.count} (${d.pct}%)</span></div>`).join('')
      : '<div style="color:var(--green);font-size:0.8rem">✓ No missing values!</div>';

    // Dups
    document.getElementById('issue-dup-count').textContent = `${noise.duplicates.count} duplicate rows`;
    document.getElementById('issue-dup-pct').textContent = `${noise.duplicates.pct}%`;

    // Outliers
    document.getElementById('issue-out-count').textContent = `${noise.outliers.total} outlier cells`;
    document.getElementById('issue-out-pct').textContent = `${noise.outliers.pct}%`;
    document.getElementById('outlier-cols').innerHTML = noise.outliers.details.length
      ? noise.outliers.details.map(d => `<div class="issue-col-row"><span class="issue-col-name">${d.col}</span><span class="issue-col-bar-wrap"><div class="issue-col-bar" style="width:${Math.min(100,d.pct*5)}%;background:rgba(139,92,246,0.6)"></div></span><span class="issue-col-val">${d.count} (${d.pct}%)</span></div>`).join('')
      : '<div style="color:var(--green);font-size:0.8rem">✓ No outliers detected!</div>';

    // Type issues
    document.getElementById('issue-type-count').textContent = `${noise.typeIssues.count} columns`;
    document.getElementById('issue-type-pct').textContent = noise.typeIssues.count > 0 ? 'flagged' : 'clean';
    document.getElementById('type-cols').innerHTML = noise.typeIssues.details.length
      ? noise.typeIssues.details.map(d => `<div class="issue-col-row"><span class="issue-col-name">${d.col}</span><span class="tag tag-blue" style="font-size:0.65rem">${d.issue}</span></div>`).join('')
      : '<div style="color:var(--green);font-size:0.8rem">✓ No type issues!</div>';
  }

  function toggleIssue(id) {
    const detail = document.getElementById(`issue-${id}-detail`);
    const toggle = document.querySelector(`#issue-${id} .issue-toggle`);
    const isOpen = detail.classList.contains('open');
    detail.classList.toggle('open', !isOpen);
    if (toggle) toggle.textContent = isOpen ? '▾' : '▴';
  }

  // ── Render Charts Panel (SEABORN) ────────────────────────
  function initChartPanel() {
    const data = state.analysis;
    const numCols = Object.keys(data.columns).filter(k => data.columns[k].type === 'numeric');
    const allCols = data.headers;

    const xSel = document.getElementById('chart-col-x');
    const ySel = document.getElementById('chart-col-y');
    xSel.innerHTML = allCols.map(h => `<option value="${h}">${h}</option>`).join('');
    ySel.innerHTML = numCols.map(h => `<option value="${h}">${h}</option>`).join('');
    
    state.chartColX = allCols[0];
    state.chartColY = numCols[1] || numCols[0];

    xSel.onchange = () => { state.chartColX = xSel.value; renderChartPanel(); };
    ySel.onchange = () => { state.chartColY = ySel.value; renderChartPanel(); };

    document.querySelectorAll('.chart-btn').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.chart-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.activeChartType = btn.dataset.chart;
        renderChartPanel();
      };
    });
    renderChartPanel();
  }

  function renderChartPanel() {
    if (!state.analysis) return;
    const type = state.activeChartType;
    const colX = state.chartColX;
    const colY = state.chartColY;
    const isProcessed = state.processedAnalysis !== null;
    
    const wrap = document.getElementById('chart-canvas-wrap');
    wrap.innerHTML = `<div id="seaborn-container" style="width:100%;height:320px;display:flex;align-items:center;justify-content:center;background:var(--bg2);border-radius:6px;overflow:hidden;"></div>`;

    document.getElementById('chart-vs-label').style.display = type === 'scatter' ? 'block' : 'none';
    document.getElementById('chart-col-y').style.display = type === 'scatter' ? 'block' : 'none';

    if (type === 'bar') Charts.renderBar('seaborn-container', colX, isProcessed);
    else if (type === 'line') Charts.renderLine('seaborn-container', colX, isProcessed);
    else if (type === 'pie') Charts.renderPie('seaborn-container', colX, isProcessed);
    else if (type === 'histogram') Charts.renderHistogram('seaborn-container', colX, isProcessed);
    else if (type === 'boxplot') Charts.renderBoxPlot('seaborn-container', colX, isProcessed);
    else if (type === 'correlation') Charts.renderCorrelation('seaborn-container', isProcessed);
    else if (type === 'scatter') Charts.renderScatter('seaborn-container', colX, colY, isProcessed);
    else if (type === 'area') Charts.renderArea('seaborn-container', colX, isProcessed);
  }

  // ── Render Utilities ─────────────────────────────────────
  function showFileInfoBar(file, data) {
    const bar = document.getElementById('file-info-bar');
    bar.querySelector('.file-name').textContent = file.name;
    bar.querySelector('[data-stat="rows"] .file-stat-val').textContent = data.totalRows.toLocaleString();
    bar.querySelector('[data-stat="cols"] .file-stat-val').textContent = data.totalCols;
    bar.querySelector('[data-stat="nulls"] .file-stat-val').textContent = data.noise.nulls.totalNulls;
    bar.classList.add('show');
  }

  function showWorkspace() { document.getElementById('workspace').classList.add('show'); }

  function renderTable(containerId, headers, rows, columns, diffRows) {
    const wrap = document.getElementById(containerId);
    if (!rows || !rows.length) { wrap.innerHTML = '<div class="empty">No data</div>'; return; }

    const thead = `<thead><tr><th style="min-width:40px">#</th>${headers.map(h => `<th>${h}<span class="col-type">${columns[h].type}</span></th>`).join('')}</tr></thead>`;
    
    const tbody = `<tbody>${rows.map((row, ri) => {
      const cells = headers.map(h => {
        const val = row[h];
        if (val === null || val === undefined) return `<td class="null-cell"><i>null</i></td>`;
        return `<td>${escHtml(String(val))}</td>`;
      }).join('');
      return `<tr><td class="row-idx">${ri + 1}</td>${cells}</tr>`;
    }).join('')}</tbody>`;

    wrap.innerHTML = `<div class="table-wrap"><table>${thead}${tbody}</table></div><div style="text-align:center;padding:10px;color:var(--text3);font-size:0.75rem">Showing top ${rows.length} rows preview from Pandas (Backend)</div>`;
  }

  function renderColumnCards(data) {
    const container = document.getElementById('col-cards');
    container.innerHTML = data.headers.map(h => {
      const col = data.columns[h];
      const stats = col.stats;
      const statsHtml = col.type === 'numeric'
        ? `<div class="col-card-stats"><div class="col-card-stat"><span class="v">${fmt(stats.mean)}</span><br>mean</div><div class="col-card-stat"><span class="v">${fmt(stats.median)}</span><br>median</div><div class="col-card-stat"><span class="v">${fmt(stats.std)}</span><br>std</div></div>`
        : `<div class="col-card-stats"><div class="col-card-stat"><span class="v">${stats.unique}</span><br>unique</div></div>`;
      
      return `<div class="col-card fade-in">
        <div class="col-card-top"><div class="col-card-name">${h}</div><span class="col-card-type">${col.type}</span></div>
        ${statsHtml}
        <div class="null-bar-wrap"><div class="null-bar" style="width:${stats.nullPct}%"></div></div>
        <div style="font-size:0.7rem;color:var(--text3);margin-top:4px">${stats.nullPct.toFixed(1)}% missing</div>
      </div>`;
    }).join('');
  }

  // Uses Chart.js just for the mini radar chart in top right (doesn't need Seaborn)
  let healthChartInstance = null;
  function renderHealthChart(health) {
    const scoreEl = document.getElementById('health-score-val');
    scoreEl.textContent = health.overall;
    scoreEl.className = 'health-score-val ' + (health.overall >= 75 ? 'great' : health.overall >= 50 ? 'ok' : 'bad');
    document.getElementById('health-label').textContent = health.overall >= 75 ? 'Excellent' : health.overall >= 50 ? 'Fair' : 'Needs Work';

    if (healthChartInstance) healthChartInstance.destroy();
    const ctx = document.getElementById('health-chart').getContext('2d');
    healthChartInstance = new Chart(ctx, {
      type: 'radar',
      data: {
        labels: Object.keys(health.axes),
        datasets: [{
          label: 'Health', data: Object.values(health.axes),
          backgroundColor: 'rgba(124,58,237,0.15)', borderColor: 'rgba(124,58,237,0.8)',
          pointBackgroundColor: '#a855f7', pointRadius: 4, borderWidth: 2,
        }]
      },
      options: {
        animation: { duration: 800 },
        scales: { r: { min: 0, max: 100, ticks: { stepSize: 25, color: '#5a6070', font:{size:10} }, grid:{color:'rgba(255,255,255,0.06)'}, angleLines:{color:'rgba(255,255,255,0.06)'}, pointLabels:{color:'#9ca3b0',font:{size:11}} } },
        plugins: { legend: { display: false } }
      }
    });
  }

  // ── Tabs & Reset ─────────────────────────────────────────
  function switchDataTab(tab) {
    state.activeDataTab = tab;
    document.querySelectorAll('#data-tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.querySelectorAll('.data-panel').forEach(p => p.classList.toggle('active', p.id === `panel-${tab}`));
  }

  function switchInsightTab(tab) {
    state.activeInsightTab = tab;
    document.querySelectorAll('#insight-tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.querySelectorAll('.insight-panel').forEach(p => p.classList.toggle('active', p.id === `ipanel-${tab}`));
  }

  function resetAll() {
    state = { file:null, analysis:null, processedAnalysis:null, strategy:{nulls:'median', dups:'remove_all', outliers:'keep', scale:'none', encode:'none'} };
    document.getElementById('file-info-bar').classList.remove('show');
    document.getElementById('workspace').classList.remove('show');
    document.getElementById('noise-dashboard').style.display = 'none';
    document.getElementById('transform-options').style.display = 'none';
    document.getElementById('upload-zone').innerHTML = getUploadZoneHTML();
    initUploadZoneInternal();
    document.getElementById('file-input').value = '';
    toast('Reset complete', 'info');
  }

  function getUploadZoneHTML() {
    return `<span class="upload-icon"><svg class="svg-icon" style="width:48px;height:48px;color:var(--accent)" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg></span><h2>Drop dataset (Pandas Backend)</h2><p>or click to browse</p>
      <div class="format-pills"><span class="format-pill">.CSV</span><span class="format-pill">.XLSX</span><span class="format-pill">.JSON</span></div>`;
  }
  function initUploadZoneInternal() {
    const zone = document.getElementById('upload-zone');
    zone.onclick = () => document.getElementById('file-input').click();
    zone.ondragover = e => { e.preventDefault(); zone.classList.add('dragover'); };
    zone.ondragleave = () => zone.classList.remove('dragover');
    zone.ondrop = e => { e.preventDefault(); zone.classList.remove('dragover'); if (e.dataTransfer.files[0]) uploadToBackend(e.dataTransfer.files[0]); };
  }

  function formatBytes(b) { if (b < 1024) return b + ' B'; if (b < 1048576) return (b/1024).toFixed(1) + ' KB'; return (b/1048576).toFixed(1) + ' MB'; }
  function fmt(n) { if (n === undefined || n === null) return '—'; const v = parseFloat(n); return isNaN(v) ? '—' : v.toLocaleString(undefined, {maximumFractionDigits:2}); }
  function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function init() {
    initUpload();
    document.querySelectorAll('#data-tabs .tab').forEach(t => t.addEventListener('click', () => switchDataTab(t.dataset.tab)));
    document.querySelectorAll('#insight-tabs .tab').forEach(t => t.addEventListener('click', () => switchInsightTab(t.dataset.tab)));
    
    // Cleanup index.html unused script tags if needed, but not strictly required
    Chart.defaults.color = '#9ca3b0';
    Chart.defaults.font.family = 'Inter';
  }

  return { init, toggleIssue };
})();

document.addEventListener('DOMContentLoaded', App.init);
