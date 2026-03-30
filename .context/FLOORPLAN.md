# Code Explorer Workspace Floorplan

**Code Explorer** is a VS Code extension that provides AI-powered code intelligence in a sidebar panel. Users place their cursor on a symbol, run "Explore Symbol" (Ctrl+Shift+E), and the sidebar shows LLM-generated analysis (overview, step-by-step breakdown, sub-functions, callers, data flow, class members, data kind, mermaid diagrams) with results cached as markdown files. Users can ask follow-up questions via the ✨ Enhance button, and symbol names in analysis text are auto-linked for click-to-explore navigation.

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
| Symbol resolution at cursor (legacy, not primary)  | `src/providers/CONTEXT.md`                  | `src/providers/SymbolResolver.ts`                     |
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
| Global skill installation (Claude + Copilot)       | `src/skills/CONTEXT.md`                     | `src/skills/SkillInstaller.ts`                        |
| ADO content sync (pull/push)                       | `src/git/CONTEXT.md`                        | `src/git/AdoSync.ts`                                  |

## Key Features (Current State)

| Feature                        | Status | Module(s)                                         |
|--------------------------------|--------|---------------------------------------------------|
| Explore Symbol command         | Implemented | `extension.ts`, `CodeExplorerViewProvider.ts` |
| Explore All Symbols in File command | Implemented | `extension.ts`, `AnalysisOrchestrator.ts` (`analyzeFile`) |
| LLM-based symbol resolution (unified prompt) | Implemented | `PromptBuilder.ts`, `ResponseParser.ts`, `AnalysisOrchestrator.ts` |
| Cursor-based cache lookup (fuzzy match) | Implemented | `CacheStore.ts` (`findByCursor`) |
| LLM-assisted cache fallback (smart match) | Implemented | `CacheStore.ts` (`findByCursorWithLLMFallback`, `listCachedSymbols`) |
| Sidebar webview with tabs      | Implemented | `CodeExplorerViewProvider.ts`, `webview/`      |
| LLM analysis (copilot-cli)     | Implemented | `CopilotCLIProvider.ts`, `cli.ts`             |
| LLM analysis (mai-claude)      | Implemented | `MaiClaudeProvider.ts`, `cli.ts`              |
| Null/disabled LLM provider     | Implemented | `NullProvider.ts`                             |
| Prompt strategies (function, class, variable, property) | Implemented | `src/llm/prompts/`  |
| Unified prompt (symbol resolution + analysis in one LLM call) | Implemented | `PromptBuilder.ts` (`buildUnified`) |
| Response parsing (JSON blocks) | Implemented | `ResponseParser.ts`                           |
| Symbol identity parsing (`json:symbol_identity`) | Implemented | `ResponseParser.ts` (`parseSymbolIdentity`) |
| Related symbol pre-caching with cache paths | Implemented | `ResponseParser.ts`, `AnalysisOrchestrator.ts` |
| Data kind analysis (`json:data_kind`) | Implemented | `ResponseParser.ts`, `CacheStore.ts` |
| Full-file analysis (`buildFileAnalysisFromSymbolList`) | Implemented | `PromptBuilder.ts`, `StaticAnalyzer.ts` (`listFileSymbols`), `AnalysisOrchestrator.ts` (`analyzeFile`) |
| File symbol batch parsing (`json:file_symbol_analyses`) | Implemented | `ResponseParser.ts` (`parseFileSymbolAnalyses`) |
| Mermaid diagram generation (`json:diagrams`) | Implemented | `PromptBuilder.ts`, `ResponseParser.ts`, `CacheStore.ts`, `webview/main.ts` |
| Mermaid diagram rendering (SVG in webview) | Implemented | `webview/main.ts` (mermaid library), `webview/styles/main.css` |
| Interactive Q&A enhancement (✨ Enhance button) | Implemented | `AnalysisOrchestrator.ts` (`enhanceAnalysis`), `PromptBuilder.ts` (`buildEnhance`), `ResponseParser.ts` (`parseEnhanceResponse`), `CodeExplorerViewProvider.ts`, `webview/main.ts` |
| Q&A history persistence in cache | Implemented | `CacheStore.ts` (`json:qa_history`), `types.ts` (`QAEntry`) |
| Auto-linking symbols in analysis text | Implemented | `webview/main.ts` (`_buildKnownSymbols`, `_autoLinkSymbols`, `_escAndLink`) |
| Mermaid + code blocks in Q&A answers | Implemented | `webview/main.ts` (`_renderMarkdownWithMermaid`) |
| Clickable file:line references | Implemented | `webview/main.ts` (`.file-link` elements) |
| Static analysis (references, call hierarchy, type hierarchy) | Implemented | `StaticAnalyzer.ts` |
| Markdown cache (read/write)    | Implemented | `CacheStore.ts`                               |
| Dual logging (OutputChannel + file) | Implemented | `logger.ts`                              |
| LLM call logging (per-call markdown files) | Implemented | `logger.ts`                       |
| Clear Cache command            | Implemented | `extension.ts`, `CacheStore.ts`               |
| Symbol linking (click-to-explore from webview) | Implemented | `CodeExplorerViewProvider.ts`, `webview/main.ts` |
| Navigate-to-source from webview | Implemented | `CodeExplorerViewProvider.ts`                |
| Scope-chain-based tab deduplication | Implemented | `CodeExplorerViewProvider.ts`            |
| Workspace-context CLI execution (cwd) | Implemented | `cli.ts`, `CopilotCLIProvider.ts`, `MaiClaudeProvider.ts` |
| Install Global Skills command  | Implemented | `extension.ts`, `SkillInstaller.ts`            |
| ADO content sync (pull/push)   | Implemented | `extension.ts`, `AdoSync.ts`                   |
| Legacy SymbolResolver (VS Code API) | Preserved (not primary) | `SymbolResolver.ts` (not imported by `extension.ts`) |
| **CacheManager/IndexManager**  | Not implemented | Planned in `src/cache/`                   |
| **AnalysisQueue with priority** | Not implemented | Planned in `src/analysis/`               |
| **BackgroundScheduler**        | Not implemented | Planned                                   |
| **HoverProvider**              | Not implemented | Planned                                   |
| **CodeLensProvider**           | Not implemented | Planned                                   |
| **MCP server**                 | Not implemented | Planned in `src/mcp/`                     |
| **File watcher invalidation**  | Not implemented | Planned                                   |
| **Analyze Workspace command**  | Stub only | `extension.ts` (shows "future release" message)  |

