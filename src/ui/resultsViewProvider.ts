import * as vscode from "vscode";
import { FinalResult } from "../types";

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
        content = JSON.stringify(this._results, null, 2);
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

    const cardsHtml = this._results!.map(r => `
      <div style="border-left: 4px solid ${r.classification === 'FP' ? '#3fb950' : '#f85149'}; margin-bottom: 20px; padding: 15px; border-radius: 6px; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #eee; padding-bottom: 10px; margin-bottom: 10px;">
          <h3 style="margin: 0; color: #333; font-size: 16px;">${escapeHtml(r.ruleId)}</h3>
          <span style="background: ${r.classification === 'FP' ? '#e6ffec' : '#ffebe9'}; color: ${r.classification === 'FP' ? '#3fb950' : '#f85149'}; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 12px;">
            ${r.classification === 'FP' ? 'FALSE POSITIVE' : 'TRUE POSITIVE'}
          </span>
        </div>
        <p style="color: #666; font-size: 14px; margin-bottom: 15px;">${escapeHtml(r.message)}</p>
        <div style="display: flex; gap: 20px; margin-bottom: 15px; font-size: 13px; color: #555;">
          <div><strong>CWE:</strong> ${escapeHtml(r.cwe)}</div>
          <div><strong>Confidence:</strong> ${escapeHtml(r.confidence)}</div>
          <div><strong>Location:</strong> <code style="background: #f4f4f4; padding: 2px 5px; border-radius: 3px;">${escapeHtml(r.sink.file)}:${r.sink.line}</code></div>
        </div>
        <div style="background: #f9f9f9; padding: 12px; border-radius: 6px; border: 1px solid #eaeaea;">
          <h4 style="margin-top: 0; margin-bottom: 8px; color: #333;">LLM Analysis</h4>
          <p style="margin: 0; font-size: 13px; color: #444; line-height: 1.5;">${escapeHtml(r.llmOutput["Explanation"])}</p>
          <div style="display: flex; gap: 20px; margin-top: 10px; font-size: 12px; color: #666; font-family: monospace;">
            <div>Is Vulnerable: ${escapeHtml(r.llmOutput["Is Vulnerable"])}</div>
            <div>Sanitization Found: ${escapeHtml(r.llmOutput["Sanitization Found"])}</div>
            <div>Attack Feasible: ${escapeHtml(r.llmOutput["Attack Feasible"])}</div>
          </div>
        </div>
      </div>
    `).join("");

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>ZeroFalse Security Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f6f8fa; color: #24292f; margin: 0; padding: 40px; }
    .container { max-width: 900px; margin: 0 auto; }
    .header { text-align: center; margin-bottom: 40px; }
    .stats { display: flex; gap: 20px; justify-content: center; margin-bottom: 40px; }
    .stat-box { background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); text-align: center; flex: 1; border: 1px solid #eee; }
    .stat-value { font-size: 32px; font-weight: bold; margin-bottom: 5px; }
    .stat-label { font-size: 12px; color: #57606a; text-transform: uppercase; font-weight: 600; }
    @media print {
      body { background: white; padding: 0; }
      .container { max-width: 100%; }
      .stat-box { box-shadow: none; border: 1px solid #ccc; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin-bottom: 5px;">ZeroFalse Security Report</h1>
      <p style="color: #57606a; margin-top: 0;">Automated AI-Driven Adjudication Results</p>
    </div>
    
    <div class="stats">
      <div class="stat-box">
        <div class="stat-value" style="color: #d29922;">${fpReduction}%</div>
        <div class="stat-label">Reduction Ratio</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${total}</div>
        <div class="stat-label">Total Alerts</div>
      </div>
      <div class="stat-box">
        <div class="stat-value" style="color: #3fb950;">${fpCount}</div>
        <div class="stat-label">False Positives</div>
      </div>
      <div class="stat-box">
        <div class="stat-value" style="color: #f85149;">${tpCount}</div>
        <div class="stat-label">True Positives</div>
      </div>
    </div>

    ${cardsHtml}
  </div>
</body>
</html>`;
  }

  public updateResults(results: FinalResult[], sarifPath: string) {
    this._results = results;
    this._sarifPath = sarifPath;
    if (this._view) {
      this._updateHtml();
    }
  }

  public setRunningState(isRunning: boolean) {
    this._isRunning = isRunning;
    this._updateHtml();
  }

  public clearResults() {
    this._results = undefined;
    this._sarifPath = undefined;
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
    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      padding: 20px;
      color: var(--vscode-foreground);
      text-align: center;
      margin-top: 20px;
    }
    .icon { font-size: 32px; margin-bottom: 20px; opacity: 0.5; }
    .actions { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
    .btn {
      padding: 8px 12px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 600;
      color: white;
      font-size: 13px;
    }
    .btn-primary { background: var(--vscode-button-background, #007acc); }
    .btn-primary:hover { background: var(--vscode-button-hoverBackground, #005999); }
    .btn-secondary { background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #ffffff); border: 1px solid var(--vscode-button-border, transparent); }
    .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground, #45494e); }
    .btn-cancel { background: var(--vscode-errorForeground, #f85149); }
    .btn-cancel:hover { opacity: 0.8; }
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
  <div class="icon" style="margin-top: 40px;">🛡️</div>
  <p>Run <strong>Analysis</strong> or Load a SARIF file to view adjudicated results here.</p>

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
        const confClass =
          r.confidence === "High" ? "conf-high" : r.confidence === "Medium" ? "conf-medium" : "conf-low";

        return `
          <div class="card ${isFp ? "card-fp" : "card-tp"}">
            <div class="card-header">
              <span class="rule-id" title="${escapeHtml(r.ruleId)}">${escapeHtml(truncate(r.ruleId, 30))}</span>
              <span class="badge ${badgeClass}">${isFp ? "FALSE POSITIVE" : "TRUE POSITIVE"}</span>
            </div>
            
            <div class="card-body">
              <p class="message" title="${escapeHtml(r.message)}">${escapeHtml(truncate(r.message, 150))}</p>
              
              <div class="meta-grid">
                <div class="meta-item">
                  <span class="meta-label">ID</span>
                  <span class="meta-value copy" title="Copy">${escapeHtml(r.alertId.substring(0, 8))}…</span>
                </div>
                <div class="meta-item">
                  <span class="meta-label">CWE</span>
                  <span class="meta-value"><code>${escapeHtml(r.cwe)}</code></span>
                </div>
                <div class="meta-item">
                  <span class="meta-label">Confidence</span>
                  <span class="meta-value ${confClass}">${escapeHtml(r.confidence)}</span>
                </div>
              </div>

              <div class="location">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h5.5L14 4.5zm-3 0A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5h-2z"/></svg>
                <code>${escapeHtml(r.sink.file)}:${r.sink.line}</code>
              </div>

              <details>
                <summary>LLM Reasoning Context</summary>
                <div class="details-grid">
                  <div class="d-label">Is Vulnerable</div><div class="d-value">${escapeHtml(r.llmOutput["Is Vulnerable"])}</div>
                  <div class="d-label">Sanitization Found</div><div class="d-value">${escapeHtml(r.llmOutput["Sanitization Found"])}</div>
                  <div class="d-label">Attack Feasible</div><div class="d-value">${escapeHtml(r.llmOutput["Attack Feasible"])}</div>
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
    :root {
      --font-sans: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      --font-mono: var(--vscode-editor-font-family, 'Cascadia Code', 'Fira Code', 'Consolas', monospace);
      --bg: var(--vscode-sideBar-background);
      --surface: var(--vscode-editor-background);
      --border: var(--vscode-sideBarSectionHeader-border, rgba(128, 128, 128, 0.2));
      --text: var(--vscode-foreground);
      --text-muted: var(--vscode-descriptionForeground, #8b949e);
      --fp-color: #3fb950;
      --tp-color: #f85149;
      --accent: var(--vscode-textLink-foreground, #58a6ff);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--font-sans);
      background: var(--bg);
      color: var(--text);
      padding: 12px;
      font-size: 13px;
      line-height: 1.5;
      padding-bottom: 30px;
    }
    
    /* Buttons */
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
    .actions .btn { flex: 1 1 45%; }
    .btn {
      padding: 8px 12px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 600;
      color: white;
      font-size: 13px;
    }
    .btn-primary { background: var(--vscode-button-background, #007acc); }
    .btn-primary:hover { background: var(--vscode-button-hoverBackground, #005999); }
    .btn-secondary { background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #ffffff); border: 1px solid var(--vscode-button-border, transparent); }
    .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground, #45494e); }
    .btn-cancel { background: var(--vscode-errorForeground, #f85149); }
    .btn-cancel:hover { opacity: 0.8; }
    
    /* Stats Header */
    .dashboard {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-bottom: 20px;
    }
    .stat-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px;
      text-align: center;
    }
    .stat-card.full-width {
      grid-column: span 2;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
    }
    .stat-label { font-size: 10px; color: var(--text-muted); text-transform: uppercase; margin-bottom: 4px; }
    .stat-value { font-size: 20px; font-weight: bold; }
    .stat-value.fp { color: var(--fp-color); }
    .stat-value.tp { color: var(--tp-color); }

    /* Cards List */
    .cards-container {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
      border-left: 4px solid var(--border);
      box-shadow: 0 2px 5px rgba(0,0,0,0.1);
    }
    .card-fp { border-left-color: var(--fp-color); }
    .card-tp { border-left-color: var(--tp-color); }

    .card-header {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgba(0,0,0,0.1);
    }
    .rule-id { font-weight: 600; font-size: 11px; }
    
    .badge {
      font-size: 9px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 3px;
    }
    .badge-fp { background: rgba(63, 185, 80, 0.15); color: var(--fp-color); }
    .badge-tp { background: rgba(248, 81, 73, 0.15); color: var(--tp-color); }

    .card-body { padding: 12px; }
    .message { font-size: 11px; color: var(--text-muted); margin-bottom: 12px; line-height: 1.4; }
    
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      background: rgba(0,0,0,0.05);
      border-radius: 4px;
      padding: 8px;
      margin-bottom: 12px;
    }
    .meta-item { display: flex; flex-direction: column; }
    .meta-label { font-size: 9px; color: var(--text-muted); text-transform: uppercase; margin-bottom: 2px; }
    .meta-value { font-size: 11px; font-weight: 500; }
    .meta-value code { font-family: var(--font-mono); background: rgba(0,0,0,0.1); padding: 1px 4px; border-radius: 3px;}
    
    .conf-high { color: var(--fp-color); }
    .conf-medium { color: #d29922; }
    .conf-low { color: var(--text-muted); }

    .location {
      font-family: var(--font-mono);
      font-size: 10px;
      color: var(--accent);
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 12px;
      padding-top: 8px;
      border-top: 1px dashed var(--border);
      word-break: break-all;
    }

    details {
      font-size: 11px;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: rgba(0,0,0,0.05);
    }
    summary {
      padding: 6px 10px;
      cursor: pointer;
      font-weight: 600;
      color: var(--text-muted);
      user-select: none;
    }
    summary:hover { color: var(--text); }
    .details-grid {
      border-top: 1px solid var(--border);
      padding: 8px 10px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .d-label { color: var(--text-muted); }
    .d-value { font-weight: 500; text-align: right; }
  </style>
</head>
<body>

  <div class="actions">
    ${this._isRunning
      ? `<button class="btn btn-cancel" onclick="vscode.postMessage({ command: 'cancelAnalysis' })">🛑 Cancel</button>`
      : `<button class="btn btn-primary" onclick="vscode.postMessage({ command: 'runAnalysis' })">▶ Run</button>`
    }
    <button class="btn btn-secondary" onclick="vscode.postMessage({ command: 'loadSarif' })" ${this._isRunning ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>📂 Load</button>
    <button class="btn btn-secondary" onclick="vscode.postMessage({ command: 'exportHtml' })" ${this._isRunning ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>📄 Export HTML</button>
    <button class="btn btn-secondary" onclick="vscode.postMessage({ command: 'exportJson' })" ${this._isRunning ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>💾 Export JSON</button>
    <button class="btn btn-secondary" onclick="vscode.postMessage({ command: 'clearResults' })" ${this._isRunning ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>🗑️ Clear</button>
  </div>

  <div class="dashboard">
    <div class="stat-card full-width">
      <div style="text-align: left">
        <div class="stat-label">Reduction Ratio</div>
        <div class="stat-value" style="color: #d29922">${fpReduction}%</div>
      </div>
      <div style="text-align: right">
        <div class="stat-label">Total Alerts</div>
        <div class="stat-value">${totalAlerts}</div>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-label">False Positives</div>
      <div class="stat-value fp">${fpCount}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">True Positives</div>
      <div class="stat-value tp">${tpCount}</div>
    </div>
  </div>

  <div class="cards-container">
    ${cards || '<p style="text-align:center; color: var(--text-muted);">No alerts processed.</p>'}
  </div>

  <script>
    const vscode = acquireVsCodeApi();
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
