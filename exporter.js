// ── EXPORTER.JS ───────────────────────────────────────────
// Exports cleaned data back to original format + Python code + Seaborn viz

const Exporter = (() => {

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function downloadAs(headers, rows, originalExt, originalName) {
    const base = (originalName || 'processed').replace(/\.[^.]+$/, '');
    const outName = `${base}_cleaned.${originalExt}`;

    if (originalExt === 'csv') {
      const csv = Papa.unparse({ fields: headers, data: rows });
      download(outName, csv, 'text/csv;charset=utf-8;');
    } else if (originalExt === 'tsv') {
      const tsv = Papa.unparse({ fields: headers, data: rows }, { delimiter: '\t' });
      download(outName, tsv, 'text/tab-separated-values;charset=utf-8;');
    } else if (originalExt === 'json') {
      const json = JSON.stringify(rows, null, 2);
      download(outName, json, 'application/json');
    } else if (originalExt === 'xlsx' || originalExt === 'xls') {
      const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Cleaned');
      XLSX.writeFile(wb, outName);
    }
    return outName;
  }

  function generatePythonCode(headers, rows, analysis, processStats, fileName, ext) {
    const readFn = {
      csv:  `pd.read_csv('${fileName}')`,
      tsv:  `pd.read_csv('${fileName}', sep='\\t')`,
      json: `pd.read_json('${fileName}')`,
      xlsx: `pd.read_excel('${fileName}')`,
      xls:  `pd.read_excel('${fileName}')`,
    }[ext] || `pd.read_csv('${fileName}')`;

    const writeFn = {
      csv:  `df.to_csv('output_cleaned.csv', index=False)`,
      tsv:  `df.to_csv('output_cleaned.tsv', sep='\\t', index=False)`,
      json: `df.to_json('output_cleaned.json', orient='records', indent=2)`,
      xlsx: `df.to_excel('output_cleaned.xlsx', index=False)`,
      xls:  `df.to_excel('output_cleaned.xls', index=False)`,
    }[ext] || `df.to_csv('output_cleaned.csv', index=False)`;

    let fillLines = [];
    headers.forEach(h => {
      const { type, stats } = analysis.columns[h];
      if (type === 'numeric' && stats.median !== undefined) {
        fillLines.push(`df['${h}'].fillna(${parseFloat(stats.median.toFixed(4))}, inplace=True)  # median fill`);
      } else if (type === 'text' || type === 'categorical') {
        const top = stats.topValues && stats.topValues.length ? stats.topValues[0][0] : 'Unknown';
        fillLines.push(`df['${h}'].fillna('${top}', inplace=True)  # mode fill`);
      }
    });

    const numericCols = headers.filter(h => analysis.columns[h].type === 'numeric');
    const lines = [
      `# ── DataSense AI — Auto-generated Preprocessing Recipe`,
      `# Generated: ${new Date().toISOString()}`,
      `# Source: ${fileName}`,
      ``,
      `import pandas as pd`,
      `import numpy as np`,
      ``,
      `# ── Load Data`,
      `df = ${readFn}`,
      `print(f"Loaded: {df.shape[0]} rows × {df.shape[1]} columns")`,
      ``,
      `# ── Remove Duplicates`,
      `before = len(df)`,
      `df.drop_duplicates(inplace=True)`,
      `print(f"Duplicates removed: {before - len(df)}")`,
      ``,
      `# ── Fill Missing Values`,
      ...fillLines,
      ``,
      ...(numericCols.length ? [
        `# ── Outlier Detection (IQR Method)`,
        ...numericCols.map(h => {
          const { q1, q3, iqr } = analysis.columns[h].stats;
          if (q1 === undefined) return '';
          const lo = (q1 - 1.5 * iqr).toFixed(4), hi = (q3 + 1.5 * iqr).toFixed(4);
          return `outliers_${h.replace(/\W/g, '_')} = df[(df['${h}'] < ${lo}) | (df['${h}'] > ${hi})]`;
        }).filter(Boolean),
        ``
      ] : []),
      `# ── Summary`,
      `print(df.describe())`,
      `print(df.isnull().sum())`,
      ``,
      `# ── Export`,
      writeFn,
      `print("Done! Cleaned data saved.")`,
    ];
    return lines.join('\n');
  }

  // ── Seaborn Visualization Code (NEW) ─────────────────────
  function generateSeabornCode(headers, rows, analysis, fileName) {
    const numericCols = headers.filter(h => analysis.columns[h].type === 'numeric');
    const catCols = headers.filter(h => analysis.columns[h].type !== 'numeric' && analysis.columns[h].stats.unique < 30);

    const lines = [
      `# ╔══════════════════════════════════════════════════════╗`,
      `# ║  DataSense AI — Python Visualization Recipe         ║`,
      `# ║  Generated: ${new Date().toISOString().slice(0,10)}                         ║`,
      `# ╚══════════════════════════════════════════════════════╝`,
      ``,
      `import pandas as pd`,
      `import numpy as np`,
      `import matplotlib.pyplot as plt`,
      `import matplotlib.gridspec as gridspec`,
      `import seaborn as sns`,
      ``,
      `# Style`,
      `sns.set_theme(style="darkgrid", palette="muted")`,
      `plt.rcParams.update({'figure.facecolor':'#0f1117','axes.facecolor':'#151821',`,
      `                     'axes.edgecolor':'#2a2f45','text.color':'#e8eaf0',`,
      `                     'axes.labelcolor':'#9ca3b0','xtick.color':'#5a6070',`,
      `                     'ytick.color':'#5a6070','grid.color':'rgba(255,255,255,0.04)'})`,
      ``,
      `# Load data`,
      `df = pd.read_csv('${fileName}')  # change to your file`,
      `print(f"Dataset: {df.shape[0]} rows × {df.shape[1]} columns")`,
      `print(df.describe())`,
      ``,
      `# ── Create figure with 8 subplots ────────────────────`,
      `fig = plt.figure(figsize=(20, 24))`,
      `fig.suptitle('DataSense AI — Data Visualization Report', fontsize=16, fontweight='bold', color='#e8eaf0', y=0.98)`,
      `gs = gridspec.GridSpec(4, 2, figure=fig, hspace=0.45, wspace=0.35)`,
      ``,
    ];

    // Plot 1: Bar chart — first categorical column
    const cat1 = catCols[0] || headers[0];
    lines.push(
      `# ── 1. Bar Chart — "${cat1}" value frequencies`,
      `ax1 = fig.add_subplot(gs[0, 0])`,
      `vc = df['${cat1}'].value_counts().head(10)`,
      `sns.barplot(x=vc.values, y=vc.index.astype(str), ax=ax1, palette='muted')`,
      `ax1.set_title('Bar: ${cat1} Frequencies', fontweight='bold')`,
      `ax1.set_xlabel('Count'); ax1.set_ylabel('${cat1}')`,
      ``,
    );

    // Plot 2: Line chart — first numeric column
    const num1 = numericCols[0] || headers[0];
    lines.push(
      `# ── 2. Line Chart — "${num1}" trend`,
      `ax2 = fig.add_subplot(gs[0, 1])`,
      `line_data = df['${num1}'].dropna().reset_index(drop=True)`,
      `ax2.plot(line_data.index, line_data.values, color='#7c3aed', linewidth=1.5)`,
      `ax2.fill_between(line_data.index, line_data.values, alpha=0.1, color='#7c3aed')`,
      `ax2.set_title('Line: ${num1} Trend', fontweight='bold')`,
      `ax2.set_xlabel('Row Index'); ax2.set_ylabel('${num1}')`,
      ``,
    );

    // Plot 3: Pie chart — second categorical column
    const cat2 = catCols[1] || catCols[0] || headers[0];
    lines.push(
      `# ── 3. Pie Chart — "${cat2}" distribution`,
      `ax3 = fig.add_subplot(gs[1, 0])`,
      `pie_data = df['${cat2}'].value_counts().head(7)`,
      `colors_pie = sns.color_palette('muted', len(pie_data))`,
      `ax3.pie(pie_data.values, labels=pie_data.index.astype(str), autopct='%1.1f%%',`,
      `        colors=colors_pie, startangle=90, pctdistance=0.85,`,
      `        wedgeprops={'width':0.6, 'edgecolor':'#0f1117', 'linewidth':2})`,
      `ax3.set_title('Pie: ${cat2} Distribution', fontweight='bold')`,
      ``,
    );

    // Plot 4: Histogram — first numeric
    lines.push(
      `# ── 4. Histogram — "${num1}" distribution`,
      `ax4 = fig.add_subplot(gs[1, 1])`,
      `sns.histplot(df['${num1}'].dropna(), bins=20, kde=True, ax=ax4, color='#7c3aed', alpha=0.7)`,
      `ax4.set_title('Histogram: ${num1}', fontweight='bold')`,
      `ax4.set_xlabel('${num1}'); ax4.set_ylabel('Frequency')`,
      ``,
    );

    // Plot 5: Box plot — all numeric
    const boxCols = numericCols.slice(0, 6);
    lines.push(
      `# ── 5. Box Plot — outlier visualization`,
      `ax5 = fig.add_subplot(gs[2, 0])`,
      boxCols.length > 1
        ? `sns.boxplot(data=df[${JSON.stringify(boxCols)}], ax=ax5, palette='muted', linewidth=1.2)`
        : `sns.boxplot(y=df['${num1}'].dropna(), ax=ax5, color='#7c3aed', linewidth=1.2)`,
      `ax5.set_title('Box Plot: Outlier View', fontweight='bold')`,
      `ax5.tick_params(axis='x', rotation=20)`,
      ``,
    );

    // Plot 6: Correlation heatmap
    lines.push(
      `# ── 6. Correlation Heatmap`,
      `ax6 = fig.add_subplot(gs[2, 1])`,
      numericCols.length >= 2
        ? [
            `corr = df[${JSON.stringify(numericCols.slice(0,8))}].corr()`,
            `sns.heatmap(corr, ax=ax6, annot=True, fmt='.2f', cmap='RdYlGn',`,
            `            linewidths=0.5, linecolor='#0f1117', vmin=-1, vmax=1,`,
            `            annot_kws={'size': 8}, cbar_kws={'shrink': 0.8})`,
          ].join('\n')
        : `ax6.text(0.5, 0.5, 'Need ≥2 numeric columns', ha='center', va='center', transform=ax6.transAxes)`,
      `ax6.set_title('Correlation Heatmap', fontweight='bold')`,
      `ax6.tick_params(axis='x', rotation=30); ax6.tick_params(axis='y', rotation=0)`,
      ``,
    );

    // Plot 7: Scatter plot — first two numeric
    const num2 = numericCols[1] || numericCols[0] || headers[0];
    lines.push(
      `# ── 7. Scatter Plot — "${num1}" vs "${num2}"`,
      `ax7 = fig.add_subplot(gs[3, 0])`,
      num2 !== num1
        ? [
            `sns.scatterplot(x='${num1}', y='${num2}', data=df.dropna(subset=['${num1}','${num2}']),`,
            `                ax=ax7, color='#7c3aed', alpha=0.6, s=40)`,
            `# Regression line`,
            `from numpy.polynomial import polynomial as P`,
            `xv = df['${num1}'].dropna(); yv = df['${num2}'].dropna()`,
            `mn = min(len(xv),len(yv)); xv=xv[:mn]; yv=yv[:mn]`,
            `if len(xv)>1:`,
            `    coefs = P.polyfit(xv.values, yv.values, 1)`,
            `    xline = np.linspace(xv.min(), xv.max(), 100)`,
            `    ax7.plot(xline, P.polyval(xline, coefs), color='#10b981', linewidth=1.5, linestyle='--')`,
          ].join('\n')
        : `ax7.text(0.5, 0.5, 'Need ≥2 numeric columns', ha='center', va='center', transform=ax7.transAxes)`,
      `ax7.set_title('Scatter: ${num1} vs ${num2}', fontweight='bold')`,
      ``,
    );

    // Plot 8: Area chart — second numeric or same
    const num3 = numericCols[1] || numericCols[0] || headers[0];
    lines.push(
      `# ── 8. Area Chart — "${num3}" cumulative trend`,
      `ax8 = fig.add_subplot(gs[3, 1])`,
      `area_data = df['${num3}'].dropna().reset_index(drop=True)`,
      `ax8.fill_between(area_data.index, area_data.values, color='#06b6d4', alpha=0.3)`,
      `ax8.plot(area_data.index, area_data.values, color='#06b6d4', linewidth=1.5)`,
      `ax8.set_title('Area: ${num3} Trend', fontweight='bold')`,
      `ax8.set_xlabel('Row Index'); ax8.set_ylabel('${num3}')`,
      ``,
      `# ── Save & Show`,
      `plt.savefig('datasense_report.png', dpi=150, bbox_inches='tight', facecolor='#0f1117')`,
      `plt.show()`,
      `print("✓ Saved: datasense_report.png")`,
    );

    return lines.join('\n');
  }

  return { downloadAs, generatePythonCode, generateSeabornCode };
})();
