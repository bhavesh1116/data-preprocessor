import os
import io
import base64
import json
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')  # Non-interactive backend
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.preprocessing import StandardScaler, MinMaxScaler, LabelEncoder
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# In-memory storage for the current session's dataframe
# In a real app, use sessions or a database, but for this single-page local tool, a global is fine.
app.config['UPLOAD_FOLDER'] = 'uploads'
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

class DataStore:
    def __init__(self):
        self.df_original = None
        self.df_processed = None
        self.filename = None
        self.stats = {}

store = DataStore()

# ── Styling ────────────────────────────────────────────────
def set_seaborn_style():
    sns.set_theme(style="darkgrid", palette="muted")
    plt.rcParams.update({
        'figure.facecolor': '#0f1117',
        'axes.facecolor': '#151821',
        'axes.edgecolor': '#2a2f45',
        'text.color': '#e8eaf0',
        'axes.labelcolor': '#9ca3b0',
        'xtick.color': '#5a6070',
        'ytick.color': '#5a6070',
        'grid.color': '#ffffff0a'
    })

# ── Helper: Fig to Base64 ──────────────────────────────────
def fig_to_base64(fig):
    buf = io.BytesIO()
    fig.savefig(buf, format='png', bbox_inches='tight', facecolor=fig.get_facecolor(), dpi=120)
    buf.seek(0)
    img_str = base64.b64encode(buf.read()).decode('utf-8')
    plt.close(fig)
    return f"data:image/png;base64,{img_str}"

# ── Helper: Analysis ───────────────────────────────────────
def analyze_dataframe(df):
    total_rows = len(df)
    headers = df.columns.tolist()
    
    # Noise calculation
    null_counts = df.isnull().sum()
    total_nulls = int(null_counts.sum())
    null_pct = (total_nulls / (total_rows * len(headers))) * 100 if total_rows > 0 else 0
    
    dup_count = int(df.duplicated().sum())
    dup_pct = (dup_count / total_rows) * 100 if total_rows > 0 else 0
    
    numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    outlier_details = []
    total_outliers = 0
    for col in numeric_cols:
        q1 = df[col].quantile(0.25)
        q3 = df[col].quantile(0.75)
        iqr = q3 - q1
        outliers = int(((df[col] < (q1 - 1.5 * iqr)) | (df[col] > (q3 + 1.5 * iqr))).sum())
        if outliers > 0:
            outlier_details.append({'col': col, 'count': outliers, 'pct': round((outliers/total_rows)*100, 1)})
            total_outliers += outliers
            
    outlier_pct = (total_outliers / (total_rows * max(1, len(numeric_cols)))) * 100 if total_rows > 0 else 0

    type_issues = []
    for col in headers:
        if df[col].isnull().all():
            type_issues.append({'col': col, 'issue': 'All empty'})
        elif df[col].nunique() == 1 and total_rows > 10:
            type_issues.append({'col': col, 'issue': 'Constant column'})

    noise_score = min(100, round(null_pct * 0.35 + dup_pct * 0.3 + outlier_pct * 0.25 + len(type_issues) * 3))
    
    # Column details
    columns_info = {}
    for col in headers:
        col_type = 'numeric' if pd.api.types.is_numeric_dtype(df[col]) else \
                   'date' if pd.api.types.is_datetime64_any_dtype(df[col]) else 'categorical'
        
        n_null = int(null_counts[col])
        unique = int(df[col].nunique())
        
        stats = {'count': int(df[col].count()), 'nullCount': n_null, 'nullPct': round(n_null/total_rows*100, 1), 'unique': unique}
        
        if col_type == 'numeric':
            stats.update({
                'min': float(df[col].min()) if pd.notnull(df[col].min()) else None,
                'max': float(df[col].max()) if pd.notnull(df[col].max()) else None,
                'mean': float(df[col].mean()) if pd.notnull(df[col].mean()) else None,
                'median': float(df[col].median()) if pd.notnull(df[col].median()) else None,
                'std': float(df[col].std()) if pd.notnull(df[col].std()) else None,
            })
            # Add quartiles for boxplot
            q1 = df[col].quantile(0.25)
            q3 = df[col].quantile(0.75)
            if pd.notnull(q1) and pd.notnull(q3):
                stats.update({'q1': float(q1), 'q3': float(q3), 'iqr': float(q3 - q1)})
                
        columns_info[col] = {'type': col_type, 'stats': stats}

    # Health score (0-100)
    completeness = max(0, 100 - null_pct)
    uniqueness = (df.drop_duplicates().shape[0] / max(total_rows, 1)) * 100
    validity = 100 # simplified
    uniformity = 100 # simplified
    outlier_safety = max(0, 100 - outlier_pct * 2)
    overall = round(completeness * 0.3 + uniqueness * 0.25 + validity * 0.2 + uniformity * 0.15 + outlier_safety * 0.1)

    return {
        'headers': headers,
        'totalRows': total_rows,
        'totalCols': len(headers),
        'noise': {
            'noiseScore': noise_score,
            'nulls': { 'totalNulls': total_nulls, 'pct': round(null_pct, 1), 'details': sorted([{'col': k, 'count': int(v), 'pct': round(v/total_rows*100,1)} for k,v in null_counts.items() if v > 0], key=lambda x: x['count'], reverse=True) },
            'duplicates': { 'count': dup_count, 'pct': round(dup_pct, 1) },
            'outliers': { 'total': total_outliers, 'pct': round(outlier_pct, 1), 'details': sorted(outlier_details, key=lambda x: x['count'], reverse=True) },
            'typeIssues': { 'count': len(type_issues), 'details': type_issues }
        },
        'columns': columns_info,
        'health': {
            'overall': overall,
            'axes': {'Completeness': round(completeness), 'Uniqueness': round(uniqueness), 'Validity': round(validity), 'Uniformity': round(uniformity), 'Outlier Safety': round(outlier_safety)}
        },
        # Return first 200 rows for UI table
        'rows': df.head(200).replace({np.nan: None}).to_dict(orient='records')
    }

