# src/llm/

LLM integration layer — providers, prompt building, and response parsing.

## Modules

| File | Role |
|------|------|
| `LLMProvider.ts` | `LLMProvider` interface: `name`, `isAvailable()`, `analyze(request)`, `getCapabilities()`, optional `setWorkspaceRoot(root)` |
| `LLMProviderFactory.ts` | Factory that creates the right provider from config string (`copilot-cli`, `mai-claude`, `build-service`, `none`) |
| `CopilotCLIProvider.ts` | Spawns `copilot --yolo -s --output-format text` with prompt piped via stdin. Supports `setWorkspaceRoot()` for workspace-context execution. |
| `MaiClaudeProvider.ts` | Spawns `claude -p --output-format text` with prompt via stdin. Deletes `CLAUDECODE` env var. Supports `setWorkspaceRoot()`. |
| `BuildServiceProvider.ts` | Remote HTTP provider: submits prompt to Go build service (`POST /api/v1/copilot/run`), polls for job completion with incremental log streaming. No local CLI needed. Supports `setWorkspaceRoot()` and `setCrPaths()`. |
| `NullProvider.ts` | No-op provider when LLM is disabled. `isAvailable()` returns false. |
| `PromptBuilder.ts` | Builds prompts using strategy pattern (`build()`), unified prompt (`buildUnified()`), file analysis (`buildFileAnalysis()` fallback, `buildFileAnalysisFromSymbolList()` primary), and enhance (`buildEnhance()`). |
| `ResponseParser.ts` | Parses LLM markdown responses: analysis fields, symbol identity, related symbol cache entries, diagrams, enhance responses. |

## Provider Architecture

CLI-based providers use the shared `runCLI()` utility (`src/utils/cli.ts`) which handles:
- Process spawning via `child_process.spawn()` with configurable `cwd`
- Stdin piping (prompts can be many KB)
- Manual timeout with `SIGTERM` kill
- `settled` guard to prevent double-resolve/reject
- Real-time stdout/stderr chunk callbacks for logging

The HTTP-based `BuildServiceProvider` uses native `http`/`https` modules (no dependencies) to POST prompts to the Go build service at `POST /api/v1/copilot/run`, then polls `GET /api/v1/jobs/{id}/logs` for incremental output until the job completes. It can also cancel timed-out jobs via `POST /api/v1/jobs/{id}/cancel`.

### Provider-Specific Details

| Provider | Transport | Command/Endpoint | System Prompt | Env Handling | Workspace Context |
|----------|-----------|-------------------|---------------|--------------|-------------------|
| `copilot-cli` | Local CLI | `copilot --yolo -s --output-format text` | Prepended into prompt text | None needed | `cwd` set via `setWorkspaceRoot()` |
| `mai-claude` | Local CLI | `claude -p --output-format text` | Via `--append-system-prompt` flag | Must `delete env.CLAUDECODE` | `cwd` set via `setWorkspaceRoot()` |
| `build-service` | HTTP API | `POST /api/v1/copilot/run` on Go build service | Prepended into prompt text | N/A (remote) | `cr_src_folder` + `depot_tools_path` in payload |

## PromptBuilder

### `build(symbol, sourceCode, containingScopeSource?)` — Legacy/Strategy-Based

Uses the **strategy pattern**: `STRATEGY_MAP` maps symbol kinds to prompt strategies:

| Symbol Kind | Strategy Class |
|-------------|---------------|
| `function`, `method` | `FunctionPromptStrategy` |
| `variable` | `VariablePromptStrategy` |
| `class`, `struct`, `interface`, `enum` | `ClassPromptStrategy` |
| `property` | `PropertyPromptStrategy` |

### `buildUnified(cursor, cacheRoot?)` — Primary/Unified Prompt

Builds a single prompt that asks the LLM to:
1. **Identify the symbol** — kind, name, container, scope chain (outputs `json:symbol_identity`)
2. **Perform full analysis** — all sections appropriate for any symbol kind
3. **Generate diagrams** — Mermaid diagrams appropriate for the symbol kind (outputs `json:diagrams`)
4. **Generate related symbol analyses** — with cache file paths matching the naming convention (outputs `json:related_symbol_analyses`)

