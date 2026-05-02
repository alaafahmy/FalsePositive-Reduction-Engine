import { Alert, CodeContext, CWERules, TraceStep } from "./src/types";
import { extractContext } from "./src/pipeline/contextExtractor";
import { enrichAlert } from "./src/pipeline/cweEnricher";
import { buildPrompt } from "./src/pipeline/promptBuilder";
import * as path from "path";

// Mock trace simulating TrickyCase1.java dataflow
const trace: TraceStep[] = [
  {
    type: "source",
    file: "dataset/TrickyCase1.java",
    line: 14,
    description: "Source: req.getParameter(\"id\")"
  },
  {
    type: "step",
    file: "dataset/TrickyCase1.java",
    line: 15,
    description: "Propagation: Assignment to String paramId"
  },
  {
    type: "step",
    file: "dataset/TrickyCase1.java",
    line: 18,
    description: "Sanitization: Integer.parseInt(paramId)"
  },
  {
    type: "step",
    file: "dataset/TrickyCase1.java",
    line: 22,
    description: "Propagation: Concatenation with SELECT query"
  },
  {
    type: "sink",
    file: "dataset/TrickyCase1.java",
    line: 23,
    description: "Sink: statement.executeQuery(query)"
  }
];

const mockAlert: Alert = {
  id: "test-alert-001",
  ruleId: "java/sql-injection",
  cwe: "CWE-089",
  message: "Query might be vulnerable to SQL injection",
  sink: {
    file: "dataset/TrickyCase1.java",
    line: 23
  },
  trace: trace
};

// Ensure dataset/TrickyCase1.java exists for the context extractor
const workspaceRoot = process.cwd();

const ctx = extractContext(mockAlert, workspaceRoot);
const rules = enrichAlert(mockAlert);
const prompt = buildPrompt(mockAlert, ctx, rules);

console.log(prompt);
