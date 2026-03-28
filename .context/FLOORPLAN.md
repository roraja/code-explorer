# Code Explorer Workspace Floorplan

**Code Explorer** is a VS Code extension that provides AI-powered code intelligence in a sidebar panel. Users place their cursor on a symbol, run "Explore Symbol" (Ctrl+Shift+E), and the sidebar shows LLM-generated analysis (overview, step-by-step breakdown, sub-functions, callers, data flow, class members) merged with static analysis data.

Two separate TypeScript bundles: **Extension Host** (Node.js, VS Code API) and **Webview** (browser, DOM). Communication via `postMessage`.

## How to Navigate

1. Read this file first.
2. Based on the task, load **one folder context** from the table below.
3. When working in a specific folder, read its co-located `CONTEXT.md` if one exists.
4. For design rationale and future plans, see `docs/`.

Only load additional contexts if the task clearly spans multiple modules.

## Folder Routing Table

| If the task involves...                            | Read this context                           | Primary files                                         |
|----------------------------------------------------|---------------------------------------------|-------------------------------------------------------|
| Extension activation, command wiring, DI setup     | `src/CONTEXT.md`                            | `src/extension.ts`                                    |
| Symbol resolution at cursor                        | `src/providers/CONTEXT.md`                  | `src/providers/SymbolResolver.ts`                     |
| Analysis pipeline, orchestration, static analysis  | `src/analysis/CONTEXT.md`                   | `src/analysis/AnalysisOrchestrator.ts`, `src/analysis/StaticAnalyzer.ts` |
| LLM providers, CLI spawning, prompt building       | `src/llm/CONTEXT.md`                        | `src/llm/CopilotCLIProvider.ts`, `src/llm/MaiClaudeProvider.ts`, `src/llm/PromptBuilder.ts` |
| Prompt strategies for different symbol kinds       | `src/llm/prompts/CONTEXT.md`               | `src/llm/prompts/*.ts`                                |
| LLM response parsing                              | `src/llm/CONTEXT.md`                        | `src/llm/ResponseParser.ts`                           |
| Markdown cache read/write/serialization            | `src/cache/CONTEXT.md`                      | `src/cache/CacheStore.ts`, `src/cache/CacheWriter.ts` |
| Sidebar webview, tab state, message routing        | `src/ui/CONTEXT.md`                         | `src/ui/CodeExplorerViewProvider.ts`                  |
| Types, interfaces, error hierarchy, constants      | `src/models/CONTEXT.md`                     | `src/models/types.ts`, `src/models/errors.ts`, `src/models/constants.ts` |
| Logger, CLI runner utility                         | `src/utils/CONTEXT.md`                      | `src/utils/logger.ts`, `src/utils/cli.ts`             |
| Webview UI rendering (browser-side)                | `webview/CONTEXT.md`                        | `webview/src/main.ts`, `webview/src/styles/main.css`  |
| Tests (unit, integration)                          | `test/CONTEXT.md`                           | `test/unit/**/*.test.ts`                              |

## Key Features (Current State)

