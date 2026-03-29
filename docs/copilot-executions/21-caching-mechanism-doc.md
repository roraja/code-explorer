# 21 - Caching Mechanism Deep Dive Documentation

**Date**: 2026-03-29 UTC
**Prompt**: "Investigate the current caching mechanism, write a doc on it in docs/next. Tell how the cache key is determined in all cases like link click, trigger from command, etc"

## 1. Code Reading & Analysis

Files read and explored:

| File | Why |
|------|-----|
| `.context/FLOORPLAN.md` | Entry point — understand overall architecture and data flow |
| `src/cache/CacheStore.ts` (full, 1383 lines) | Primary cache implementation — `read()`, `write()`, `findByCursor()`, `findByCursorWithLLMFallback()`, `listCachedSymbols()`, `readAllForFile()`, `_buildCacheKey()`, `_resolvePath()`, `_serialize()`, `_deserialize()` |
| `src/cache/CacheWriter.ts` (196 lines) | Legacy cache writer — confirmed superseded by CacheStore |
| `src/cache/CONTEXT.md` | Module documentation — confirmed current state |
| `src/models/types.ts` (765 lines) | `SymbolInfo`, `CursorContext`, `AnalysisResult`, `AnalysisMetadata`, `SYMBOL_KIND_PREFIX`, message types |
| `src/models/constants.ts` (99 lines) | `CACHE` constants, `CACHE_FALLBACK_LLM_TIMEOUT_MS`, `ANALYSIS_VERSION` |
| `src/analysis/AnalysisOrchestrator.ts` (1035 lines) | `analyzeSymbol()`, `analyzeFromCursor()`, `analyzeFile()`, `enhanceAnalysis()`, `_cacheRelatedSymbols()`, `_cacheRelatedSymbolAnalyses()` — all cache read/write paths |
| `src/ui/CodeExplorerViewProvider.ts` (1164 lines) | `openTab()`, `openTabFromCursor()`, `_exploreSymbolByName()`, `_handleMessage()` (all trigger paths), session restore |
| `src/extension.ts` (517 lines) | Command handler for `exploreSymbol` — cursor context gathering, programmatic SymbolInfo detection, all registered commands |
| `src/providers/CodeExplorerHoverProvider.ts` (197 lines) | Hover → `findByCursor()` cache-only lookup |
| `src/providers/CodeExplorerCodeLensProvider.ts` (355 lines) | CodeLens → `readAllForFile()`, `_createCodeLens()` with `kind: 'unknown'` |
| `src/llm/PromptBuilder.ts` (searched) | `buildUnified()`, `buildFileAnalysis()` — cache root and naming convention in prompts |
| `src/llm/ResponseParser.ts` (searched) | `parseRelatedSymbolCacheEntries`, `RelatedSymbolCacheEntry` interface |
| `webview/src/main.ts` (searched) | Symbol link click handling — `exploreSymbol` message with `symbolName`, `filePath`, `line`, `kind` |

Key functions inspected in detail:
- `CacheStore._buildCacheKey()` (lines 620-636): The core cache key algorithm
- `CacheStore._resolvePath()` (lines 638-642): Combines cache root + file path + key
- `CacheStore.findByCursor()` (lines 184-306): Fuzzy lookup by name + ±3 line tolerance
- `CacheStore.findByCursorWithLLMFallback()` (lines 397-588): Two-tier cache lookup
- `AnalysisOrchestrator.analyzeFromCursor()` (lines 325-572): Primary cursor-based flow
- `AnalysisOrchestrator.analyzeSymbol()` (lines 77-309): Legacy SymbolInfo flow
- `CodeExplorerViewProvider._exploreSymbolByName()` (lines 680-761): Symbol link click resolution
- `CodeExplorerCodeLensProvider._createCodeLens()` (lines 273-292): Hardcoded `kind: 'unknown'`

Grep searches run:
- `exploreSymbol|symbol-link|explore-symbol` in `webview/src/main.ts` — found symbol link click handler
- `buildUnified|buildFileAnalysis|cacheRoot|cache_root|cache_file_path` in `PromptBuilder.ts` — found cache naming in LLM prompts
- `parseRelatedSymbolCacheEntries|RelatedSymbolCacheEntry` in `ResponseParser.ts` — found related symbol pre-cache parsing

## 2. Issues Identified

1. **CodeLens click cache miss** (`CodeExplorerCodeLensProvider.ts:284`): `_createCodeLens()` passes `kind: 'unknown'` which produces cache key prefix `sym.` instead of the actual kind prefix. This creates a systematic cache miss for every CodeLens click.

2. **Symbol link scope chain mismatch** (`CodeExplorerViewProvider.ts:680-761`): `_exploreSymbolByName()` resolves symbols via VS Code's `DocumentSymbolProvider` which doesn't set `scopeChain`. If the original analysis was cached with a scope chain from the cursor-based flow, the exact-path lookup misses.

3. **No staleness detection** (`CacheStore.ts:674`): `stale` is always `false`, `sourceHash` is always empty string — no mechanism to detect when source changes make a cached analysis outdated.

## 3. Plan

- Write a comprehensive documentation file at `docs/next/04-caching-mechanism-deep-dive.md`
- Cover all trigger paths exhaustively, tracing from user action to cache key computation
- Document all 4 lookup strategies (exact, fuzzy, LLM fallback, batch)
- Include the serialization format, pre-caching, staleness model
- Create a summary matrix of all triggers × lookup methods × cache key behavior
- Note known mismatches and issues

## 4. Changes Made

### New file: `docs/next/04-caching-mechanism-deep-dive.md`

Created a comprehensive 400+ line documentation file covering:

1. **Overview** — Purpose and location of cache
2. **Cache File Layout** — Directory structure mirroring source tree
3. **Cache Key Resolution** — `_buildCacheKey()` algorithm with 3 priority levels (scope chain → container name → name only), kind prefix map, examples table
4. **Trigger Paths (10 total)** — Each with full trace from user action through code to cache read/write:
   - Ctrl+Shift+E (cursor-based, primary flow)
   - Symbol link click (from webview)
   - Programmatic call (SymbolInfo passed directly)
   - Refresh/Retry
   - Explore All File Symbols
   - Enhance (Q&A)
   - Hover provider
   - CodeLens display
   - Session restore
   - CodeLens click
5. **Cache Lookup Strategies** — 4 methods: exact-path, fuzzy cursor, LLM fallback, batch read
6. **Serialization Format** — YAML frontmatter fields, 20 body sections in order, dual-format pattern
7. **Pre-Caching Related Symbols** — Legacy and new formats, dedup logic
8. **Cache Hit/Miss Decision Logic** — Three-condition check, miss scenarios table
9. **Cache Invalidation** — Current minimal state and planned features
10. **Summary Matrix** — All 11 trigger → lookup → key combinations in one table
11. **Known Cache Key Mismatches** — Three documented issues

No diff (new file creation).

## 5. Commands Run

No build/test/lint commands were needed — this was a documentation-only task.

## 6. Result

Created `docs/next/04-caching-mechanism-deep-dive.md` — a comprehensive deep-dive document covering every aspect of the caching mechanism. The document traces 10 distinct trigger paths from user action to cache key, documents 4 lookup strategies, explains the serialization format with all 20 sections, covers pre-caching of related symbols, and identifies 3 known cache key mismatch issues.

## 7. Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| `docs/next/04-caching-mechanism-deep-dive.md` | Created | Comprehensive caching mechanism documentation |
| `docs/copilot-executions/21-caching-mechanism-doc.md` | Created | This execution log |
