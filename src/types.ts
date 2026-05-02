// ============================================================
// types.ts — Canonical ZeroFalse type definitions
// All types strictly match the specification.
// ============================================================

// ------- SARIF Input Types (Strict Minimal Structure) -------

export type SarifReport = {
  runs: {
    // SARIF spec: `results` is optional — omitted when a run produced no findings
    results?: SarifResult[];
  }[];
};

export type SarifResult = {
  ruleId: string;
  message: { text: string };
  locations: {
    physicalLocation: {
      artifactLocation: { uri: string };
      region: { startLine: number };
    };
  }[];
  codeFlows?: {
    threadFlows: {
      locations: {
        location: {
          physicalLocation: {
            artifactLocation: { uri: string };
            region: { startLine: number };
          };
          message?: { text: string };
        };
      }[];
    }[];
  }[];
};

// ------- Canonical Internal Model -------

export type Alert = {
  id: string;
  ruleId: string;
  cwe: string;
  message: string;

  sink: {
    file: string;
    line: number;
  };

  trace: TraceStep[];
  codeContext?: CodeContext;
};

export type TraceStep = {
  type: "source" | "step" | "sink";
  file: string;
  line: number;
  description: string;
};

export type CodeContext = {
  source: string;
  steps: string[];
  sink: string;
  code_context: string;
  annotations: string[];
};

// ------- CWE Enrichment -------

export type CWERules = {
  cweId: string;
  description: string;
  preconditions: string[];
  highRiskPatterns: string[];
  safePatterns: string[];
  commonFalsePositives: string[];
  validSanitization: string[];
  invalidSanitization: string[];
};

// ------- LLM Output -------

export type LLMOutput = {
  "Is Vulnerable": "Yes" | "No";
  "Sanitization Found": "Yes" | "No" | "Unsure";
  "Attack Feasible": "Yes" | "No";
  "Confidence": "Low" | "Medium" | "High";
  "Explanation": string;
};

// ------- Final Result -------

export type FinalResult = {
  alertId: string;
  classification: "FP" | "TP";
  confidence: string;
  ruleId: string;
  cwe: string;
  message: string;
  sink: { file: string; line: number };
  llmOutput: LLMOutput;
};

// ------- Pipeline Errors -------

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class EnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvironmentError";
  }
}
