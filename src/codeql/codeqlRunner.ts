// ============================================================
// codeql/codeqlRunner.ts — CodeQL Detection & Execution
//
// Responsibilities:
//   1. detectCodeQL()       — Find a working CodeQL binary via
//                             prioritized fallback path list.
//   2. isCodeQLInstalled()  — Boolean convenience wrapper.
//   3. installCodeQL()      — Download & extract CodeQL CLI
//                             into extension global storage.
//   4. runCodeQLAnalysis()  — Create DB + analyze + return SARIF path.
//
// Execution order inside runCodeQLAnalysis():
//   A) Cleanup: delete old db-codeql dir and results.sarif
//   B) database create  (Java + Maven build command)
//   C) database analyze (codeql/java-queries, sarif-latest)
//   D) Validate SARIF file existence
//   E) Return absolute SARIF path
//
// Error handling:
//   - CodeQL not found       → showErrorMessage + throw
//   - Build / analyze error  → log stdout/stderr + throw
//   - SARIF not generated    → showErrorMessage + throw
//
// NOTE: No fallback / synthetic data — only real CodeQL results are used.
// ============================================================

import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as os from 'os';
import { cancellationController } from '../extension';

// ---------------------------------------------------------------------------
// Module-level: path set by installCodeQL() for the remainder of the session.
// ---------------------------------------------------------------------------
let localCodeQLPath: string | undefined = undefined;

// ---------------------------------------------------------------------------
// Shared Output Channel — shows full CodeQL stdout/stderr for diagnostics.
// Created lazily on first use so the channel only appears when needed.
// ---------------------------------------------------------------------------
let _outputChannel: vscode.OutputChannel | undefined;
function getOutputChannel(): vscode.OutputChannel {
  if (!_outputChannel) {
    _outputChannel = vscode.window.createOutputChannel("ZeroFalse – CodeQL");
  }
  return _outputChannel;
}

// ---- Candidate paths tried in priority order ----
// "codeql" covers any PATH-accessible installation (e.g. GitHub CLI extension
// or a manually added entry).  The two absolute paths target the conventional
// Windows locations documented in the CodeQL CLI quickstart.
const CODEQL_CANDIDATE_PATHS: ReadonlyArray<string> = [
  "codeql",
  "C:\\codeql\\codeql.exe",
  "C:\\codeql\\codeql\\codeql.exe",
];

/**
 * Detect a working CodeQL executable by probing candidate paths.
 *
 * Priority order:
 *   1. localCodeQLPath  — set after a successful installCodeQL() call
 *   2. "codeql"         — PATH lookup
 *   3. C:\codeql\codeql.exe
 *   4. C:\codeql\codeql\codeql.exe
 *
 * @returns Absolute (or PATH-relative) executable string, or null.
 */
export function detectCodeQL(): string | null {
  // Build candidate list: prepend the locally installed path if available
  const candidates: string[] = [];
  if (localCodeQLPath && fs.existsSync(localCodeQLPath)) {
    candidates.push(localCodeQLPath);
  }
  candidates.push(...CODEQL_CANDIDATE_PATHS);

  for (const candidate of candidates) {
    console.log(`[ZeroFalse] Probing CodeQL path: ${candidate}`);
    try {
      const result = child_process.spawnSync(candidate, ["--version"], {
        stdio: "pipe",
        timeout: 8_000,
        // shell: false is the default — do NOT use shell:true here; it can
        // mask failures on some Windows shells.
      });
      if (result.status === 0) {
        const version = result.stdout?.toString().trim() ?? "(unknown version)";
        console.log(`[ZeroFalse] CodeQL detected at: ${candidate}  (${version})`);
        return candidate;
      }
      // Non-zero exit or spawn error — try next candidate
      if (result.error) {
        console.log(`[ZeroFalse]   → spawn error for "${candidate}": ${result.error.message}`);
      } else {
        console.log(`[ZeroFalse]   → exit code ${result.status} for "${candidate}"`);
      }
    } catch (err: any) {
      // spawnSync itself threw (e.g. ENOENT on Node < 18 on some platforms)
      console.log(`[ZeroFalse]   → exception for "${candidate}": ${err.message}`);
    }
  }

  console.log("[ZeroFalse] CodeQL detection FAILED — none of the candidate paths returned exit 0.");
  return null;
}

/**
 * Boolean convenience wrapper around detectCodeQL().
 */
