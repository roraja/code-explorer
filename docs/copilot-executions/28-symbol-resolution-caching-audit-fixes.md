# 28 - Symbol Resolution & Caching Key Audit + Fixes

**Date**: 2026-03-29 UTC
**Prompt**: Double check the code for symbol address resolution and all caching key related operations which links symbol to an MD file and a given symbol to file:line number, etc. Make sure vscode intellisense is used where ever possible. Also, the show symbol info for a var doesn't include the parent function name, this looks wrong.

## 1. Code Reading & Analysis
- Read `.context/FLOORPLAN.md` — routing table of all modules
- Read `src/models/types.ts` — all interfaces (SymbolInfo, CursorContext, AnalysisResult, etc.)
- Read `src/models/constants.ts` — CACHE constants, SYMBOL_KIND_PREFIX
- Read `src/indexing/SymbolAddress.ts` — `buildAddress()`, `parseAddress()`, `addressToCachePath()`
- Read `src/indexing/SymbolIndex.ts` — `resolveAtCursor()`, `getByAddress()`, `getCachePath()`
- Read `src/cache/CacheStore.ts` — `read()`, `readByAddress()`, `write()`, `findByCursor()`, `findByCursorWithLLMFallback()`, `_resolvePath()`, `_buildCacheKey()`, `_serialize()`, `_deserialize()`
- Read `src/analysis/AnalysisOrchestrator.ts` — 3-tier resolution in `analyzeFromCursor()`, `analyzeSymbol()`, pre-caching
- Read `src/analysis/StaticAnalyzer.ts` — `resolveSymbolAtPosition()`, `_resolveViaDefinitionProvider()`, `_findDeepestSymbol()`, `_buildScopeChainForPosition()`, `_mapVscodeSymbolKind()`
- Read `src/providers/SymbolResolver.ts` — legacy resolver with `_findDeepest()`, `_resolveViaDefinition()`, `_buildScopeChainForPosition()`, `_mapSymbolKind()`
- Read `src/providers/ShowSymbolInfoCommand.ts` — diagnostic command using 11 VS Code IntelliSense providers
- Read `src/providers/CodeExplorerHoverProvider.ts` — hover cards from cache
- Read `src/providers/CodeExplorerCodeLensProvider.ts` — inline annotations
- Read `src/ui/CodeExplorerViewProvider.ts` — tab management, `openTab()`, `openTabFromCursor()`, navigation
- Read `src/extension.ts` — activation, DI wiring

## 2. Issues Identified

### Issue 1: Cross-file scope chain bug in `StaticAnalyzer._resolveViaDefinitionProvider` (Medium)
- **File**: `src/analysis/StaticAnalyzer.ts`, line 148
- When definition is in a different file, `_buildScopeChainForPosition(allSymbols, defRange.start)` uses the CURRENT file's symbols, not the definition file's. The `defRange.start` position doesn't exist in the current file's symbol tree, producing incorrect/empty scope chains for cross-file definitions.

### Issue 2: Same cross-file bug in legacy `SymbolResolver._resolveViaDefinition` (Low)
- **File**: `src/providers/SymbolResolver.ts`, line 182
- Identical bug pattern. Legacy module (not wired into main pipeline).

### Issue 3: ShowSymbolInfo for variables doesn't show parent function name (Medium)
- **File**: `src/providers/ShowSymbolInfoCommand.ts`, section 1
- When cursor is on a variable inside a function, `_findDeepest` returns the containing function. Section 1 only shows the containing symbol's name, kind, range — but doesn't indicate that the cursor is on a different token (the variable) INSIDE that function. Missing: cursor word, container name, inferred kind, full scope path.

### Issue 4: `CacheStore.readByAddress` reimplements `addressToCachePath` logic (Maintainability)
- **File**: `src/cache/CacheStore.ts`, lines 113-122
- Manually splits address on `#`, replaces `::` with `.`, appends `.md` — identical to `addressToCachePath()` in `SymbolAddress.ts`. Also `promoteToAddress` had the same duplication.

### Issue 5: String concatenation for file URIs (Low)
- **File**: `src/ui/CodeExplorerViewProvider.ts`, lines 705, 788
- `vscode.Uri.file(\`${workspaceRoot}/${filePath}\`)` should use `path.join` for cross-platform safety.

### Issue 6: 4 duplicate `_findDeepest`/`_mapSymbolKind` implementations (Maintainability)
- `SymbolResolver.ts`, `StaticAnalyzer.ts`, `ShowSymbolInfoCommand.ts` all had identical copies of `_findDeepest`/`_findDeepestSymbol`, `_buildScopeChainForPosition`, and `_mapSymbolKind`/`_mapVscodeSymbolKind`.

