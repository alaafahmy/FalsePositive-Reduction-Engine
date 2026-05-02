"use strict";
// ============================================================
// llm/ollamaClient.ts
//
// Ollama HTTP API client for LLaMA 3 8B adjudication.
//
// Specification (STRICT):
//   Endpoint:  http://localhost:11434/api/chat
//   Model:     llama3:8b
//   Stream:    false
//   Temperature: 0 (deterministic)
//
// Constraints:
//   - No fallback models
//   - No retries with altered prompts
//   - No modification of request/response structure
//   - LLM is external service only
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
exports.USE_MOCK_LLM = void 0;
exports.invokeOllama = invokeOllama;
exports.verifyOllamaReachable = verifyOllamaReachable;
const http = __importStar(require("http"));
// Toggle for Mock LLM Mode
exports.USE_MOCK_LLM = false;
const OLLAMA_HOST = "localhost";
const OLLAMA_PORT = 11434;
const OLLAMA_PATH = "/api/chat";
const MODEL_NAME = "llama3:8b";
const REQUEST_TIMEOUT_MS = 300000; // 5 minutes — LLM may be slow
/**
 * Send one adjudication prompt to Ollama and return the raw response string.
 *
 * @param prompt - The fully assembled ZeroFalse prompt string
 * @returns Raw text content from the LLM (may include markdown wrapping)
 * @throws Error if the request fails, times out, or returns a non-200 status
 */
async function invokeOllama(prompt, isCancelled) {
    // Inject Mock Mode Logic
    if (exports.USE_MOCK_LLM) {
        const lowercasePrompt = prompt.toLowerCase();
        // Default balanced response
        const mockOutput = {
            "Explanation": "Mock analysis...",
            "Is Vulnerable": "Yes",
            "Sanitization Found": "Unsure",
            "Attack Feasible": "Yes",
            "Confidence": "Medium"
        };
        // Smart mock behavior based on prompt keywords
        if (lowercasePrompt.includes("sanitize") || lowercasePrompt.includes("escape")) {
            mockOutput["Is Vulnerable"] = "No";
            mockOutput["Sanitization Found"] = "Yes";
            mockOutput["Attack Feasible"] = "No";
            mockOutput["Confidence"] = "High";
        }
        else if (lowercasePrompt.includes("user input") || lowercasePrompt.includes("query") || lowercasePrompt.includes("exec")) {
            mockOutput["Is Vulnerable"] = "Yes";
            mockOutput["Sanitization Found"] = "No";
            mockOutput["Attack Feasible"] = "Yes";
            mockOutput["Confidence"] = "High";
        }
        return Promise.resolve(JSON.stringify(mockOutput, null, 2));
    }
    const requestBody = {
        model: MODEL_NAME,
        messages: [
            {
                role: "user",
                content: prompt,
            },
        ],
        stream: false,
        options: {
            temperature: 0,
            num_ctx: 2048,
        },
    };
    const bodyString = JSON.stringify(requestBody);
    return new Promise((resolve, reject) => {
        const options = {
            hostname: OLLAMA_HOST,
            port: OLLAMA_PORT,
            path: OLLAMA_PATH,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(bodyString),
            },
        };
        let cancelInterval;
        const req = http.request(options, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`Ollama returned HTTP ${res.statusCode}. Check that 'llama3:8b' is pulled and Ollama is running.`));
                res.resume();
                return;
            }
            const chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => {
                const raw = Buffer.concat(chunks).toString("utf8");
                try {
                    const parsed = JSON.parse(raw);
                    const content = parsed?.message?.content;
                    // --- DEBUG LOGGING ---
                    require("fs").appendFileSync("d:\\last-ext\\ollama-debug.log", "=== RESPONSE ===\n" + content + "\n\n");
                    // ---------------------
                    if (typeof content !== "string") {
                        reject(new Error(`Unexpected Ollama response structure: ${raw.slice(0, 200)}`));
                    }
                    else {
                        resolve(content);
                    }
                }
                catch (err) {
                    reject(new Error(`Failed to parse Ollama response as JSON: ${err.message}. Raw: ${raw.slice(0, 200)}`));
                }
            });
            res.on("error", reject);
        });
        req.setTimeout(REQUEST_TIMEOUT_MS, () => {
            req.destroy();
            reject(new Error(`Ollama request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`));
        });
        req.on("error", (err) => {
            reject(new Error(`Failed to connect to Ollama at ${OLLAMA_HOST}:${OLLAMA_PORT}: ${err.message}`));
        });
        if (isCancelled) {
            cancelInterval = setInterval(() => {
                if (isCancelled()) {
                    clearInterval(cancelInterval);
                    req.destroy(new Error("CancelledByUser"));
                }
            }, 500);
            req.on("close", () => clearInterval(cancelInterval));
        }
        req.write(bodyString);
        req.end();
    });
}
/**
 * Verify that the Ollama service is reachable.
 * Used during environment validation before any analysis begins.
 *
 * @returns true if reachable, throws EnvironmentError otherwise
 */
async function verifyOllamaReachable() {
    // Inject Mock Mode Bypass
    if (exports.USE_MOCK_LLM) {
        return Promise.resolve(true); // Bypass validation if mock is enabled
    }
    return new Promise((resolve, reject) => {
        // Use /api/tags as a lightweight health-check endpoint
        const options = {
            hostname: OLLAMA_HOST,
            port: OLLAMA_PORT,
            path: "/api/tags",
            method: "GET",
        };
        const req = http.request(options, (res) => {
            res.resume(); // drain the response
            if (res.statusCode && res.statusCode < 500) {
                resolve(true);
            }
            else {
                reject(new Error(`Ollama health check returned HTTP ${res.statusCode}`));
            }
        });
        req.setTimeout(5000, () => {
            req.destroy();
            reject(new Error("Ollama health check timed out"));
        });
        req.on("error", (err) => {
            reject(new Error(`Local LLM service is not running: ${err.message}`));
        });
        req.end();
    });
}
//# sourceMappingURL=ollamaClient.js.map