export function isCodeQLInstalled(): boolean {
  return detectCodeQL() !== null;
}

// ---------------------------------------------------------------------------
// Optional: auto-install CodeQL from GitHub releases
// ---------------------------------------------------------------------------

/**
 * Downloads and extracts the CodeQL CLI bundle into the extension's global
 * storage directory.  Sets `localCodeQLPath` on success so that subsequent
 * calls to detectCodeQL() will find it immediately.
 *
 * @param context - VS Code extension context (provides global storage URI)
 * @returns Absolute path to the extracted CodeQL executable
 */
export async function installCodeQL(context: vscode.ExtensionContext): Promise<string> {
  return await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Installing CodeQL...",
      cancellable: false,
    },
    async (progress) => {
      const storageUri = context.globalStorageUri;
      if (!fs.existsSync(storageUri.fsPath)) {
        fs.mkdirSync(storageUri.fsPath, { recursive: true });
      }

      const toolsDir = path.join(storageUri.fsPath, ".tools");
      if (!fs.existsSync(toolsDir)) {
        fs.mkdirSync(toolsDir, { recursive: true });
      }

      let releaseAsset: string;
      if (os.platform() === 'win32') {
        releaseAsset = "codeql-win64.zip";
      } else if (os.platform() === 'darwin') {
        releaseAsset = "codeql-osx64.tar.gz";
      } else {
        releaseAsset = "codeql-linux64.tar.gz";
      }

      const downloadUrl = `https://github.com/github/codeql-cli-binaries/releases/latest/download/${releaseAsset}`;
      const archivePath = path.join(toolsDir, releaseAsset);

      progress.report({ message: `Downloading CodeQL CLI (${releaseAsset})…` });
      await downloadFile(downloadUrl, archivePath);

      progress.report({ message: "Extracting CodeQL CLI…" });
      const extractDir = path.join(toolsDir, "codeql-cli");
      if (!fs.existsSync(extractDir)) {
        fs.mkdirSync(extractDir, { recursive: true });
      }

      if (os.platform() === 'win32') {
        child_process.execSync(
          `PowerShell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${extractDir}' -Force"`,
          { stdio: 'pipe' }
        );
      } else {
        child_process.execSync(`tar -xf "${archivePath}" -C "${extractDir}"`, { stdio: 'pipe' });
      }

      // Resolve executable path inside the extracted bundle
      const exeName = os.platform() === 'win32' ? "codeql.cmd" : "codeql";
      localCodeQLPath = path.join(extractDir, "codeql", exeName);

      if (!fs.existsSync(localCodeQLPath)) {
        throw new Error("CodeQL extraction failed — executable not found at expected path.");
      }

      if (os.platform() !== 'win32') {
        child_process.execSync(`chmod +x "${localCodeQLPath}"`);
      }

      // Remove the archive to reclaim disk space
      fs.unlinkSync(archivePath);

      console.log(`[ZeroFalse] CodeQL installed at: ${localCodeQLPath}`);
      return localCodeQLPath;
    }
  );
}

// ---------------------------------------------------------------------------
// Helper: resolve the best available Java security query suite
// ---------------------------------------------------------------------------

/**
 * Probe the installed CodeQL qlpacks and return the first query-suite
 * reference that CodeQL can actually resolve.  Tries candidates in
 * priority order so the correct suite is used regardless of the CodeQL
 * version or qlpack layout on the host machine.
 *
 * Priority:
 *   1. codeql/java-queries  with  java-security-extended.qls  (most detailed)
 *   2. codeql/java-queries  with  java-security-and-quality.qls
 *   3. codeql/java-queries                                     (fallback)
 *
 * @param codeqlExe - Verified path to the CodeQL executable.
 * @returns The suite/pack string to pass to `codeql database analyze`.
 */