# ── API: Upload ────────────────────────────────────────────
@app.route('/api/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    
    try:
        ext = file.filename.split('.')[-1].lower()
        if ext == 'csv':
            try:
                df = pd.read_csv(file)
            except UnicodeDecodeError:
                file.seek(0)
                df = pd.read_csv(file, encoding='latin1')
            except pd.errors.EmptyDataError:
                return jsonify({'error': 'The uploaded CSV file is empty.'}), 400
            except pd.errors.ParserError:
                file.seek(0)
                df = pd.read_csv(file, on_bad_lines='skip')
            except Exception as e:
                file.seek(0)
                # Try fallback just in case
                df = pd.read_csv(file, sep=None, engine='python')

        elif ext == 'tsv':
            df = pd.read_csv(file, sep='\t')
        elif ext in ['xls', 'xlsx']:
            df = pd.read_excel(file)
        elif ext == 'json':
            df = pd.read_json(file)
        else:
            return jsonify({'error': f'Unsupported format: {ext}'}), 400
            
        # Optional: Clean up extreme column names that might break logic
        df.columns = [str(c).strip() for c in df.columns]
            
        store.df_original = df.copy()
        store.df_processed = None
        store.filename = file.filename
        
        analysis = analyze_dataframe(df)
        return jsonify(analysis)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': f"Pandas failed to analyze this file: {str(e)}"}), 500

# ── API: Preprocess ────────────────────────────────────────
@app.route('/api/preprocess', methods=['POST'])
def preprocess():
    if store.df_original is None:
        return jsonify({'error': 'No data loaded'}), 400
        
    strategy = request.json or {}
    null_strat = strategy.get('nulls', 'median')
    dup_strat = strategy.get('dups', 'remove_all')
    outlier_strat = strategy.get('outliers', 'keep')
    scale_strat = strategy.get('scale', 'none')
    encode_strat = strategy.get('encode', 'none')
    
    df = store.df_original.copy()
    initial_len = len(df)
    
    # 1. Duplicates
    if dup_strat == 'remove_all':
        df.drop_duplicates(inplace=True, keep=False)
    elif dup_strat == 'keep_first':
        df.drop_duplicates(inplace=True, keep='first')
        
    dup_removed = initial_len - len(df)
    
    # 2. Nulls
    numeric_cols = df.select_dtypes(include=[np.number]).columns
    cat_cols = df.select_dtypes(exclude=[np.number]).columns
    
    total_nulls_before = df.isnull().sum().sum()
    
    if null_strat == 'drop':
        df.dropna(inplace=True)
    elif null_strat == 'unknown':
        for col in numeric_cols: df[col].fillna(0, inplace=True)
        for col in cat_cols: df[col].fillna("Unknown", inplace=True)
    else:
        for col in numeric_cols:
            if null_strat == 'mean': df[col].fillna(df[col].mean(), inplace=True)
            elif null_strat == 'median': df[col].fillna(df[col].median(), inplace=True)
            elif null_strat == 'mode' and df[col].mode().shape[0] > 0: df[col].fillna(df[col].mode()[0], inplace=True)
        for col in cat_cols:
            if df[col].mode().shape[0] > 0: df[col].fillna(df[col].mode()[0], inplace=True)
            else: df[col].fillna("Unknown", inplace=True)
            
    fill_count = int(total_nulls_before - df.isnull().sum().sum())
    
    # 3. Outliers
    if outlier_strat != 'keep':
        for col in numeric_cols:
            q1 = df[col].quantile(0.25)
            q3 = df[col].quantile(0.75)
            iqr = q3 - q1
            lo = q1 - 1.5 * iqr
            hi = q3 + 1.5 * iqr
            
            is_outlier = (df[col] < lo) | (df[col] > hi)
            if outlier_strat == 'remove':
                df = df[~is_outlier]
            elif outlier_strat == 'cap':
                df[col] = np.where(df[col] < lo, lo, df[col])
                df[col] = np.where(df[col] > hi, hi, df[col])
            elif outlier_strat == 'mean':
                df.loc[is_outlier, col] = df[col].mean()
            elif outlier_strat == 'median':
                df.loc[is_outlier, col] = df[col].median()
                
    # 4. Scaling
    if scale_strat != 'none':
        numeric_cols_current = df.select_dtypes(include=[np.number]).columns
        if len(numeric_cols_current) > 0:
            if scale_strat == 'standard':
                scaler = StandardScaler()
                df[numeric_cols_current] = scaler.fit_transform(df[numeric_cols_current])
            elif scale_strat == 'minmax':
                scaler = MinMaxScaler()
                df[numeric_cols_current] = scaler.fit_transform(df[numeric_cols_current])
                
    # 5. Encoding
    if encode_strat != 'none':
        cat_cols_current = df.select_dtypes(exclude=[np.number]).columns
        if len(cat_cols_current) > 0:
            if encode_strat == 'label':
                le = LabelEncoder()
                for c in cat_cols_current:
                    # fillna again just in case there are still unhandled NaNs
                    df[c] = df[c].fillna("Unknown")
                    df[c] = le.fit_transform(df[c].astype(str))
                
    store.df_processed = df.copy()
    
    analysis = analyze_dataframe(df)
    analysis['stats'] = {
        'dupRemoved': dup_removed,
        'fillCount': fill_count,
        'finalRows': len(df)
    }
    
    return jsonify(analysis)

# ── API: Generate Single Chart ─────────────────────────────
@app.route('/api/chart/<chart_type>')
def generate_chart(chart_type):
    use_processed = request.args.get('processed', 'false').lower() == 'true'
    df = store.df_processed if use_processed and store.df_processed is not None else store.df_original
    
    if df is None:
        return jsonify({'error': 'No data loaded'}), 400
        
    set_seaborn_style()
    fig, ax = plt.subplots(figsize=(10, 6))
    
    col1 = request.args.get('col1')
    col2 = request.args.get('col2')
    
    try:
        if chart_type == 'bar':
            if not col1: col1 = df.columns[0]
            vc = df[col1].value_counts().head(10)
            sns.barplot(x=vc.values, y=vc.index.astype(str), ax=ax, palette='muted')
            ax.set_title(f'Bar: {col1[:15]}')
            
        elif chart_type == 'line':
            if not col1: col1 = df.select_dtypes(include=[np.number]).columns[0]
            d = df[col1].dropna().head(200)
            ax.plot(d.values, color='#7c3aed', linewidth=2)
            ax.fill_between(range(len(d)), d.values, alpha=0.1, color='#7c3aed')
            ax.set_title(f'Line: {col1[:15]}')
            
        elif chart_type == 'pie':
            if not col1: col1 = df.columns[0]
            vc = df[col1].value_counts().head(7)
            ax.pie(vc.values, labels=[str(x)[:15] for x in vc.index], autopct='%1.1f%%', 
                   colors=sns.color_palette('muted'), textprops={'color':'#e8eaf0', 'fontsize':8})
            ax.set_title(f'Pie: {col1[:15]}')
            
        elif chart_type == 'histogram':
            if not col1: col1 = df.select_dtypes(include=[np.number]).columns[0]
            sns.histplot(df[col1].dropna(), bins=20, kde=True, ax=ax, color='#7c3aed', alpha=0.7)
            ax.set_title(f'Histogram: {col1[:15]}')
            
        elif chart_type == 'boxplot':
            num_cols = df.select_dtypes(include=[np.number]).columns.tolist()[:6]
            if len(num_cols) > 0:
                sns.boxplot(data=df[num_cols], ax=ax, palette='muted', linewidth=1.2)
                ax.set_title('Box Plot: Outlier View')
                ax.tick_params(axis='x', rotation=20, labelsize=8)
            else:
                ax.text(0.5, 0.5, 'No numeric columns', ha='center', va='center')
                
        elif chart_type == 'correlation':
            num_cols = df.select_dtypes(include=[np.number]).columns.tolist()[:8]
            if len(num_cols) >= 2:
                corr = df[num_cols].corr()
                sns.heatmap(corr, ax=ax, annot=True, fmt='.2f', cmap='RdYlGn', 
                            linewidths=0.5, linecolor='#0f1117', vmin=-1, vmax=1,
                            annot_kws={'size': 8}, cbar_kws={'shrink': 0.8})
                ax.set_title('Correlation Heatmap')
                ax.tick_params(axis='x', rotation=30, labelsize=8)
            else:
                ax.text(0.5, 0.5, 'Need ≥2 numeric columns', ha='center', va='center', color='white')
                
        elif chart_type == 'scatter':
            num_cols = df.select_dtypes(include=[np.number]).columns.tolist()
            if not col1: col1 = num_cols[0] if len(num_cols) > 0 else df.columns[0]
            if not col2: col2 = num_cols[1] if len(num_cols) > 1 else col1
            sns.scatterplot(x=df[col1], y=df[col2], ax=ax, color='#7c3aed', alpha=0.6)
            ax.set_title(f'Scatter: {col1[:10]} vs {col2[:10]}')
            
        elif chart_type == 'area':
            if not col1: col1 = df.select_dtypes(include=[np.number]).columns[0]
            d = df[col1].dropna().head(200)
            ax.fill_between(range(len(d)), d.values, color='#06b6d4', alpha=0.3)
            ax.plot(d.values, color='#06b6d4', linewidth=1.5)
            ax.set_title(f'Area: {col1[:15]}')
            
        else:
            ax.text(0.5, 0.5, f'Unknown chart type: {chart_type}', ha='center', va='center', color='red')
            
    except Exception as e:
        ax.clear()
        ax.text(0.5, 0.5, f'Error generating chart:\n{str(e)}', ha='center', va='center', color='red', fontsize=8)

    return jsonify({'image': fig_to_base64(fig)})

# ── API: Generate Full Seaborn Script ──────────────────────
@app.route('/api/generate_script')
def generate_script():
    if store.filename is None:
        return jsonify({'error': 'No file loaded'}), 400
    
    # This just returns the text template similar to what exporter.js was doing, 
    # but could be heavily expanded. For now, the user wants charts rendered *in* the UI using Seaborn.
    # The individual /api/chart endpoints above handle the actual UI rendering.
    return jsonify({"message": "Use exporter.js for script template, or /api/chart for live images."})

if __name__ == '__main__':
    app.run(debug=True, port=5000)
