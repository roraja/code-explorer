# Code Explorer — Project Guidelines

VS Code extension providing AI-powered code intelligence in a sidebar panel. For full architecture details, see [CLAUDE.md](../CLAUDE.md). For design docs, see `docs/`.

## Codebase Navigation

**Start with the floorplan**: `.context/FLOORPLAN.md` provides a routing table of all modules, their responsibilities, and which `CONTEXT.md` files to read based on the task. Each key folder has a co-located `CONTEXT.md` with detailed module documentation.

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

**Data flow**: `SymbolResolver` -> `CodeExplorerViewProvider` -> `AnalysisOrchestrator` -> cache check -> `PromptBuilder` (strategy pattern) -> `LLMProvider` (CLI via `runCLI()`) -> `ResponseParser` (JSON blocks) -> `CacheStore` (markdown write) -> webview. LLM failures degrade gracefully — never block or throw.

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
- **copilot-cli provider**: Does not support `--append-system-prompt`; system instructions go in the prompt text. Uses `--yolo -s` flags.
- **Webview imports**: Cannot import from `src/` — webview redefines its own interfaces locally.
- **Cache path**: `.vscode/code-explorer/` in workspace root. Log files at `.vscode/code-explorer/logs/YYYY-MM-DD.log`. LLM call logs at `.vscode/code-explorer/logs/llms/`.
- **Static analysis methods**: `StaticAnalyzer.findReferences()`, `buildCallHierarchy()`, `getTypeHierarchy()` exist but are **not currently called** by the orchestrator — only LLM-generated data is used.
- **CacheWriter vs CacheStore**: `CacheWriter.ts` is an earlier/alternative writer. The main pipeline uses `CacheStore.ts` for both read and write.

## Not Yet Implemented

See `docs/05-implementation_plan.md` for full roadmap. Key gaps: CacheManager/IndexManager, AnalysisQueue, BackgroundScheduler, HoverProvider, CodeLensProvider, MCP server (`src/mcp/`), file watcher invalidation, static analysis merge, Analyze Workspace command.

## Execution Logging (Mandatory)

**During EVERY prompt execution — no matter how big or small — you MUST create a detailed execution log in `docs/copilot-executions/` in REAL-TIME.**

This is mandatory and must never be skipped. The log documents exactly what happened during the prompt so work is traceable, reproducible, and reviewable.

### File naming
- Files are sequenced: `01-short-title.md`, `02-another-title.md`, etc.
- Check the last sequence number in `docs/copilot-executions/` and increment by 1. If no files exist, start with `01-`.
- The title should be a short, descriptive kebab-case summary of what the prompt asked for.

### Required sections
Every execution log must include **all** of the following sections with detailed content:

```markdown
# <NN> - <Prompt Title>

**Date**: YYYY-MM-DD HH:MM UTC
**Prompt**: <The user's original prompt, quoted verbatim or closely paraphrased>

## 1. Code Reading & Analysis
- List every file read/explored during this prompt, with why it was read
- Note relevant line numbers, functions, classes inspected
- Include any grep/search queries run and what they found

## 2. Issues Identified
- Describe each issue found, with exact file path and line number(s)
- Explain why it's a problem (root cause analysis)
- Include relevant code snippets if helpful

## 3. Plan
- What approach/strategy was decided on to address the prompt
- Any alternatives considered and why they were rejected
- Dependencies or ordering constraints

## 4. Changes Made
- For each file changed:
  - File path
  - What was changed (before → after summary)
  - Why the change was made
- For new files created: file path and purpose
- Write down the exact code diff for all changes made, with line numbers and context
- If no code changes were made, explain why (e.g., "the issue was a misunderstanding")

## 5. Commands Run
- Every command executed (build, test, lint, etc.)
- The result/output of each command (pass/fail, key output lines)
- Any retries or troubleshooting steps

## 6. Result
- Final outcome: what was achieved
- Any remaining issues or follow-up needed
- Verification steps taken (tests, manual checks, etc.)

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| path/to/file | Modified/Created/Deleted | Brief description |
```

### Rules
- **Never skip this step**, even for single-line changes, doc-only changes, or exploratory prompts
- Write the log at the very end, after all work is complete
- Be detailed and specific — vague entries like "read some files" or "fixed the bug" are not acceptable
- Include actual file paths, line numbers, command outputs, and error messages
- If a prompt was purely exploratory (no code changes), still document what was read and what was learned
