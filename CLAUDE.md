# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A VS Code extension ("Code Explorer") that provides AI-powered code intelligence in a sidebar panel. Users place their cursor on a symbol, run "Explore Symbol" (Ctrl+Shift+E), and the sidebar shows static analysis (references, call hierarchy, type hierarchy) merged with LLM-generated analysis (overview, key points, usage patterns, potential issues). Default LLM provider is `copilot` CLI (`copilot --yolo -p`); also supports `claude` CLI.

## Build & Dev Commands

```bash
npm run build              # Build extension (→ dist/extension.js) + webview (→ webview/dist/)
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
| esbuild | `esbuild.config.mjs` → `dist/extension.js` | `webview/esbuild.config.mjs` → `webview/dist/main.js + main.css` |
| Platform | Node.js (has `vscode` API, `fs`, `child_process`) | Browser (has DOM, `acquireVsCodeApi()`) |
| Tests tsconfig | `tsconfig.test.json` (includes both `src/` and `test/`) | — |

The webview communicates with the extension via `postMessage`. Message types are defined in `src/models/types.ts` (`ExtensionToWebviewMessage`, `WebviewToExtensionMessage`) but the webview cannot import from `src/` — it redefines its own local interfaces.

## Architecture — Data Flow

```
User clicks symbol → Ctrl+Shift+E
  → extension.ts command handler
    → SymbolResolver.resolveAtPosition() [queries vscode.executeDocumentSymbolProvider]
      → CodeExplorerViewProvider.openTab(symbol)
        → posts 'openTab' message to webview (shows loading spinner)
        → AnalysisOrchestrator.analyzeSymbol(symbol)
          → StaticAnalyzer (parallel): findReferences, buildCallHierarchy, getTypeHierarchy, readSymbolSource
          → LLM Provider.analyze() [spawns CLI with prompt on stdin]
          → ResponseParser.parse() [extracts markdown sections]
          → merges static + LLM results into AnalysisResult
        → posts 'analysisResult' to webview (renders tabs + sections)
```

If the LLM is unavailable or fails, the orchestrator returns static-only results — never blocks or throws to the user.

## Key Module Responsibilities

- **`src/extension.ts`** — Wires all dependencies via constructor injection, registers commands/providers. All services are constructed here.
- **`src/ui/CodeExplorerViewProvider.ts`** — `WebviewViewProvider` that serves HTML with CSP, manages tab state, routes webview messages, triggers analysis.
- **`src/analysis/AnalysisOrchestrator.ts`** — Coordinates static + LLM analysis pipeline, merges results. Gracefully degrades on LLM failure.
- **`src/analysis/StaticAnalyzer.ts`** — Uses VS Code commands (`vscode.executeReferenceProvider`, `vscode.prepareCallHierarchy`, etc.) to gather static data.
- **`src/llm/CopilotCLIProvider.ts`** — Spawns `copilot --yolo -p` with prompt piped via stdin. Default provider.
- **`src/llm/MaiClaudeProvider.ts`** — Spawns `claude -p --output-format text` with prompt piped via stdin. **Must** `delete env.CLAUDECODE` to work when Extension Development Host is launched from inside a Claude Code session.
- **`src/utils/cli.ts`** — Shared `runCLI()` utility for spawning CLI processes with stdin piping, manual timeout, and env overrides. Used by both LLM providers.
- **`src/llm/PromptBuilder.ts`** — Builds prompts with source code + references. Language-aware code fences.
- **`src/llm/ResponseParser.ts`** — Extracts `### Section` headings from LLM markdown into structured fields.
- **`src/models/types.ts`** — Single source of truth for all interfaces: `SymbolInfo`, `AnalysisResult`, `TabState`, message types, cache types.
- **`src/models/errors.ts`** — `CodeExplorerError` hierarchy with `ErrorCode` enum. Subclasses: `LLMError`, `CacheError`, `AnalysisError`, `SystemError`.
- **`src/utils/logger.ts`** — Dual-output singleton: VS Code OutputChannel + daily log files at `<workspace>/.vscode/code-explorer/logs/YYYY-MM-DD.log`. Must call `logger.init(workspaceRoot)` during activation.
- **`webview/src/main.ts`** — Vanilla TS (no React). Renders tab bar, analysis sections (collapsible `<details>`), empty/loading/error states. All CSS uses VS Code theme variables.

## Conventions

- Private members prefixed with `_` (enforced by ESLint `@typescript-eslint/naming-convention`).
- Unused parameters prefixed with `_` (e.g., `_context`, `_token`).
- All extension settings live under the `codeExplorer.` namespace. Keys are in `src/models/constants.ts`.
- Commands: `codeExplorer.exploreSymbol`, `codeExplorer.refreshAnalysis`, `codeExplorer.clearCache`, `codeExplorer.analyzeWorkspace`.
- The webview's `package.json` view type is `"webview"` (not `"tree"`), requiring a `WebviewViewProvider` registration.

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

## Not Yet Implemented

Referring to `docs/05-implementation_plan.md`, the following are scaffolded in the directory structure but **not yet implemented**:

- **Cache layer** (`src/cache/`): CacheManager, IndexManager, HashService, MarkdownSerializer, CacheKeyResolver — files not yet created
- **AnalysisQueue** with priority + rate limiting
- **BackgroundScheduler** for periodic re-analysis
- **CodeExplorerHoverProvider** and **CodeExplorerCodeLensProvider**
- **MCP server** (`src/mcp/`)
- File watcher → cache invalidation pipeline

## LLM Provider Gotchas

All providers use the shared `runCLI()` utility (`src/utils/cli.ts`) which handles spawn, stdin piping, and manual timeout.

- **copilot-cli** (default): Runs `copilot --yolo -s --output-format text` with prompt piped via stdin (omits `-p` flag — copilot reads stdin when `-p` is absent). Does **not** support `--append-system-prompt`; system instructions are prepended into the prompt text. No special env handling needed.
- **mai-claude**: Runs `claude -p --output-format text`. **Must** `delete env.CLAUDECODE` — otherwise `claude` refuses to start inside a Claude Code session. Supports `--append-system-prompt`.
- **Both**: Prompt is sent via **stdin** (not as CLI argument) — prompts can be many KB; stdin avoids OS argument length limits.
- **Timeout**: `spawn()` doesn't support a `timeout` option; `runCLI()` uses `setTimeout` + `child.kill('SIGTERM')` with a `settled` guard.
