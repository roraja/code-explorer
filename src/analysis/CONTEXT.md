# src/analysis/

Analysis pipeline — coordinates static analysis and LLM analysis into a single result.

## Modules

| File | Contains |
|------|----------|
| `AnalysisOrchestrator.ts` | `AnalysisOrchestrator` — main pipeline coordinator |
| `StaticAnalyzer.ts` | `StaticAnalyzer` — uses VS Code language services for references, call hierarchy, type hierarchy, and source reading |

## AnalysisOrchestrator Pipeline

`analyzeSymbol(symbol, force?, onProgress?)` runs this sequence:

1. **Cache check** — `CacheStore.read()`. Returns immediately on non-stale hit with LLM data. Skipped if `force=true`.
2. **Read source** — `StaticAnalyzer.readSymbolSource()`. For variables/properties, also reads containing scope source.
3. **LLM analysis** — Checks provider availability, builds prompt via `PromptBuilder.build()`, calls `LLMProvider.analyze()`, parses response via `ResponseParser.parse()`.
4. **Build result** — Merges LLM fields into `AnalysisResult` with metadata.
5. **Write cache** — `CacheStore.write()`. Also pre-caches any `relatedSymbols` discovered by the LLM (won't overwrite existing richer analyses).

The orchestrator fires `onAnalysisComplete` event after each analysis. It reports progress via the `onProgress` callback (cache-check, reading-source, llm-analyzing, writing-cache).

**Graceful degradation**: If the LLM provider is unavailable or fails, the orchestrator returns a result with empty LLM fields (overview shows a placeholder). It never blocks or throws to the user.

## StaticAnalyzer Methods

| Method | VS Code Command | Returns |
|--------|----------------|---------|
| `findReferences()` | `vscode.executeReferenceProvider` | `UsageEntry[]` |
| `buildCallHierarchy()` | `vscode.prepareCallHierarchy` + `vscode.provideIncomingCalls` | `CallStackEntry[]` |
| `getTypeHierarchy()` | `vscode.prepareTypeHierarchy` + `vscode.provideSupertypes`/`Subtypes` | `RelationshipEntry[]` |
| `readSymbolSource()` | `vscode.workspace.openTextDocument` | `string` (source code) |
| `readContainingScopeSource()` | `vscode.executeDocumentSymbolProvider` | `string` (enclosing scope) |

**Note**: `findReferences()`, `buildCallHierarchy()`, and `getTypeHierarchy()` are defined but currently NOT called by the orchestrator — the orchestrator relies on LLM-generated callers/usages instead of static analysis for these. The static methods are available for future use (e.g., merging static + LLM results).

## Key Design Decisions

- **`withTimeout()` helper**: Races any promise against a timeout, returning a fallback value. Used for source reading operations.
- **Pre-caching**: The LLM can return `relatedSymbols` — brief analyses of symbols it discovers during analysis. These are cached but never overwrite existing richer analyses.
- **No static analysis merge (current)**: The current pipeline runs LLM-only analysis (not parallel static + LLM). Static methods are ready but not wired into the pipeline yet.