function resolveJavaSecuritySuite(codeqlExe: string): string {
  const candidates: string[] = [
    // Preferred: security-extended (taint-tracking, same as GitHub Code Scanning)
    "codeql/java-queries:codeql/java/ql/src/codeql-suites/java-security-extended.qls",
    // Fallback 1: security + quality combined suite
    "codeql/java-queries:codeql/java/ql/src/codeql-suites/java-security-and-quality.qls",
    // Fallback 2: bare pack — runs default queries (better than nothing)
    "codeql/java-queries",
  ];

  for (const suite of candidates) {
    try {
      const probe = child_process.spawnSync(
        codeqlExe,
        ["resolve", "queries", suite, "--format=text"],
        { stdio: "pipe", timeout: 15_000 }
      );
      // Exit 0 and at least one resolved query path → suite is valid
      if (probe.status === 0 && probe.stdout?.toString().trim().length > 0) {
        console.log(`[ZeroFalse] Resolved Java security suite: ${suite}`);
        return suite;
      }
      const errSnippet = probe.stderr?.toString().trim().slice(0, 200) ?? "";
      console.log(`[ZeroFalse] Suite not available (${suite}): ${errSnippet}`);
    } catch (e: any) {
      console.log(`[ZeroFalse] Suite probe threw for (${suite}): ${e.message}`);
    }
  }

  // Should never reach here because the bare pack is always valid
  console.warn("[ZeroFalse] All suite probes failed — falling back to codeql/java-queries");
  return "codeql/java-queries";
}

// ---------------------------------------------------------------------------
// Core: run CodeQL database creation + analysis
// ---------------------------------------------------------------------------

/**
 * Run a full CodeQL analysis on `workspacePath` and return the path to the
 * generated SARIF file.
 *
 * Steps:
 *   1. Detect CodeQL executable (error + throw if not found).
 *   2. Remove any pre-existing db-codeql/ directory and results.sarif.
 *   3. Create CodeQL database using Maven build command.
 *   4. Analyze database with codeql/java-queries → sarif-latest output.
 *   5. Validate SARIF file was actually created on disk.
 *   6. Return absolute path to results.sarif.
 *
 * @param workspacePath - Absolute path to the root of the Java project.
 * @param isCancelled - Optional callback to check for cancellation
 * @returns Absolute path to the generated results.sarif file.
 * @throws Error with descriptive message on any failure.
 */
