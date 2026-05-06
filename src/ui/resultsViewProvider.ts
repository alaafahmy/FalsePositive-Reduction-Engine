import * as vscode from "vscode";
import { FinalResult } from "../types";
import { DashboardPanel } from "./dashboardPanel";

export class ResultsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "zerofalse.resultsView";

  private _view?: vscode.WebviewView;
  private _results?: FinalResult[];
  private _sarifPath?: string;
  private _isRunning: boolean = false;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case "runAnalysis":
          vscode.commands.executeCommand("zerofalse.analyze");
          break;
        case "cancelAnalysis":
          vscode.commands.executeCommand("zerofalse.cancel");
          break;
        case "clearResults":
          vscode.commands.executeCommand("zerofalse.clearResults");
          break;
        case "loadSarif":
          const uris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            openLabel: "Load SARIF",
            filters: { "SARIF Files": ["sarif", "json"] },
          });
          if (uris && uris.length > 0) {
            vscode.commands.executeCommand("zerofalse.analyze", uris[0]);
          }
          break;
        case "exportHtml":
          if (this._results) {
            await this.exportReport("html");
          }
          break;
        case "exportJson":
          if (this._results) {
            await this.exportReport("json");
          }
          break;
        case "openAlertPanel":
          if (this._results) {
            const selectedAlert = this._results.find(r => r.alertId === message.alertId);
            if (selectedAlert) {
              DashboardPanel.createOrShow(this._extensionUri, this._results, selectedAlert);
            }
          }
          break;
      }
    });

    this._updateHtml();
  }

  private async exportReport(format: "html" | "json") {
    if (!this._results || this._results.length === 0) {
      vscode.window.showWarningMessage("ZeroFalse: No results to export.");
      return;
    }

    const defaultUri = vscode.Uri.file(
      this._sarifPath 
        ? this._sarifPath.replace(/\.sarif$/i, `-adjudicated.${format}`)
        : `zerofalse-report.${format}`
    );

    const uri = await vscode.window.showSaveDialog({
      defaultUri,
      filters: format === "html" ? { "HTML Report": ["html"] } : { "JSON Data": ["json"] },
      saveLabel: "Export",
    });

    if (!uri) return;

    try {
      let content = "";
      if (format === "json") {
        const fpCount = this._results.filter(r => r.classification === "FP").length;
        const tpCount = this._results.filter(r => r.classification === "TP").length;
        const total = this._results.length;
        const fpReduction = total > 0 ? Math.round((fpCount / total) * 100) : 0;
        
        const jsonExport = {
          summary: {
            total: total,
            true_positive: tpCount,
            false_positive: fpCount,
            reduction_ratio: fpReduction
          },
          alerts: this._results.map(r => ({
            rule: r.ruleId,
            cwe: r.cwe,
            file: `${r.sink.file}:${r.sink.line}`,
            severity: "Unknown",
            classification: r.classification,
            confidence: r.confidence,
            reason: r.llmOutput["Explanation"],
            signals: {
              is_vulnerable: r.llmOutput["Is Vulnerable"] === "Yes",
              sanitization: r.llmOutput["Sanitization Found"] === "Yes",
              attack_feasible: r.llmOutput["Attack Feasible"] === "Yes"
            }
          }))
        };
        content = JSON.stringify(jsonExport, null, 2);
      } else {
        content = this.generateStandaloneHtmlReport();
      }

      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"));
      vscode.window.showInformationMessage(`ZeroFalse: Report exported to ${uri.fsPath}`);
    } catch (err) {
      vscode.window.showErrorMessage(`ZeroFalse: Export failed: ${(err as Error).message}`);
    }
  }

  private generateStandaloneHtmlReport(): string {
    const fpCount = this._results!.filter(r => r.classification === "FP").length;
    const tpCount = this._results!.filter(r => r.classification === "TP").length;
    const total = this._results!.length;
    const fpReduction = total > 0 ? Math.round((fpCount / total) * 100) : 0;
    const resultsJson = JSON.stringify(this._results).replace(/</g, '\\u003c');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>ZeroFalse Security Report</title>
  <style>
    :root {
      --bg-dark: #12141a;
      --panel-bg: #1e212b;
      --card-bg: #252836;
      --primary: #FF8000;
      --text-main: #FFFFFF;
      --text-muted: #8F95B2;
      --border-color: #313543;
      --fp-color: #00D084;
      --tp-color: #FF4D4F;
      --tp-bg: rgba(255, 77, 79, 0.15);
      --fp-bg: rgba(0, 208, 132, 0.15);
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg-dark);
      color: var(--text-main);
      margin: 0;
      padding: 0;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .header {
      background-color: var(--panel-bg);
      padding: 20px 40px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
    }
    .header h1 { margin: 0; font-size: 20px; font-weight: 600; }
    .container {
      padding: 30px 40px;
      max-width: 1400px;
      margin: 0 auto;
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      width: 100%;
      box-sizing: border-box;
      height: calc(100vh - 70px);
    }
    .summary-cards {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 20px;
      margin-bottom: 24px;
      flex-shrink: 0;
    }
    .card {
      background-color: var(--card-bg);
      border-radius: 12px;
      padding: 20px;
      border: 1px solid var(--border-color);
      box-shadow: 0 4px 6px rgba(0,0,0,0.3);
    }
    .card-label { font-size: 12px; color: var(--text-muted); text-transform: uppercase; font-weight: 600; margin-bottom: 8px; letter-spacing: 0.5px; }
    .card-value { font-size: 32px; font-weight: bold; }
    .text-tp { color: var(--tp-color); }
    .text-fp { color: var(--fp-color); }
    
    .dashboard-layout {
      display: grid;
      grid-template-columns: 3fr 2fr;
      gap: 20px;
      min-height: 0;
      flex-grow: 1;
    }
    
    .table-container {
      background-color: var(--card-bg);
      border-radius: 12px;
      border: 1px solid var(--border-color);
      overflow-y: auto;
    }
    table { width: 100%; border-collapse: collapse; text-align: left; }
    th {
      position: sticky;
      top: 0;
      background-color: var(--panel-bg);
      color: var(--text-muted);
      font-size: 11px;
      text-transform: uppercase;
      padding: 14px 16px;
      border-bottom: 1px solid var(--border-color);
      font-weight: 600;
      z-index: 10;
    }
    td {
      padding: 14px 16px;
      border-bottom: 1px solid rgba(255,255,255,0.03);
      font-size: 13px;
    }
    tbody tr { cursor: pointer; transition: background 0.2s; }
    tbody tr:hover { background-color: rgba(255,255,255,0.05); }
    tbody tr.active { background-color: rgba(255,128,0,0.1); border-left: 3px solid var(--primary); }
    
    .badge {
      font-size: 10px; font-weight: 700; padding: 4px 8px; border-radius: 6px; text-transform: uppercase; letter-spacing: 0.5px;
    }
    .badge-tp { background-color: var(--tp-bg); color: var(--tp-color); }
    .badge-fp { background-color: var(--fp-bg); color: var(--fp-color); }
    
    .details-panel {
      background-color: var(--card-bg);
      border-radius: 12px;
      border: 1px solid var(--border-color);
      padding: 24px;
      overflow-y: auto;
      box-sizing: border-box;
    }
    .details-placeholder {
      display: flex; height: 100%; align-items: center; justify-content: center; color: var(--text-muted); text-align: center; font-size: 14px;
    }
    .detail-row { margin-bottom: 16px; }
    .detail-label { font-size: 11px; color: var(--text-muted); margin-bottom: 6px; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px; }
    .detail-value { font-size: 13px; word-break: break-all; }
    .llm-reasoning { background: rgba(0,0,0,0.2); padding: 16px; border-radius: 8px; border: 1px solid var(--border-color); font-size: 13px; line-height: 1.6; margin-top: 20px; color: #E1E4F0; }
    
    .signals-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-top: 20px; }
    .signal-item { background: var(--panel-bg); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color); }
  </style>
