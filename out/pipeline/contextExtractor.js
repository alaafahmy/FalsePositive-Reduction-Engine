"use strict";
// ============================================================
// pipeline/contextExtractor.ts
//
// Refactored flow-sensitive context extraction.
// Reconstructs the propagation path between dataflow steps in pairs.
// Matches the structured output format requested by the ZeroFalse paper.
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
exports.extractContext = extractContext;
exports.formatCodeContext = formatCodeContext;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// ---- File line cache (keyed by absolute path) ----
const fileLineCache = new Map();
function getFileLines(absPath) {
    if (fileLineCache.has(absPath)) {
        return fileLineCache.get(absPath);
    }
    try {
        const content = fs.readFileSync(absPath, "utf8");
        const lines = content.split(/\r?\n/);
        fileLineCache.set(absPath, lines);
        return lines;
    }
    catch {
        return null;
    }
}
// ---- Method boundary detection ----
const METHOD_START_PATTERNS = [
    /^\s*(public|private|protected|static|async|override|abstract|final|synchronized|native|internal|open|sealed)\b[\s\S]*?\w+\s*\([^)]*\)\s*(throws\s+\w+(\s*,\s*\w+)*)?\s*(\{|:)?\s*$/,
    /^\s*(?:[\w<>\[\]]+\s+){1,3}\w+\s*\([^)]*\)\s*(\{|throws)?\s*$/,
    /^\s*def\s+\w[\w0-9_]*\s*\(/,
    /^\s*func\s+(?:\(.*?\)\s+)?\w[\w0-9_]*\s*\(/,
    /^\s*(export\s+)?(const|let|var)\s+\w[\w0-9_]*\s*=\s*(async\s*)?\(/,
    /^\s*(suspend\s+)?fun\s+\w[\w0-9_]*\s*\(/,
    /^\s*(pub(\s*\(.*?\))?\s+)?(async\s+)?fn\s+\w[\w0-9_]*\s*(<.*?>)?\s*\(/,
    /^\s*def\s+\w[\w0-9_?!]*\s*(\(|$)/,
];
function looksLikeMethodStart(line) {
    return METHOD_START_PATTERNS.some((p) => p.test(line));
}
function findMethodBounds(lines, targetLine // 1-based
) {
    for (let i = targetLine - 1; i >= 0; i--) {
        if (looksLikeMethodStart(lines[i])) {
            const endIdx = findMethodEnd(lines, i);
            return { startIdx: i, endIdx };
        }
    }
    return null;
}
function findMethodEnd(lines, startIdx) {
    const startLine = lines[startIdx];
    // Indent-based (Python)
    if (/^\s*def\s+/.test(startLine)) {
        const baseIndent = startLine.search(/\S/);
        for (let i = startIdx + 1; i < lines.length; i++) {
            const l = lines[i];
            if (l.trim() === "")
                continue;
            const indent = l.search(/\S/);
            if (indent <= baseIndent)
                return i - 1;
        }
        return lines.length - 1;
    }
    // Brace-based
    let depth = 0;
    let foundOpen = false;
    for (let i = startIdx; i < lines.length; i++) {
        for (const ch of lines[i]) {
            if (ch === "{") {
                depth++;
                foundOpen = true;
            }
            else if (ch === "}") {
                depth--;
                if (foundOpen && depth === 0)
                    return i;
            }
        }
    }
    return Math.min(startIdx + 200, lines.length - 1);
}
// ---- Formatting Helpers ----
function renderLines(lines, fromIdx, toIdx) {
    const clamped = Math.min(toIdx, lines.length - 1);
    return lines
        .slice(fromIdx, clamped + 1)
        .map((l, offset) => `${fromIdx + offset + 1}: ${l}`)
        .join("\n");
}
function resolveAbsPath(stepFile, workspaceRoot) {
    if (path.isAbsolute(stepFile))
        return stepFile;
    return path.join(workspaceRoot, stepFile);
}
function roleFromType(type) {
    if (type === "source")
        return "source";
    if (type === "sink")
        return "sink";
    return "intermediate";
}
function getAnnotationType(step) {
    const desc = step.description.toLowerCase();
    if (step.type === "source")
        return "SOURCE";
    if (step.type === "sink")
        return "SINK";
    if (desc.includes("sanitize") || desc.includes("escape") || desc.includes("encode") || desc.includes("validate")) {
        return "SANITIZATION";
    }
    return "PROPAGATION";
}
// ---- Core Logic ----
function extractContext(alert, workspaceRoot) {
    const trace = alert.trace;
    if (trace.length === 0) {
        return {
            source: "",
            steps: [],
            sink: "",
            code_context: "[No dataflow context available]",
            annotations: []
        };
    }
    const snippets = [];
    const annotations = [];
    // Handle annotations
    trace.forEach((step, idx) => {
        const annType = getAnnotationType(step);
        annotations.push(`[${idx + 1}] ${annType}: ${step.file}:${step.line} - ${step.description}`);
    });
    // Edge case: single-step sink (no propagation possible)
    if (trace.length === 1) {
        const step = trace[0];
        const absPath = resolveAbsPath(step.file, workspaceRoot);
        const lines = getFileLines(absPath);
        if (lines) {
            const bounds = findMethodBounds(lines, step.line);
            const startLine = bounds ? bounds.startIdx + 1 : step.line;
            snippets.push({
                file: step.file,
                startLine,
                endLine: step.line,
                code: renderLines(lines, startLine - 1, step.line - 1),
                role: "sink",
            });
        }
    }
    else {
        // Proper dataflow: Iterate pairwise (step[i], step[i+1])
        for (let i = 0; i < trace.length - 1; i++) {
            const currentStep = trace[i];
            const nextStep = trace[i + 1];
            const absCurrent = resolveAbsPath(currentStep.file, workspaceRoot);
            const absNext = resolveAbsPath(nextStep.file, workspaceRoot);
            const linesCurrent = getFileLines(absCurrent);
            const linesNext = getFileLines(absNext);
            if (!linesCurrent || !linesNext) {
                continue; // Unreadable file(s)
            }
            const boundsCurrent = findMethodBounds(linesCurrent, currentStep.line);
            const boundsNext = findMethodBounds(linesNext, nextStep.line);
            // Case 1: Both steps are in the SAME file AND SAME method
            if (currentStep.file === nextStep.file &&
                boundsCurrent && boundsNext &&
                boundsCurrent.startIdx === boundsNext.startIdx) {
                const startIdx = Math.min(currentStep.line - 1, nextStep.line - 1);
                const endIdx = Math.max(currentStep.line - 1, nextStep.line - 1);
                snippets.push({
                    file: currentStep.file,
                    startLine: startIdx + 1,
                    endLine: endIdx + 1,
                    role: roleFromType(currentStep.type),
                    code: renderLines(linesCurrent, startIdx, endIdx),
                    relatedTo: i + 1,
                });
            }
            // Case 2: Different methods or different files (Interprocedural)
            else {
                // Snippet A: Caller logic
                const startCurrent = boundsCurrent ? boundsCurrent.startIdx : currentStep.line - 1;
                snippets.push({
                    file: currentStep.file,
                    startLine: startCurrent + 1,
                    endLine: currentStep.line,
                    role: roleFromType(currentStep.type),
                    code: renderLines(linesCurrent, startCurrent, currentStep.line - 1),
                    relatedTo: i + 1,
                });
                // Snippet B: Callee target function representation
                const startNext = boundsNext ? boundsNext.startIdx : nextStep.line - 1;
                snippets.push({
                    file: nextStep.file,
                    startLine: startNext + 1,
                    endLine: nextStep.line,
                    role: roleFromType(nextStep.type),
                    code: renderLines(linesNext, startNext, nextStep.line - 1),
                    relatedTo: i + 1,
                });
            }
        }
    }
    // Deduplicate completely identical/overlapping spans
    const dedupedSnippets = deduplicateSnippets(snippets, fileLineCache, workspaceRoot);
    const code_context = dedupedSnippets.map((s, idx) => {
        const roleLabel = s.role.toUpperCase();
        const relStr = s.relatedTo !== undefined ? ` (propagates to step [${s.relatedTo + 1}])` : "";
        return `=== [${idx + 1}] ${roleLabel}${relStr} — ${s.file} (Lines ${s.startLine}–${s.endLine}) ===\n${s.code}`;
    }).join("\n\n");
    const sourceCode = dedupedSnippets.find(s => s.role === "source")?.code || "";
    const sinkCode = dedupedSnippets.filter(s => s.role === "sink").pop()?.code || "";
    const stepsCode = dedupedSnippets.filter(s => s.role === "intermediate").map(s => s.code);
    return {
        source: sourceCode,
        steps: stepsCode,
        sink: sinkCode,
        code_context,
        annotations
    };
}
/**
 * Deduplicate contiguous overlapping ranges inside the same file for contiguous relatedTo indices.
 */
function deduplicateSnippets(snippets, cache, workspaceRoot) {
    if (snippets.length === 0)
        return [];
    const result = [snippets[0]];
    for (let i = 1; i < snippets.length; i++) {
        const prev = result[result.length - 1];
        const curr = snippets[i];
        if (prev.file === curr.file &&
            prev.endLine >= curr.startLine - 1 // contiguous or overlapping
        ) {
            // Merge
            prev.endLine = Math.max(prev.endLine, curr.endLine);
            prev.startLine = Math.min(prev.startLine, curr.startLine);
            if (curr.role === "sink" || prev.role !== "source") {
                prev.role = curr.role === "sink" ? "sink" : prev.role;
            }
            prev.relatedTo = curr.relatedTo ?? prev.relatedTo;
            const lines = cache.get(resolveAbsPath(prev.file, workspaceRoot));
            if (lines) {
                prev.code = renderLines(lines, prev.startLine - 1, prev.endLine - 1);
            }
        }
        else {
            result.push({ ...curr });
        }
    }
    return result;
}
/**
 * Format CodeContext with relational pointers for the LLM.
 * We can keep this if anything needs it, but it's redundant since we build code_context directly.
 */
function formatCodeContext(ctx) {
    return ctx.code_context;
}
//# sourceMappingURL=contextExtractor.js.map