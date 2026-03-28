# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Codebase Navigation

**Start with the floorplan**: `.context/FLOORPLAN.md` provides a routing table of all modules, their responsibilities, and which `CONTEXT.md` files to read based on the task. Each key folder has a co-located `CONTEXT.md` with detailed module documentation.

## What This Is

A VS Code extension ("Code Explorer") that provides AI-powered code intelligence in a sidebar panel. Users place their cursor on a symbol, run "Explore Symbol" (Ctrl+Shift+E), and the sidebar shows LLM-generated analysis (overview, step-by-step breakdown, sub-functions, inputs/outputs, callers, data flow, class members, variable lifecycle) with results cached as markdown files. Default LLM provider is `copilot` CLI; also supports `claude` CLI.

## Build & Dev Commands

```bash
npm run build              # Build extension (-> dist/extension.js) + webview (-> webview/dist/)
npm run watch              # Watch mode for both (uses concurrently)
npm run lint               # ESLint across src/, webview/src/, test/
npm run lint:fix           # ESLint with auto-fix
npm run format             # Prettier write
npm run format:check       # Prettier check (used in CI)
npm run test:unit          # Mocha unit tests (ts-node, no VS Code runtime needed)
npm run package            # Build + produce .vsix
```

To run a single test file: `TS_NODE_PROJECT=tsconfig.test.json npx mocha test/unit/models/errors.test.ts`

Mocha uses `tdd` UI (`suite`/`test`, not `describe`/`it`). Config is in `.mocharc.yml`.

**F5 debug** launches the Extension Development Host with `sample-workspace/` (C++ sample project) as the opened workspace.

## Two Separate TypeScript Projects

The extension host and webview are **separate bundles** with separate tsconfigs — they cannot share code at runtime:

| | Extension Host | Webview |
|---|---|---|
| Entry | `src/extension.ts` | `webview/src/main.ts` |
| tsconfig | `tsconfig.json` (module: commonjs) | `webview/tsconfig.json` (module: ES2022) |
| esbuild | `esbuild.config.mjs` -> `dist/extension.js` | `webview/esbuild.config.mjs` -> `webview/dist/main.js + main.css` |
| Platform | Node.js (has `vscode` API, `fs`, `child_process`) | Browser (has DOM, `acquireVsCodeApi()`) |
| Tests tsconfig | `tsconfig.test.json` (includes both `src/` and `test/`) | -- |

The webview communicates with the extension via `postMessage`. Message types are defined in `src/models/types.ts` (`ExtensionToWebviewMessage`, `WebviewToExtensionMessage`) but the webview cannot import from `src/` — it redefines its own local interfaces.

## Architecture — Data Flow

```
User clicks symbol -> Ctrl+Shift+E
  -> extension.ts command handler
    -> SymbolResolver.resolveAtPosition() [queries vscode.executeDocumentSymbolProvider]
      -> CodeExplorerViewProvider.openTab(symbol)
        -> posts 'setState' to webview (shows loading spinner with stage labels)
        -> AnalysisOrchestrator.analyzeSymbol(symbol)
          -> CacheStore.read() [disk cache check, returns on non-stale hit]
          -> StaticAnalyzer.readSymbolSource() [reads source code for prompt]
          -> PromptBuilder.build() [strategy pattern by symbol kind]
          -> LLMProvider.analyze() [spawns CLI with prompt on stdin via runCLI()]
          -> ResponseParser.parse() [extracts JSON blocks + markdown sections]
          -> CacheStore.write() [persists as markdown with YAML frontmatter]
          -> Pre-cache related symbols [discovered by LLM]
        -> posts 'setState' to webview (renders tabs + analysis sections)
```

If the LLM is unavailable or fails, the orchestrator returns a result with placeholder overview — never blocks or throws to the user.

## Key Module Responsibilities

