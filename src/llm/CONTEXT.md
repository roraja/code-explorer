# src/llm/

LLM integration layer — providers, prompt building, and response parsing.

## Modules

| File | Role |
|------|------|
| `LLMProvider.ts` | `LLMProvider` interface: `name`, `isAvailable()`, `analyze(request)`, `getCapabilities()`, optional `setWorkspaceRoot(root)` |
| `LLMProviderFactory.ts` | Factory that creates the right provider from config string (`copilot-cli`, `mai-claude`, `none`) |
| `CopilotCLIProvider.ts` | Spawns `copilot --yolo -s --output-format text` with prompt piped via stdin. Supports `setWorkspaceRoot()` for workspace-context execution. |
| `MaiClaudeProvider.ts` | Spawns `claude -p --output-format text` with prompt via stdin. Deletes `CLAUDECODE` env var. Supports `setWorkspaceRoot()`. |
| `NullProvider.ts` | No-op provider when LLM is disabled. `isAvailable()` returns false. |
| `PromptBuilder.ts` | Builds prompts using strategy pattern (`build()`), unified prompt (`buildUnified()`), file analysis (`buildFileAnalysis()`), and enhance (`buildEnhance()`). |
| `ResponseParser.ts` | Parses LLM markdown responses: analysis fields, symbol identity, related symbol cache entries, diagrams, enhance responses. |

## Provider Architecture

All providers use the shared `runCLI()` utility (`src/utils/cli.ts`) which handles:
- Process spawning via `child_process.spawn()` with configurable `cwd`
- Stdin piping (prompts can be many KB)
- Manual timeout with `SIGTERM` kill
- `settled` guard to prevent double-resolve/reject
- Real-time stdout/stderr chunk callbacks for logging

### Provider-Specific Details

| Provider | Command | System Prompt | Env Handling | Workspace Context |
|----------|---------|---------------|--------------|-------------------|
| `copilot-cli` | `copilot --yolo -s --output-format text` | Prepended into prompt text (no `--append-system-prompt`) | None needed | `cwd` set to workspace root via `setWorkspaceRoot()` |
| `mai-claude` | `claude -p --output-format text` | Via `--append-system-prompt` flag | Must `delete env.CLAUDECODE` | `cwd` set to workspace root via `setWorkspaceRoot()` |

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

### `buildFileAnalysis(filePath, fileSource, cacheRoot?)` — Full-File Analysis

Builds a prompt that instructs the LLM to analyze ALL crucial symbols in a given file and output cache-compatible entries for each. Outputs `json:file_symbol_analyses`.

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
