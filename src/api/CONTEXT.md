# src/api/ — Public API Layer

This directory contains the VS-Code-free public API for Code Explorer. All files here have **zero** `import * as vscode` dependencies and can be used outside the extension host (CLI, tests, MCP server).

## Files

| File | Purpose |
|------|---------|
| `CodeExplorerAPI.ts` | Single-entry-point facade wrapping `AnalysisOrchestrator`, `CacheStore`, and `GraphBuilder`. Accepts `CodeExplorerAPIOptions` with workspace root, LLM provider name, and optional `ISourceReader`. |
| `ISourceReader.ts` | Interface abstracting VS-Code-coupled source reading. Defines `readSymbolSource`, `readContainingScopeSource`, `resolveSymbolAtPosition`, `listFileSymbols`. Also exports `FileSymbolDescriptor`. |
| `ILogger.ts` | Interface abstracting VS-Code-coupled logging. Defines `debug/info/warn/error` and LLM/command log methods. |
| `FileSystemSourceReader.ts` | `ISourceReader` implementation using Node.js `fs`. Reads files from disk, returns `null` for symbol resolution (no language server). |
| `ConsoleLogger.ts` | `ILogger` implementation writing to stderr. Used by the CLI tool. |
| `NullLogger.ts` | `ILogger` implementation that discards all output. Used in silent tests. |

## Architecture

```
CodeExplorerAPI
  ├── ISourceReader (FileSystemSourceReader or VscodeSourceReader)
  ├── LLMProvider (any provider from src/llm/)
  ├── CacheStore (disk cache, same format as VS Code extension)
  ├── AnalysisOrchestrator (core pipeline, no vscode imports)
  └── GraphBuilder (reads cache files, builds dependency graph)
```

## Key Design Decisions

- **`AnalysisOrchestrator` accepts `ISourceReader`** instead of `StaticAnalyzer` directly. This is the main abstraction seam — the orchestrator works identically whether it gets a VS Code language server or plain filesystem access.
- **`logger.ts` uses lazy `require('vscode')`** — at runtime, it checks if the `vscode` module is resolvable. Outside VS Code, it falls back to a no-op output channel. File logging still works everywhere.
- **`vscode.EventEmitter` replaced** in `AnalysisOrchestrator` with a simple callback list — eliminates the only remaining `import * as vscode` in the analysis pipeline.

## Usage Examples

### In tests (MockLLMProvider + FileSystemSourceReader)
```typescript
const api = new CodeExplorerAPI({
  workspaceRoot: tmpDir,
  llmProviderInstance: new MockLLMProvider(cannedResponse),
  sourceReader: new FileSystemSourceReader(tmpDir),
});
const { symbol, result } = await api.exploreSymbol(cursor);
```

### In CLI
```bash
npm run cli -- explore-symbol --workspace /path --file src/main.ts --line 10 --word processUser --llm none
```

### In extension.ts (VscodeSourceReader)
```typescript
const api = new CodeExplorerAPI({
  workspaceRoot,
  llmProvider: 'copilot-cli',
  sourceReader: new VscodeSourceReader(),
});
```
