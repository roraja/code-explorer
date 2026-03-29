# src/analysis/

Analysis pipeline — coordinates cache lookup, LLM-based symbol resolution, analysis, and Q&A enhancement into a single result.

## Modules

| File | Contains |
|------|----------|
| `AnalysisOrchestrator.ts` | `AnalysisOrchestrator` — main pipeline coordinator, supports cursor-based, legacy symbol-based, file-level, and enhance flows |
| `StaticAnalyzer.ts` | `StaticAnalyzer` — uses VS Code language services for references, call hierarchy, type hierarchy, and source reading |

## AnalysisOrchestrator — Four Flows

### Primary: `analyzeFromCursor(cursor, onProgress?)`

Used when the user triggers Ctrl+Shift+E. Takes a `CursorContext` (word, file, ±50 lines) and performs symbol resolution + analysis in a single LLM call:

1. **Cache scan** — `CacheStore.findByCursorWithLLMFallback()`. Two-tier: exact name+line match, then lightweight LLM fallback.
2. **Build unified prompt** — `PromptBuilder.buildUnified()`. Single prompt that asks the LLM to identify the symbol kind, perform full analysis, and generate diagrams.
3. **LLM call** — `LLMProvider.analyze()`. Copilot CLI runs with `cwd` set to workspace root for full workspace context.
   - 3a. **Parse identity** — `ResponseParser.parseSymbolIdentity()`. Extracts `json:symbol_identity` block.
   - 3b. **Parse analysis** — `ResponseParser.parse()`. Extracts all analysis JSON blocks including `json:diagrams`.
4. **Build SymbolInfo** — Constructs resolved `SymbolInfo` from the LLM-identified identity.
5. **Build result** — Merges LLM fields into `AnalysisResult` with metadata.
6. **Write cache** — `CacheStore.write()`. Also pre-caches related symbols.

Returns `{ symbol: SymbolInfo, result: AnalysisResult }`.

### File-Level: `analyzeFile(filePath, fileSource, onProgress?)`

Analyzes an entire file in a single LLM call, identifying and caching all crucial symbols:

1. **Check LLM availability**
2. **Build file analysis prompt** — `PromptBuilder.buildFileAnalysis()`.
3. **LLM call** — Sends full file source with larger token budget (16384).
4. **Parse response** — `ResponseParser.parseFileSymbolAnalyses()`. Extracts `json:file_symbol_analyses` block.
5. **Write cache** — Each parsed symbol is written as an individual cache file (skips existing non-stale entries).

Returns number of symbols cached.

### Enhance: `enhanceAnalysis(existingResult, userPrompt)`

Enhances an existing analysis with a user-provided question or request:

1. **Check LLM availability** — on failure, adds error Q&A entry and returns.
2. **Read source code** — `StaticAnalyzer.readSymbolSource()` for additional context.
3. **Build enhance prompt** — `PromptBuilder.buildEnhance()`. Includes existing analysis summary, prior Q&A history, and source code.
4. **LLM call** — `LLMProvider.analyze()`.
5. **Parse response** — `ResponseParser.parseEnhanceResponse()`. Extracts answer, optional updated overview, additional key points, and additional issues.
6. **Merge** — Appends `QAEntry` to `qaHistory`, optionally updates overview, appends new key points/issues.
7. **Write cache** — Persists updated result with Q&A history.

Returns updated `AnalysisResult`.

### Legacy: `analyzeSymbol(symbol, force?, onProgress?)`

Used for programmatic calls with a pre-resolved `SymbolInfo`:

1. **Cache check** — `CacheStore.read()` (exact-path lookup). Returns on non-stale hit.
2. **Read source** — `StaticAnalyzer.readSymbolSource()`. For variables/properties, also reads containing scope source.
3. **LLM analysis** — Builds kind-specific prompt via `PromptBuilder.build()`, calls LLM, parses response.
4. **Build result** — Merges into `AnalysisResult`.
5. **Write cache** — `CacheStore.write()` + pre-cache related symbols.

### Graceful Degradation

If the LLM provider is unavailable or fails, the orchestrator returns a result with empty LLM fields (overview shows a placeholder). It never blocks or throws to the user. For the enhance flow, an error Q&A entry is added to the history.

## StaticAnalyzer Methods

| Method | VS Code Command | Returns |
|--------|----------------|---------|
| `findReferences()` | `vscode.executeReferenceProvider` | `UsageEntry[]` |
| `buildCallHierarchy()` | `vscode.prepareCallHierarchy` + `vscode.provideIncomingCalls` | `CallStackEntry[]` |
| `getTypeHierarchy()` | `vscode.prepareTypeHierarchy` + `vscode.provideSupertypes`/`Subtypes` | `RelationshipEntry[]` |
| `readSymbolSource()` | `vscode.workspace.openTextDocument` | `string` (source code) |
| `readContainingScopeSource()` | `vscode.executeDocumentSymbolProvider` | `string` (enclosing scope) |

**Note**: `findReferences()`, `buildCallHierarchy()`, and `getTypeHierarchy()` are defined but currently NOT called by the orchestrator. `readSymbolSource()` is used by both the legacy `analyzeSymbol` flow and the `enhanceAnalysis` flow. `readContainingScopeSource()` is only used by the legacy flow.

## Key Design Decisions

- **`withTimeout()` helper**: Races any promise against a timeout, returning a fallback value. Used for source reading operations.
- **Pre-caching**: The LLM can return `relatedSymbols` (brief analyses) and `related_symbol_analyses` (with cache file paths). These are cached but never overwrite existing richer analyses.
- **Cursor cache scan before LLM**: `findByCursorWithLLMFallback` checks the cache by scanning frontmatter before sending any LLM request, saving expensive round-trips.
- **Q&A accumulation**: Each enhance call appends to `qaHistory` — prior Q&A is sent to the LLM for conversation continuity.
