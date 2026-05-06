"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DashboardPanel = void 0;
const vscode = __importStar(require("vscode"));
class DashboardPanel {
    static createOrShow(extensionUri, results, selectedAlert) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;
        // If we already have a panel, show it.
        if (DashboardPanel.currentPanel) {
            DashboardPanel.currentPanel.updateData(results, selectedAlert);
            DashboardPanel.currentPanel._panel.reveal(column);
            return;
        }
        // Otherwise, create a new panel.
        const panel = vscode.window.createWebviewPanel(DashboardPanel.viewType, 'ZeroFalse Dashboard', column || vscode.ViewColumn.One, {
            enableScripts: true,
            localResourceRoots: [extensionUri],
            retainContextWhenHidden: true
        });
        DashboardPanel.currentPanel = new DashboardPanel(panel, extensionUri, results, selectedAlert);
    }
    constructor(panel, extensionUri, results, selectedAlert) {
        this._disposables = [];
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._results = results;
        this._selectedAlert = selectedAlert;
        this._update();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }
    dispose() {
        DashboardPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
    updateData(results, selectedAlert) {
        this._results = results;
        if (selectedAlert) {
            this._selectedAlert = selectedAlert;
        }
        this._update();
    }
    get currentSelectedAlert() {
        return this._selectedAlert;
    }
    postMessage(message) {
        if (this._panel) {
            this._panel.webview.postMessage(message);
        }
    }
    _update() {
        const webview = this._panel.webview;
        this._panel.title = this._selectedAlert ? `Alert: ${this._selectedAlert.ruleId}` : 'ZeroFalse Dashboard';
        this._panel.webview.html = this._getHtmlForWebview(webview);
    }
    _getHtmlForWebview(webview) {
        const totalAlerts = this._results.length;
        const fpCount = this._results.filter(r => r.classification === 'FP').length;
        const tpCount = this._results.filter(r => r.classification === 'TP').length;
        const fpReduction = totalAlerts > 0 ? Math.round((fpCount / totalAlerts) * 100) : 0;
        const tpPercentage = totalAlerts > 0 ? Math.round((tpCount / totalAlerts) * 100) : 0;
        const fpPercentage = totalAlerts > 0 ? Math.round((fpCount / totalAlerts) * 100) : 0;
        const alert = this._selectedAlert || {
            ruleId: 'Scanning...',
            classification: 'Unknown',
            cwe: 'N/A',
            sink: { file: 'N/A', line: 0 },
            confidence: 'N/A',
            llmOutput: { "Explanation": "...", "Is Vulnerable": "N/A", "Sanitization Found": "N/A", "Attack Feasible": "N/A" }
        };
        const isFp = alert.classification === 'FP';
        const tableRows = this._results.map(r => {
            const rIsFp = r.classification === 'FP';
            return `
        <tr style="border-bottom: 1px solid #313543;">
          <td style="padding: 12px 16px; color: #fff;">${escapeHtml(r.ruleId)}</td>
          <td style="padding: 12px 16px; color: #8F95B2; font-family: monospace;">${escapeHtml(r.sink.file)}:${r.sink.line}</td>
          <td style="padding: 12px 16px; color: #8F95B2;">High</td>
          <td style="padding: 12px 16px;"><span style="color: ${rIsFp ? '#00D084' : '#FF4D4F'}; background: ${rIsFp ? 'rgba(0,208,132,0.1)' : 'rgba(255,77,79,0.1)'}; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">${r.classification}</span></td>
          <td style="padding: 12px 16px; color: #8F95B2;">${escapeHtml(r.confidence)}</td>
        </tr>
      `;
        }).join('');
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dashboard</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        
        :root {
            --bg-main: #1C1E26;
            --bg-card: #252836;
            --text-main: #FFFFFF;
            --text-muted: #8F95B2;
            --border: #313543;
            --color-fp: #00D084;
            --color-tp: #FF4D4F;
            --color-primary: #FF8000;
        }

        body {
            margin: 0;
            padding: 24px;
            font-family: 'Inter', sans-serif;
            background-color: var(--bg-main);
            color: var(--text-main);
        }

        .dashboard-grid {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            grid-template-rows: auto auto auto;
            gap: 20px;
        }

        /* Top Cards */
        .top-cards {
            grid-column: 1 / -1;
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 20px;
        }

        .card {
            background-color: var(--bg-card);
            border-radius: 12px;
            padding: 20px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            display: flex;
            align-items: center;
            gap: 16px;
        }

        .card-icon {
            width: 48px;
            height: 48px;
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
        }

        .card-info h3 {
            margin: 0;
            font-size: 20px;
            font-weight: 700;
        }

        .card-info p {
            margin: 4px 0 0 0;
            font-size: 12px;
            color: var(--text-muted);
        }

        /* Main Chart Area */
        .chart-section {
            grid-column: 1 / 3;
            background-color: var(--bg-card);
            border-radius: 12px;
            padding: 24px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            min-height: 300px;
            display: flex;
            flex-direction: column;
        }

        .chart-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }

        .chart-placeholder {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 2px dashed var(--border);
            border-radius: 8px;
            color: var(--text-muted);
        }

        /* Right Panel */
        .right-panel {
            grid-column: 3 / 4;
            background-color: var(--bg-card);
            border-radius: 12px;
            padding: 24px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            display: flex;
            flex-direction: column;
            align-items: center;
        }

        .donut-container {
            position: relative;
            width: 150px;
            height: 150px;
            margin: 20px 0;
        }

        .donut {
            width: 100%;
            height: 100%;
            border-radius: 50%;
            background: conic-gradient(
                var(--color-tp) 0% ${tpPercentage}%,
                var(--color-fp) ${tpPercentage}% 100%
            );
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .donut-inner {
            width: 120px;
            height: 120px;
            background-color: var(--bg-card);
            border-radius: 50%;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
        }

        .donut-inner h2 {
            margin: 0;
            font-size: 24px;
        }
        
        .donut-inner span {
            font-size: 12px;
            color: var(--text-muted);
        }

        .legend {
            width: 100%;
            margin-top: 20px;
        }

        .legend-item {
            display: flex;
            justify-content: space-between;
            margin-bottom: 12px;
            font-size: 13px;
        }

        .legend-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            display: inline-block;
            margin-right: 8px;
        }

        /* Table Section */
        .table-section {
            grid-column: 1 / 3;
            background-color: var(--bg-card);
            border-radius: 12px;
            padding: 24px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            overflow-x: auto;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            text-align: left;
            font-size: 13px;
        }

        th {
            color: var(--text-muted);
            font-weight: 500;
            padding: 0 16px 12px 16px;
            border-bottom: 1px solid var(--border);
        }

        /* Alert Details */
        .alert-details {
            grid-column: 3 / 4;
            background-color: var(--bg-card);
            border-radius: 12px;
            padding: 24px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }

        .detail-header {
            border-bottom: 1px solid var(--border);
            padding-bottom: 16px;
            margin-bottom: 16px;
        }

        .detail-title {
            font-size: 18px;
            font-weight: 600;
            margin: 0 0 8px 0;
            color: ${isFp ? 'var(--color-fp)' : 'var(--color-tp)'};
        }

        .detail-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 12px;
            font-size: 13px;
        }

        .detail-label {
            color: var(--text-muted);
        }

        .detail-value {
            font-weight: 500;
        }

        .llm-reasoning {
            margin-top: 20px;
            background-color: rgba(0,0,0,0.2);
            padding: 16px;
            border-radius: 8px;
            border: 1px solid var(--border);
        }

        .llm-reasoning h4 {
            margin: 0 0 10px 0;
            font-size: 14px;
            color: var(--color-primary);
        }

        .llm-reasoning p {
            margin: 0;
            font-size: 12px;
            line-height: 1.6;
            color: #ccc;
        }
    </style>
