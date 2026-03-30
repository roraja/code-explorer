# 29 - Show Cache File Path in Analysis View

**Date**: 2026-03-29 UTC
**Prompt**: For a given llm analysis file opened, show the relative file path (md file which has the analysis in cache)

## 1. Code Reading & Analysis
- Read `src/models/types.ts` — `AnalysisMetadata` interface (lines 441-465), `TabState` (lines 666-676)
- Read `src/cache/CacheStore.ts` — `write()` (returns absolute path but nobody captures it), `read()`, `readByAddress()`, `readAllForFile()`, `findByCursor()`, `findByCursorWithLLMFallback()`, `_resolvePath()`, `_buildCacheKey()`, `getRelativeCachePath()` (new)
- Read `webview/src/main.ts` — metadata rendering at line 1204 (timestamp section), badge section at line 798, `.file-link` click handler at line 1272
- Read `webview/src/styles/main.css` — `.metadata` styles at line 552

## 2. Issues Identified
- Cache file path is computed inside `CacheStore._resolvePath()` and `write()` but never exposed to the UI layer
- The webview shows analysis timestamp and LLM provider but not where the analysis file lives on disk
- Users cannot easily find, read, or share the cached analysis markdown file

## 3. Plan
1. Add `cacheFilePath?: string` field to `AnalysisMetadata` in `types.ts`
2. Add public `getRelativeCachePath(symbol)` method to `CacheStore`
3. Set `cacheFilePath` in every path that produces an `AnalysisResult`:
   - `write()` — when writing new analysis
   - `read()` — when reading by SymbolInfo
   - `readByAddress()` — when reading by address
   - `readAllForFile()` — when scanning all cache files for a source file
   - `findByCursor()` — when fuzzy matching by cursor position
   - `findByCursorWithLLMFallback()` — when LLM-assisted cache fallback matches
4. Display the path in the webview metadata section as a clickable `.file-link`
5. Style the cache path link to be subtle but discoverable

## 4. Changes Made

### `src/models/types.ts` — Modified
- Added `cacheFilePath?: string` to `AnalysisMetadata` interface with JSDoc
- Example: `".vscode/code-explorer/src/main.cpp/fn.printBanner.md"`

### `src/cache/CacheStore.ts` — Modified
- Added public `getRelativeCachePath(symbol: SymbolInfo): string` method
- `write()`: sets `result.metadata.cacheFilePath` before serializing
- `read()`: sets `result.metadata.cacheFilePath` after deserialization
- `readByAddress()`: sets `result.metadata.cacheFilePath` from address components
- `readAllForFile()`: sets `result.metadata.cacheFilePath` from directory scan file name
- `findByCursor()`: sets `result.metadata.cacheFilePath` from matched md file name
- `findByCursorWithLLMFallback()`: sets `result.metadata.cacheFilePath` from LLM-matched file

### `webview/src/main.ts` — Modified
- Metadata section now includes the cache file path as a clickable `.file-link` span
- Path renders after the timestamp, separated by ` · `
- Clicking opens the `.md` file in the editor (uses existing `navigateToSource` message handler)

### `webview/src/styles/main.css` — Modified
- Added `.metadata__cache-path` styles: cursor pointer, dotted underline, word-break, opacity
- Added `.metadata__cache-path:hover` styles: full opacity, link color

## 5. Commands Run
- `npm run build` — PASS (extension 206.4kb, webview 2.8mb)
- `npm run lint` — PASS (0 errors, 0 warnings)
- `npm run test:unit` — PASS (223 passing, 207ms)

## 6. Result
The cache file path is now displayed at the bottom of every analyzed symbol's view, right next to the analysis timestamp. The path is clickable — clicking it opens the cached `.md` file in the VS Code editor. This makes it easy to inspect, read, or share the cached analysis.

The path is populated consistently across all cache read paths:
- Direct read by SymbolInfo (`read()`)
- Address-based O(1) lookup (`readByAddress()`)
- Full file scan (`readAllForFile()`)
- Fuzzy cursor match (`findByCursor()`)
- LLM-assisted fallback (`findByCursorWithLLMFallback()`)
- Fresh write (`write()`)

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `src/models/types.ts` | Modified | Added `cacheFilePath?: string` to `AnalysisMetadata` |
| `src/cache/CacheStore.ts` | Modified | Added `getRelativeCachePath()`; populated `cacheFilePath` in all read/write paths |
| `webview/src/main.ts` | Modified | Display cache file path as clickable link in metadata section |
| `webview/src/styles/main.css` | Modified | Added `.metadata__cache-path` styles |
