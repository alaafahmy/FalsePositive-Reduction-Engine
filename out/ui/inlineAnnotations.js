"use strict";
// ============================================================
// ui/inlineAnnotations.ts
//
// Applies inline gutter decorations to source files after
// the full ZeroFalse pipeline completes.
//
// Policy:
//   - Annotations are only applied after all results are final.
//   - FP alerts → green annotation in gutter + hover message
//   - TP alerts → red annotation in gutter + hover message
//   - Clears all previous decorations before applying new ones.
//   - No annotation is shown during processing.
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
exports.initDecorations = initDecorations;
exports.clearAllAnnotations = clearAllAnnotations;
exports.applyAnnotations = applyAnnotations;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
// Decoration type for False Positives (green)
let fpDecorationType;
// Decoration type for True Positives (red)
let tpDecorationType;
// Track all active decorations for cleanup
const activeDecorations = new Map();
/**
 * Initialise decoration types.
 * Must be called once from extension activation.
 */
function initDecorations(context) {
    fpDecorationType = vscode.window.createTextEditorDecorationType({
        gutterIconSize: "contain",
        overviewRulerColor: new vscode.ThemeColor("charts.green"),
        overviewRulerLane: vscode.OverviewRulerLane.Right,
        after: {
            contentText: " ✓ ZeroFalse: False Positive",
            color: new vscode.ThemeColor("charts.green"),
            margin: "0 0 0 16px",
            fontStyle: "italic",
        },
    });
    tpDecorationType = vscode.window.createTextEditorDecorationType({
        gutterIconSize: "contain",
        overviewRulerColor: new vscode.ThemeColor("charts.red"),
        overviewRulerLane: vscode.OverviewRulerLane.Right,
        after: {
            contentText: " ⚠ ZeroFalse: True Positive",
            color: new vscode.ThemeColor("charts.red"),
            margin: "0 0 0 16px",
            fontStyle: "italic",
        },
    });
    context.subscriptions.push(fpDecorationType, tpDecorationType);
}
/**
 * Clear all active ZeroFalse decorations from all open editors.
 */
function clearAllAnnotations() {
    activeDecorations.clear();
    vscode.window.visibleTextEditors.forEach((editor) => {
        if (fpDecorationType)
            editor.setDecorations(fpDecorationType, []);
        if (tpDecorationType)
            editor.setDecorations(tpDecorationType, []);
    });
}
/**
 * Apply inline annotations to all relevant open editors.
 * Called only after full pipeline completion.
 *
 * @param results - Final validated results from the ZeroFalse pipeline
 * @param workspaceRoot - Root directory to resolve relative file paths
 */
async function applyAnnotations(results, workspaceRoot) {
    clearAllAnnotations();
    // Group decorations by absolute file path
    for (const result of results) {
        const absFile = resolveFilePath(result.sink.file, workspaceRoot);
        const lineIndex = result.sink.line - 1; // 0-based
        if (!activeDecorations.has(absFile)) {
            activeDecorations.set(absFile, { fp: [], tp: [] });
        }
        const entry = activeDecorations.get(absFile);
        const range = new vscode.Range(lineIndex, 0, lineIndex, 0);
        const hoverMessage = buildHoverMessage(result);
        const decoration = {
            range,
            hoverMessage,
        };
        if (result.classification === "FP") {
            entry.fp.push(decoration);
        }
        else {
            entry.tp.push(decoration);
        }
    }
    // Apply to currently visible editors
    applyToVisibleEditors();
    // Also listen for new editors opening
    vscode.window.onDidChangeVisibleTextEditors(() => {
        applyToVisibleEditors();
    });
}
/**
 * Apply collected decorations to all currently visible editors.
 */
function applyToVisibleEditors() {
    if (!fpDecorationType || !tpDecorationType)
        return;
    vscode.window.visibleTextEditors.forEach((editor) => {
        const docUri = editor.document.uri.fsPath;
        // Match by absolute path or by ending segment
        let entry = activeDecorations.get(docUri);
        if (!entry) {
            // Try fuzzy match by file basename overlap
            for (const [key, val] of activeDecorations.entries()) {
                if (docUri.endsWith(key.replace(/\//g, path.sep)) ||
                    key.endsWith(docUri)) {
                    entry = val;
                    break;
                }
            }
        }
        if (entry) {
            editor.setDecorations(fpDecorationType, entry.fp);
            editor.setDecorations(tpDecorationType, entry.tp);
        }
        else {
            editor.setDecorations(fpDecorationType, []);
            editor.setDecorations(tpDecorationType, []);
        }
    });
}
function buildHoverMessage(result) {
    const md = new vscode.MarkdownString("", true);
    md.isTrusted = true;
    const icon = result.classification === "FP" ? "✓" : "⚠";
    const label = result.classification === "FP" ? "FALSE POSITIVE" : "TRUE POSITIVE";
    md.appendMarkdown(`### ZeroFalse: ${icon} ${label}\n\n`);
    md.appendMarkdown(`| Field | Value |\n|---|---|\n`);
    md.appendMarkdown(`| **Alert ID** | \`${result.alertId}\` |\n`);
    md.appendMarkdown(`| **Rule** | \`${result.ruleId}\` |\n`);
    md.appendMarkdown(`| **CWE** | \`${result.cwe}\` |\n`);
    md.appendMarkdown(`| **Confidence** | ${result.confidence} |\n`);
    md.appendMarkdown(`| **Is Vulnerable** | ${result.llmOutput["Is Vulnerable"]} |\n`);
    md.appendMarkdown(`| **Sanitization Found** | ${result.llmOutput["Sanitization Found"]} |\n`);
    md.appendMarkdown(`| **Attack Feasible** | ${result.llmOutput["Attack Feasible"]} |\n`);
    md.appendMarkdown(`\n**Message:** ${result.message}`);
    return md;
}
function resolveFilePath(file, workspaceRoot) {
    if (path.isAbsolute(file))
        return file;
    return path.join(workspaceRoot, file);
}
//# sourceMappingURL=inlineAnnotations.js.map