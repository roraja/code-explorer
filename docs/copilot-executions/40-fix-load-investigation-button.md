# 40 - Fix Load Investigation Button

**Date**: 2026-03-30 20:58 UTC
**Prompt**: "The load investigation button functionality is not working"

## 1. Code Reading & Analysis
- `webview/src/main.ts` (lines 40-51, 285-320, 1530-1560): Webview-side `PinnedInvestigation` interface and "Load" button rendering + click handler. Button sends `{ type: 'restoreInvestigation', investigationId }` to the extension.
- `src/models/types.ts` (lines 603-690): `NavigationEntry`, `PinnedInvestigation`, `TabState` interfaces. `trailSymbols` only stored `{ tabId, symbolName, symbolKind }` — no full `SymbolInfo`.
- `src/ui/CodeExplorerViewProvider.ts` (lines 1060-1090): `_restoreInvestigation()` — only searched for existing tabs in `_tabs` by tab ID; silently returned if none found.
- `src/ui/CodeExplorerViewProvider.ts` (lines 426-512): `_restoreTabsAsync()` — the session restore method that shows the pattern for re-creating tabs from cache (used as reference).
- `src/ui/CodeExplorerViewProvider.ts` (lines 1000-1043, 1155-1210): `_pinCurrentInvestigation()`, `_saveCurrentInvestigation()`, `_saveCurrentInvestigationAs()` — all stored `trailSymbols` without full `SymbolInfo`.
- `src/ui/CodeExplorerViewProvider.ts` (lines 629-633): Message handler that calls `_restoreInvestigation()`.
- `test/unit/ui/NavigationHistory.test.ts`: Tests for navigation history and pinned investigations.

Grep searches: `trailSymbols` across all files, `restoreInvestigation` across all files, `NavigationEntry` in types.

## 2. Issues Identified
1. **`_restoreInvestigation()` silently fails when tabs are closed** (`src/ui/CodeExplorerViewProvider.ts:1072-1090`): The method iterates `investigation.trail` looking for tab IDs in `this._tabs`. When all tabs have been closed (IDs no longer in `_tabs`), it logs a warning and returns — the user sees no effect.
2. **`PinnedInvestigation.trailSymbols` lacks full `SymbolInfo`** (`src/models/types.ts:630`): Only `{ tabId, symbolName, symbolKind }` was stored, which is insufficient to look up cached analysis via `CacheStore.read(symbol)` (needs `filePath`, `position`, `scopeChain`).
3. **All three pin/save methods omit `SymbolInfo`** (`CodeExplorerViewProvider.ts:1016-1020, 1164-1168, 1184-1188`): When creating or updating pinned investigations, full symbol data was discarded.

## 3. Plan
- Add optional `symbol?: SymbolInfo` to `PinnedInvestigation.trailSymbols` entries for backward compat
- Store the full `SymbolInfo` from the tab when pinning/saving investigations
- Rewrite `_restoreInvestigation()` as async: first check existing tabs, then fall back to re-creating tabs from cache using stored `SymbolInfo`
- Update the webview's local `PinnedInvestigation` interface to accept the new field

## 4. Changes Made

### `src/models/types.ts` (line 630)
**Before:**
```typescript
trailSymbols: { tabId: string; symbolName: string; symbolKind: string }[];
```
**After:**
```typescript
trailSymbols: {
  tabId: string;
  symbolName: string;
  symbolKind: string;
  /** Full symbol info for re-creating tabs from cache when the original tab is closed */
  symbol?: SymbolInfo;
}[];
```

### `src/ui/CodeExplorerViewProvider.ts` — `_pinCurrentInvestigation()` (line ~1016)
**Before:**
```typescript
trailSymbols.push({
  tabId: entry.toTabId,
  symbolName: entry.symbolName,
  symbolKind: entry.symbolKind,
});
```
**After:**
```typescript
const tab = this._tabs.find((t) => t.id === entry.toTabId);
trailSymbols.push({
  tabId: entry.toTabId,
  symbolName: entry.symbolName,
  symbolKind: entry.symbolKind,
  symbol: tab?.symbol,
});
```

### `src/ui/CodeExplorerViewProvider.ts` — `_saveCurrentInvestigation()` (line ~1164)
Added `symbol: t.symbol` to `trailSymbols` map.

### `src/ui/CodeExplorerViewProvider.ts` — `_saveCurrentInvestigationAs()` (line ~1184)
Added `symbol: t.symbol` to `trailSymbols` map.

### `src/ui/CodeExplorerViewProvider.ts` — `_restoreInvestigation()` (lines 1060-1090)
Complete rewrite from sync to async. New behavior:
1. Sets investigation as current (name, id, dirty flag)
2. Iterates through `trailSymbols`, checking if each tab exists in `_tabs`
3. If tab doesn't exist but `ts.symbol` and `_cacheStore` are available, reads cached analysis and re-creates the tab
4. Updates investigation trail IDs to reflect re-created tabs
5. Activates the first available tab and calls `_pushState()`

### `webview/src/main.ts` (line 49)
**Before:**
```typescript
trailSymbols: { tabId: string; symbolName: string; symbolKind: string }[];
```
**After:**
```typescript
trailSymbols: { tabId: string; symbolName: string; symbolKind: string; symbol?: unknown }[];
```

## 5. Commands Run
- `npm run build` → Success (extension.js 237.9kb, webview main.js 2.8mb)
- `npm run test:unit` → 291 passing (all pass)
- `npx eslint src/ui/CodeExplorerViewProvider.ts src/models/types.ts webview/src/main.ts --quiet` → No errors

## 6. Result
The "Load Investigation" button now works when tabs have been closed:
- Tabs are re-created from cached analysis data using the full `SymbolInfo` stored in the pinned investigation
- Backward compatible: old pinned investigations without `symbol` field degrade gracefully (tabs without `symbol` info are skipped during re-creation, same as before)
- Tab IDs in the investigation trail are updated to reflect re-created tabs

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| src/models/types.ts | Modified | Added optional `symbol?: SymbolInfo` to `trailSymbols` entries |
| src/ui/CodeExplorerViewProvider.ts | Modified | Store full SymbolInfo when pinning; rewrite `_restoreInvestigation()` to async with cache-based tab re-creation |
| webview/src/main.ts | Modified | Updated local `PinnedInvestigation` interface to accept `symbol?` field |