## Data Flow

The primary flow (cursor-based, no VS Code symbol resolution):

```
User clicks symbol -> Ctrl+Shift+E
  -> extension.ts command handler
    -> Gathers CursorContext (word, ±50 lines, cursor line) [FAST]
      -> CodeExplorerViewProvider.openTabFromCursor(cursor)
        -> posts 'setState' message to webview (shows loading spinner)
        -> AnalysisOrchestrator.analyzeFromCursor(cursor)
          -> CacheStore.findByCursorWithLLMFallback(cursor, workspaceRoot)
            -> Tier 1: findByCursor() (name + ±3 lines) [FAST]
            -> Tier 2: listCachedSymbols() + lightweight Copilot CLI match [~5-15s]
          -> PromptBuilder.buildUnified() (single prompt: identify + analyze + diagrams)
          -> LLMProvider.analyze() (spawns CLI via runCLI, stdin pipe, workspace cwd)
          -> ResponseParser.parseSymbolIdentity() (extracts kind from response)
          -> ResponseParser.parse() (extracts analysis + diagrams from same response)
          -> ResponseParser.parseRelatedSymbolCacheEntries() (related symbols)
          -> CacheStore.write() (persists result as markdown)
          -> Pre-cache related symbols (if any discovered)
        -> posts 'setState' to webview (renders analysis tabs + sections)
        -> webview renders mermaid diagrams asynchronously
        -> webview auto-links symbol names in analysis text
```

Enhance flow (Q&A on existing analysis):

```
User clicks ✨ Enhance button -> enters question in modal dialog
  -> webview posts 'enhanceAnalysis' message (tabId, userPrompt)
    -> CodeExplorerViewProvider._handleEnhanceAnalysis()
      -> AnalysisOrchestrator.enhanceAnalysis(existingResult, userPrompt)
        -> PromptBuilder.buildEnhance() (includes existing analysis + source + Q&A history)
        -> LLMProvider.analyze()
        -> ResponseParser.parseEnhanceResponse() (answer, updated overview, additional points/issues)
        -> Merges Q&A entry + enhancements into result
        -> CacheStore.write() (persists updated result with Q&A history)
      -> pushState with updated analysis
```

Legacy flow (programmatic calls with pre-resolved SymbolInfo):

```
Programmatic call with SymbolInfo
  -> CodeExplorerViewProvider.openTab(symbol)
    -> AnalysisOrchestrator.analyzeSymbol(symbol)
      -> CacheStore.read() (exact-path lookup)
      -> StaticAnalyzer.readSymbolSource()
      -> PromptBuilder.build() (kind-specific strategy)
      -> LLMProvider.analyze()
      -> ResponseParser.parse()
      -> CacheStore.write()
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
| LLM analysis returns empty | Check VS Code Output panel "Code Explorer" and LLM call logs at `.vscode/code-explorer-logs/llms/` |
| `claude` CLI refuses to start | Ensure `CLAUDECODE` env var is deleted before spawn (MaiClaudeProvider handles this) |
| Cache not found despite prior analysis | Check `findByCursor` logs — line tolerance is ±3; different scope = different cache file |
| Webview shows blank | Check CSP in `_getHtmlForWebview()`, verify `webview/dist/` has built files |
| "No symbol found at cursor" | Cursor not on a word; check `getWordRangeAtPosition` call in `extension.ts` |
| Tab duplicates for same symbol | Scope chain mismatch; check `openTab()` dedup logic |
| Symbol resolved as 'unknown' | LLM did not return `json:symbol_identity` block; check prompt and response in LLM call log |
| Mermaid diagram not rendering | Check CSP allows `'unsafe-inline'` for styles (mermaid injects inline CSS); check browser console for mermaid errors |
| Enhance Q&A not persisting | Check `CacheStore.write()` — Q&A history is serialized as `json:qa_history` block |
