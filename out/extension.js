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
exports.cancelRequested = void 0;
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
exports.cancelRequested = false;
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
        exports.cancelRequested = true;
    });
    const clearResultsCmd = vscode.commands.registerCommand("zerofalse.clearResults", () => {
        provider.clearResults();
    });
    context.subscriptions.push(analyzeCmd, clearCmd, cancelCmd, clearResultsCmd);
    console.log("[ZeroFalse] Extension activated — commands registered.");
}
function deactivate() {
    auditTrail.clear();
}
// ---- Main Pipeline Orchestrator ----
async function runZeroFalsePipeline(fileUri, context, provider) {
    exports.cancelRequested = false;
    provider.clearResults();
    provider.setRunningState(true);
    exports.cancelRequested = false;
    provider.clearResults();
    provider.setRunningState(true);
    try {
        // ------------------------------------------------------------------
        // Phase 1: Resolve SARIF path
        //   Case A: User right-clicked a .sarif file → use it directly.
        //   Case B: No file provided → run CodeQL to generate the SARIF.
        // ------------------------------------------------------------------
        let sarifPath;
        let workspaceRoot;
        if (fileUri && fileUri.fsPath.endsWith(".sarif")) {
            // ---- Case A: Direct SARIF file ----
            sarifPath = fileUri.fsPath;
            workspaceRoot = resolveWorkspaceRoot(sarifPath);
            console.log(`[ZeroFalse] Using provided SARIF file: ${sarifPath}`);
        }
        else {
            // ---- Case B: Run CodeQL pipeline ----
            // Validate that a workspace is open
            if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
                vscode.window.showErrorMessage("ZeroFalse: Please open a workspace folder to run analysis.");
                return;
            }
            workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
            // Step 1: Detect CodeQL — abort with a clear message if absent
            const codeqlPath = (0, codeqlRunner_1.detectCodeQL)();
            if (!codeqlPath) {
                vscode.window.showErrorMessage("ZeroFalse: CodeQL was not found. " +
                    "Install the CodeQL CLI and ensure 'codeql' is on PATH, " +
                    "or place it at C:\\codeql\\codeql.exe.");
                console.error("[ZeroFalse] Aborting — CodeQL not found.");
                return; // Safe stop
            }
            console.log(`[ZeroFalse] CodeQL found at: ${codeqlPath}`);
            // Step 2: Run CodeQL database create + analyze
            try {
                sarifPath = await (0, codeqlRunner_1.runCodeQLAnalysis)(workspaceRoot);
            }
            catch (err) {
                vscode.window.showErrorMessage(`ZeroFalse: ${err.message}`);
                return;
            }
        }
        if (!sarifPath) {
            console.error("[ZeroFalse] sarifPath is undefined after resolution — aborting.");
            return;
        }
        // ------------------------------------------------------------------
        // Phase 2: Read & Parse SARIF
        // ------------------------------------------------------------------
        let sarif;
        try {
            const raw = fs.readFileSync(sarifPath, "utf8");
            sarif = JSON.parse(raw);
            console.log(`[ZeroFalse] SARIF file read successfully: ${sarifPath}`);
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
        console.log(`[ZeroFalse] SARIF parsed — ${alerts.length} alert(s) found.`);
        // ---- SARIF Empty: stop cleanly, no synthetic data ----
        if (alerts.length === 0) {
            console.log("[ZeroFalse] CodeQL returned 0 alerts — nothing to adjudicate.");
            vscode.window.showInformationMessage("ZeroFalse: No security alerts were found by CodeQL in this project.");
            return;
        }
        // ------------------------------------------------------------------
        // Phase 3: Verify LLM is reachable before processing alerts
        // ------------------------------------------------------------------
        try {
            await (0, ollamaClient_1.verifyOllamaReachable)();
        }
        catch {
            vscode.window.showErrorMessage("ZeroFalse: Local LLM service is not reachable. " +
                "Start Ollama with `ollama serve` and pull llama3:8b, or enable mock mode.");
            return;
        }
        // ------------------------------------------------------------------
        // Phase 4: Per-alert LLM adjudication pipeline
        // ------------------------------------------------------------------
        const results = [];
        auditTrail.clear();
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "ZeroFalse",
            cancellable: false,
        }, async (progress) => {
            const total = alerts.length;
            for (let i = 0; i < total; i++) {
                if (exports.cancelRequested) {
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
                    const rawResponse = await (0, ollamaClient_1.invokeOllama)(prompt, () => exports.cancelRequested);
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
        });
        // ------------------------------------------------------------------
        // Phase 5: Display results
        // ------------------------------------------------------------------
        if (results.length === 0) {
            vscode.window.showWarningMessage("ZeroFalse: No alerts could be successfully adjudicated. " +
                "Check the Output panel for per-alert error details.");
            return;
        }
        console.log(`[ZeroFalse] Pipeline complete — ${results.length} result(s) ready for display.`);
        // Show results in the sidebar panel
        provider.updateResults(results, sarifPath);
        vscode.commands.executeCommand("zerofalse.resultsView.focus");
        // Apply inline gutter annotations to source files
        await (0, inlineAnnotations_1.applyAnnotations)(results, workspaceRoot);
        vscode.window.showInformationMessage(`ZeroFalse: Analysis complete. ${results.length} alert(s) classified — ` +
            `FP: ${results.filter((r) => r.classification === "FP").length}, ` +
            `TP: ${results.filter((r) => r.classification === "TP").length}.`);
    }
    finally {
        provider.setRunningState(false);
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