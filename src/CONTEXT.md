# src/

Root of the extension host source code. All modules here run in Node.js with access to the VS Code API.

## Entry Point

**`extension.ts`** is the sole entry point. It:
1. Validates workspace is open
2. Initializes the logger with workspace root and extension version
3. Reads `codeExplorer.llmProvider` config setting
4. Creates the LLM provider via `LLMProviderFactory.create()` (supports `copilot-cli`, `mai-claude`, `build-service`, `mock-copilot`, `none`)
5. Creates the `CodeExplorerAPI` (VS-Code-free core engine) with `VscodeSourceReader` and the LLM provider
6. Creates the `CodeExplorerViewProvider` with `api.orchestrator`, `api.cacheStore`, and `workspaceRoot`
7. Registers the webview view provider for `codeExplorer.sidebar` (with `retainContextWhenHidden: true`)
8. Creates and registers the **HoverProvider** (`CodeExplorerHoverProvider`) for 9 languages
9. Creates and registers the **CodeLensProvider** (`CodeExplorerCodeLensProvider`) for 9 languages
10. Creates the **GraphBuilder** and injects it into the view provider via `setGraphBuilder()`
11. Registers twelve commands:
    - `codeExplorer.exploreSymbol` — gathers `CursorContext` from editor, opens tab via `openTabFromCursor()`. Falls back to `openTab()` for programmatic calls with pre-resolved `SymbolInfo`.
    - `codeExplorer.exploreFileSymbols` — analyzes all symbols in the current file via `api.exploreFile()`
    - `codeExplorer.refreshAnalysis` — placeholder (shows info message)
    - `codeExplorer.clearCache` — deletes all cache files after confirmation via `api.clearCache()`
    - `codeExplorer.analyzeWorkspace` — stub (shows "future release" message)
    - `codeExplorer.installGlobalSkills` — installs Claude + Copilot analysis skills via `SkillInstaller`
    - `codeExplorer.pullAdoContent` — pulls content from ADO via `pullAdoContent()`
    - `codeExplorer.pushAdoContent` — pushes content to ADO via `pushAdoContent()`
    - `codeExplorer.pullAdoUpstream` — pulls upstream content from ADO via `pullAdoUpstream()`
    - `codeExplorer.pushAdoUpstream` — pushes upstream content to ADO via `pushAdoUpstream()`
    - `codeExplorer.showDependencyGraph` — builds and displays dependency graph in webview
    - `codeExplorer.showSymbolInfo` — diagnostic command showing all VS Code intellisense info for cursor symbol

**Note**: `SymbolResolver` is **no longer imported** by `extension.ts`. Symbol resolution is handled by the LLM via the unified prompt. The file `src/providers/SymbolResolver.ts` is preserved for potential future use.

## Dependency Graph

```
extension.ts
  +-- models/constants.ts
  +-- models/types.ts (CursorContext)
  +-- api/CodeExplorerAPI.ts
  +-- providers/VscodeSourceReader.ts
  +-- providers/CodeExplorerHoverProvider.ts
  +-- providers/CodeExplorerCodeLensProvider.ts
  +-- providers/ShowSymbolInfoCommand.ts
  +-- ui/CodeExplorerViewProvider.ts
  +-- graph/GraphBuilder.ts
  +-- llm/LLMProviderFactory.ts
  +-- skills/SkillInstaller.ts
  +-- git/AdoSync.ts
  +-- utils/logger.ts
```

## Module Folders

| Folder | Role | Key files |
|--------|------|-----------|
| `models/` | Types, errors, constants | `types.ts`, `errors.ts`, `constants.ts` |
| `providers/` | Symbol resolution (legacy), hover cards, CodeLens, diagnostic command, VS Code source reader | `SymbolResolver.ts`, `CodeExplorerHoverProvider.ts`, `CodeExplorerCodeLensProvider.ts`, `ShowSymbolInfoCommand.ts`, `VscodeSourceReader.ts` |
| `analysis/` | Orchestration + static analysis | `AnalysisOrchestrator.ts`, `StaticAnalyzer.ts` |
| `llm/` | LLM providers, prompts, parsing | `CopilotCLIProvider.ts`, `MaiClaudeProvider.ts`, `BuildServiceProvider.ts`, `MockCopilotProvider.ts`, `NullProvider.ts`, `LLMProviderFactory.ts`, `PromptBuilder.ts`, `ResponseParser.ts` |
| `llm/prompts/` | Per-symbol-kind prompt strategies | `FunctionPromptStrategy.ts`, `ClassPromptStrategy.ts`, `VariablePromptStrategy.ts`, `PropertyPromptStrategy.ts` |
| `cache/` | Markdown cache read/write | `CacheStore.ts`, `CacheWriter.ts` |
| `ui/` | Webview provider + tab session persistence | `CodeExplorerViewProvider.ts`, `TabSessionStore.ts` |
| `utils/` | Logger, CLI runner, symbol helpers | `logger.ts`, `cli.ts`, `symbolHelpers.ts` |
| `api/` | Public API (VS-Code-free) | `CodeExplorerAPI.ts`, `ISourceReader.ts`, `ILogger.ts`, `FileSystemSourceReader.ts`, `ConsoleLogger.ts`, `NullLogger.ts` |
| `cli/` | Standalone CLI tool | `code-explorer-cli.ts` |
| `graph/` | Dependency graph builder | `GraphBuilder.ts` |
| `indexing/` | Tree-sitter symbol indexing | `SymbolAddress.ts`, `SymbolIndex.ts`, `TreeSitterParser.ts`, `extractors/` |
| `skills/` | Global skill installer (Claude + Copilot) | `SkillInstaller.ts` |
| `git/` | ADO content sync (content + upstream branches) | `AdoSync.ts` |
