Listed directory last-ext
Viewed package.json:1-69
Listed directory src
Viewed extension.ts:1-391
Viewed types.ts:1-122
Listed directory codeql
Listed directory llm
Listed directory pipeline
Listed directory sarif
Listed directory ui
Viewed codeqlRunner.ts:1-565
Viewed ollamaClient.ts:1-280
Viewed outputValidator.ts:1-200
Viewed dashboardPanel.ts:1-657

# ZeroFalse — SAST False Positive Reduction

## Overview
ZeroFalse is a Visual Studio Code extension engineered to reduce false positives in Static Application Security Testing (SAST) outputs. It automates the execution of CodeQL security analyses on Java codebases and leverages a local Large Language Model (LLM) to adjudicate the resulting SARIF alerts. By extracting flow-sensitive code paths and enriching them with context, ZeroFalse deterministically queries a local instance of LLaMA 3 to classify each alert as either a True Positive (TP) or a False Positive (FP).

## Key Features
- **Automated CodeQL Execution**: Automatically detects the CodeQL CLI, creates databases (supporting Maven `pom.xml` builds), and executes the `java-security-extended` query suite without manual intervention.
- **Contextual Source Extraction**: Extracts the precise flow-sensitive code snippets (source, steps, sink) and surrounding annotations referenced by the SARIF artifact locations.
- **Deterministic LLM Adjudication**: Interfaces directly with a local Ollama instance (`llama3:8b`) using a deterministic configuration (temperature `0`) to evaluate security alerts.
- **Strict Output Validation**: Implements a robust JSON repair and regex-based fallback parsing layer to ensure LLM responses conform strictly to the required schema.
- **Dashboard Webview UI**: Provides a dark-themed, data-centric dashboard containing summary metrics, reduction ratios, distribution charts, and detailed LLM reasoning.
- **Inline Gutter Annotations**: Directly decorates source code lines in the editor with visual markers for TP and FP classifications.
- **Unified Process Cancellation**: Features a centralized cancellation controller that securely terminates both long-running CodeQL background processes and active LLM requests.

## System Architecture
The extension is designed with a modular architecture to enforce separation of concerns:
- **Extension Layer** (`extension.ts`): Orchestrates the pipeline, registers VS Code commands (`zerofalse.analyze`, `zerofalse.cancel`), and manages global state and cancellation flows.
- **CodeQL Integration** (`codeqlRunner.ts`): Responsible for locating the CodeQL executable (probing `PATH` and Windows defaults like `C:\codeql\codeql.exe`), executing DB creation (`mvn clean compile`), and running the `sarif-latest` format analysis.
- **Pipeline Orchestration** (`contextExtractor.ts`, `cweEnricher.ts`, `promptBuilder.ts`): Isolates code flow execution traces, correlates them with CWE definitions (sanitization and attack patterns), and constructs a standardized prompt template.
- **SARIF Processing** (`parser.ts`): Parses standard `.sarif` formatted data into a canonical internal `Alert` model.
- **LLM Module** (`ollamaClient.ts`, `outputValidator.ts`): Manages HTTP interactions with the local Ollama API. Enforces a strict classification schema (Vulnerability, Sanitization, Attack Feasibility, Confidence, Explanation) and handles JSON malformations.
- **UI Layer** (`dashboardPanel.ts`, `resultsViewProvider.ts`, `inlineAnnotations.ts`): Renders the interactive HTML dashboard and applies VS Code `TextEditorDecorationType` to the active workspace.

## Data Flow / Workflow
1. **Input**: The user invokes the analysis on a `.sarif` file or an open workspace directory.
2. **CodeQL Phase**: If a workspace is provided without a SARIF file, `codeql database create` and `codeql database analyze` are executed to generate `results.sarif`.
3. **SARIF Phase**: The parser reads the SARIF file and maps `ruleId`, `message`, and physical `locations` into an internal list of alerts.
4. **Processing Phase**: For each alert, the pipeline extracts the affected source code lines, enriches the data with specific CWE guidelines, and constructs an evaluation prompt.
5. **LLM Phase**: The extension sends HTTP POST requests to `http://localhost:11434/api/chat`.
6. **Validation Phase**: The LLM response is extracted, structurally repaired if necessary, and classified as `TP` or `FP`.
7. **Output**: Results are streamed sequentially to the VS Code sidebar, Dashboard webview, and source file gutter annotations.