</head>
<body>
  <div class="header">
    <h1>ZeroFalse Security Dashboard</h1>
    <div style="font-size: 13px; color: var(--text-muted);">Interactive Report</div>
  </div>
  <div class="container">
    <div class="summary-cards">
      <div class="card">
        <div class="card-label">Total Alerts</div>
        <div class="card-value">${total}</div>
      </div>
      <div class="card">
        <div class="card-label">True Positives</div>
        <div class="card-value text-tp">${tpCount}</div>
      </div>
      <div class="card">
        <div class="card-label">False Positives</div>
        <div class="card-value text-fp">${fpCount}</div>
      </div>
      <div class="card">
        <div class="card-label">Reduction Ratio</div>
        <div class="card-value" style="color: #FF8000;">${fpReduction}%</div>
      </div>
    </div>
    
    <div class="dashboard-layout">
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Rule / Vulnerability Type</th>
              <th>File Location</th>
              <th>Severity</th>
              <th>Classification</th>
              <th>Confidence</th>
            </tr>
          </thead>
          <tbody id="alerts-tbody">
          </tbody>
        </table>
      </div>
      <div class="details-panel" id="details-panel">
        <div class="details-placeholder">
          Select an alert from the table to view its detailed LLM analysis and signals.
        </div>
      </div>
    </div>
  </div>
  
  <script>
    const alertsData = ${resultsJson};
    
    function renderTable() {
      const tbody = document.getElementById('alerts-tbody');
      tbody.innerHTML = '';
      
      alertsData.forEach((alert, index) => {
        const isFp = alert.classification === 'FP';
        const tr = document.createElement('tr');
        tr.onclick = () => selectAlert(index, tr);
        
        tr.innerHTML = \`
          <td><strong style="color: #E1E4F0;">\${escapeHtml(alert.ruleId)}</strong></td>
          <td><code style="background: rgba(0,0,0,0.2); padding: 4px 6px; border-radius: 4px; font-size: 12px; color: #A5B4FC;">\${escapeHtml(alert.sink.file)}:\${alert.sink.line}</code></td>
          <td style="color: var(--text-muted);">Unknown</td>
          <td><span class="badge \${isFp ? 'badge-fp' : 'badge-tp'}">\${isFp ? 'FP' : 'TP'}</span></td>
          <td>\${escapeHtml(alert.confidence)}</td>
        \`;
        tbody.appendChild(tr);
      });
    }
    
    function selectAlert(index, rowElement) {
      document.querySelectorAll('#alerts-tbody tr').forEach(r => r.classList.remove('active'));
      rowElement.classList.add('active');
      
      const alert = alertsData[index];
      const isFp = alert.classification === 'FP';
      const detailsPanel = document.getElementById('details-panel');
      
      const isVuln = alert.llmOutput["Is Vulnerable"] || "N/A";
      const isSanit = alert.llmOutput["Sanitization Found"] || "N/A";
      const attackFeas = alert.llmOutput["Attack Feasible"] || "N/A";
      
      detailsPanel.innerHTML = \`
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid var(--border-color);">
          <div>
            <div style="font-size: 18px; font-weight: 600; margin-bottom: 6px; color: #FFFFFF;">\${escapeHtml(alert.ruleId)}</div>
            <div style="color: var(--text-muted); font-size: 12px; font-weight: 600;">CWE: <span style="color: #A5B4FC;">\${escapeHtml(alert.cwe)}</span></div>
          </div>
          <span class="badge \${isFp ? 'badge-fp' : 'badge-tp'}" style="font-size: 11px; padding: 6px 10px;">\${isFp ? 'FALSE POSITIVE' : 'TRUE POSITIVE'}</span>
        </div>
        
        <div class="detail-row">
          <div class="detail-label">Location</div>
          <div class="detail-value" style="font-family: monospace; background: rgba(0,0,0,0.2); padding: 8px 12px; border-radius: 6px; display: inline-block; color: #A5B4FC; font-size: 12px; border: 1px solid var(--border-color);">\${escapeHtml(alert.sink.file)}:\${alert.sink.line}</div>
        </div>
        
        <div class="signals-grid">
          <div class="signal-item">
            <div class="detail-label">Is Vulnerable</div>
            <div class="detail-value" style="font-weight: 600; color: \${isVuln === 'Yes' ? 'var(--tp-color)' : 'var(--text-main)'}">\${escapeHtml(isVuln)}</div>
          </div>
          <div class="signal-item">
            <div class="detail-label">Sanitization Found</div>
            <div class="detail-value" style="font-weight: 600; color: \${isSanit === 'Yes' ? 'var(--fp-color)' : 'var(--text-main)'}">\${escapeHtml(isSanit)}</div>
          </div>
          <div class="signal-item">
            <div class="detail-label">Attack Feasible</div>
            <div class="detail-value" style="font-weight: 600; color: \${attackFeas === 'Yes' ? 'var(--tp-color)' : 'var(--text-main)'}">\${escapeHtml(attackFeas)}</div>
          </div>
        </div>
        
        <div class="llm-reasoning">
          <div class="detail-label" style="margin-bottom: 12px; color: var(--text-main);">LLM Reasoning</div>
          \${escapeHtml(alert.llmOutput["Explanation"])}
        </div>
      \`;
    }
    
    function escapeHtml(str) {
      if (!str) return "";
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }
    
    renderTable();
  </script>
</body>
</html>`;
  }

  public updateResults(results: FinalResult[], sarifPath: string) {
    const isNewAlert = this._results && results.length === this._results.length + 1;
    const newAlert = isNewAlert ? results[results.length - 1] : null;

    this._results = results;
    this._sarifPath = sarifPath;

    if (isNewAlert && newAlert) {
      if (this._view) {
        this._view.webview.postMessage({ type: 'NEW_ALERT', alert: newAlert, total: results.length, fpCount: results.filter(r => r.classification === 'FP').length, tpCount: results.filter(r => r.classification === 'TP').length });
      }
      if (DashboardPanel.currentPanel) {
        DashboardPanel.currentPanel.postMessage({ type: 'NEW_ALERT', alert: newAlert, total: results.length, fpCount: results.filter(r => r.classification === 'FP').length, tpCount: results.filter(r => r.classification === 'TP').length });
      }
      return; // Do not rebuild UI
    }

    if (this._view) {
      this._updateHtml();
    }

    if (DashboardPanel.currentPanel && results.length > 0) {
      const currentSelected = DashboardPanel.currentPanel.currentSelectedAlert;
      let newSelectedAlert = results.find(r => r.alertId === currentSelected?.alertId);
      if (!newSelectedAlert) {
        newSelectedAlert = results[results.length - 1];
      }
      DashboardPanel.currentPanel.updateData(results, newSelectedAlert);
    }
  }

  public setRunningState(isRunning: boolean) {
    this._isRunning = isRunning;
    if (isRunning) {
      if (this._view) this._view.webview.postMessage({ type: 'SCAN_STARTED' });
      DashboardPanel.createOrShow(this._extensionUri, [], undefined);
      if (DashboardPanel.currentPanel) DashboardPanel.currentPanel.postMessage({ type: 'SCAN_STARTED' });
    } else {
      if (this._view) this._view.webview.postMessage({ type: 'SCAN_COMPLETED' });
      if (DashboardPanel.currentPanel) DashboardPanel.currentPanel.postMessage({ type: 'SCAN_COMPLETED' });
    }
    this._updateHtml();
  }

  public clearResults() {
    this._results = undefined;
    this._sarifPath = undefined;
    
    if (this._view) {
      this._view.webview.postMessage({ type: 'CLEAR_ALL' });
    }
    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel.postMessage({ type: 'CLEAR_ALL' });
    }
    
    this._updateHtml();
  }

  private _updateHtml() {
    if (!this._view) return;

    if (!this._results) {
      this._view.webview.html = this._getLoadingHtml();
      return;
    }

    this._view.webview.html = this._buildHtml(this._results, this._sarifPath!);
  }

  private _getLoadingHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ZeroFalse Results</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    
    :root {
      --bg-dark: #1A1D27;
      --card-bg: #252836;
      --primary: #FF8000;
      --primary-hover: #E67300;
      --text-main: #FFFFFF;
      --text-muted: #8F95B2;
      --border-color: #313543;
    }
    
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      padding: 20px;
      color: var(--text-main);
      background-color: var(--bg-dark);
      text-align: center;
      margin: 0;
    }
    .icon { font-size: 48px; margin-bottom: 20px; opacity: 0.8; }
    .actions { display: flex; flex-direction: column; gap: 12px; margin-bottom: 30px; }
    .btn {
      padding: 12px 16px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
      font-family: 'Inter', sans-serif;
      transition: all 0.2s ease;
    }
    .btn-primary { background: var(--primary); color: white; box-shadow: 0 4px 12px rgba(255, 128, 0, 0.3); }
    .btn-primary:hover { background: var(--primary-hover); transform: translateY(-1px); }
    .btn-secondary { background: var(--card-bg); color: var(--text-main); border: 1px solid var(--border-color); }
    .btn-secondary:hover { background: #2F3346; }
    .btn-cancel { background: #FF4D4F; color: white; }
    .btn-cancel:hover { background: #E64345; }
    
    .loading-card {
      background: var(--card-bg);
      border-radius: 12px;
      padding: 30px 20px;
      border: 1px solid var(--border-color);
      box-shadow: 0 8px 24px rgba(0,0,0,0.2);
    }
    h2 { margin: 0 0 10px 0; font-size: 18px; font-weight: 600; }
    p { color: var(--text-muted); font-size: 13px; line-height: 1.5; margin: 0; }
  </style>
</head>
<body>
  <div class="actions">
    ${this._isRunning
      ? `<button class="btn btn-cancel" onclick="vscode.postMessage({ command: 'cancelAnalysis' })">🛑 Cancel Analysis</button>`
      : `<button class="btn btn-primary" onclick="vscode.postMessage({ command: 'runAnalysis' })">▶ Run Analysis</button>`
    }
    <button class="btn btn-secondary" onclick="vscode.postMessage({ command: 'loadSarif' })" ${this._isRunning ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>📂 Load SARIF</button>
  </div>
  
  <div class="loading-card">
    <div class="icon">🛡️</div>
    <h2>ZeroFalse Security</h2>
    <p>Run <strong>Analysis</strong> or Load a SARIF file to view LLM-adjudicated results in a modern dashboard.</p>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
  </script>
</body>
</html>`;
  }

  private _buildHtml(results: FinalResult[], sarifPath: string): string {
    const totalAlerts = results.length;
    const fpCount = results.filter((r) => r.classification === "FP").length;
    const tpCount = results.filter((r) => r.classification === "TP").length;

    const fpReduction = totalAlerts > 0 ? Math.round((fpCount / totalAlerts) * 100) : 0;

    const cards = results
      .map((r) => {
        const isFp = r.classification === "FP";
        const badgeClass = isFp ? "badge-fp" : "badge-tp";
        const iconColor = isFp ? "#00D084" : "#FF4D4F";
        
        return `
          <div class="alert-card" onclick="vscode.postMessage({ command: 'openAlertPanel', alertId: '${r.alertId}' })" style="cursor: pointer;">
            <div class="alert-header">
              <div class="alert-title-group">
                <div class="alert-icon" style="background: ${isFp ? 'rgba(0, 208, 132, 0.1)' : 'rgba(255, 77, 79, 0.1)'}; color: ${iconColor};">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    ${isFp ? '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline>' : '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>'}
                  </svg>
                </div>
                <div class="alert-titles">
                  <span class="rule-id" title="${escapeHtml(r.ruleId)}">${escapeHtml(truncate(r.ruleId, 30))}</span>
                  <span class="cwe-id">${escapeHtml(r.cwe)}</span>
                </div>
              </div>
              <span class="badge ${badgeClass}">${isFp ? "FALSE POSITIVE" : "TRUE POSITIVE"}</span>
            </div>
            
            <div class="alert-body">
              <p class="message" title="${escapeHtml(r.message)}">${escapeHtml(truncate(r.message, 120))}</p>
              
              <div class="metrics-row">
                <div class="metric">
                  <span class="m-label">Confidence</span>
                  <span class="m-value ${r.confidence === 'High' ? (isFp ? 'text-fp' : 'text-tp') : 'text-muted'}">${escapeHtml(r.confidence)}</span>
                </div>
                <div class="metric">
                  <span class="m-label">Alert ID</span>
                  <span class="m-value id-hash">${escapeHtml(r.alertId.substring(0, 8))}</span>
                </div>
              </div>

              <div class="location-box">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>
                <span>${escapeHtml(r.sink.file)}:${r.sink.line}</span>
              </div>

              <details class="llm-details">
                <summary>
                  <span>LLM Reasoning Context</span>
                  <svg class="chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </summary>
                <div class="details-content">
                  <div class="d-row"><span class="d-label">Is Vulnerable:</span><span class="d-value">${escapeHtml(r.llmOutput["Is Vulnerable"])}</span></div>
                  <div class="d-row"><span class="d-label">Sanitization Found:</span><span class="d-value">${escapeHtml(r.llmOutput["Sanitization Found"])}</span></div>
                  <div class="d-row"><span class="d-label">Attack Feasible:</span><span class="d-value">${escapeHtml(r.llmOutput["Attack Feasible"])}</span></div>
                </div>
              </details>
            </div>
          </div>
        `;
      })
      .join("");

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ZeroFalse Results</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    
    :root {
      --bg-dark: #1A1D27;
      --card-bg: #252836;
      --card-hover: #2C3040;
      --primary: #FF8000;
      --primary-hover: #E67300;
      --text-main: #FFFFFF;
      --text-muted: #8F95B2;
      --border-color: #313543;
      --fp-color: #00D084;
      --tp-color: #FF4D4F;
      --accent-teal: #00B2A9;
    }
    
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background-color: var(--bg-dark);
      color: var(--text-main);
      padding: 16px;
      font-size: 13px;
      line-height: 1.5;
    }
    
    /* Header / Actions */
    .actions-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-bottom: 24px;
    }
    .btn {
      padding: 10px 12px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      font-size: 12px;
      font-family: 'Inter', sans-serif;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    .btn-primary { background: var(--primary); color: white; box-shadow: 0 4px 10px rgba(255, 128, 0, 0.25); }
    .btn-primary:hover { background: var(--primary-hover); transform: translateY(-1px); }
    .btn-secondary { background: var(--card-bg); color: var(--text-main); border: 1px solid var(--border-color); }
    .btn-secondary:hover { background: #2F3346; }
    .btn-cancel { background: var(--tp-color); color: white; }
    .btn-clear { background: rgba(255, 77, 79, 0.1); color: var(--tp-color); border: 1px solid rgba(255, 77, 79, 0.2); }
    .btn-clear:hover { background: rgba(255, 77, 79, 0.2); transform: translateY(-1px); }
    
    /* Dashboard Stats (Elegent Style) */
    .dashboard {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 24px;
    }
    .stat-card {
      background: var(--card-bg);
      border-radius: 12px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      border: 1px solid transparent;
      transition: border-color 0.2s;
    }
    .stat-card:hover { border-color: var(--border-color); }
    .stat-card.full-width {
      grid-column: span 2;
      flex-direction: row;
      justify-content: space-between;
      align-items: center;
      background: linear-gradient(135deg, var(--card-bg) 0%, #2A2D3C 100%);
      border-left: 3px solid var(--primary);
    }
    
    .stat-header { display: flex; align-items: center; gap: 8px; }
    .stat-icon {
      width: 32px; height: 32px;
      border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
    }
    .icon-orange { background: rgba(255, 128, 0, 0.1); color: var(--primary); }
    .icon-teal { background: rgba(0, 208, 132, 0.1); color: var(--fp-color); }
    .icon-red { background: rgba(255, 77, 79, 0.1); color: var(--tp-color); }
    
    .stat-label { font-size: 11px; color: var(--text-muted); font-weight: 500; }
    .stat-value { font-size: 20px; font-weight: 700; color: var(--text-main); }
    
    .text-fp { color: var(--fp-color); }
    .text-tp { color: var(--tp-color); }

    /* Alerts List Header */
    .section-title {
      font-size: 15px;
      font-weight: 600;
      margin-bottom: 12px;
      color: var(--text-main);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    /* Alert Cards */
    .alerts-list { display: flex; flex-direction: column; gap: 12px; }
    .alert-card {
      background: var(--card-bg);
      border-radius: 12px;
      overflow: hidden;
      transition: transform 0.2s, background 0.2s;
    }
    .alert-card:hover { background: var(--card-hover); }
    
    .alert-header {
      padding: 14px 16px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 1px solid rgba(255,255,255,0.03);
    }
    .alert-title-group { display: flex; gap: 12px; align-items: center; }
    .alert-icon {
      width: 36px; height: 36px;
      border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .alert-titles { display: flex; flex-direction: column; gap: 2px; }
    .rule-id { font-weight: 600; font-size: 13px; color: var(--text-main); }
    .cwe-id { font-size: 11px; color: var(--text-muted); }
    
    .badge {
      font-size: 10px;
      font-weight: 700;
      padding: 4px 8px;
      border-radius: 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .badge-fp { background: rgba(0, 208, 132, 0.15); color: var(--fp-color); }
    .badge-tp { background: rgba(255, 77, 79, 0.15); color: var(--tp-color); }

    .alert-body { padding: 14px 16px; }
    .message { font-size: 12px; color: #B4B9D1; margin-bottom: 16px; line-height: 1.5; }
    
    .metrics-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 16px;
    }
    .metric { display: flex; flex-direction: column; gap: 4px; }
    .m-label { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
    .m-value { font-size: 13px; font-weight: 600; }
    .id-hash { font-family: monospace; background: rgba(0,0,0,0.2); padding: 2px 6px; border-radius: 4px; display: inline-block; width: fit-content; color: #B4B9D1;}
    
    .location-box {
      background: rgba(0,0,0,0.15);
      border-radius: 6px;
      padding: 8px 10px;
      font-family: 'Inter', monospace;
      font-size: 11px;
      color: var(--accent-teal);
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
      border: 1px solid rgba(255,255,255,0.02);
    }
    .location-box span { word-break: break-all; }

    /* Accordion Details */
    .llm-details {
      background: rgba(0,0,0,0.1);
      border-radius: 8px;
      border: 1px solid var(--border-color);
      overflow: hidden;
    }
    .llm-details summary {
      padding: 10px 12px;
      cursor: pointer;
      font-weight: 500;
      font-size: 11px;
      color: var(--text-muted);
      display: flex;
      justify-content: space-between;
      align-items: center;
      user-select: none;
      list-style: none;
    }
    .llm-details summary::-webkit-details-marker { display: none; }
    .llm-details summary:hover { color: var(--text-main); background: rgba(255,255,255,0.02); }
    .llm-details[open] summary .chevron { transform: rotate(180deg); }
    .chevron { transition: transform 0.2s; }
    
    .details-content {
      padding: 12px;
      border-top: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .d-row { display: flex; justify-content: space-between; font-size: 11px; }
    .d-label { color: var(--text-muted); }
    .d-value { font-weight: 600; color: var(--text-main); text-align: right; }
  </style>
</head>
<body>

  <div class="actions-grid">
    ${this._isRunning
      ? `<button class="btn btn-cancel" onclick="vscode.postMessage({ command: 'cancelAnalysis' })">
           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg> Cancel
         </button>`
      : `<button class="btn btn-primary" onclick="vscode.postMessage({ command: 'runAnalysis' })">
           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Run Analysis
         </button>`
    }
    <button class="btn btn-secondary" onclick="vscode.postMessage({ command: 'loadSarif' })" ${this._isRunning ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg> Load
    </button>
    <button class="btn btn-secondary" onclick="vscode.postMessage({ command: 'exportHtml' })" ${this._isRunning ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>
      📄 Export HTML
    </button>
    <button class="btn btn-secondary" onclick="vscode.postMessage({ command: 'exportJson' })" ${this._isRunning ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>
      💾 Export JSON
    </button>
  </div>

  <div class="dashboard">
    <div class="stat-card full-width">
      <div>
        <div class="stat-label">Reduction Ratio</div>
        <div class="stat-value text-fp">${fpReduction}%</div>
      </div>
      <div style="text-align: right">
        <div class="stat-label">Total Alerts</div>
        <div class="stat-value">${totalAlerts}</div>
      </div>
    </div>
    
    <div class="stat-card">
      <div class="stat-header">
        <div class="stat-icon icon-teal">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
        </div>
        <div class="stat-label">False Pos</div>
      </div>
      <div class="stat-value text-fp" style="margin-top: 8px;">${fpCount}</div>
    </div>
    
    <div class="stat-card">
      <div class="stat-header">
        <div class="stat-icon icon-red">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
        </div>
        <div class="stat-label">True Pos</div>
      </div>
      <div class="stat-value text-tp" style="margin-top: 8px;">${tpCount}</div>
    </div>
  </div>

  <div class="section-title">
    Processed Alerts
    <button class="btn btn-clear" style="padding: 4px 8px; font-size: 11px;" onclick="vscode.postMessage({ command: 'clearResults' })" ${this._isRunning ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>
      Clear All
    </button>
  </div>

  <div class="alerts-list">
    ${cards || `
      <div class="alert-card" style="text-align: center; padding: 30px; border: 1px dashed var(--border-color); background: transparent;">
        <p style="color: var(--text-muted); font-size: 13px;">No alerts processed.</p>
      </div>
    `}
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    
    function escapeHtml(str) {
      if (!str) return "";
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function truncate(str, maxLen) {
      if (!str) return "";
      return str.length > maxLen ? str.slice(0, maxLen) + "…" : str;
    }

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'NEW_ALERT') {
        const { alert, total, fpCount, tpCount } = message;
        const isFp = alert.classification === 'FP';
        const fpReduction = total > 0 ? Math.round((fpCount / total) * 100) : 0;
        
        // Update stats
        const statValues = document.querySelectorAll('.stat-value');
        if (statValues.length >= 4) {
          statValues[0].textContent = fpReduction + '%';
          statValues[1].textContent = total;
          statValues[2].textContent = fpCount;
          statValues[3].textContent = tpCount;
        }

        const alertsList = document.querySelector('.alerts-list');
        const emptyState = alertsList.querySelector('.alert-card[style*="text-align: center"]');
        if (emptyState) emptyState.remove();

        const badgeClass = isFp ? "badge-fp" : "badge-tp";
        const iconColor = isFp ? "#00D084" : "#FF4D4F";
        
        const newCardHTML = \`
          <div class="alert-card" onclick="vscode.postMessage({ command: 'openAlertPanel', alertId: '\${alert.alertId}' })" style="cursor: pointer;">
            <div class="alert-header">
              <div class="alert-title-group">
                <div class="alert-icon" style="background: \${isFp ? 'rgba(0, 208, 132, 0.1)' : 'rgba(255, 77, 79, 0.1)'}; color: \${iconColor};">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    \${isFp ? '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline>' : '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>'}
                  </svg>
                </div>
                <div class="alert-titles">
                  <span class="rule-id" title="\${escapeHtml(alert.ruleId)}">\${escapeHtml(truncate(alert.ruleId, 30))}</span>
                  <span class="cwe-id">\${escapeHtml(alert.cwe)}</span>
                </div>
              </div>
              <span class="badge \${badgeClass}">\${isFp ? "FALSE POSITIVE" : "TRUE POSITIVE"}</span>
            </div>
            
            <div class="alert-body">
              <p class="message" title="\${escapeHtml(alert.message)}">\${escapeHtml(truncate(alert.message, 120))}</p>
              
              <div class="metrics-row">
                <div class="metric">
                  <span class="m-label">Confidence</span>
                  <span class="m-value \${alert.confidence === 'High' ? (isFp ? 'text-fp' : 'text-tp') : 'text-muted'}">\${escapeHtml(alert.confidence)}</span>
                </div>
                <div class="metric">
                  <span class="m-label">Alert ID</span>
                  <span class="m-value id-hash">\${escapeHtml(alert.alertId.substring(0, 8))}</span>
                </div>
              </div>

              <div class="location-box">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>
                <span>\${escapeHtml(alert.sink.file)}:\${alert.sink.line}</span>
              </div>

              <details class="llm-details">
                <summary>
                  <span>LLM Reasoning Context</span>
                  <svg class="chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </summary>
                <div class="details-content">
                  <div class="d-row"><span class="d-label">Is Vulnerable:</span><span class="d-value">\${escapeHtml(alert.llmOutput["Is Vulnerable"])}</span></div>
                  <div class="d-row"><span class="d-label">Sanitization Found:</span><span class="d-value">\${escapeHtml(alert.llmOutput["Sanitization Found"])}</span></div>
                  <div class="d-row"><span class="d-label">Attack Feasible:</span><span class="d-value">\${escapeHtml(alert.llmOutput["Attack Feasible"])}</span></div>
                </div>
              </details>
            </div>
          </div>
        \`;
        alertsList.insertAdjacentHTML('beforeend', newCardHTML);
      } else if (message.type === 'CLEAR_ALL' || message.type === 'RESET_SCAN' || message.type === 'SCAN_STARTED') {
        const statValues = document.querySelectorAll('.stat-value');
        if (statValues.length >= 4) {
          statValues[0].textContent = '0%';
          statValues[1].textContent = '0';
          statValues[2].textContent = '0';
          statValues[3].textContent = '0';
        }
        const alertsList = document.querySelector('.alerts-list');
        if (alertsList) {
          alertsList.innerHTML = \`
            <div class="alert-card" style="text-align: center; padding: 30px; border: 1px dashed var(--border-color); background: transparent;">
              <p style="color: var(--text-muted); font-size: 13px;">No alerts processed.</p>
            </div>
          \`;
        }
      }
    });
  </script>
</body>
</html>`;
  }
}

function escapeHtml(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(str: string, maxLen: number): string {
  if (!str) return "";
  return str.length > maxLen ? str.slice(0, maxLen) + "…" : str;
}
