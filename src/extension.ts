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

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

import { parseSarif } from "./sarif/parser";
import { extractContext } from "./pipeline/contextExtractor";
import { enrichAlert } from "./pipeline/cweEnricher";
import { buildPrompt } from "./pipeline/promptBuilder";
import { invokeOllama, verifyOllamaReachable, unloadOllamaModel } from "./llm/ollamaClient";
import { validateLLMOutput, deriveClassification } from "./llm/outputValidator";
import { ResultsViewProvider } from "./ui/resultsViewProvider";
import { initDecorations, applyAnnotations, clearAllAnnotations } from "./ui/inlineAnnotations";
import { SarifReport, FinalResult, Alert } from "./types";
import {
  isCodeQLInstalled,
  installCodeQL,
  runCodeQLAnalysis,
  detectCodeQL,
} from "./codeql/codeqlRunner";

// Per-session audit trail: alertId → { prompt, rawResponse }
const auditTrail = new Map<
  string,
  { prompt: string; rawResponse: string }
>();

export const cancellationController = {
  _cancelled: false,
  _listeners: [] as (() => void)[],
  get isCancelled() { return this._cancelled; },
  cancel() { 
    this._cancelled = true; 
    this._listeners.forEach(l => l());
  },
  onCancellationRequested(listener: () => void) {
    this._listeners.push(listener);
    return { dispose: () => { this._listeners = this._listeners.filter(l => l !== listener); } };
  },
  reset() { 
    this._cancelled = false; 
    this._listeners = [];
  }
};

// ---- Extension Activation ----

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  console.log("[ZeroFalse] Extension activating…");

  // Initialise decoration types (must run before any annotation call)
  initDecorations(context);

  // ---- Environment Validation ----
  // CodeQL detection is deferred to pipeline execution time so the extension
  // still activates normally when CodeQL is absent (user gets a clear error
  // only when they trigger the analysis).
  //
  // Ollama is validated here but the error is non-fatal: the extension
  // continues to activate so the user can still open SARIF files, etc.
  // Mock mode bypasses this check inside verifyOllamaReachable().
  try {
    await verifyOllamaReachable();
    console.log("[ZeroFalse] Ollama service reachable.");
  } catch (err) {
    vscode.window.showWarningMessage(
      "ZeroFalse: Local LLM service (Ollama) is not reachable. " +
        "Mock LLM mode is active — real adjudication requires `ollama serve`."
    );
    console.warn("[ZeroFalse] Ollama not reachable — continuing with mock/fallback mode.");
  }

  // ---- Webview Provider Setup ----
  const provider = new ResultsViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ResultsViewProvider.viewType, provider)
  );

  // ---- Register Commands ----

  const analyzeCmd = vscode.commands.registerCommand(
    "zerofalse.analyze",
    async (fileUri?: vscode.Uri) => {
      await runZeroFalsePipeline(fileUri, context, provider);
    }
  );

  const clearCmd = vscode.commands.registerCommand(
    "zerofalse.clearAnnotations",
    () => {
      clearAllAnnotations();
      vscode.window.showInformationMessage("ZeroFalse: Annotations cleared.");
    }
  );

  const cancelCmd = vscode.commands.registerCommand(
    "zerofalse.cancel",
    () => {
      cancellationController.cancel();
      unloadOllamaModel();
    }
  );

  const clearResultsCmd = vscode.commands.registerCommand(
    "zerofalse.clearResults",
    () => {
      provider.clearResults();
      unloadOllamaModel();
    }
  );

  context.subscriptions.push(analyzeCmd, clearCmd, cancelCmd, clearResultsCmd);
  console.log("[ZeroFalse] Extension activated — commands registered.");
}

export function deactivate(): void {
  auditTrail.clear();
  unloadOllamaModel();
}

// ---- Main Pipeline Orchestrator ----

