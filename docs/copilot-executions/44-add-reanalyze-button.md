# 44 - Add Re-analyze Button

**Date**: 2026-03-31 UTC
**Prompt**: Add command "re-analyze" next to enhance command button which re-triggers exploration of the symbol (as if called for first time, disregarding current text)

## 1. Code Reading & Analysis
- Read `.context/FLOORPLAN.md` — understood routing table and data flow
- Read `src/models/constants.ts` — checked existing commands
- Read `src/models/types.ts` — examined `WebviewToExtensionMessage` union, `TabState`, `ExplorerState`
- Read `src/extension.ts` — understood command registration and how exploreSymbol works
- Read `src/ui/CodeExplorerViewProvider.ts` — analyzed `openTab`, `openTabFromCursor`, `_handleEnhanceAnalysis`, `refreshRequested`/`retryAnalysis` handlers, `_pushState`, `_buildCursorContext`
- Read `webview/src/main.ts` — found enhance button rendering (lines 793–810), click handler wiring (lines 1490–1498), notes button pattern
- Read `webview/src/styles/main.css` — found `.enhance-bar`, `.enhance-bar__button`, `.notes-btn` styles
- Read `src/analysis/AnalysisOrchestrator.ts` — analyzed `analyzeFromCursor` method (lines 352–740), all three cache tiers (1: VS Code static + address cache, 2: tree-sitter, 3: fuzzy scan), and the LLM analysis section after cache tiers. Also checked `analyzeSymbol` which has a `force` parameter.

## 2. Issues Identified
- `analyzeFromCursor` did not have a `force` parameter to bypass cache — needed to add one
- No `reAnalyze` message type existed in `WebviewToExtensionMessage`
- No re-analyze button existed in the webview UI
- No handler existed in `CodeExplorerViewProvider` for re-analyze requests

## 3. Plan
- Add `reAnalyze` message type to the `WebviewToExtensionMessage` union in `types.ts`
- Add `force` parameter (default `false`) to `analyzeFromCursor` in `AnalysisOrchestrator.ts`, wrapping cache tiers 1–3 in `if (!force)` block
- Add `_handleReAnalyze` method in `CodeExplorerViewProvider.ts` that rebuilds a `CursorContext` from the tab's symbol and calls `analyzeFromCursor` with `force=true`
- Add re-analyze button in `webview/src/main.ts` next to the enhance button
- Wire up the button click handler to post `reAnalyze` message
- Add CSS styles for `.reanalyze-btn` in `webview/src/styles/main.css`

## 4. Changes Made

### `src/models/types.ts`
- Added `| { type: 'reAnalyze'; tabId: string }` to `WebviewToExtensionMessage` union

### `src/analysis/AnalysisOrchestrator.ts`
- Added `force = false` parameter to `analyzeFromCursor` signature
- Added force-mode log message before cache tiers
- Wrapped cache tiers 1–3 (lines 373–573) in `if (!force) { ... }` block so they are skipped when re-analyzing
- Existing callers (CodeExplorerAPI, openTabFromCursor) are unaffected because `force` defaults to `false`

### `src/ui/CodeExplorerViewProvider.ts`
- Added `case 'reAnalyze'` handler in the message switch that calls `_handleReAnalyze`
- Added `_handleReAnalyze(tabId)` method that:
  1. Finds the tab by ID
  2. Resets tab to loading state (preserving position in tab bar)
  3. Builds a `CursorContext` from the tab's symbol using `_buildCursorContext`
  4. Calls `analyzeFromCursor(cursor, onProgress, true)` with force=true
  5. Updates the tab with the new analysis result on success
  6. Sets error state on failure

### `webview/src/main.ts`
- Added `🔄 Re-analyze` button in both enhancing and normal states of the enhance bar, positioned between the Enhance button and Notes button
- Added click handler for `.reanalyze-btn` that posts `{ type: 'reAnalyze', tabId }` message

### `webview/src/styles/main.css`
- Added `.reanalyze-btn` and `.reanalyze-btn:hover` styles matching the `.notes-btn` style pattern

## 5. Commands Run
- `npm run build` — initial build failed due to missing `_exploreSymbolByName` function declaration (edit accidentally swallowed the method signature). Fixed and re-ran.
- `npm run build` — succeeded (extension: 239.4kb, webview: 2.8mb)
- `npm run lint` — 1 pre-existing error in `logger.ts` (unrelated `@typescript-eslint/no-var-requires`), no new errors
- `npm run test:unit` — all 291 tests passing

## 6. Result
The "Re-analyze" button (🔄 Re-analyze) now appears next to the ✨ Enhance button in the sidebar analysis view. Clicking it:
1. Puts the tab back into loading state
2. Rebuilds cursor context from the existing symbol info
3. Runs the full LLM analysis pipeline with `force=true`, bypassing all cache tiers
4. Updates the tab with fresh analysis results

The button has a tooltip explaining "Re-analyze this symbol from scratch, ignoring cached results". It uses the same visual style as the Notes button for consistency.

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `src/models/types.ts` | Modified | Added `reAnalyze` message type to `WebviewToExtensionMessage` |
| `src/analysis/AnalysisOrchestrator.ts` | Modified | Added `force` parameter to `analyzeFromCursor`, wrapped cache tiers in `if (!force)` |
| `src/ui/CodeExplorerViewProvider.ts` | Modified | Added `reAnalyze` message handler and `_handleReAnalyze` method |
| `webview/src/main.ts` | Modified | Added re-analyze button and click handler |
| `webview/src/styles/main.css` | Modified | Added `.reanalyze-btn` styles |
