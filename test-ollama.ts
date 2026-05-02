import { invokeOllama } from "./src/llm/ollamaClient";
import { buildPrompt } from "./src/pipeline/promptBuilder";
import { Alert, CodeContext, CWERules } from "./src/types";

const alert: Alert = {
  id: "test-123",
  ruleId: "java/sql-injection",
  cwe: "CWE-089",
  message: "This query depends on a user-provided value.",
  sink: {
    file: "file:///d:/last-ext/security-dataset/src/main/java/com/test/SQLInjectionFP1.java",
    line: 31
  },
  trace: [
    { type: "source", file: "file:///d:/last-ext/security-dataset/src/main/java/com/test/SQLInjectionFP1.java", line: 23, description: "username is fully controlled by the user" },
    { type: "sink", file: "file:///d:/last-ext/security-dataset/src/main/java/com/test/SQLInjectionFP1.java", line: 31, description: "username is passed to ps.setString(1, username)" }
  ]
};

const codeContext: CodeContext = {
  snippets: [{
    file: "file:///d:/last-ext/security-dataset/src/main/java/com/test/SQLInjectionFP1.java",
    startLine: 20,
    endLine: 35,
    role: "intermediate",
    code: `    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws ServletException, IOException {

        // SOURCE — looks dangerous
        String username = req.getParameter("username");

        PrintWriter out = resp.getWriter();
        try {
            Connection conn = DriverManager.getConnection(
                    "jdbc:mysql://localhost:3306/appdb", "root", "secret");

            // SAFE — parameterised query; user value bound as data, not SQL
            PreparedStatement ps = conn.prepareStatement(
                    "SELECT id, email FROM users WHERE username = ?");
            ps.setString(1, username);
            ResultSet rs = ps.executeQuery();`
  }]
};

const cweRules: CWERules = {
  cweId: "CWE-089",
  description: "CLASSIFICATION RULES:
- Start your=== REQUIRED OUTPUT FORMAT ===
1. First, write your detailed step-by-step Analysis (evaluating the trust boundary, trace, and sanitization).
2. Then, output EXACTLY this JSON object:
{
  "Analysis": "A brief summary of your reasoning",
  "Is Vulnerable?": "Yes" or "No",
  "Sanitization Found?": "Yes" or "No" or "Unsure",
  "Attack Feasible?": "Yes" or "No",
  "Confidence": "Low" or "Medium" or "High"
}`;
- Set "Is Vulnerable?": "Yes" if no valid sanitization is found or the attack remains feasible.
- Set "Sanitization Found?": "Yes" / "No" / "Unsure" based on the rubric above.
- Set "Attack Feasible?": "Yes" if an attacker can realistically exploit the sink via the trace.

=== INPUT EVIDENCE ===",
  detectionRules: ["Untrusted input flows into SQL query construction."],
  sanitizationRules: ["Use of parameterized queries (e.g., PreparedStatement, placeholder `?` bindings)."],
  nonSanitizers: ["String escaping alone (e.g., replacing ' with '')."]
};

const prompt = buildPrompt(alert, codeContext, cweRules);
console.log("=== SENDING PROMPT ===");
console.log(prompt);

invokeOllama(prompt).then(res => {
  console.log("=== OLLAMA RAW RESPONSE ===");
  console.log(res);
}).catch(console.error);
