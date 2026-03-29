# src/

Root of the extension host source code. All modules here run in Node.js with access to the VS Code API.

## Entry Point

**`extension.ts`** is the sole entry point. It:
1. Validates workspace is open
2. Initializes the logger with workspace root
3. Reads `codeExplorer.llmProvider` config setting
4. Creates all services via constructor injection (no singletons/globals):
   - `LLMProviderFactory.create()` -> `LLMProvider`
   - Calls `llmProvider.setWorkspaceRoot(workspaceRoot)` if available — sets CLI working directory for full workspace context
   - `new StaticAnalyzer()`
   - `new CacheStore(workspaceRoot)`
   - `new AnalysisOrchestrator(staticAnalyzer, llmProvider, cacheStore)`
   - `new CodeExplorerViewProvider(extensionUri, orchestrator)`
5. Registers the webview view provider for `codeExplorer.sidebar`
6. Registers four commands:
   - `codeExplorer.exploreSymbol` — gathers `CursorContext` from editor, opens tab via `openTabFromCursor()`. Falls back to `openTab()` for programmatic calls with pre-resolved `SymbolInfo`.
   - `codeExplorer.refreshAnalysis` — placeholder (shows info message)
   - `codeExplorer.clearCache` — deletes all cache files after confirmation
   - `codeExplorer.analyzeWorkspace` — stub (shows "future release" message)

**Note**: `SymbolResolver` is **no longer imported** by `extension.ts`. Symbol resolution is handled by the LLM via the unified prompt. The file `src/providers/SymbolResolver.ts` is preserved for potential future use.

## Dependency Graph

```
extension.ts
  +-- models/constants.ts
  +-- models/types.ts (CursorContext)
  +-- ui/CodeExplorerViewProvider.ts
  +-- analysis/StaticAnalyzer.ts
  +-- analysis/AnalysisOrchestrator.ts
  +-- cache/CacheStore.ts
  +-- llm/LLMProviderFactory.ts
  +-- utils/logger.ts
```

## Module Folders

| Folder | Role | Key files |
|--------|------|-----------|
| `models/` | Types, errors, constants | `types.ts`, `errors.ts`, `constants.ts` |
| `providers/` | Symbol resolution (legacy, not primary) | `SymbolResolver.ts` |
| `analysis/` | Orchestration + static analysis | `AnalysisOrchestrator.ts`, `StaticAnalyzer.ts` |
| `llm/` | LLM providers, prompts, parsing | `CopilotCLIProvider.ts`, `MaiClaudeProvider.ts`, `PromptBuilder.ts`, `ResponseParser.ts` |
| `llm/prompts/` | Per-symbol-kind prompt strategies | `FunctionPromptStrategy.ts`, `ClassPromptStrategy.ts`, `VariablePromptStrategy.ts`, `PropertyPromptStrategy.ts` |
| `cache/` | Markdown cache read/write | `CacheStore.ts`, `CacheWriter.ts` |
| `ui/` | Webview provider | `CodeExplorerViewProvider.ts` |
| `utils/` | Logger, CLI runner | `logger.ts`, `cli.ts` |