### `buildFileAnalysis(filePath, fileSource, cacheRoot?)` — Full-File Analysis (Fallback)

Builds a prompt that sends full file source code and instructs the LLM to analyze ALL crucial symbols. Used as fallback when the language server does not return document symbols. Outputs `json:file_symbol_analyses`.

### `buildFileAnalysisFromSymbolList(filePath, symbols, cacheRoot?)` — Lightweight File Analysis (Primary)

Builds a lightweight prompt that lists only the file path and pre-discovered symbol names (from `StaticAnalyzer.listFileSymbols()`). Does NOT include source code — the LLM runs in workspace context and reads the file directly. This reduces prompt size significantly for large files. Outputs `json:file_symbol_analyses`.

### `buildEnhance(existingResult, userPrompt, sourceCode)` — Q&A Enhancement

Builds a prompt that provides the existing analysis summary, prior Q&A history, and source code as context, then asks the LLM to answer the user's question. The response may include:
- A direct answer (stored as a `QAEntry`)
- An updated overview (replaces existing)
- Additional key points (`json:additional_key_points`)
- Additional potential issues (`json:additional_issues`)

## ResponseParser

Extracts structured data from LLM markdown responses using regex-based parsing:

| JSON Block Tag | Parsed Into | Method |
|----------------|-------------|--------|
| `json:symbol_identity` | `ResolvedSymbolIdentity` | `parseSymbolIdentity()` |
| `json:related_symbol_analyses` | `RelatedSymbolCacheEntry[]` | `parseRelatedSymbolCacheEntries()` |
| `json:file_symbol_analyses` | `FileSymbolAnalysisEntry[]` | `parseFileSymbolAnalyses()` |
| `json:callers` | `CallStackEntry[]` + `UsageEntry[]` | `_parseCallers()` |
| `json:steps` | `FunctionStep[]` | `_parseSteps()` |
| `json:subfunctions` | `SubFunctionInfo[]` | `_parseSubFunctions()` |
| `json:function_inputs` | `FunctionInputParam[]` | `_parseFunctionInputs()` |
| `json:function_output` | `FunctionOutputInfo` | `_parseFunctionOutput()` |
| `json:data_flow` | `DataFlowEntry[]` | `_parseDataFlow()` |
| `json:variable_lifecycle` | `VariableLifecycle` | `_parseVariableLifecycle()` |
| `json:data_kind` | `DataKindInfo` | `_parseDataKind()` |
| `json:class_members` | `ClassMemberInfo[]` | `_parseClassMembers()` |
| `json:member_access` | `MemberAccessInfo[]` | `_parseMemberAccess()` |
| `json:diagrams` | `DiagramEntry[]` | `_parseDiagrams()` |
| `json:related_symbols` | `RelatedSymbolAnalysis[]` | `_parseRelatedSymbols()` |
| `json:additional_key_points` | `string[]` | `parseEnhanceResponse()` |
| `json:additional_issues` | `string[]` | `parseEnhanceResponse()` |

Also extracts markdown `### Section` headings into key-value pairs for overview, key points, dependencies, usage pattern, and potential issues.

### Exported Types

- `ResolvedSymbolIdentity` — LLM-resolved symbol identity (name, kind, container, scopeChain)
- `RelatedSymbolCacheEntry` — Related symbol with cache file path, overview, key points, dependencies
- `FileSymbolAnalysisEntry` — Full symbol analysis entry from file-level analysis (includes steps, sub-functions, class members, callers, etc.)
- `EnhanceParseResult` — Result of parsing an enhance response (answer, updatedOverview, additionalKeyPoints, additionalIssues)

## Do NOT

- Pass prompts as CLI arguments (use stdin via `runCLI()`)
- Forget to handle LLM unavailability gracefully (orchestrator degrades, never blocks)
- Add a new provider without implementing the full `LLMProvider` interface and registering it in `LLMProviderFactory`
- Forget to call `setWorkspaceRoot()` on providers that support it