</head>
<body>
    <div id="loading-container" style="display: ${totalAlerts === 0 ? 'flex' : 'none'}; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: var(--bg-main); align-items: center; justify-content: center; flex-direction: column; z-index: 1000;">
        <div style="font-size: 32px; margin-bottom: 16px; opacity: 0.8;">⏳</div>
        <div style="font-size: 18px; font-weight: 600;">Scan started... please wait</div>
    </div>
    <div class="dashboard-grid">
        <!-- Top Summary Cards -->
        <div class="top-cards">
            <div class="card">
                <div class="card-icon" style="background: rgba(255, 128, 0, 0.1); color: var(--color-primary);">📊</div>
                <div class="card-info">
                    <h3>${totalAlerts}</h3>
                    <p>Total Alerts</p>
                </div>
            </div>
            <div class="card">
                <div class="card-icon" style="background: rgba(0, 208, 132, 0.1); color: var(--color-fp);">✅</div>
                <div class="card-info">
                    <h3>${fpCount}</h3>
                    <p>False Positives</p>
                </div>
            </div>
            <div class="card">
                <div class="card-icon" style="background: rgba(255, 77, 79, 0.1); color: var(--color-tp);">🚨</div>
                <div class="card-info">
                    <h3>${tpCount}</h3>
                    <p>True Positives</p>
                </div>
            </div>
            <div class="card">
                <div class="card-icon" style="background: rgba(255, 255, 255, 0.1); color: #fff;">📉</div>
                <div class="card-info">
                    <h3>${fpReduction}%</h3>
                    <p>Reduction Ratio</p>
                </div>
            </div>
        </div>

        <!-- Main Chart Section -->
        <div class="chart-section">
            <div class="chart-header">
                <h3 style="margin:0;">Alert Trends</h3>
                <span style="font-size: 12px; color: var(--text-muted);">Last Analysis</span>
            </div>
            <div class="chart-placeholder">
                <p>Chart Data Visualization Placeholder</p>
            </div>
        </div>

        <!-- Right Panel (Circular Chart) -->
        <div class="right-panel">
            <h3 style="margin: 0 0 10px 0; width: 100%; text-align: left;">Distribution</h3>
            <div class="donut-container">
                <div class="donut">
                    <div class="donut-inner">
                        <h2>${totalAlerts}</h2>
                        <span>Alerts</span>
                    </div>
                </div>
            </div>
            <div class="legend">
                <div class="legend-item">
                    <div><span class="legend-dot" style="background: var(--color-tp);"></span> True Positive</div>
                    <span>${tpPercentage}%</span>
                </div>
                <div class="legend-item">
                    <div><span class="legend-dot" style="background: var(--color-fp);"></span> False Positive</div>
                    <span>${fpPercentage}%</span>
                </div>
            </div>
        </div>

        <!-- Table Section -->
        <div class="table-section">
            <h3 style="margin: 0 0 20px 0;">Alerts Table</h3>
            <table>
                <thead>
                    <tr>
                        <th>Vulnerability Type</th>
                        <th>File Location</th>
                        <th>Severity</th>
                        <th>Classification</th>
                        <th>Confidence</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRows}
                </tbody>
            </table>
        </div>

        <!-- Alert Details Section -->
        <div class="alert-details">
            <div class="detail-header">
                <h2 class="detail-title">${escapeHtml(alert.ruleId)}</h2>
                <div style="display: inline-block; padding: 4px 8px; border-radius: 4px; background: ${isFp ? 'rgba(0,208,132,0.1)' : 'rgba(255,77,79,0.1)'}; color: ${isFp ? 'var(--color-fp)' : 'var(--color-tp)'}; font-size: 11px; font-weight: 700;">
                    ${isFp ? 'FALSE POSITIVE' : 'TRUE POSITIVE'}
                </div>
            </div>
            
            <div class="detail-row">
                <span class="detail-label">CWE ID</span>
                <span class="detail-value">${escapeHtml(alert.cwe)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">File</span>
                <span class="detail-value" style="font-family: monospace; color: #fff;">${escapeHtml(alert.sink.file)}:${alert.sink.line}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Confidence</span>
                <span class="detail-value">${escapeHtml(alert.confidence)}</span>
            </div>
            
            <div class="llm-reasoning">
                <h4>LLM Reasoning</h4>
                <p>${escapeHtml(alert.llmOutput["Explanation"])}</p>
                
                <div style="margin-top: 16px; border-top: 1px solid var(--border); padding-top: 12px;">
                    <div class="detail-row" style="margin-bottom: 8px;">
                        <span class="detail-label" style="font-size: 11px;">Is Vulnerable</span>
                        <span class="detail-value" style="font-size: 11px;">${escapeHtml(alert.llmOutput["Is Vulnerable"])}</span>
                    </div>
                    <div class="detail-row" style="margin-bottom: 8px;">
                        <span class="detail-label" style="font-size: 11px;">Sanitization Found</span>
                        <span class="detail-value" style="font-size: 11px;">${escapeHtml(alert.llmOutput["Sanitization Found"])}</span>
                    </div>
                    <div class="detail-row" style="margin-bottom: 0;">
                        <span class="detail-label" style="font-size: 11px;">Attack Feasible</span>
                        <span class="detail-value" style="font-size: 11px;">${escapeHtml(alert.llmOutput["Attack Feasible"])}</span>
                    </div>
                </div>
            </div>
            </div>
        </div>
    </div>
    <script>
        function escapeHtml(str) {
            if (!str) return "";
            return String(str)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#39;");
        }

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'NEW_ALERT') {
                const loadingContainer = document.getElementById('loading-container');
                if (loadingContainer) loadingContainer.style.display = 'none';
                
                const tableSection = document.querySelector('.table-section');
                if (tableSection) tableSection.style.display = 'block';
                const detailsPanel = document.querySelector('.alert-details');
                if (detailsPanel) detailsPanel.style.display = 'block';

                const { alert, total, fpCount, tpCount } = message;
                const fpReduction = total > 0 ? Math.round((fpCount / total) * 100) : 0;
                const tpPercentage = total > 0 ? Math.round((tpCount / total) * 100) : 0;
                const fpPercentage = total > 0 ? Math.round((fpCount / total) * 100) : 0;
                
                // update top cards
                const h3s = document.querySelectorAll('.card-info h3');
                if (h3s.length >= 4) {
                    h3s[0].textContent = total;
                    h3s[1].textContent = fpCount;
                    h3s[2].textContent = tpCount;
                    h3s[3].textContent = fpReduction + '%';
                }
                
                // update donut
                const donutInnerH2 = document.querySelector('.donut-inner h2');
                if (donutInnerH2) donutInnerH2.textContent = total;
                
                const legendSpans = document.querySelectorAll('.legend-item > span:last-child');
                if (legendSpans.length >= 2) {
                    legendSpans[0].textContent = tpPercentage + '%';
                    legendSpans[1].textContent = fpPercentage + '%';
                }
                
                const donut = document.querySelector('.donut');
                if (donut) {
                    donut.style.background = \`conic-gradient(var(--color-tp) 0% \${tpPercentage}%, var(--color-fp) \${tpPercentage}% 100%)\`;
                }
                
                // append to table
                const tbody = document.querySelector('tbody');
                if (tbody) {
                    const rIsFp = alert.classification === 'FP';
                    const tr = document.createElement('tr');
                    tr.style.borderBottom = '1px solid #313543';
                    tr.innerHTML = \`
                        <td style="padding: 12px 16px; color: #fff;">\${escapeHtml(alert.ruleId)}</td>
                        <td style="padding: 12px 16px; color: #8F95B2; font-family: monospace;">\${escapeHtml(alert.sink.file)}:\${alert.sink.line}</td>
                        <td style="padding: 12px 16px; color: #8F95B2;">High</td>
                        <td style="padding: 12px 16px;"><span style="color: \${rIsFp ? '#00D084' : '#FF4D4F'}; background: \${rIsFp ? 'rgba(0,208,132,0.1)' : 'rgba(255,77,79,0.1)'}; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">\${alert.classification}</span></td>
                        <td style="padding: 12px 16px; color: #8F95B2;">\${escapeHtml(alert.confidence)}</td>
                    \`;
                    tbody.appendChild(tr);
                }
            } else if (message.type === 'CLEAR_ALL' || message.type === 'RESET_SCAN' || message.type === 'SCAN_STARTED') {
                if (message.type === 'SCAN_STARTED') {
                    const loadingContainer = document.getElementById('loading-container');
                    if (loadingContainer) loadingContainer.style.display = 'flex';
                    const tableSection = document.querySelector('.table-section');
                    if (tableSection) tableSection.style.display = 'none';
                    const detailsPanel = document.querySelector('.alert-details');
                    if (detailsPanel) detailsPanel.style.display = 'none';
                }

                const h3s = document.querySelectorAll('.card-info h3');
                if (h3s.length >= 4) {
                    h3s[0].textContent = '0';
                    h3s[1].textContent = '0';
                    h3s[2].textContent = '0';
                    h3s[3].textContent = '0%';
                }
                
                const donutInnerH2 = document.querySelector('.donut-inner h2');
                if (donutInnerH2) donutInnerH2.textContent = '0';
                
                const legendSpans = document.querySelectorAll('.legend-item > span:last-child');
                if (legendSpans.length >= 2) {
                    legendSpans[0].textContent = '0%';
                    legendSpans[1].textContent = '0%';
                }
                
                const donut = document.querySelector('.donut');
                if (donut) {
                    donut.style.background = 'conic-gradient(var(--color-tp) 0% 0%, var(--color-fp) 0% 100%)';
                }
                
                const tbody = document.querySelector('tbody');
                if (tbody) tbody.innerHTML = '';
                
                const detailsPanel = document.querySelector('.alert-details');
                if (detailsPanel && message.type !== 'SCAN_STARTED') {
                    detailsPanel.style.display = 'block';
                    detailsPanel.innerHTML = '<div style="display: flex; height: 100%; min-height: 200px; align-items: center; justify-content: center; color: var(--text-muted);">No alerts processed.</div>';
                }
            } else if (message.type === 'SCAN_COMPLETED') {
                const loadingContainer = document.getElementById('loading-container');
                if (loadingContainer) loadingContainer.style.display = 'none';
                
                const tableSection = document.querySelector('.table-section');
                if (tableSection) tableSection.style.display = 'block';
                const detailsPanel = document.querySelector('.alert-details');
                if (detailsPanel) detailsPanel.style.display = 'block';
            }
        });
    </script>
</body>
</html>`;
    }
}
exports.DashboardPanel = DashboardPanel;
DashboardPanel.viewType = 'zerofalseDashboard';
function escapeHtml(str) {
    if (!str)
        return "";
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
//# sourceMappingURL=dashboardPanel.js.map