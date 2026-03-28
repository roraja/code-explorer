# src/

Root of the extension host source code. All modules here run in Node.js with access to the VS Code API.

## Entry Point

**`extension.ts`** is the sole entry point. It:
1. Validates workspace is open
2. Initializes the logger with workspace root
3. Reads `codeExplorer.llmProvider` config setting
4. Creates all services via constructor injection (no singletons/globals):
   - `LLMProviderFactory.create()` -> `LLMProvider`
   - `new SymbolResolver()`
   - `new StaticAnalyzer()`
   - `new CacheStore(workspaceRoot)`
   - `new AnalysisOrchestrator(staticAnalyzer, llmProvider, cacheStore)`
   - `new CodeExplorerViewProvider(extensionUri, orchestrator)`
5. Registers the webview view provider for `codeExplorer.sidebar`
6. Registers four commands:
   - `codeExplorer.exploreSymbol` — resolves symbol at cursor, opens tab, triggers analysis
   - `codeExplorer.refreshAnalysis` — placeholder (shows info message)
   - `codeExplorer.clearCache` — deletes all cache files after confirmation
   - `codeExplorer.analyzeWorkspace` — stub (shows "future release" message)

## Dependency Graph

```
extension.ts
  +-- models/constants.ts
  +-- ui/CodeExplorerViewProvider.ts
  +-- providers/SymbolResolver.ts
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
| `providers/` | Symbol resolution | `SymbolResolver.ts` |
| `analysis/` | Orchestration + static analysis | `AnalysisOrchestrator.ts`, `StaticAnalyzer.ts` |
| `llm/` | LLM providers, prompts, parsing | `CopilotCLIProvider.ts`, `MaiClaudeProvider.ts`, `PromptBuilder.ts`, `ResponseParser.ts` |
| `llm/prompts/` | Per-symbol-kind prompt strategies | `FunctionPromptStrategy.ts`, `ClassPromptStrategy.ts`, `VariablePromptStrategy.ts`, `PropertyPromptStrategy.ts` |
| `cache/` | Markdown cache read/write | `CacheStore.ts`, `CacheWriter.ts` |
| `ui/` | Webview provider | `CodeExplorerViewProvider.ts` |
| `utils/` | Logger, CLI runner | `logger.ts`, `cli.ts` |