## 3. Plan
1. Fix cross-file scope chain bugs by fetching definition file's document symbols when URI differs
2. Fix ShowSymbolInfo section 1 to distinguish "cursor on symbol name" vs "cursor on token inside body"
3. Extract `addressToCacheComponents()` in SymbolAddress.ts and use it in CacheStore
4. Fix string concatenation URIs with `path.join`
5. Extract shared helpers (`findDeepestSymbol`, `buildScopeChainForPosition`, `mapVscodeSymbolKind`) into `src/utils/symbolHelpers.ts` and refactor all 3 files to use them

## 4. Changes Made

### `src/utils/symbolHelpers.ts` — NEW FILE
- Created shared utility module with `findDeepestSymbol()`, `buildScopeChainForPosition()`, `mapVscodeSymbolKind()`, and `DeepestSymbolMatch` interface
- Single source of truth for document symbol tree traversal and kind mapping

### `src/analysis/StaticAnalyzer.ts` — Modified
- **Cross-file fix**: `_resolveViaDefinitionProvider` now checks if `defUri.fsPath !== uri.fsPath` and fetches `vscode.executeDocumentSymbolProvider` for the definition file when different
- **Refactor**: Replaced private `_findDeepestSymbol`, `_buildScopeChainForPosition`, `_mapVscodeSymbolKind` with shared imports from `symbolHelpers.ts`
- Removed ~70 lines of duplicated code

### `src/providers/SymbolResolver.ts` — Modified
- **Cross-file fix**: `_resolveViaDefinition` now checks `defUri.fsPath !== document.uri.fsPath` and fetches definition file's document symbols
- **Refactor**: Replaced private `_findDeepest`, `_buildScopeChainForPosition`, `_mapSymbolKind` with shared imports
- Removed ~50 lines of duplicated code

### `src/providers/ShowSymbolInfoCommand.ts` — Modified
- **Section 1 fix**: Now distinguishes between "cursor IS on the symbol name" vs "cursor is INSIDE a symbol body (not on its name)". For the latter case, shows:
  - Word at cursor (the actual variable/token)
  - Container function/class name with kind
  - Full scope chain including container
  - Whether it resolved as a child DocumentSymbol or was inferred from hover/container kind
- **Refactor**: Replaced local `_findDeepest`, `_mapSymbolKind` with shared imports, removed duplicated functions (~40 lines)

### `src/indexing/SymbolAddress.ts` — Modified
- Added `addressToCacheComponents()` — splits address into `{ filePath, fileName }`, single source of truth for address → file name mapping
- `addressToCachePath()` now delegates to `addressToCacheComponents()`

### `src/cache/CacheStore.ts` — Modified
- `readByAddress()` now uses `addressToCacheComponents()` instead of inline address parsing
- `promoteToAddress()` now uses `addressToCacheComponents()` instead of inline address parsing
- Added import for `addressToCacheComponents`

### `src/ui/CodeExplorerViewProvider.ts` — Modified
- Added `import * as path from 'path'`
- Replaced `vscode.Uri.file(\`${workspaceRoot}/${filePath}\`)` with `vscode.Uri.file(path.join(workspaceRoot, filePath))` in both `_exploreSymbolByName` and `_navigateToSource`

## 5. Commands Run
- `npm run build` — PASS (extension 205.7kb, webview 2.8mb)
- `npm run lint` — PASS (0 errors, 0 warnings)
- `npm run test:unit` — PASS (223 passing, 252ms)

## 6. Result
All 7 issues fixed:
1. Cross-file scope chain bug in StaticAnalyzer — fixed by fetching definition file's symbols
2. Same bug in legacy SymbolResolver — fixed identically
3. ShowSymbolInfo for variables — now shows parent function, word at cursor, inferred kind
4. Duplicated address→cache path logic — centralized in `addressToCacheComponents()`
5. String concatenation for URIs — replaced with `path.join`
6. 4 duplicate helper implementations — extracted to `src/utils/symbolHelpers.ts`

All tests pass, build succeeds, lint clean.

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `src/utils/symbolHelpers.ts` | Created | Shared `findDeepestSymbol`, `buildScopeChainForPosition`, `mapVscodeSymbolKind` utilities |
| `src/analysis/StaticAnalyzer.ts` | Modified | Fixed cross-file scope chain bug; use shared helpers; removed ~70 lines of duplicates |
| `src/providers/SymbolResolver.ts` | Modified | Fixed cross-file scope chain bug; use shared helpers; removed ~50 lines of duplicates |
| `src/providers/ShowSymbolInfoCommand.ts` | Modified | Section 1 shows parent function for variables; use shared helpers; removed ~40 lines |
| `src/indexing/SymbolAddress.ts` | Modified | Added `addressToCacheComponents()` shared utility; `addressToCachePath()` delegates to it |
| `src/cache/CacheStore.ts` | Modified | `readByAddress` and `promoteToAddress` use `addressToCacheComponents()` |
| `src/ui/CodeExplorerViewProvider.ts` | Modified | Added `path` import; use `path.join` for URI construction |
