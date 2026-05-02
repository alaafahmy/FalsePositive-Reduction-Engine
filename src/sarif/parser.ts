// ============================================================
// sarif/parser.ts — SARIF → Alert Canonicalizer
//
// Consumes only the strictly specified SARIF fields.
// Maps ruleId to CWE via well-known CodeQL rule prefix table.
// Builds ordered TraceStep[] from codeFlows[0].threadFlows[0].
// ============================================================

import * as path from "path";
import { Alert, SarifReport, SarifResult, TraceStep } from "../types";

// ---- Rule → CWE mapping (CodeQL standard security query pack) ----
// Maps CodeQL rule ID prefixes to CWE identifiers.
const RULE_TO_CWE: Record<string, string> = {
  // Path Traversal
  "java/path-injection": "CWE-022",
  "py/path-injection": "CWE-022",
  "js/path-injection": "CWE-022",
  "cs/path-injection": "CWE-022",
  "rb/path-injection": "CWE-022",
  "go/path-injection": "CWE-022",
  "cpp/path-injection": "CWE-022",

  // OS Command Injection
  "java/command-line-injection": "CWE-078",
  "py/command-line-injection": "CWE-078",
  "js/command-line-injection": "CWE-078",
  "cs/command-line-injection": "CWE-078",
  "rb/shell-command-injection": "CWE-078",
  "go/command-injection": "CWE-078",

  // XSS
  "java/xss": "CWE-079",
  "py/reflected-xss": "CWE-079",
  "js/reflected-xss": "CWE-079",
  "js/stored-xss": "CWE-079",
  "cs/web/xss": "CWE-079",
  "rb/reflected-xss": "CWE-079",

  // SQL Injection
  "java/sql-injection": "CWE-089",
  "py/sql-injection": "CWE-089",
  "js/sql-injection": "CWE-089",
  "cs/sql-injection": "CWE-089",
  "rb/sql-injection": "CWE-089",
  "go/sql-injection": "CWE-089",
  "cpp/sql-injection": "CWE-089",

  // LDAP Injection
  "java/ldap-injection": "CWE-090",
  "py/ldap-injection": "CWE-090",
  "js/ldap-injection": "CWE-090",

  // Weak Cryptography
  "java/weak-cryptographic-algorithm": "CWE-327",
  "py/weak-cryptographic-algorithm": "CWE-327",
  "js/weak-cryptographic-algorithm": "CWE-327",
  "cs/weak-cryptographic-algorithm": "CWE-327",
  "go/weak-cryptographic-algorithm": "CWE-327",

  // Weak Randomness
  "java/insecure-randomness": "CWE-330",
  "py/insecure-randomness": "CWE-330",
  "js/insecure-randomness": "CWE-330",

  // Trust Boundary Violation
  "java/trust-boundary-violation": "CWE-501",
  "py/trust-boundary-violation": "CWE-501",
  "js/trust-boundary-violation": "CWE-501",

  // Sensitive Cookie
  "java/missing-http-only-cookie": "CWE-614",
  "java/sensitive-cookie": "CWE-614",
  "py/flask-cookie-flags": "CWE-614",
  "js/missing-token-validation": "CWE-614",

  // XPath Injection
  "java/xpath-injection": "CWE-643",
  "py/xpath-injection": "CWE-643",
  "js/xpath-injection": "CWE-643",

  // Format String
  "cpp/tainted-format-string": "CWE-134",

  // Integer Overflow
  "cpp/integer-overflow": "CWE-190",
};

// CWE tag patterns in ruleId for fallback extraction
const CWE_PATTERN = /CWE[-_](\d+)/i;
const RULE_CWE_TAG = /cwe[-_]?(\d+)/i;

/**
 * Resolve the CWE for a ruleId.
 * 1. Exact table lookup
 * 2. Prefix match in table
 * 3. Extract CWE number embedded in ruleId string
 * 4. Generic fallback "CWE-UNKNOWN"
 */
function resolveCwe(ruleId: string): string {
  // 1. exact
  if (RULE_TO_CWE[ruleId]) {
    return RULE_TO_CWE[ruleId];
  }
  // 2. prefix match
  for (const key of Object.keys(RULE_TO_CWE)) {
    if (ruleId.toLowerCase().startsWith(key.toLowerCase())) {
      return RULE_TO_CWE[key];
    }
  }
  // 3. embedded CWE tag
  const cweMatch =
    ruleId.match(CWE_PATTERN) || ruleId.match(RULE_CWE_TAG);
  if (cweMatch) {
    return `CWE-${cweMatch[1]}`;
  }
  // 4. fallback
  return "CWE-UNKNOWN";
}

/**
 * Normalise a SARIF URI to a clean relative path.
 * Strips leading "file:/" prefixes and normalises separators.
 */
function normaliseUri(uri: string): string {
  return uri
    .replace(/^file:\/+/i, "")
    .replace(/\\/g, "/")
    .replace(/^\/([A-Za-z]:)/, "$1"); // Windows drive letter
}

/**
 * Build the ordered TraceStep array from the first threadFlow of the
 * first codeFlow in a SARIF result.
 */
function buildTrace(result: SarifResult): TraceStep[] {
  if (
    !result.codeFlows ||
    result.codeFlows.length === 0 ||
    result.codeFlows[0].threadFlows.length === 0
  ) {
    // No trace — synthesise a single "sink" step from primary location
    const loc = result.locations[0]?.physicalLocation;
    if (!loc) return [];
    return [
      {
        type: "sink",
        file: normaliseUri(loc.artifactLocation.uri),
        line: loc.region.startLine,
        description: result.message.text,
      },
    ];
  }

  const flowLocations =
    result.codeFlows[0].threadFlows[0].locations;
  const total = flowLocations.length;

  return flowLocations.map((fl, idx) => {
    const phys = fl.location.physicalLocation;
    const stepType: TraceStep["type"] =
      idx === 0 ? "source" : idx === total - 1 ? "sink" : "step";
    return {
      type: stepType,
      file: normaliseUri(phys.artifactLocation.uri),
      line: phys.region.startLine,
      description: fl.location.message?.text ?? "",
    };
  });
}

/**
 * Parse a SARIF report and return canonical Alert[].
 * Only the specified SARIF fields are consumed.
 *
 * @param report - Parsed SARIF JSON object
 * @param workspaceRoot - Absolute path to workspace root (for resolving relative URIs)
 */
export function parseSarif(
  report: SarifReport,
  workspaceRoot: string
): Alert[] {
  const alerts: Alert[] = [];

  report.runs.forEach((run, runIdx) => {
    (run.results ?? []).forEach((result, resultIdx) => {
      const id = `alert-${runIdx}-${resultIdx}`;
      const ruleId = result.ruleId ?? "unknown";
      const cwe = resolveCwe(ruleId);
      const message = result.message.text;

      // Primary sink location
      const primaryLoc = result.locations[0]?.physicalLocation;
      const sinkFile = primaryLoc
        ? normaliseUri(primaryLoc.artifactLocation.uri)
        : "unknown";
      const sinkLine = primaryLoc ? primaryLoc.region.startLine : 0;

      const trace = buildTrace(result);

      alerts.push({
        id,
        ruleId,
        cwe,
        message,
        sink: { file: sinkFile, line: sinkLine },
        trace,
      });
    });
  });

  return alerts;
}