- **`src/extension.ts`** — Wires all dependencies via constructor injection, registers commands/providers. All services are constructed here.
- **`src/ui/CodeExplorerViewProvider.ts`** — `WebviewViewProvider` that serves HTML with CSP, manages tab state (single source of truth), routes webview messages, triggers analysis. Deduplicates tabs using scope chain comparison.
- **`src/analysis/AnalysisOrchestrator.ts`** — Coordinates cache check + LLM analysis pipeline. Gracefully degrades on LLM failure. Pre-caches related symbols discovered by the LLM.
- **`src/analysis/StaticAnalyzer.ts`** — Uses VS Code commands (`vscode.executeReferenceProvider`, `vscode.prepareCallHierarchy`, etc.) to gather static data. Currently, only `readSymbolSource()` and `readContainingScopeSource()` are called by the orchestrator; reference/call hierarchy methods are available but not wired into the pipeline.
- **`src/llm/CopilotCLIProvider.ts`** — Spawns `copilot --yolo -s --output-format text` with prompt piped via stdin. Default provider.
- **`src/llm/MaiClaudeProvider.ts`** — Spawns `claude -p --output-format text` with prompt piped via stdin. **Must** `delete env.CLAUDECODE` to work inside a Claude Code session.
- **`src/llm/NullProvider.ts`** — No-op provider when LLM is disabled (`isAvailable()` returns false).
- **`src/utils/cli.ts`** — Shared `runCLI()` utility for spawning CLI processes with stdin piping, manual timeout (15 min default), env overrides, and real-time chunk callbacks. Used by both LLM providers.
- **`src/llm/PromptBuilder.ts`** — Builds prompts using strategy pattern. Delegates to per-symbol-kind strategies in `src/llm/prompts/` (`FunctionPromptStrategy`, `ClassPromptStrategy`, `VariablePromptStrategy`, `PropertyPromptStrategy`).
- **`src/llm/ResponseParser.ts`** — Extracts structured data from LLM markdown responses via regex-based parsing of `json:*` fenced blocks and `### Section` headings.
- **`src/cache/CacheStore.ts`** — Reads/writes analysis results as markdown files with YAML frontmatter. Cache key uses scope chain for unique identification. Full serialization/deserialization round-trip.
- **`src/cache/CacheWriter.ts`** — Earlier/alternative cache writer with simpler serialization. Superseded by `CacheStore` for the main pipeline.
- **`src/providers/SymbolResolver.ts`** — Resolves cursor position to `SymbolInfo` using document symbols, definition provider fallback, and word-at-cursor fallback. Builds scope chains for unique symbol identity.
- **`src/models/types.ts`** — Single source of truth for all interfaces: `SymbolInfo`, `AnalysisResult`, `TabState`, message types, cache types, LLM types. Includes `SYMBOL_KIND_PREFIX` map.
- **`src/models/errors.ts`** — `CodeExplorerError` hierarchy with `ErrorCode` enum. Subclasses: `LLMError`, `CacheError`, `AnalysisError`, `SystemError`.
- **`src/models/constants.ts`** — Extension IDs, command names, config keys, cache constants, queue defaults, supported languages.
- **`src/utils/logger.ts`** — Dual-output logger: VS Code OutputChannel + daily log files. Also manages per-LLM-call markdown log files at `.vscode/code-explorer/logs/llms/`. Must call `logger.init(workspaceRoot)` during activation.
- **`webview/src/main.ts`** — Vanilla TS (no React). Pure renderer. Renders tab bar, analysis sections (collapsible `<details>`), empty/loading/error states. Supports symbol linking (click sub-function/caller to explore) and navigate-to-source. All CSS uses VS Code theme variables.

## Conventions

- Private members prefixed with `_` (enforced by ESLint `@typescript-eslint/naming-convention`).
- Unused parameters prefixed with `_` (e.g., `_context`, `_token`).
- All extension settings live under the `codeExplorer.` namespace. Keys are in `src/models/constants.ts`.
- Commands: `codeExplorer.exploreSymbol`, `codeExplorer.refreshAnalysis`, `codeExplorer.clearCache`, `codeExplorer.analyzeWorkspace`.
- The webview's `package.json` view type is `"webview"` (not `"tree"`), requiring a `WebviewViewProvider` registration.
- Errors: Use `CodeExplorerError` hierarchy from `src/models/errors.ts` — never throw raw `Error`.
- Logging: Use `logger` from `src/utils/logger.ts` — never `console.log` directly.
- Tests: Mocha TDD UI (`suite`/`test`, not `describe`/`it`). Assert with Node.js `assert` module.
- LLM prompts: Send via **stdin** (not CLI arguments) — prompts can be many KB.

