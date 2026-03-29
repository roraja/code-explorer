# 01 - Fix Cursor-Based Cache Lookup

**Date**: 2026-03-29 UTC
**Prompt**: Now that static analyzer is not used, the cache read system is kind of broken. Without symbol type, its not able to lookup properly. Can you modify the cache read system so that for the given symbol text and line number and filepath, it searches the file's folder in .vscode/code-explorer and for each file, checks if any of them has symbol matching and the line number within +- 3 lines. Then it uses that file as cache to determine symbol and load llm analysis. Add logs for this cache read system so I can debug

## 1. Code Reading & Analysis
- Read `src/cache/CacheStore.ts` — the full cache read/write system. Lines 48-68: `read()` method requires a fully-resolved `SymbolInfo` with known `kind` and `scopeChain` to compute the exact file path via `_buildCacheKey()` → `_resolvePath()`.
- Read `src/analysis/AnalysisOrchestrator.ts` — the `analyzeFromCursor()` method (lines 298-497). The post-LLM cache check at step 6 (line 455) was pointless since we just got fresh LLM results.
- Read `src/models/types.ts` — `SymbolInfo` and `CursorContext` interfaces (lines 61-111).
- Examined the YAML frontmatter format in `_serialize()` (lines 125-155) — fields: `symbol`, `kind`, `file`, `line`, `scope_chain`, `analyzed_at`, `llm_provider`, `stale`.
- Examined `_parseFrontmatter()` (lines 424-433) — regex-based key-value parsing.
- Examined `_resolvePath()` (lines 117-121) and `_buildCacheKey()` (lines 100-115) — these require `symbol.kind` to compute the kind prefix in the filename, which is unavailable before LLM resolution.

## 2. Issues Identified
- **`CacheStore.read()` requires kind + scopeChain** (`src/cache/CacheStore.ts` line 48): Without knowing the symbol kind, the cache key cannot be computed (e.g., `fn.processUser.md` vs `method.processUser.md` vs `var.processUser.md`). In the `analyzeFromCursor()` flow, kind is only known after the LLM responds.
- **Post-LLM cache check was redundant** (`src/analysis/AnalysisOrchestrator.ts` lines 455-478): Step 6 checked the exact-path cache after the LLM had already responded with fresh data — the cache would only match if the LLM returned the same kind/scope as a previous run, but we already have fresh results so returning stale ones makes no sense.
- **No pre-LLM cache check in cursor flow**: There was no cache check before sending the expensive LLM call, meaning every "Explore Symbol" triggered a full LLM round-trip even for previously-analyzed symbols.

## 3. Plan
- Add a new `findByCursor(word, filePath, cursorLine)` method to `CacheStore` that:
  1. Resolves the cache directory for the given source file path
  2. Lists all `.md` files in that directory
  3. For each file, reads YAML frontmatter and checks: symbol name matches AND line within ±3
  4. Returns the first match with reconstructed `SymbolInfo` + `AnalysisResult`
  5. Extensive logging at every step for debuggability
- Wire `findByCursor` into `analyzeFromCursor` BEFORE the LLM call (new step 1)
- Remove the redundant post-LLM cache check (old step 6)
- Add comprehensive unit tests with real filesystem operations

## 4. Changes Made

### `src/cache/CacheStore.ts`
- **Added `SymbolKindType` to imports** (line 14): Needed for type-safe kind casting from frontmatter.
- **Added `findByCursor()` method** (lines 73-203): New public method that scans the cache directory for a source file, reads each `.md` file's frontmatter, checks symbol name and line tolerance, and returns the first match. Includes detailed logging at every step:
  - Logs cache directory path being searched
  - Logs list of `.md` files found
  - Logs each file being checked with its frontmatter values
  - Logs name mismatch details
  - Logs line delta calculations and tolerance checks
  - Logs hit details (delta, age, provider, staleness)
  - Logs miss summary with count of files scanned
- **Renamed `_LINE_TOLERANCE` → `_lineTolerance`** (line 73): Fix ESLint camelCase naming convention warning.

### `src/analysis/AnalysisOrchestrator.ts`
- **Added cursor cache scan as step 1** (lines 310-360): Calls `cache.findByCursor()` before building the LLM prompt. If a non-stale cached result is found, returns it immediately — saving the entire LLM round-trip. Logs whether the match was a hit, stale, no-LLM-data, or miss.
- **Removed redundant post-LLM cache check** (old lines 455-478): The step 6 cache check after LLM resolution was pointless since we already have fresh LLM results.
- **Renumbered steps** in `analyzeFromCursor`: 1=cache scan, 2=build prompt, 3=LLM call, 3a=parse identity, 3b=parse analysis, 4=build SymbolInfo, 5=build result, 6=write cache.

### `test/unit/cache/CacheStore.test.ts` (NEW)
- Created 10 tests for `findByCursor`:
  - Finds symbol matching name and line within tolerance (delta=1)
  - Finds symbol at exact same line (delta=0)
  - Finds symbol at max tolerance ±3 (both sides)
  - Returns null when line delta exceeds tolerance (delta=4)
  - Returns null when symbol name doesn't match
  - Returns null for nonexistent cache directory
  - Returns null for empty cache directory
  - Distinguishes multiple symbols with same name at different lines
  - Reconstructs SymbolInfo with scope chain from frontmatter
  - Returns stale entries (caller decides what to do)
- All tests use real filesystem via `os.tmpdir()` with setup/teardown cleanup.

## 5. Commands Run
1. `npm run build` — **PASS** (extension 87.1kb, webview 10.3kb+10.8kb)
2. `npm run lint` — **PASS** (0 errors, 0 warnings after fixing `_LINE_TOLERANCE` → `_lineTolerance`)
3. `npm run test:unit` — **PASS** (111 passing in 56ms)

## 6. Result
- Cache system now works correctly with the cursor-based flow
- `findByCursor` scans the cache directory by symbol name + ±3 line tolerance
- Pre-LLM cache check prevents unnecessary LLM calls for previously-analyzed symbols
- Extensive logging at every step of the cache lookup process for debugging
- Removed redundant post-LLM cache check
- All 111 tests pass (10 new CacheStore tests)
- Zero lint warnings/errors

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| src/cache/CacheStore.ts | Modified | Added `findByCursor()` method with ±3 line tolerance and extensive debug logging; added `SymbolKindType` import; renamed `_LINE_TOLERANCE` → `_lineTolerance` |
| src/analysis/AnalysisOrchestrator.ts | Modified | Added pre-LLM cursor cache scan (step 1); removed redundant post-LLM cache check (old step 6); renumbered steps |
| test/unit/cache/CacheStore.test.ts | Created | 10 unit tests for `findByCursor` covering matches, misses, tolerance boundaries, same-name disambiguation, and scope chain reconstruction |
