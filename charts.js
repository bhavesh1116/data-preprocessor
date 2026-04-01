// ── CHARTS.JS ─────────────────────────────────────────────
// Updated to fetch real Seaborn chart images from Flask API

const Charts = (() => {

  const _charts = {}; // No longer Chart.js instances, just DOM tracking
  function _destroy(id) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  }

  function _renderImage(containerId, endpoint, col1, col2, isProcessed) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    // Show loader
    container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text3)">
      <div class="spinner" style="margin-right:10px;width:16px;height:16px;border-width:2px"></div>
      Rendering Seaborn...
    </div>`;

    const url = `http://localhost:5000/api/chart/${endpoint}?processed=${isProcessed}&col1=${encodeURIComponent(col1||'')}&col2=${encodeURIComponent(col2||'')}&t=${Date.now()}`;
    
    fetch(url)
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          container.innerHTML = `<div class="empty" style="color:var(--red2)">Error: ${data.error}</div>`;
        } else {
          container.innerHTML = `<img src="${data.image}" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:6px;border:1px solid rgba(255,255,255,0.05)">`;
        }
      })
      .catch(err => {
        container.innerHTML = `<div class="empty" style="color:var(--red2)">Backend not running. Start server.py</div>`;
      });
  }

  function renderBar(containerId, col1, isProcessed) { _renderImage(containerId, 'bar', col1, null, isProcessed); }
  function renderLine(containerId, col1, isProcessed) { _renderImage(containerId, 'line', col1, null, isProcessed); }
  function renderPie(containerId, col1, isProcessed) { _renderImage(containerId, 'pie', col1, null, isProcessed); }
  function renderHistogram(containerId, col1, isProcessed) { _renderImage(containerId, 'histogram', col1, null, isProcessed); }
  function renderBoxPlot(containerId, col1, isProcessed) { _renderImage(containerId, 'boxplot', col1, null, isProcessed); }
  function renderCorrelation(containerId, isProcessed) { _renderImage(containerId, 'correlation', null, null, isProcessed); }
  function renderScatter(containerId, col1, col2, isProcessed) { _renderImage(containerId, 'scatter', col1, col2, isProcessed); }
  function renderArea(containerId, col1, isProcessed) { _renderImage(containerId, 'area', col1, null, isProcessed); }

  return { renderBar, renderLine, renderPie, renderHistogram, renderBoxPlot, renderCorrelation, renderScatter, renderArea };
})();
