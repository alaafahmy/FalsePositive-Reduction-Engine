"use strict";
// ============================================================
// extension.ts — ZeroFalse VS Code Extension Entry Point
//
// Activation:
//   1. Initialise decoration types.
//   2. Validate Ollama reachability (skipped when USE_MOCK_LLM = true).
//   3. Register commands.
//
// Command: zerofalse.analyze
//   Accepts an optional SARIF URI (context-menu invocation).
//   When no URI is supplied the full CodeQL pipeline runs first:
//     detectCodeQL → runCodeQLAnalysis → SARIF path
//   Then the ZeroFalse analysis pipeline runs:
//     read SARIF → parseSarif → extractContext → enrichCWE →
//     buildPrompt → invokeOllama (per alert) → validateOutput →
//     deriveClassification → ResultsPanel + inline annotations.
//
// Execution policy:
//   - No intermediate results are displayed.
//   - Alerts with individual failures are skipped (warning shown).
//   - Zero-result SARIF files produce a warning but do NOT abort.
//   - CodeQL not found → error message + abort (no crash).
// ============================================================
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
exports.cancellationController = void 0;
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const parser_1 = require("./sarif/parser");
const contextExtractor_1 = require("./pipeline/contextExtractor");
const cweEnricher_1 = require("./pipeline/cweEnricher");
const promptBuilder_1 = require("./pipeline/promptBuilder");
const ollamaClient_1 = require("./llm/ollamaClient");
const outputValidator_1 = require("./llm/outputValidator");
const resultsViewProvider_1 = require("./ui/resultsViewProvider");
const inlineAnnotations_1 = require("./ui/inlineAnnotations");
const codeqlRunner_1 = require("./codeql/codeqlRunner");
// Per-session audit trail: alertId → { prompt, rawResponse }
const auditTrail = new Map();
exports.cancellationController = {
    _cancelled: false,
    _listeners: [],
    get isCancelled() { return this._cancelled; },
    cancel() {
        this._cancelled = true;
        this._listeners.forEach(l => l());
    },
    onCancellationRequested(listener) {
        this._listeners.push(listener);
        return { dispose: () => { this._listeners = this._listeners.filter(l => l !== listener); } };
    },
    reset() {
        this._cancelled = false;
        this._listeners = [];
    }
};
// ---- Extension Activation ----
async function activate(context) {
    console.log("[ZeroFalse] Extension activating…");
    // Initialise decoration types (must run before any annotation call)
    (0, inlineAnnotations_1.initDecorations)(context);
    // ---- Environment Validation ----
    // CodeQL detection is deferred to pipeline execution time so the extension
    // still activates normally when CodeQL is absent (user gets a clear error
    // only when they trigger the analysis).
    //
    // Ollama is validated here but the error is non-fatal: the extension
    // continues to activate so the user can still open SARIF files, etc.
    // Mock mode bypasses this check inside verifyOllamaReachable().
    try {
        await (0, ollamaClient_1.verifyOllamaReachable)();
        console.log("[ZeroFalse] Ollama service reachable.");
    }
    catch (err) {
        vscode.window.showWarningMessage("ZeroFalse: Local LLM service (Ollama) is not reachable. " +
            "Mock LLM mode is active — real adjudication requires `ollama serve`.");
        console.warn("[ZeroFalse] Ollama not reachable — continuing with mock/fallback mode.");
    }
    // ---- Webview Provider Setup ----
    const provider = new resultsViewProvider_1.ResultsViewProvider(context.extensionUri);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(resultsViewProvider_1.ResultsViewProvider.viewType, provider));
    // ---- Register Commands ----
    const analyzeCmd = vscode.commands.registerCommand("zerofalse.analyze", async (fileUri) => {
        await runZeroFalsePipeline(fileUri, context, provider);
    });
    const clearCmd = vscode.commands.registerCommand("zerofalse.clearAnnotations", () => {
        (0, inlineAnnotations_1.clearAllAnnotations)();
        vscode.window.showInformationMessage("ZeroFalse: Annotations cleared.");
    });
    const cancelCmd = vscode.commands.registerCommand("zerofalse.cancel", () => {
        exports.cancellationController.cancel();
        (0, ollamaClient_1.unloadOllamaModel)();
    });
    const clearResultsCmd = vscode.commands.registerCommand("zerofalse.clearResults", () => {
        provider.clearResults();
        (0, ollamaClient_1.unloadOllamaModel)();
    });
    context.subscriptions.push(analyzeCmd, clearCmd, cancelCmd, clearResultsCmd);
    console.log("[ZeroFalse] Extension activated — commands registered.");
}
function deactivate() {
    auditTrail.clear();
    (0, ollamaClient_1.unloadOllamaModel)();
}
// ---- Main Pipeline Orchestrator ----
async function runZeroFalsePipeline(fileUri, context, provider) {
    exports.cancellationController.reset();
    provider.clearResults();
    provider.setRunningState(true);
    const results = [];
    let finalSarifPath = "";
    let finalWorkspaceRoot = "";
    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "ZeroFalse Pipeline",
            cancellable: true,
        }, async (progress, token) => {
            const cancelDisposable = token.onCancellationRequested(() => {
                exports.cancellationController.cancel();
            });
            try {
                // ------------------------------------------------------------------
                // Phase 1: Resolve SARIF path
                // ------------------------------------------------------------------
                let sarifPath;
                let workspaceRoot;
                if (fileUri && fileUri.fsPath.endsWith(".sarif")) {
                    sarifPath = fileUri.fsPath;
                    workspaceRoot = resolveWorkspaceRoot(sarifPath);
                    console.log(`[ZeroFalse] Using provided SARIF file: ${sarifPath}`);
                }
                else {
                    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
                        vscode.window.showErrorMessage("ZeroFalse: Please open a workspace folder to run analysis.");
                        return;
                    }
                    workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
                    const codeqlPath = (0, codeqlRunner_1.detectCodeQL)();
                    if (!codeqlPath) {
                        vscode.window.showErrorMessage("ZeroFalse: CodeQL was not found. Install the CodeQL CLI and ensure 'codeql' is on PATH, or place it at C:\\codeql\\codeql.exe.");
                        return;
                    }
                    console.log(`[ZeroFalse] CodeQL found at: ${codeqlPath}`);
                    try {
                        sarifPath = await (0, codeqlRunner_1.runCodeQLAnalysis)(workspaceRoot, progress);
                    }
                    catch (err) {
                        if (err.message === "CancelledByUser") {
                            console.log("[ZeroFalse] CodeQL analysis was cancelled by the user.");
                            return;
                        }
                        vscode.window.showErrorMessage(`ZeroFalse: ${err.message}`);
                        return;
                    }
                }
                if (!sarifPath || exports.cancellationController.isCancelled)
                    return;
                finalSarifPath = sarifPath;
                finalWorkspaceRoot = workspaceRoot;
                // ------------------------------------------------------------------
                // Phase 2: Read & Parse SARIF
                // ------------------------------------------------------------------
                let sarif;
                try {
                    const raw = fs.readFileSync(sarifPath, "utf8");
                    sarif = JSON.parse(raw);
                }
                catch (err) {
                    vscode.window.showErrorMessage(`ZeroFalse: Failed to read/parse SARIF file: ${err.message}`);
                    return;
                }
                let alerts;
                try {
                    alerts = (0, parser_1.parseSarif)(sarif, workspaceRoot);
                }
                catch (err) {
                    vscode.window.showErrorMessage(`ZeroFalse: SARIF parsing failed: ${err.message}`);
                    return;
                }
                if (alerts.length === 0) {
                    vscode.window.showInformationMessage("ZeroFalse: No security alerts were found by CodeQL in this project.");
                    return;
                }
                if (exports.cancellationController.isCancelled)
                    return;
                // ------------------------------------------------------------------
                // Phase 3: Verify LLM is reachable
                // ------------------------------------------------------------------
                try {
                    await (0, ollamaClient_1.verifyOllamaReachable)();
                }
                catch {
                    vscode.window.showErrorMessage("ZeroFalse: Local LLM service is not reachable. Start Ollama with `ollama serve` or enable mock mode.");
                    return;
                }
                if (exports.cancellationController.isCancelled)
                    return;
                // ------------------------------------------------------------------
                // Phase 4: Per-alert LLM adjudication pipeline
                // ------------------------------------------------------------------
                auditTrail.clear();
                const total = alerts.length;
                for (let i = 0; i < total; i++) {
                    if (exports.cancellationController.isCancelled) {
                        console.log('[ZeroFalse] Analysis cancelled by user.');
                        break;
                    }
                    const alert = alerts[i];
                    const stepLabel = `Adjudicating alert ${i + 1}/${total}: ${alert.ruleId}`;
                    progress.report({ message: stepLabel, increment: (1 / total) * 100 });
                    console.log(`[ZeroFalse] [${i + 1}/${total}] Processing alert: ${alert.id}  rule=${alert.ruleId}  cwe=${alert.cwe}`);
                    try {
                        // Step A: Extract flow-sensitive code context (Algorithm 1)
                        const codeContext = (0, contextExtractor_1.extractContext)(alert, workspaceRoot);
                        alert.codeContext = codeContext;
                        // Step B: CWE enrichment
                        const cweRules = (0, cweEnricher_1.enrichAlert)(alert);
                        // Step C: Build deterministic prompt
                        const prompt = (0, promptBuilder_1.buildPrompt)(alert, codeContext, cweRules);
                        // Step D: LLM adjudication (independent per alert, no batching)
                        console.log(`[ZeroFalse] Invoking LLM for alert ${alert.id}…`);
                        const rawResponse = await (0, ollamaClient_1.invokeOllama)(prompt, () => exports.cancellationController.isCancelled);
                        console.log(`[ZeroFalse] LLM response received for alert ${alert.id}.`);
                        // Store audit trail entry
                        auditTrail.set(alert.id, { prompt, rawResponse });
                        // Step E: Validate output schema
                        const llmOutput = (0, outputValidator_1.validateLLMOutput)(rawResponse);
                        // Step F: Derive classification
                        const classification = (0, outputValidator_1.deriveClassification)(llmOutput);
                        console.log(`[ZeroFalse] Alert ${alert.id} classified as ${classification}  ` +
                            `confidence=${llmOutput["Confidence"]}`);
                        results.push({
                            alertId: alert.id,
                            classification,
                            confidence: llmOutput["Confidence"],
                            ruleId: alert.ruleId,
                            cwe: alert.cwe,
                            message: alert.message,
                            sink: alert.sink,
                            llmOutput,
                        });
                        // Stream result to UI immediately
                        provider.updateResults([...results], sarifPath || "");
                    }
                    catch (err) {
                        // Individual alert failure: log and skip — do not abort entire run
                        const errMsg = err.message;
                        console.error(`[ZeroFalse] Alert ${alert.id} pipeline error: ${errMsg}`);
                        vscode.window.showWarningMessage(`ZeroFalse: Alert ${alert.id} (${alert.ruleId}) could not be adjudicated: ${errMsg}`);
                    }
                }
            }
            finally {
                cancelDisposable.dispose();
            }
        });
        if (exports.cancellationController.isCancelled) {
            console.log("[ZeroFalse] Pipeline cancelled, exiting.");
            return;
        }
        // ------------------------------------------------------------------
        // Phase 5: Display results
        // ------------------------------------------------------------------
        if (exports.cancellationController.isCancelled || !finalSarifPath || !finalWorkspaceRoot)
            return;
        if (results.length === 0) {
            vscode.window.showWarningMessage("ZeroFalse: No alerts could be successfully adjudicated. " +
                "Check the Output panel for per-alert error details.");
            return;
        }
        console.log(`[ZeroFalse] Pipeline complete — ${results.length} result(s) ready for display.`);
        // Show results in the sidebar panel
        provider.updateResults(results, finalSarifPath);
        vscode.commands.executeCommand("zerofalse.resultsView.focus");
        // Apply inline gutter annotations to source files
        await (0, inlineAnnotations_1.applyAnnotations)(results, finalWorkspaceRoot);
        vscode.window.showInformationMessage(`ZeroFalse: Analysis complete. ${results.length} alert(s) classified — ` +
            `FP: ${results.filter((r) => r.classification === "FP").length}, ` +
            `TP: ${results.filter((r) => r.classification === "TP").length}.`);
    }
    finally {
        provider.setRunningState(false);
        // Unload Ollama model to free up RAM once analysis is complete or aborted
        (0, ollamaClient_1.unloadOllamaModel)();
    }
}
// ---- Helpers ----
/**
 * Resolve the workspace root for a given SARIF file path.
 * Prefers the VS Code workspace folder that contains the SARIF file.
 * Falls back to the first open workspace folder, then to the SARIF's directory.
 */
function resolveWorkspaceRoot(sarifPath) {
    // Prefer the workspace folder that contains the SARIF file
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        if (sarifPath.startsWith(folder.uri.fsPath)) {
            return folder.uri.fsPath;
        }
    }
    // Fall back to first open workspace folder
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        return vscode.workspace.workspaceFolders[0].uri.fsPath;
    }
    // Last resort: directory containing the SARIF file
    return path.dirname(sarifPath);
}
//# sourceMappingURL=extension.js.map