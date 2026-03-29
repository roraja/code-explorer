# 22 - Symbol Link: Navigate to Source Instead of LLM Analysis

**Date**: 2026-03-29 UTC
**Prompt**: When I click a reference, take me to that code location, don't trigger LLM analysis. I can trigger the analysis myself from the code location. Make sure to navigate to exact line number / file for that symbol.

## 1. Code Reading & Analysis
- Read `.context/FLOORPLAN.md` — understood data flow and module responsibilities
- Read `webview/src/main.ts` — full webview renderer including:
  - `_symbolExploreLink()` (line 753): generates `<a class="symbol-link">` with `data-symbol-name`, `data-symbol-file`, `data-symbol-line`, `data-symbol-kind` attributes
  - `attachListeners()` (line 1281-1299): `.symbol-link` click handler sends `exploreSymbol` message
  - `.file-link` click handler (line 1267-1279): sends `navigateToSource` — this is the behavior we want for symbol links too
- Read `src/ui/CodeExplorerViewProvider.ts` — extension-side message handling:
  - `_handleMessage()` case `exploreSymbol` (line 586): calls `_exploreSymbolByName()` which triggers full LLM analysis via `openTabFromCursor()`
  - `_handleMessage()` case `navigateToSource` (line 558): calls `_navigateToSource()` which simply opens the file at the exact line
  - `_navigateToSource()` (line 770-803): opens document, sets cursor position, reveals range in center
- Read `src/models/types.ts` — `WebviewToExtensionMessage` union type defines all valid messages

## 2. Issues Identified
- `webview/src/main.ts` line 1281-1299: Symbol link clicks send `exploreSymbol` message, which triggers `_exploreSymbolByName()` → `openTabFromCursor()` → full LLM analysis pipeline. User wants to just navigate to the code location instead.
- No message type exists for "navigate to symbol by name" (when file path is unknown) — only `navigateToSource` exists which requires a file path.

## 3. Plan
- **Webview**: Change `.symbol-link` click handler to:
  1. If filePath + line are available → send `navigateToSource` (exact navigation)
  2. If filePath but no line → send `navigateToSource` with line=1
  3. If only symbolName (no file) → send new `navigateToSymbol` message
- **Extension**: Add `navigateToSymbol` handler that uses `vscode.executeWorkspaceSymbolProvider` to find the symbol location, then navigates there (no LLM analysis)
- **Types**: Add `navigateToSymbol` to `WebviewToExtensionMessage` union
- Keep `exploreSymbol` message type intact — it's still used by the existing `_exploreSymbolByName()` method which other code paths may call

## 4. Changes Made

### File: `webview/src/main.ts`
- **Changed**: `.symbol-link` click handler (was lines 1281-1299)
- **Before**: Always sent `exploreSymbol` message with symbolName, filePath, line, kind — triggering full LLM analysis
- **After**: Sends `navigateToSource` when filePath+line are available (direct file navigation), `navigateToSource` with line=1 when only filePath is available, or `navigateToSymbol` when only symbolName is available (extension finds the symbol via workspace symbol provider)

### File: `src/models/types.ts`
- **Changed**: Added `{ type: 'navigateToSymbol'; symbolName: string }` to `WebviewToExtensionMessage` union type

### File: `src/ui/CodeExplorerViewProvider.ts`
- **Changed**: Added `case 'navigateToSymbol'` handler in `_handleMessage()` that calls new `_navigateToSymbolByName()`
- **Added**: New method `_navigateToSymbolByName(symbolName)` that:
  1. Uses `vscode.executeWorkspaceSymbolProvider` to find the symbol
  2. Calls `_navigateToSource()` with the resolved file path and line
  3. Does NOT trigger any LLM analysis

## 5. Commands Run
- `npm run build` — ✅ both extension and webview build successfully
- `npm run lint` — ✅ no lint errors
- `npm run test:unit` — ✅ all 150 tests passing

## 6. Result
- Clicking any symbol link (sub-functions, callers, relationships, class members, type links, auto-linked names) now navigates directly to the code location
- The exact file and line number are used for navigation
- No LLM analysis is triggered — users can manually trigger analysis from the code location if desired (Ctrl+Shift+H)
- For symbols without a known file path, the workspace symbol provider is used to locate them

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `webview/src/main.ts` | Modified | Changed `.symbol-link` click handler to navigate to source instead of triggering LLM analysis |
| `src/models/types.ts` | Modified | Added `navigateToSymbol` message type to `WebviewToExtensionMessage` |
| `src/ui/CodeExplorerViewProvider.ts` | Modified | Added `navigateToSymbol` handler and `_navigateToSymbolByName()` method for name-only symbol navigation |
