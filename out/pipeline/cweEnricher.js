"use strict";
// ============================================================
// pipeline/cweEnricher.ts
//
// CWE-specific micro-rubric database based on the ZeroFalse paper.
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCweRules = getCweRules;
exports.enrichAlert = enrichAlert;
exports.formatCweRubric = formatCweRubric;
// ---- CWE Micro-Rubric Database ----
const CWE_DATABASE = [
    // ----------------------------------------------------------------
    // CWE-089: SQL Injection
    // ----------------------------------------------------------------
    {
        cweId: "CWE-089",
        description: "Improper Neutralization of Special Elements used in an SQL Command. Untrusted data reaches an SQL query sink without structural separation.",
        preconditions: [
            "A database connection exists and an SQL query is constructed.",
            "Untrusted input is passed to the query construction.",
        ],
        highRiskPatterns: [
            "Untrusted input flows into SQL query construction via string concatenation (+, concat(), format(), f-strings).",
            "A user-controlled String variable is interpolated into WHERE, ORDER BY, INSERT, or UPDATE clauses.",
            "Statement.execute(), executeQuery(), or cursor.execute() receives a dynamically built String containing user input.",
            "User-controlled sort or column names are spliced directly into the query string without allowlist validation.",
            "A non-parameterized query concatenates a user-controlled String value at any point in the flow.",
        ],
        safePatterns: [
            "Use of parameterized queries (e.g., PreparedStatement with placeholder `?` bindings).",
            "ORM safe query builders (e.g., Criteria API, Django ORM filters) that do not use raw SQL.",
            "Hardcoded static SQL strings.",
        ],
        commonFalsePositives: [
            "Data passed as a parameter to a PreparedStatement.",
            "Input that has been successfully parsed into a primitive int/long before being passed to SQL.",
            "The value concatenated into the SQL is hardcoded/trusted, even if other parts of the system handle untrusted data.",
        ],
        validSanitization: [
            "NUMERIC TYPE COERCION (parseInt/parseLong): If user input passes through Integer.parseInt() or Long.parseLong() and the variable that physically reaches the SQL sink is the resulting primitive `int` or `long` type.",
            "Exact-match string allowlisting against a hardcoded Set or List of safe values, applied before any concatenation.",
        ],
        invalidSanitization: [
            "String escaping alone (e.g., replacing \\' with \\'\\') — does not prevent all injection vectors, especially numeric context attacks.",
            "Input trimming (e.g., .trim(), .strip()) — does not remove SQL metacharacters.",
            "URL encoding or HTML encoding — wrong encoding context for SQL sinks.",
            "parseInt/parseLong does NOT sanitize when the original String variable (not the parsed integer) is what reaches the SQL sink.",
        ],
    },
    // ----------------------------------------------------------------
    // CWE-079: Cross-Site Scripting (XSS)
    // ----------------------------------------------------------------
    {
        cweId: "CWE-079",
        description: "Improper Neutralization of Input During Web Page Generation. Untrusted input is written to web output without context-aware encoding.",
        preconditions: [
            "Web application generates dynamic content based on user input.",
            "Output is sent to a web browser.",
        ],
        highRiskPatterns: [
            "Untrusted data flows into an HTTP response body rendered as text/html.",
            "Input is echoed back to the client natively (e.g., response.getWriter().print(input)) in an HTML context without encoding.",
            "Input is bound to unsafe DOM properties (e.g., innerHTML, document.write, outerHTML).",
            "Input is embedded into a <script> block or JavaScript string literal without JavaScript-specific escaping.",
        ],
        safePatterns: [
            "Template auto-escaping (default behavior of React, Angular, modern Jinja2) applied at the output point.",
            "Safe DOM methods (e.g., textContent, innerText) instead of innerHTML for DOM body context.",
            "HTTP response Content-Type is set to `application/json`.",
        ],
        commonFalsePositives: [
            "Output Content-Type is `application/json` and input is properly JSON-string-escaped.",
            "Input is passed to a modern frontend framework's default safe rendering mechanism (like React `{variable}`).",
        ],
        validSanitization: [
            "Context-aware HTML encoding that replaces ALL of: & → &amp;, < → &lt;, > → &gt;, \" → &quot;, \\' → &#x27; before placing value in an HTML body context.",
            "Strict CSP (Content Security Policy) enforcement at the controller/header level.",
        ],
        invalidSanitization: [
            "URL decoding / encoding (URLDecoder, encodeURIComponent) alone does not secure HTML or JavaScript contexts.",
            "CRITICAL — ENCODING CONTEXT MISMATCH: HTML entity encoding applied to a value placed inside a JavaScript string literal does NOT prevent XSS.",
            "Trimming whitespace or removing <script> tags using regex.",
        ],
    },
    // ----------------------------------------------------------------
    // CWE-022: Path Traversal
    // ----------------------------------------------------------------
    {
        cweId: "CWE-022",
        description: "Improper Limitation of a Pathname to a Restricted Directory. Untrusted input alters file path structures to access unauthorized files.",
        preconditions: [
            "Application constructs a file path using user input.",
            "File operations (read, write, delete) are performed on the constructed path.",
        ],
        highRiskPatterns: [
            "Untrusted input is directly concatenated to a base directory string.",
            "Data from request parameters flows into file system APIs (e.g., fs.readFile, new File(), open()).",
            "Path combinations are executed without verifying the resulting canonical, absolute path.",
            "Attacker payload containing `../` or `%2e%2e` reaches the filesystem sink.",
        ],
        safePatterns: [
            "User input maps to an internal safe identifier map (allowlist) instead of passing raw paths.",
            "Extraction of only the strict filename without any directory components.",
        ],
        commonFalsePositives: [
            "Input is strongly validated against a known set of allowed file names.",
            "The constructed path is verified to strictly reside within an allowed base directory using canonical paths.",
        ],
        validSanitization: [
            "Canonicalize the final path (e.g., path.resolve(), File.getCanonicalPath()) and verify it starts with the intended base directory.",
            "Extract only the strict filename (e.g., path.basename(), FilenameUtils.getName()) and discard parent directory traversals.",
        ],
        invalidSanitization: [
            "Replacing `../` with empty strings (bypassed by `..././`).",
            "URL decoding.",
            "Checking only file extensions (e.g., `.txt`).",
        ],
    },
    // ----------------------------------------------------------------
    // CWE-078: OS Command Injection
    // ----------------------------------------------------------------
    {
        cweId: "CWE-078",
        description: "Improper Neutralization of Special Elements used in an OS Command. Untrusted input reaches an OS system wrapper that invokes a shell.",
        preconditions: [
            "Application executes an OS command.",
            "User input is part of the command executed.",
        ],
        highRiskPatterns: [
            "Untrusted data flows into Runtime.exec(String) — the single-String form — where the OS shell is invoked, making metacharacters (; & | $ ` > <) dangerous.",
            "Command is executed via an explicit shell interpreter (e.g., Runtime.exec(new String[]{\"sh\", \"-c\", userInput})) using string concatenation.",
            "User input is concatenated into a command string: `\"ping \" + userInput` passed to the single-string exec.",
        ],
        safePatterns: [
            "Using Runtime.exec(String[]) or ProcessBuilder(List<String>) where the executable and each argument are discrete elements.",
        ],
        commonFalsePositives: [
            "User input is passed as a distinct argument in array-form execution, avoiding shell interpretation.",
        ],
        validSanitization: [
            "ARRAY-FORM EXECUTION: Using Runtime.exec(String[]) or ProcessBuilder(List<String>). Shell metacharacters have NO special meaning.",
            "Strict allowlist of permissible argument values.",
            "Numeric/Alphanumeric validation that rejects all shell metacharacters.",
        ],
        invalidSanitization: [
            "Partial character stripping or escaping for string-form exec.",
            "HTML or URL encoding — wrong context for OS command sinks.",
        ],
    },
];
// ---- Generic fallback rubric ----
const GENERIC_RULES = {
    cweId: "CWE-UNKNOWN",
    description: "General Vulnerability. Untrusted data reaches a sensitive sink without adequate constraints.",
    preconditions: ["Untrusted data is processed.", "A sensitive operation is performed."],
    highRiskPatterns: [
        "Trace confirms untrusted source reaches the sensitive sink unaltered.",
        "String concatenation or unconstrained type-casting allows attacker payloads.",
    ],
    safePatterns: [
        "Type-safe abstraction layers are used.",
        "Data is validated against an allowlist.",
    ],
    commonFalsePositives: [
        "The input is strongly typed or validated before use.",
    ],
    validSanitization: [
        "Strict allowlists matching incoming data against explicitly safe enums/keys.",
        "Context-aware encoding specific to the execution sink.",
    ],
    invalidSanitization: [
        "Logging or echoing the variable state.",
        "Length requirements or non-null assertions.",
    ],
};
// ---- Index for O(1) lookup ----
const CWE_INDEX = new Map(CWE_DATABASE.map((r) => [r.cweId, r]));
function getCweRules(cweId) {
    const normalised = normaliseCweId(cweId);
    return CWE_INDEX.get(normalised) ?? GENERIC_RULES;
}
function enrichAlert(alert) {
    return getCweRules(alert.cwe);
}
function normaliseCweId(id) {
    const match = id.match(/(\d+)$/);
    if (!match)
        return id.toUpperCase();
    const num = parseInt(match[1], 10);
    const padded = String(num).padStart(3, "0");
    return `CWE-${padded}`;
}
function formatCweRubric(rules) {
    const formatList = (title, items) => {
        if (items.length === 0)
            return "";
        const list = items.map(i => "  - " + i).join("\n");
        return `${title}:\n${list}\n`;
    };
    return [
        `CWE Rubric for ${rules.cweId}:`,
        `Description: ${rules.description}`,
        "",
        formatList("Preconditions for Exploitability", rules.preconditions),
        formatList("High-Risk Patterns", rules.highRiskPatterns),
        formatList("Safe/Benign Patterns", rules.safePatterns),
        formatList("Common False Positives", rules.commonFalsePositives),
        formatList("Valid Sanitization Techniques", rules.validSanitization),
        formatList("Invalid/Misleading Sanitization", rules.invalidSanitization),
    ].filter(Boolean).join("\n");
}
//# sourceMappingURL=cweEnricher.js.map