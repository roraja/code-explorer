# Code Explorer — Project Guidelines

VS Code extension providing AI-powered code intelligence in a sidebar panel. For full architecture details, see [CLAUDE.md](../CLAUDE.md). For design docs, see `docs/`.

## Build & Test

```bash
npm run build              # Extension (dist/extension.js) + webview (webview/dist/)
npm run watch              # Watch mode for both
npm run test:unit          # Mocha unit tests (no VS Code runtime needed)
npm run lint:fix           # ESLint with auto-fix
npm run package            # Build + produce .vsix
```

Single test file: `TS_NODE_PROJECT=tsconfig.test.json npx mocha test/unit/models/errors.test.ts`

**F5 debug** launches Extension Development Host with `sample-workspace/` as the opened workspace.

## Architecture

**Two separate TypeScript bundles** — extension host and webview cannot share code at runtime:

| | Extension Host | Webview |
|---|---|---|
| Entry | `src/extension.ts` | `webview/src/main.ts` |
| Platform | Node.js (`vscode` API, `fs`) | Browser (DOM, `acquireVsCodeApi()`) |
| Module | commonjs | ES2022 |

Communication is via `postMessage`. Message types defined in `src/models/types.ts`.

**Data flow**: `SymbolResolver` → `CodeExplorerViewProvider` → `AnalysisOrchestrator` → parallel `StaticAnalyzer` + `LLMProvider` → merge → webview. LLM failures degrade gracefully to static-only results.

**Dependency injection**: All services wired in `src/extension.ts` via constructor injection. No singletons or global state.

## Conventions

- **Private members**: `_` prefix required (ESLint-enforced `@typescript-eslint/naming-convention`)
- **Unused parameters**: `_` prefix (e.g., `_context`, `_token`)
- **Tests**: Mocha TDD UI — use `suite`/`test`, **not** `describe`/`it`. Assert with Node.js `assert` module.
- **Settings namespace**: `codeExplorer.*` — keys defined in `src/models/constants.ts`
- **Commands**: `codeExplorer.exploreSymbol`, `codeExplorer.refreshAnalysis`, `codeExplorer.clearCache`, `codeExplorer.analyzeWorkspace`
- **Errors**: Use `CodeExplorerError` hierarchy from `src/models/errors.ts` — never throw raw `Error`
- **Logging**: Use `logger` from `src/utils/logger.ts` — never `console.log` directly
- **Webview CSS**: Use VS Code theme variables (`var(--vscode-foreground)` etc.), no hardcoded colors
- **LLM prompts**: Send via **stdin** (not CLI arguments) — prompts can be many KB

## Gotchas

- **mai-claude provider**: Must `delete env.CLAUDECODE` before spawning `claude` CLI, otherwise it refuses to start inside a Claude Code session.
- **copilot-cli provider**: Does not support `--append-system-prompt`; system instructions go in the prompt text.
- **Webview imports**: Cannot import from `src/` — webview redefines its own interfaces locally.
- **Cache path**: `.vscode/code-explorer/` in workspace root. Log files at `.vscode/code-explorer/logs/YYYY-MM-DD.log`.

## Not Yet Implemented

See `docs/05-implementation_plan.md` for full roadmap. Key gaps: CacheManager/IndexManager, AnalysisQueue, BackgroundScheduler, HoverProvider, CodeLensProvider, MCP server (`src/mcp/`), file watcher invalidation.
