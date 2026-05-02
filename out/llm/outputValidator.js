"use strict";
// ============================================================
// llm/outputValidator.ts
//
// Validates LLM string responses against the strict schema:
//
//   {
//     "False Positive":      "Yes" | "No"
//     "Sanitization Found":  "Yes" | "No" | "Unsure"
//     "Attack Feasible":     "Yes" | "No"
//     "Confidence":          "Low" | "Medium" | "High"
//     "Explanation":         string (free text)
//   }
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateLLMOutput = validateLLMOutput;
exports.deriveClassification = deriveClassification;
const types_1 = require("../types");
// ---- Allowed value sets -----------------------------------------------
const VALID_IS_VULN = new Set(["Yes", "No"]);
const VALID_SANITIZATION = new Set(["Yes", "No", "Unsure"]);
const VALID_ATTACK = new Set(["Yes", "No"]);
const VALID_CONFIDENCE = new Set(["Low", "Medium", "High"]);
function extractJsonBlock(raw) {
    const fenceMatch = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (fenceMatch) {
        return fenceMatch[1].trim();
    }
    const start = raw.indexOf("{");
    if (start === -1) {
        return raw.trim();
    }
    let depth = 0;
    for (let i = start; i < raw.length; i++) {
        if (raw[i] === "{") {
            depth++;
        }
        else if (raw[i] === "}") {
            depth--;
            if (depth === 0) {
                return raw.slice(start, i + 1).trim();
            }
        }
    }
    const end = raw.lastIndexOf("}");
    return end > start ? raw.slice(start, end + 1).trim() : raw.trim();
}
function repairJson(jsonStr) {
    const chars = [];
    let inString = false;
    let escape = false;
    for (let i = 0; i < jsonStr.length; i++) {
        const ch = jsonStr[i];
        if (escape) {
            chars.push(ch);
            escape = false;
            continue;
        }
        if (ch === "\\") {
            escape = true;
            chars.push(ch);
            continue;
        }
        if (ch === '"') {
            inString = !inString;
            chars.push(ch);
            continue;
        }
        if (inString) {
            if (ch === "\n") {
                chars.push("\\n");
                continue;
            }
            if (ch === "\r") {
                chars.push("\\r");
                continue;
            }
            if (ch === "\t") {
                chars.push("\\t");
                continue;
            }
        }
        chars.push(ch);
    }
    return chars.join("");
}
function extractFieldByRegex(raw, key) {
    const escaped = key.replace(/[?]/g, "\\?");
    const jsonStyle = new RegExp(`"${escaped}"\\s*:\\s*"([^"\\n]+)"`);
    const m1 = raw.match(jsonStyle);
    if (m1) {
        return m1[1].trim();
    }
    const bulletStyle = new RegExp(`[*-]?\\s*"?${escaped}"?\\s*:\\s*([A-Za-z][A-Za-z ]*?)(?:\\n|\\.|$)`);
    const m2 = raw.match(bulletStyle);
    if (m2) {
        return m2[1].trim().replace(/[*"`]/g, "");
    }
    return undefined;
}
function normaliseValue(val, allowed) {
    if (allowed.has(val)) {
        return val;
    }
    for (const a of allowed) {
        if (a.toLowerCase() === val.toLowerCase()) {
            return a;
        }
    }
    return val;
}
function validateLLMOutput(raw) {
    if (!raw || raw.trim().length === 0) {
        throw new types_1.ValidationError("LLM returned an empty response.");
    }
    let parsed = null;
    const jsonBlock = extractJsonBlock(raw);
    try {
        parsed = JSON.parse(jsonBlock);
    }
    catch (_) {
        parsed = null;
    }
    if (!parsed) {
        try {
            const repaired = repairJson(jsonBlock);
            parsed = JSON.parse(repaired);
        }
        catch (_) {
            parsed = null;
        }
    }
    if (!parsed) {
        const isVuln = extractFieldByRegex(raw, "Is Vulnerable");
        const san = extractFieldByRegex(raw, "Sanitization Found");
        const atk = extractFieldByRegex(raw, "Attack Feasible");
        const conf = extractFieldByRegex(raw, "Confidence");
        if (isVuln && san && atk && conf) {
            let explanation = "Explanation recovered via fallback parsing.";
            const aMatch = raw.match(/"Explanation"\s*:\s*"([\s\S]*?)"\s*}/);
            if (aMatch) {
                explanation = aMatch[1].replace(/\\n/g, " ").trim();
            }
            else {
                const proseIdx = raw.search(/"Is Vulnerable"/);
                if (proseIdx > 0) {
                    explanation = raw.slice(0, proseIdx).replace(/[*"{}]/g, "").trim();
                }
            }
            parsed = {
                "Explanation": explanation,
                "Is Vulnerable": isVuln,
                "Sanitization Found": san,
                "Attack Feasible": atk,
                "Confidence": conf,
            };
        }
        else {
            throw new types_1.ValidationError(`All three parsing layers failed. Raw (first 400 chars): ${raw.slice(0, 400)}`);
        }
    }
    const normalise = (key, allowed) => {
        const raw_val = String(parsed[key] ?? "").trim();
        return normaliseValue(raw_val, allowed);
    };
    const isVuln = normalise("Is Vulnerable", VALID_IS_VULN);
    const san = normalise("Sanitization Found", VALID_SANITIZATION);
    const atk = normalise("Attack Feasible", VALID_ATTACK);
    const conf = normalise("Confidence", VALID_CONFIDENCE);
    if (!VALID_IS_VULN.has(isVuln)) {
        throw new types_1.ValidationError(`Invalid "Is Vulnerable" value: "${isVuln}". Must be "Yes" or "No". Raw (first 300): ${raw.slice(0, 300)}`);
    }
    if (!VALID_SANITIZATION.has(san)) {
        throw new types_1.ValidationError(`Invalid "Sanitization Found" value: "${san}". Must be "Yes", "No", or "Unsure".`);
    }
    if (!VALID_ATTACK.has(atk)) {
        throw new types_1.ValidationError(`Invalid "Attack Feasible" value: "${atk}". Must be "Yes" or "No".`);
    }
    if (!VALID_CONFIDENCE.has(conf)) {
        throw new types_1.ValidationError(`Invalid "Confidence" value: "${conf}". Must be "Low", "Medium", or "High".`);
    }
    const explanation = String(parsed["Explanation"] ?? "").trim() || "No explanation provided.";
    return {
        "Explanation": explanation,
        "Is Vulnerable": isVuln,
        "Sanitization Found": san,
        "Attack Feasible": atk,
        "Confidence": conf,
    };
}
function deriveClassification(output) {
    return output["Is Vulnerable"] === "No" ? "FP" : "TP";
}
//# sourceMappingURL=outputValidator.js.map