## Design Docs

The `docs/` folder contains detailed design documents that specify planned features beyond current implementation:

| Doc | Covers |
|-----|--------|
| `01-prd.md` | Product requirements, user stories, personas |
| `02-spec.md` | Technical spec: config schema, API contracts, error handling strategy, cache format |
| `03-hld_architecture.md` | Layered architecture, component diagrams, directory structure, technology rationale |
| `04-lld_detailed_design.md` | Full implementation code for all modules (CacheManager, IndexManager, BackgroundScheduler, etc.) |
| `05-implementation_plan.md` | Sprint-by-sprint task breakdown with acceptance criteria |
| `06-data_model_and_cache.md` | Markdown cache format, key resolution, invalidation strategy, index schema |
| `07-ui_ux_design.md` | UI/UX design for the sidebar panel |
| `08-mcp_and_api_design.md` | MCP server and API design |

## Implemented Features

| Feature | Module(s) |
|---------|-----------|
| Explore Symbol command (Ctrl+Shift+E) | `extension.ts`, `SymbolResolver.ts` |
| Sidebar webview with tabbed UI | `CodeExplorerViewProvider.ts`, `webview/src/main.ts` |
| LLM analysis via copilot-cli | `CopilotCLIProvider.ts`, `cli.ts` |
| LLM analysis via mai-claude | `MaiClaudeProvider.ts`, `cli.ts` |
| Strategy-based prompts (function, class, variable, property) | `src/llm/prompts/` |
| Structured response parsing (JSON blocks) | `ResponseParser.ts` |
| Markdown cache with YAML frontmatter (read/write/clear) | `CacheStore.ts` |
| Related symbol pre-caching | `AnalysisOrchestrator.ts` |
| Dual logging (OutputChannel + daily files) | `logger.ts` |
| Per-LLM-call markdown log files | `logger.ts` |
| Symbol linking (click to explore from webview) | `CodeExplorerViewProvider.ts`, `webview/main.ts` |
| Navigate-to-source from webview | `CodeExplorerViewProvider.ts` |
| Scope-chain-based tab deduplication | `CodeExplorerViewProvider.ts` |
| Static analysis: references, call hierarchy, type hierarchy | `StaticAnalyzer.ts` (methods available, not wired into pipeline) |

## Not Yet Implemented

Referring to `docs/05-implementation_plan.md`, the following are planned but **not yet implemented**:

- **CacheManager/IndexManager** (`src/cache/`): Master index, TTL, size limits, batch invalidation — files not yet created
- **HashService**: SHA-256 hashing for source file staleness detection
- **AnalysisQueue** with priority + rate limiting
- **BackgroundScheduler** for periodic re-analysis
- **CodeExplorerHoverProvider** and **CodeExplorerCodeLensProvider**
- **MCP server** (`src/mcp/`)
- File watcher -> cache invalidation pipeline
- **Analyze Workspace command** (currently shows "future release" stub)
- **Static analysis merge**: `findReferences()`, `buildCallHierarchy()`, `getTypeHierarchy()` exist in `StaticAnalyzer` but are not called by the orchestrator — only LLM-generated data is used

## LLM Provider Gotchas

All providers use the shared `runCLI()` utility (`src/utils/cli.ts`) which handles spawn, stdin piping, and manual timeout.

- **copilot-cli** (default): Runs `copilot --yolo -s --output-format text` with prompt piped via stdin (omits `-p` flag — copilot reads stdin when `-p` is absent). Does **not** support `--append-system-prompt`; system instructions are prepended into the prompt text. No special env handling needed.
- **mai-claude**: Runs `claude -p --output-format text`. **Must** `delete env.CLAUDECODE` — otherwise `claude` refuses to start inside a Claude Code session. Supports `--append-system-prompt`.
- **Both**: Prompt is sent via **stdin** (not as CLI argument) — prompts can be many KB; stdin avoids OS argument length limits.
- **Timeout**: `spawn()` doesn't support a `timeout` option; `runCLI()` uses `setTimeout` + `child.kill('SIGTERM')` with a `settled` guard. Default timeout is 15 minutes.
