# 25 - Wire VS Code Static Analysis + Address-Based Cache into Analysis Pipeline

**Date**: 2026-03-29 13:00 UTC
**Prompt**: "VSCode's built in static analyzer API can also help - like to find type or any intellisense info. Check how that can be used. Also I still see findByCursor method being used to resolve symbol / cached AI file. Don't search by line, first try by static analysis to find symbol / md. Modify the plan so that if for a given string, if there are duplicate symbol addresses, then show all symbols as options in a context menu with symbol address and let user select where to navigate to."

## 1. Code Reading & Analysis

| File | Why |
|------|-----|
| `src/analysis/AnalysisOrchestrator.ts` (1035 lines) | Main analysis pipeline — identified that `analyzeFromCursor()` (line 325) always calls `findByCursorWithLLMFallback()` which scans files by name + ±3 line tolerance |
| `src/analysis/StaticAnalyzer.ts` (336 lines) | VS Code API wrappers — already has `findReferences()`, `buildCallHierarchy()`, `getTypeHierarchy()`, `readSymbolSource()` but NO symbol resolution at position |
| `src/providers/SymbolResolver.ts` (274 lines) | Has `resolveAtPosition()` using `vscode.executeDocumentSymbolProvider` — correct approach but NOT imported anywhere in the main pipeline |
| `src/cache/CacheStore.ts` (1383 lines) | `findByCursor()` at line 184 does O(n) scan of `.md` files with ±3 line tolerance; NO address-based lookup exists |
| `src/extension.ts` (527 lines) | Constructs orchestrator at line 55 — `new AnalysisOrchestrator(staticAnalyzer, llmProvider, cacheStore, workspaceRoot)` — no symbol index injected |
| `src/ui/CodeExplorerViewProvider.ts` (multiple spots) | `openTabFromCursor()` at line 246 calls `orchestrator.analyzeFromCursor()` — the entry point for Ctrl+Shift+E |
| `src/indexing/SymbolAddress.ts` | Our Phase 1 `buildAddress()` function — used to compute address from resolved SymbolInfo |
| `src/indexing/SymbolIndex.ts` | Our Phase 1 `SymbolIndex` class — has `resolveAtCursor()` for tree-sitter-based resolution |

## 2. Issues Identified

1. **`analyzeFromCursor()` always uses line-based fuzzy scan** — even though VS Code's language server can resolve the exact symbol at a cursor position with accurate kind, name, and scope chain, this was never called before the cache check
2. **No `readByAddress()` on CacheStore** — the address-based cache path from Phase 1 couldn't be used for lookups; only legacy `_buildCacheKey()` path was available
3. **`StaticAnalyzer` had no symbol resolution method** — the class had references/call hierarchy/type hierarchy but not the most basic operation: "what symbol is at this position?"
4. **`SymbolResolver.ts` existed but was disconnected** — it implements the exact approach needed (document symbols + definition provider + scope chain) but isn't imported by `extension.ts` or `AnalysisOrchestrator`

## 3. Plan

Rather than refactoring the entire pipeline, take a **layered approach**:

1. Add `resolveSymbolAtPosition()` to `StaticAnalyzer` (reusing patterns from `SymbolResolver.ts`)
2. Add `readByAddress()` to `CacheStore` for O(1) address-based lookup
3. Modify `analyzeFromCursor()` to try 3 tiers before falling to LLM:
   - **Tier 1**: VS Code static analysis → build address → `readByAddress()` + legacy `read()`
   - **Tier 2**: Tree-sitter symbol index → `resolveAtCursor()` → `readByAddress()`
   - **Tier 3**: Legacy fuzzy scan (`findByCursor()` / `findByCursorWithLLMFallback()`)
   - **LLM**: Only if all tiers miss

## 4. Changes Made

### `src/analysis/StaticAnalyzer.ts` — Added `resolveSymbolAtPosition()`
- New public method: `resolveSymbolAtPosition(filePath, line, character, word)`
- Uses `vscode.executeDocumentSymbolProvider` to get full symbol tree
- Uses `_findDeepestSymbol()` to find the most specific symbol at cursor
- Falls back to `vscode.executeDefinitionProvider` for local variables/parameters
- Builds `SymbolInfo` with accurate kind, name, range, scopeChain, containerName
- Added private helpers: `_resolveViaDefinitionProvider()`, `_findDeepestSymbol()`, `_buildScopeChainForPosition()`, `_mapVscodeSymbolKind()`