export async function runCodeQLAnalysis(
  workspacePath: string, 
  progress: vscode.Progress<{ message?: string; increment?: number }>
): Promise<string> {

  // Helper to run child processes asynchronously with cancellation support
  const spawnAsync = (command: string, args: string[], options: child_process.SpawnOptions, timeoutMs: number): Promise<{stdout: string, stderr: string}> => {
    return new Promise((resolve, reject) => {
      if (cancellationController.isCancelled) {
        return reject(new Error("CancelledByUser"));
      }

          const cp = child_process.spawn(command, args, options);
          let stdout = "";
          let stderr = "";
          
          cp.stdout?.on('data', data => stdout += data.toString());
          cp.stderr?.on('data', data => stderr += data.toString());

          let isTerminating = false;

          const handleCancel = async () => {
            if (isTerminating) return;
            isTerminating = true;
            console.log(`[ZeroFalse] Cancelling CodeQL process: ${command}`);

            if (cp.pid && cp.exitCode === null && cp.signalCode === null) {
              try {
                if (os.platform() === 'win32') {
                  // Safe termination first (without /F)
                  child_process.execSync(`taskkill /pid ${cp.pid} /T`, { stdio: 'ignore' });
                } else {
                  cp.kill('SIGTERM');
                }
              } catch (e) {
                // Ignore kill errors
              }

              // Wait up to 3 seconds for graceful shutdown
              for (let i = 0; i < 30; i++) {
                if (cp.exitCode !== null || cp.signalCode !== null) break;
                await new Promise(r => setTimeout(r, 100));
              }

              // Force kill if still alive
              if (cp.exitCode === null && cp.signalCode === null) {
                try {
                  if (os.platform() === 'win32') {
                    child_process.execSync(`taskkill /pid ${cp.pid} /T /F`, { stdio: 'ignore' });
                  } else {
                    cp.kill('SIGKILL');
                  }
                } catch (e) {
                  // Ignore kill errors
                }
              }
            }
          };

          const cancelDisposable = cancellationController.onCancellationRequested(handleCancel);
          
          const timeoutId = setTimeout(() => {
            cancelDisposable.dispose();
            handleCancel().finally(() => {
              reject(new Error(`Timeout after ${timeoutMs}ms`));
            });
          }, timeoutMs);
          
          cp.on('close', code => {
            clearTimeout(timeoutId);
            cancelDisposable.dispose();
            
            if (isTerminating || cancellationController.isCancelled) {
              reject(new Error("CancelledByUser"));
            } else if (code === 0) {
              resolve({stdout, stderr});
            } else {
              const err = new Error(`Command failed with exit code ${code}`);
              (err as any).stdout = stdout;
              (err as any).stderr = stderr;
              (err as any).status = code;
              reject(err);
            }
          });
          
          cp.on('error', err => {
            clearTimeout(timeoutId);
            cancelDisposable.dispose();
            if (isTerminating || cancellationController.isCancelled) {
              reject(new Error("CancelledByUser"));
            } else {
              reject(err);
            }
          });
        });
      };


      // ------------------------------------------------------------------
      // Step 0: Detect CodeQL executable
      // ------------------------------------------------------------------
      const codeqlExe = detectCodeQL();
      if (!codeqlExe) {
        const msg = "CodeQL was not found. Please install it and ensure it is on PATH, " +
          "or place it at C:\\codeql\\codeql.exe.";
        vscode.window.showErrorMessage(`ZeroFalse: ${msg}`);
        throw new Error(msg);
      }
      console.log(`[ZeroFalse] Using CodeQL executable: ${codeqlExe}`);

      const dbPath = path.join(workspacePath, "db-codeql");
      const sarifPath = path.join(workspacePath, "results.sarif");

      // ------------------------------------------------------------------
      // Step 1: Cleanup — remove stale artifacts before running
      // ------------------------------------------------------------------
      if (cancellationController.isCancelled) throw new Error("CancelledByUser");
      progress.report({ message: "Cleaning up previous analysis artifacts…" });

      if (fs.existsSync(dbPath)) {
        console.log(`[ZeroFalse] Removing existing CodeQL database at: ${dbPath}`);
        fs.rmSync(dbPath, { recursive: true, force: true });
      }

      if (fs.existsSync(sarifPath)) {
        console.log(`[ZeroFalse] Removing existing SARIF file at: ${sarifPath}`);
        fs.unlinkSync(sarifPath);
      }

      // ------------------------------------------------------------------
      // Step 2: Create CodeQL database
      //
      // IMPORTANT: Use spawnSync with an argument ARRAY, not execSync with a
      // joined string. When execSync builds "--command=mvn clean compile -Dspotless.skip=true" as
      // a single string the shell splits it into three tokens at the spaces,
      // giving CodeQL three unmatched positional arguments. spawnSync passes
      // each element directly to the OS without any shell interpretation, so
      // the value of --command stays intact as "mvn clean compile".
      // ------------------------------------------------------------------
      progress.report({ message: "Creating CodeQL database (running mvn clean compile)…" });
      console.log(`[ZeroFalse] Starting CodeQL database creation in: ${workspacePath}`);

      const dbCreateArgs = [
        "database", "create",
        dbPath,
        "--language=java",
        "--overwrite",
        "--ram=4096",      // Allow up to 4GB RAM
        "--threads=0",
      ];

      // If the project has a pom.xml use Maven; otherwise let CodeQL autobuild.
      // NOTE: Do NOT wrap with "cmd /c" here — CodeQL's Java extractor sets up
      // JAVA_TOOL_OPTIONS / tracer hooks before invoking the build command, and
      // an extra cmd.exe layer breaks that environment injection, causing the
      // pre-finalize step to fail because no class files are traced.
      if (fs.existsSync(path.join(workspacePath, "pom.xml"))) {
        dbCreateArgs.push("--command");
        dbCreateArgs.push("mvn clean compile -Dspotless.skip=true -T 1C");
      }

      console.log(`[ZeroFalse] DB create: ${codeqlExe} ${dbCreateArgs.join(" ")}`);

      try {
        const { stdout: dbStdout, stderr: dbStderr } = await spawnAsync(codeqlExe, dbCreateArgs, { cwd: workspacePath }, 600_000);

        // Always write full output to the Output Channel for diagnostics
        const ch = getOutputChannel();
        ch.appendLine("\n=== CodeQL database create ===");
        ch.appendLine(`Command: ${codeqlExe} ${dbCreateArgs.join(" ")}`);
        ch.appendLine(`CWD: ${workspacePath}`);
        if (dbStdout.trim()) { ch.appendLine("[stdout]\n" + dbStdout); }
        if (dbStderr.trim()) { ch.appendLine("[stderr]\n" + dbStderr); }
        ch.appendLine(`Exit code: 0`);

        console.log("[ZeroFalse] CodeQL database creation completed.");
        if (dbStdout.trim()) { console.log(`[ZeroFalse] DB stdout: ${dbStdout.trim()}`); }
      } catch (err: any) {
        if (err.message === "CancelledByUser" || cancellationController.isCancelled) {
          console.log(`[ZeroFalse] Cleaning up partially created CodeQL database at: ${dbPath}`);
          try {
            if (fs.existsSync(dbPath)) fs.rmSync(dbPath, { recursive: true, force: true });
          } catch (cleanupErr) {
            console.error(`[ZeroFalse] Failed to delete partial db: ${cleanupErr}`);
          }
          throw new Error("CancelledByUser");
        }
        const ch = getOutputChannel();
        ch.appendLine("\n=== CodeQL database create FAILED ===");
        if (err.stdout) ch.appendLine("[stdout]\n" + err.stdout);
        if (err.stderr) ch.appendLine("[stderr]\n" + err.stderr);
        ch.show(true);
        console.error("[ZeroFalse] CodeQL database creation FAILED");
        const detail = err.stderr || err.stdout || err.message;
        throw new Error(`CodeQL database creation failed: ${detail.slice(0, 2000)}`);
      }

      // ------------------------------------------------------------------
      // Step 3: Analyze — codeql database analyze
      // ------------------------------------------------------------------

      // Dynamically resolve the best available security suite for the
      // installed CodeQL version (avoids hard-coded paths that break
      // across different qlpack layouts).
      if (cancellationController.isCancelled) throw new Error("CancelledByUser");
      const javaSuite = resolveJavaSecuritySuite(codeqlExe);
      progress.report({ message: `Running CodeQL security queries (${javaSuite.split(":").pop()})…` });
      console.log(`[ZeroFalse] Starting CodeQL analysis with suite: ${javaSuite}`);

      const analyzeArgs = [
        "database", "analyze",
        dbPath,
        javaSuite,
        "--format=sarif-latest",
        "--output", sarifPath,
        "--download",
        "--ram=4096",      // Allow up to 4GB RAM to prevent swapping
        "--threads=0",     // Use all available cores to maximize speed
      ];
      console.log(`[ZeroFalse] Analyze: ${codeqlExe} ${analyzeArgs.join(" ")}`);

      try {
        await spawnAsync(codeqlExe, analyzeArgs, { cwd: workspacePath }, 1_200_000);
        console.log("[ZeroFalse] CodeQL analysis completed.");
      } catch (err: any) {
        if (err.message === "CancelledByUser" || cancellationController.isCancelled) {
          console.log(`[ZeroFalse] Cleaning up CodeQL database after cancellation at: ${dbPath}`);
          try {
            if (fs.existsSync(dbPath)) fs.rmSync(dbPath, { recursive: true, force: true });
            if (fs.existsSync(sarifPath)) fs.unlinkSync(sarifPath);
          } catch (cleanupErr) {
            console.error(`[ZeroFalse] Failed to delete partial db: ${cleanupErr}`);
          }
          throw new Error("CancelledByUser");
        }
        console.error("[ZeroFalse] CodeQL analysis FAILED");
        const detail = err.stderr || err.stdout || err.message;
        throw new Error(`CodeQL analysis failed: ${detail.slice(0, 500)}`);
      }

      // ------------------------------------------------------------------
      // Step 4: Validate SARIF file exists
      // ------------------------------------------------------------------
      if (!fs.existsSync(sarifPath)) {
        const msg = "CodeQL analysis completed but no SARIF file was generated. " +
          "Check that the query pack is compatible with your CodeQL version.";
        vscode.window.showErrorMessage(`ZeroFalse: ${msg}`);
        throw new Error(msg);
      }

      const sarifBytes = fs.statSync(sarifPath).size;
      console.log(`[ZeroFalse] SARIF file generated: ${sarifPath}  (${sarifBytes} bytes)`);

      return sarifPath;
}



// ---------------------------------------------------------------------------
// Internal: HTTP file download with redirect support
// ---------------------------------------------------------------------------

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);

    const request = (currentUrl: string): void => {
      https.get(currentUrl, (response) => {
        // Follow HTTP 301/302 redirects (GitHub releases use these)
        if (response.statusCode === 301 || response.statusCode === 302) {
          if (response.headers.location) {
            request(response.headers.location);
          } else {
            reject(new Error("HTTP redirect missing Location header"));
          }
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Download failed with HTTP ${response.statusCode}`));
          return;
        }

        response.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }).on('error', (err) => {
        fs.unlink(dest, () => reject(err));
      });
    };

    request(url);
  });
}
