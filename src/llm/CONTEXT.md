# src/llm/

LLM integration layer — providers, prompt building, and response parsing.

## Modules

| File | Role |
|------|------|
| `LLMProvider.ts` | `LLMProvider` interface: `name`, `isAvailable()`, `analyze(request)`, `getCapabilities()` |
| `LLMProviderFactory.ts` | Factory that creates the right provider from config string (`copilot-cli`, `mai-claude`, `none`) |
| `CopilotCLIProvider.ts` | Spawns `copilot --yolo -s --output-format text` with prompt piped via stdin |
| `MaiClaudeProvider.ts` | Spawns `claude -p --output-format text` with prompt via stdin. Deletes `CLAUDECODE` env var. |
| `NullProvider.ts` | No-op provider when LLM is disabled. `isAvailable()` returns false. |
| `PromptBuilder.ts` | Builds prompts using strategy pattern. Delegates to per-kind strategies in `prompts/`. |
| `ResponseParser.ts` | Parses LLM markdown responses into structured `AnalysisResult` fields. |

## Provider Architecture

All providers use the shared `runCLI()` utility (`src/utils/cli.ts`) which handles:
- Process spawning via `child_process.spawn()`
- Stdin piping (prompts can be many KB)
- Manual timeout with `SIGTERM` kill
- `settled` guard to prevent double-resolve/reject
- Real-time stdout/stderr chunk callbacks for logging

### Provider-Specific Gotchas

| Provider | Command | System Prompt | Env Handling |
|----------|---------|---------------|--------------|
| `copilot-cli` | `copilot --yolo -s --output-format text` | Prepended into prompt text (no `--append-system-prompt`) | None needed |
| `mai-claude` | `claude -p --output-format text` | Via `--append-system-prompt` flag | Must `delete env.CLAUDECODE` |

## PromptBuilder

Uses the **strategy pattern**: `STRATEGY_MAP` maps symbol kinds to prompt strategies:

| Symbol Kind | Strategy Class |
|-------------|---------------|
| `function`, `method` | `FunctionPromptStrategy` |
| `variable` | `VariablePromptStrategy` |
| `class`, `interface`, `enum` | `ClassPromptStrategy` |
| `property` | `PropertyPromptStrategy` |

Each strategy builds a prompt requesting specific sections and JSON blocks. See `src/llm/prompts/CONTEXT.md`.

## ResponseParser

Extracts structured data from LLM markdown responses using regex-based parsing:

| JSON Block Tag | Parsed Into | Used By |
|----------------|-------------|---------|
| `json:callers` | `CallStackEntry[]` + `UsageEntry[]` | All strategies |
| `json:steps` | `FunctionStep[]` | Function/class strategies |
| `json:subfunctions` | `SubFunctionInfo[]` | Function strategy |
| `json:function_inputs` | `FunctionInputParam[]` | Function strategy |
| `json:function_output` | `FunctionOutputInfo` | Function strategy |
| `json:data_flow` | `DataFlowEntry[]` | Variable/property strategies |
| `json:variable_lifecycle` | `VariableLifecycle` | Variable/property strategies |
| `json:class_members` | `ClassMemberInfo[]` | Class strategy |
| `json:member_access` | `MemberAccessInfo[]` | Class/property strategies |
| `json:related_symbols` | `RelatedSymbolAnalysis[]` | All strategies |

Also extracts markdown `### Section` headings into key-value pairs for overview, key points, dependencies, usage pattern, and potential issues.

## Do NOT

- Pass prompts as CLI arguments (use stdin via `runCLI()`)
- Forget to handle LLM unavailability gracefully (orchestrator degrades, never blocks)
- Add a new provider without implementing the full `LLMProvider` interface and registering it in `LLMProviderFactory`
