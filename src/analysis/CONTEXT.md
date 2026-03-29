# src/analysis/

Analysis pipeline — coordinates cache lookup, LLM-based symbol resolution, and analysis into a single result.

## Modules

| File | Contains |
|------|----------|
| `AnalysisOrchestrator.ts` | `AnalysisOrchestrator` — main pipeline coordinator, supports both cursor-based and legacy symbol-based flows |
| `StaticAnalyzer.ts` | `StaticAnalyzer` — uses VS Code language services for references, call hierarchy, type hierarchy, and source reading |

## AnalysisOrchestrator — Two Flows

### Primary: `analyzeFromCursor(cursor, onProgress?)`

Used when the user triggers Ctrl+Shift+E. Takes a `CursorContext` (word, file, ±50 lines) and performs symbol resolution + analysis in a single LLM call:

1. **Cache scan** — `CacheStore.findByCursor()`. Scans the cache directory for the source file, matches by symbol name + line within ±3. Returns immediately on non-stale hit.
2. **Build unified prompt** — `PromptBuilder.buildUnified()`. Single prompt that asks the LLM to identify the symbol kind AND perform full analysis.
3. **LLM call** — `LLMProvider.analyze()`. Copilot CLI runs with `cwd` set to workspace root for full workspace context.
   - 3a. **Parse identity** — `ResponseParser.parseSymbolIdentity()`. Extracts `json:symbol_identity` block (name, kind, container, scope_chain).
   - 3b. **Parse analysis** — `ResponseParser.parse()`. Extracts all analysis JSON blocks from the same response.
4. **Build SymbolInfo** — Constructs resolved `SymbolInfo` from the LLM-identified identity.
5. **Build result** — Merges LLM fields into `AnalysisResult` with metadata.
6. **Write cache** — `CacheStore.write()`. Also pre-caches related symbols from `json:related_symbols` and `json:related_symbol_analyses`.

Returns `{ symbol: SymbolInfo, result: AnalysisResult }`.

### File-Level: `analyzeFile(filePath, fileSource, onProgress?)`

Analyzes an entire file in a single LLM call, identifying and caching all crucial symbols:

1. **Check LLM availability**
2. **Build file analysis prompt** — `PromptBuilder.buildFileAnalysis()`. Instructs LLM to identify every class, function, method, interface, enum, type alias, and exported variable.
3. **LLM call** — Sends full file source with larger token budget (16384).
4. **Parse response** — `ResponseParser.parseFileSymbolAnalyses()`. Extracts `json:file_symbol_analyses` block.
5. **Write cache** — Each parsed symbol is written as an individual cache file (skips existing non-stale entries).

Returns number of symbols cached.

### Legacy: `analyzeSymbol(symbol, force?, onProgress?)`

Used for programmatic calls with a pre-resolved `SymbolInfo`:

1. **Cache check** — `CacheStore.read()` (exact-path lookup). Returns on non-stale hit.
2. **Read source** — `StaticAnalyzer.readSymbolSource()`. For variables/properties, also reads containing scope source.
3. **LLM analysis** — Builds kind-specific prompt via `PromptBuilder.build()`, calls LLM, parses response.
4. **Build result** — Merges into `AnalysisResult`.
5. **Write cache** — `CacheStore.write()` + pre-cache related symbols.

### Graceful Degradation

If the LLM provider is unavailable or fails, the orchestrator returns a result with empty LLM fields (overview shows a placeholder). It never blocks or throws to the user.

## StaticAnalyzer Methods

| Method | VS Code Command | Returns |
|--------|----------------|---------|
| `findReferences()` | `vscode.executeReferenceProvider` | `UsageEntry[]` |
| `buildCallHierarchy()` | `vscode.prepareCallHierarchy` + `vscode.provideIncomingCalls` | `CallStackEntry[]` |
| `getTypeHierarchy()` | `vscode.prepareTypeHierarchy` + `vscode.provideSupertypes`/`Subtypes` | `RelationshipEntry[]` |
| `readSymbolSource()` | `vscode.workspace.openTextDocument` | `string` (source code) |
| `readContainingScopeSource()` | `vscode.executeDocumentSymbolProvider` | `string` (enclosing scope) |

**Note**: `findReferences()`, `buildCallHierarchy()`, and `getTypeHierarchy()` are defined but currently NOT called by the orchestrator. `readSymbolSource()` and `readContainingScopeSource()` are only used by the legacy `analyzeSymbol` flow.

## Key Design Decisions

- **`withTimeout()` helper**: Races any promise against a timeout, returning a fallback value. Used for source reading operations.
- **Pre-caching**: The LLM can return `relatedSymbols` (brief analyses) and `related_symbol_analyses` (with cache file paths). These are cached but never overwrite existing richer analyses.
- **Cursor cache scan before LLM**: `findByCursor` checks the cache by scanning frontmatter before sending any LLM request, saving expensive round-trips.