| Feature                        | Status | Module(s)                                         |
|--------------------------------|--------|---------------------------------------------------|
| Explore Symbol command         | Implemented | `extension.ts`, `SymbolResolver.ts`           |
| Sidebar webview with tabs      | Implemented | `CodeExplorerViewProvider.ts`, `webview/`      |
| LLM analysis (copilot-cli)     | Implemented | `CopilotCLIProvider.ts`, `cli.ts`             |
| LLM analysis (mai-claude)      | Implemented | `MaiClaudeProvider.ts`, `cli.ts`              |
| Null/disabled LLM provider     | Implemented | `NullProvider.ts`                             |
| Prompt strategies (function, class, variable, property) | Implemented | `src/llm/prompts/`  |
| Response parsing (JSON blocks) | Implemented | `ResponseParser.ts`                           |
| Static analysis (references, call hierarchy, type hierarchy) | Implemented | `StaticAnalyzer.ts` |
| Markdown cache (read/write)    | Implemented | `CacheStore.ts`                               |
| Related symbol pre-caching     | Implemented | `AnalysisOrchestrator.ts`                     |
| Dual logging (OutputChannel + file) | Implemented | `logger.ts`                              |
| LLM call logging (per-call markdown files) | Implemented | `logger.ts`                       |
| Clear Cache command            | Implemented | `extension.ts`, `CacheStore.ts`               |
| Symbol linking (click-to-explore from webview) | Implemented | `CodeExplorerViewProvider.ts`, `webview/main.ts` |
| Navigate-to-source from webview | Implemented | `CodeExplorerViewProvider.ts`                |
| Scope-chain-based tab deduplication | Implemented | `CodeExplorerViewProvider.ts`            |
| **CacheManager/IndexManager**  | Not implemented | Planned in `src/cache/`                   |
| **AnalysisQueue with priority** | Not implemented | Planned in `src/analysis/`               |
| **BackgroundScheduler**        | Not implemented | Planned                                   |
| **HoverProvider**              | Not implemented | Planned                                   |
| **CodeLensProvider**           | Not implemented | Planned                                   |
| **MCP server**                 | Not implemented | Planned in `src/mcp/`                     |
| **File watcher invalidation**  | Not implemented | Planned                                   |
| **Analyze Workspace command**  | Stub only | `extension.ts` (shows "future release" message)  |

## Data Flow

```
User clicks symbol -> Ctrl+Shift+E
  -> extension.ts command handler
    -> SymbolResolver.resolveAtPosition()
      -> CodeExplorerViewProvider.openTab(symbol)
        -> posts 'setState' message to webview (shows loading spinner)
        -> AnalysisOrchestrator.analyzeSymbol(symbol)
          -> CacheStore.read() (cache check)
          -> StaticAnalyzer.readSymbolSource()
          -> PromptBuilder.build() (strategy pattern by symbol kind)
          -> LLMProvider.analyze() (spawns CLI via runCLI, stdin pipe)
          -> ResponseParser.parse() (extracts JSON blocks from markdown)
          -> CacheStore.write() (persists result as markdown)
          -> Pre-cache related symbols (if any discovered)
        -> posts 'setState' to webview (renders analysis tabs + sections)
```

## Build & Dev

```bash
npm run build              # Build extension + webview
npm run watch              # Watch mode for both
npm run test:unit          # Mocha unit tests
npm run lint:fix           # ESLint with auto-fix
npm run package            # Build + produce .vsix
```

Single test: `TS_NODE_PROJECT=tsconfig.test.json npx mocha test/unit/models/errors.test.ts`

**F5 debug** launches Extension Development Host with `sample-workspace/` as workspace.

## Conventions

- Private members: `_` prefix (ESLint-enforced)
- Unused parameters: `_` prefix (e.g., `_context`)
- Tests: Mocha TDD UI (`suite`/`test`, not `describe`/`it`)
- Settings: `codeExplorer.*` namespace, keys in `src/models/constants.ts`
- Errors: `CodeExplorerError` hierarchy, never raw `Error`
- Logging: `logger` from `src/utils/logger.ts`, never `console.log`
- Webview CSS: VS Code theme variables only, no hardcoded colors
- LLM prompts: stdin pipe (not CLI args) via `runCLI()`

## Quick Troubleshooting

| Symptom | First thing to check |
|---------|---------------------|
| LLM analysis returns empty | Check VS Code Output panel "Code Explorer" and LLM call logs at `.vscode/code-explorer/logs/llms/` |
| `claude` CLI refuses to start | Ensure `CLAUDECODE` env var is deleted before spawn (MaiClaudeProvider handles this) |
| Cache not found despite prior analysis | Cache key uses scope chain; different scope = different cache entry |
| Webview shows blank | Check CSP in `_getHtmlForWebview()`, verify `webview/dist/` has built files |
| "No symbol found at cursor" | Language server may not provide DocumentSymbol; check `SymbolResolver` fallback logic |
| Tab duplicates for same symbol | Scope chain mismatch; check `openTab()` dedup logic |