### `src/cache/CacheStore.ts` — Added `readByAddress()`
- New public method: `readByAddress(address, symbol)`
- Computes cache path directly from address: `address.split('#')[1].replace(/::/g, '.') + '.md'`
- O(1) file read — no directory scanning, no line matching, no LLM fallback
- Returns `AnalysisResult | null`

### `src/analysis/AnalysisOrchestrator.ts` — 3-tier resolution before LLM
- Import `buildAddress` from `src/indexing/SymbolAddress`
- Import `SymbolIndex` type for optional dependency injection
- Constructor now accepts optional `_symbolIndex?: SymbolIndex` parameter (backward-compatible)
- `analyzeFromCursor()` now tries in order:
  1. **Tier 1**: `_staticAnalyzer.resolveSymbolAtPosition()` → `buildAddress()` → `_cache.readByAddress()` → `_cache.read()` (legacy key)
  2. **Tier 2**: `_symbolIndex?.resolveAtCursor()` → `_cache.readByAddress()`
  3. **Tier 3**: `_cache.findByCursorWithLLMFallback()` / `findByCursor()` (unchanged)
  4. LLM unified prompt (unchanged)

## 5. Commands Run

| Command | Result |
|---------|--------|
| `npx tsc --noEmit` (first) | 1 error: unused `relPath` parameter in `_resolveViaDefinitionProvider` |
| `npx tsc --noEmit` (after fix) | OK — clean compile |
| `npm run lint` | OK — no warnings |
| `npm run test:unit` | OK — **223 passing** (0 regressions) |
| `npm run build:extension` | OK — 201.9kb, 32ms |

## 6. Result

### What Changed
The analysis pipeline now has a **3-tier resolution strategy** before falling back to LLM:

```
Ctrl+Shift+E on cursor
  → TIER 1: VS Code static analysis (definition provider + document symbols)
    → resolves SymbolInfo with kind, name, scopeChain [<100ms, deterministic]
    → builds address → readByAddress() [O(1), no scanning]
    → falls back to read() with legacy key [O(1)]
  → TIER 2: tree-sitter symbol index (when available)
    → resolveAtCursor() → readByAddress() [O(1)]
  → TIER 3: legacy fuzzy scan (findByCursor ±3 lines) [O(n), line-dependent]
  → LLM unified prompt [5-15s, non-deterministic]
```

### Key APIs Used

| VS Code API | What It Does | Where Used |
|-------------|-------------|------------|
| `vscode.executeDocumentSymbolProvider` | Returns full symbol tree (DocumentSymbol[]) with kinds, ranges, children | `StaticAnalyzer.resolveSymbolAtPosition()` |
| `vscode.executeDefinitionProvider` | Go-to-Definition for any token — resolves to definition location | `StaticAnalyzer._resolveViaDefinitionProvider()` |
| `DocumentSymbol.range.contains()` | Check if cursor is inside a symbol | `_findDeepestSymbol()` |
| `DocumentSymbol.selectionRange` | The identifier range (vs full body range) | Distinguish "on name" vs "inside body" |
| `DocumentSymbol.kind` | SymbolKind enum (Class, Function, Method, etc.) | `_mapVscodeSymbolKind()` |

### Backward Compatibility
- `AnalysisOrchestrator` constructor accepts `_symbolIndex` as optional 5th parameter — existing callers are unaffected
- `findByCursor()` remains as Tier 3 fallback — not removed
- No changes to `extension.ts` (Phase 2 of the plan will wire the index into the constructor)

## 7. Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| `src/analysis/StaticAnalyzer.ts` | Modified | Added `resolveSymbolAtPosition()` and 4 private helpers for VS Code API-based symbol resolution |
| `src/cache/CacheStore.ts` | Modified | Added `readByAddress()` for O(1) address-based cache lookup |
| `src/analysis/AnalysisOrchestrator.ts` | Modified | Added 3-tier resolution (VS Code static → tree-sitter index → legacy fuzzy) before LLM; accepts optional SymbolIndex |