## Technologies Used
- **Language**: TypeScript, Node.js
- **Platform**: Visual Studio Code Extension API
- **Analysis Tool**: CodeQL CLI
- **LLM Provider**: Ollama
- **Model**: `llama3:8b`
- **UI**: HTML, CSS (Vanilla), JavaScript

## Installation
1. Ensure you have **Visual Studio Code v1.85.0** or higher installed.
2. Install the **CodeQL CLI**. It must be available in your system `PATH` or located at `C:\codeql\codeql.exe`.
3. Install **Ollama** and pull the required model:
   ```bash
   ollama pull llama3:8b
   ```
4. Start the Ollama local server:
   ```bash
   ollama serve
   ```
5. Install the ZeroFalse extension `.vsix` package through the VS Code Extensions pane.

## Usage
- **From a SARIF File**: Right-click any `.sarif` file in the Explorer and select **ZeroFalse: Analyze SARIF File**.
- **From a Workspace**: Open the Command Palette (`Ctrl+Shift+P`), type **ZeroFalse: Analyze SARIF File**, and hit Enter. The extension will automatically invoke CodeQL.
- **Clear Annotations**: Open the Command Palette and run **ZeroFalse: Clear Annotations** to remove editor gutter icons.
- **Cancel Execution**: Click the cancel button on the progress notification or run **ZeroFalse: Cancel**.

## Output & Reports
- **SARIF File**: An intermediate `results.sarif` file is saved to the workspace root when running automatic analysis.
- **Dashboard UI**: Displays a visual breakdown of False Positives vs. True Positives, along with a detailed table highlighting rule IDs, file paths, LLM explanations, and confidence levels.
- **Inline Editor Output**: Lines containing identified vulnerabilities or false alarms are decorated with red (TP) or green (FP) background highlights and gutter markers. Hovering over the marker reveals the LLM's reasoning.

## Requirements (DETAILED)
- **Software**: 
  - Node.js (for extension runtime)
  - VS Code ^1.85.0
  - CodeQL CLI
  - Apache Maven (`mvn` must be in `PATH` for creating databases of Java projects with a `pom.xml`)
- **LLM Requirements**:
  - Ollama installed locally.
  - The model `llama3:8b` must be downloaded.
- **Hardware Constraints**:
  - **RAM**: Minimum 16GB total system memory recommended. CodeQL explicitly allocates up to 4GB RAM (`--ram=4096`), and the `llama3:8b` model will require approximately 8GB of memory to load and run inference successfully.
  - **CPU**: Multi-core processor (CodeQL utilizes `--threads=0` to scale across all cores).
- **Runtime Environment**: Works on Windows, macOS, and Linux. For CodeQL detection, it heavily favors standard global PATHs and Windows `C:\codeql` structures.

## Limitations (CRITICAL ANALYSIS)
- **Sequential LLM Processing**: Alerts are adjudicated synchronously in a `for` loop. There is no batching or parallel execution of LLM requests, causing execution time to scale linearly with the number of alerts.
- **Language Lock-in**: CodeQL database creation arguments are strictly hardcoded to Java (`--language=java`, executing Maven). The extension does not currently support dynamic language detection or scanning for Python, JavaScript, etc.
- **Model Rigidity**: The extension strictly enforces the use of `localhost:11434` and the `llama3:8b` model. There is no configurability for external endpoints, cloud APIs (e.g., OpenAI, Anthropic), or alternative local models.
- **Response Instability**: The implementation relies heavily on a complex regex-based fallback parser (`repairJson`, `extractFieldByRegex`) to salvage broken JSON from the LLM, indicating that the underlying model frequently fails to return valid structural output despite a temperature setting of `0`.
- **Lack of Prioritization/Ranking**: The extension classifies items as TP or FP but does not provide dynamic severity ranking or risk scoring based on the LLM's assessment.

## Future Work
- **Concurrent Request Handling**: Refactor the pipeline to support parallel LLM invocations using a bounded concurrency pool to drastically reduce total adjudication time.
- **Language Agnosticism**: Implement workspace introspection to dynamically select the appropriate CodeQL language flags and build commands (e.g., npm/yarn for JS, pip for Python).
- **Model Configurability**: Expose VS Code settings to allow users to define custom LLM endpoints, ports, and model names.
- **Enhanced Prompt Engineering**: Transition from string-based JSON prompting to schema-forced outputs (such as Ollama's native JSON mode) to deprecate the regex parsing layers and improve stability.
