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

import * as http from "http";

// Toggle for Mock LLM Mode
export const USE_MOCK_LLM = false;

const OLLAMA_HOST = "localhost";
const OLLAMA_PORT = 11434;
const OLLAMA_PATH = "/api/chat";
const MODEL_NAME = "llama3:8b";
const REQUEST_TIMEOUT_MS = 300_000; // 5 minutes — LLM may be slow

export interface OllamaRequest {
  model: string;
  messages: { role: string; content: string }[];
  stream: boolean;
  options?: {
    temperature: number;
    num_ctx?: number;
  };
}

export interface OllamaResponse {
  message: {
    role: string;
    content: string;
  };
  done: boolean;
}

/**
 * Send one adjudication prompt to Ollama and return the raw response string.
 *
 * @param prompt - The fully assembled ZeroFalse prompt string
 * @returns Raw text content from the LLM (may include markdown wrapping)
 * @throws Error if the request fails, times out, or returns a non-200 status
 */
export async function invokeOllama(prompt: string, isCancelled?: () => boolean): Promise<string> {
  // Inject Mock Mode Logic
  if (USE_MOCK_LLM) {
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
    } else if (lowercasePrompt.includes("user input") || lowercasePrompt.includes("query") || lowercasePrompt.includes("exec")) {
      mockOutput["Is Vulnerable"] = "Yes";
      mockOutput["Sanitization Found"] = "No";
      mockOutput["Attack Feasible"] = "Yes";
      mockOutput["Confidence"] = "High";
    }

    return Promise.resolve(JSON.stringify(mockOutput, null, 2));
  }

  const requestBody: OllamaRequest = {
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

  return new Promise<string>((resolve, reject) => {
    const options: http.RequestOptions = {
      hostname: OLLAMA_HOST,
      port: OLLAMA_PORT,
      path: OLLAMA_PATH,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(bodyString),
      },
    };

    let cancelInterval: NodeJS.Timeout | undefined;

    const req = http.request(options, (res) => {
      if (res.statusCode !== 200) {
        reject(
          new Error(
            `Ollama returned HTTP ${res.statusCode}. Check that 'llama3:8b' is pulled and Ollama is running.`
          )
        );
        res.resume();
        return;
      }

      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        try {
          const parsed: OllamaResponse = JSON.parse(raw);
          const content = parsed?.message?.content;
          
          // --- DEBUG LOGGING ---
          require("fs").appendFileSync("d:\\last-ext\\ollama-debug.log", "=== RESPONSE ===\n" + content + "\n\n");
          // ---------------------

          if (typeof content !== "string") {
            reject(
              new Error(
                `Unexpected Ollama response structure: ${raw.slice(0, 200)}`
              )
            );
          } else {
            resolve(content);
          }
        } catch (err) {
          reject(
            new Error(
              `Failed to parse Ollama response as JSON: ${(err as Error).message}. Raw: ${raw.slice(0, 200)}`
            )
          );
        }
      });
      res.on("error", reject);
    });

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error(`Ollama request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`));
    });

    req.on("error", (err) => {
      reject(
        new Error(
          `Failed to connect to Ollama at ${OLLAMA_HOST}:${OLLAMA_PORT}: ${err.message}`
        )
      );
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
export async function verifyOllamaReachable(): Promise<boolean> {
  // Inject Mock Mode Bypass
  if (USE_MOCK_LLM) {
    return Promise.resolve(true); // Bypass validation if mock is enabled
  }

  return new Promise<boolean>((resolve, reject) => {
    // Use /api/tags as a lightweight health-check endpoint
    const options: http.RequestOptions = {
      hostname: OLLAMA_HOST,
      port: OLLAMA_PORT,
      path: "/api/tags",
      method: "GET",
    };

    const req = http.request(options, (res) => {
      res.resume(); // drain the response
      if (res.statusCode && res.statusCode < 500) {
        resolve(true);
      } else {
        reject(
          new Error(
            `Ollama health check returned HTTP ${res.statusCode}`
          )
        );
      }
    });

    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error("Ollama health check timed out"));
    });

    req.on("error", (err) => {
      reject(
        new Error(
          `Local LLM service is not running: ${err.message}`
        )
      );
    });

    req.end();
  });
}

/**
 * Force Ollama to unload the model from memory.
 * This sends a lightweight request with keep_alive: 0.
 */
export async function unloadOllamaModel(): Promise<void> {
  if (USE_MOCK_LLM) return;

  return new Promise<void>((resolve, reject) => {
    const requestBody = {
      model: MODEL_NAME,
      keep_alive: 0,
    };

    const bodyString = JSON.stringify(requestBody);

    const options: import("http").RequestOptions = {
      hostname: OLLAMA_HOST,
      port: OLLAMA_PORT,
      path: "/api/generate",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(bodyString),
      },
    };

    const req = import("http").then(http => {
      const request = http.request(options, (res) => {
        res.resume(); // drain response
        resolve();
      });

      request.on("error", (err) => {
        console.error("[ZeroFalse] Failed to unload Ollama model:", err);
        resolve(); // Don't throw, just resolve so we don't block cleanup
      });

      request.write(bodyString);
      request.end();
    });
  });
}