async function runZeroFalsePipeline(
  fileUri: vscode.Uri | undefined,
  context: vscode.ExtensionContext,
  provider: ResultsViewProvider
): Promise<void> {
  cancellationController.reset();
  provider.clearResults();
  provider.setRunningState(true);

  const results: FinalResult[] = [];
  let finalSarifPath: string = "";
  let finalWorkspaceRoot: string = "";

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "ZeroFalse Pipeline",
        cancellable: true,
      },
      async (progress, token) => {
        const cancelDisposable = token.onCancellationRequested(() => {
          cancellationController.cancel();
        });

        try {
          // ------------------------------------------------------------------
          // Phase 1: Resolve SARIF path
          // ------------------------------------------------------------------
          let sarifPath: string | undefined;
          let workspaceRoot: string;

          if (fileUri && fileUri.fsPath.endsWith(".sarif")) {
            sarifPath = fileUri.fsPath;
            workspaceRoot = resolveWorkspaceRoot(sarifPath);
            console.log(`[ZeroFalse] Using provided SARIF file: ${sarifPath}`);
          } else {
            if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
              vscode.window.showErrorMessage("ZeroFalse: Please open a workspace folder to run analysis.");
              return;
            }
            workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;

            const codeqlPath = detectCodeQL();
            if (!codeqlPath) {
              vscode.window.showErrorMessage(
                "ZeroFalse: CodeQL was not found. Install the CodeQL CLI and ensure 'codeql' is on PATH, or place it at C:\\codeql\\codeql.exe."
              );
              return;
            }
            console.log(`[ZeroFalse] CodeQL found at: ${codeqlPath}`);

            try {
              sarifPath = await runCodeQLAnalysis(workspaceRoot, progress);
            } catch (err: any) {
              if (err.message === "CancelledByUser") {
                console.log("[ZeroFalse] CodeQL analysis was cancelled by the user.");
                return;
              }
              vscode.window.showErrorMessage(`ZeroFalse: ${err.message}`);
              return;
            }
          }

          if (!sarifPath || cancellationController.isCancelled) return;
          finalSarifPath = sarifPath;
          finalWorkspaceRoot = workspaceRoot;

          // ------------------------------------------------------------------
          // Phase 2: Read & Parse SARIF
          // ------------------------------------------------------------------
          let sarif: SarifReport;
          try {
            const raw = fs.readFileSync(sarifPath, "utf8");
            sarif = JSON.parse(raw) as SarifReport;
          } catch (err) {
            vscode.window.showErrorMessage(`ZeroFalse: Failed to read/parse SARIF file: ${(err as Error).message}`);
            return;
          }

          let alerts: Alert[];
          try {
            alerts = parseSarif(sarif, workspaceRoot);
          } catch (err) {
            vscode.window.showErrorMessage(`ZeroFalse: SARIF parsing failed: ${(err as Error).message}`);
            return;
          }

          if (alerts.length === 0) {
            vscode.window.showInformationMessage("ZeroFalse: No security alerts were found by CodeQL in this project.");
            return;
          }

          if (cancellationController.isCancelled) return;

          // ------------------------------------------------------------------
          // Phase 3: Verify LLM is reachable
          // ------------------------------------------------------------------
          try {
            await verifyOllamaReachable();
          } catch {
            vscode.window.showErrorMessage("ZeroFalse: Local LLM service is not reachable. Start Ollama with `ollama serve` or enable mock mode.");
            return;
          }

          if (cancellationController.isCancelled) return;

          // ------------------------------------------------------------------
          // Phase 4: Per-alert LLM adjudication pipeline
          // ------------------------------------------------------------------
          auditTrail.clear();
          const total = alerts.length;

          for (let i = 0; i < total; i++) {
            if (cancellationController.isCancelled) {
              console.log('[ZeroFalse] Analysis cancelled by user.');
              break;
            }
        const alert = alerts[i];
        const stepLabel = `Adjudicating alert ${i + 1}/${total}: ${alert.ruleId}`;
        progress.report({ message: stepLabel, increment: (1 / total) * 100 });

        console.log(`[ZeroFalse] [${i + 1}/${total}] Processing alert: ${alert.id}  rule=${alert.ruleId}  cwe=${alert.cwe}`);

        try {
          // Step A: Extract flow-sensitive code context (Algorithm 1)
          const codeContext = extractContext(alert, workspaceRoot);
          alert.codeContext = codeContext;

          // Step B: CWE enrichment
          const cweRules = enrichAlert(alert);

          // Step C: Build deterministic prompt
          const prompt = buildPrompt(alert, codeContext, cweRules);

          // Step D: LLM adjudication (independent per alert, no batching)
          console.log(`[ZeroFalse] Invoking LLM for alert ${alert.id}…`);
          const rawResponse = await invokeOllama(prompt, () => cancellationController.isCancelled);
          console.log(`[ZeroFalse] LLM response received for alert ${alert.id}.`);

          // Store audit trail entry
          auditTrail.set(alert.id, { prompt, rawResponse });

          // Step E: Validate output schema
          const llmOutput = validateLLMOutput(rawResponse);

          // Step F: Derive classification
          const classification = deriveClassification(llmOutput);

          console.log(
            `[ZeroFalse] Alert ${alert.id} classified as ${classification}  ` +
              `confidence=${llmOutput["Confidence"]}`
          );

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
        } catch (err) {
          // Individual alert failure: log and skip — do not abort entire run
          const errMsg = (err as Error).message;
          console.error(`[ZeroFalse] Alert ${alert.id} pipeline error: ${errMsg}`);
          vscode.window.showWarningMessage(
            `ZeroFalse: Alert ${alert.id} (${alert.ruleId}) could not be adjudicated: ${errMsg}`
          );
        }
        }
      } finally {
        cancelDisposable.dispose();
      }
    });

    if (cancellationController.isCancelled) {
      console.log("[ZeroFalse] Pipeline cancelled, exiting.");
      return;
    }

  // ------------------------------------------------------------------
  // Phase 5: Display results
  // ------------------------------------------------------------------
  if (cancellationController.isCancelled || !finalSarifPath || !finalWorkspaceRoot) return;

  if (results.length === 0) {
    vscode.window.showWarningMessage(
      "ZeroFalse: No alerts could be successfully adjudicated. " +
        "Check the Output panel for per-alert error details."
    );
    return;
  }

  console.log(`[ZeroFalse] Pipeline complete — ${results.length} result(s) ready for display.`);

  // Show results in the sidebar panel
  provider.updateResults(results, finalSarifPath);
  vscode.commands.executeCommand("zerofalse.resultsView.focus");

  // Apply inline gutter annotations to source files
  await applyAnnotations(results, finalWorkspaceRoot);

  vscode.window.showInformationMessage(
    `ZeroFalse: Analysis complete. ${results.length} alert(s) classified — ` +
      `FP: ${results.filter((r) => r.classification === "FP").length}, ` +
      `TP: ${results.filter((r) => r.classification === "TP").length}.`
  );
  } finally {
    provider.setRunningState(false);
    // Unload Ollama model to free up RAM once analysis is complete or aborted
    unloadOllamaModel();
  }
}

// ---- Helpers ----

/**
 * Resolve the workspace root for a given SARIF file path.
 * Prefers the VS Code workspace folder that contains the SARIF file.
 * Falls back to the first open workspace folder, then to the SARIF's directory.
 */
function resolveWorkspaceRoot(sarifPath: string): string {
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
