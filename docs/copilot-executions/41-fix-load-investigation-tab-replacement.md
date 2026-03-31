# 41 - Fix Load Investigation Tab Replacement

**Date**: 2026-03-31 UTC
**Prompt**: "The load investigation button on an investigation should modify the vertical tab explorer to match what the investigation tabs had saved (in that order) and remove the vertical tabs not present. Currently its not working"

## 1. Code Reading & Analysis
- `src/ui/CodeExplorerViewProvider.ts` (lines 1058-1148): `_restoreInvestigation()` — the method called when user clicks "Load" on a saved investigation
- `src/ui/CodeExplorerViewProvider.ts` (lines 1241-1273): `_saveCurrentInvestigationAs()` — saves current `this._tabs` array as investigation `trailSymbols`
- `src/ui/CodeExplorerViewProvider.ts` (lines 1204-1236): `_saveCurrentInvestigation()` — overwrites existing investigation with current `this._tabs`
- `src/ui/CodeExplorerViewProvider.ts` (lines 335-358): `_pushState()` — pushes full tab state to webview
- `webview/src/main.ts` (lines 251-324): `renderTabBar()` — renders tab list from `currentTabs` array
- `webview/src/main.ts` (lines 1541-1549): Event handler for `.saved-inv__restore` — sends `restoreInvestigation` message
- `src/models/types.ts` (lines 622-639): `PinnedInvestigation` interface with `trailSymbols`
- `docs/copilot-executions/40-fix-load-investigation-button.md`: Previous fix that added `symbol?: SymbolInfo` to trailSymbols and made _restoreInvestigation async with cache-based tab re-creation

## 2. Issues Identified
1. **Tabs not in the investigation were never removed** (`src/ui/CodeExplorerViewProvider.ts:1078-1122`): The old `_restoreInvestigation()` only *added* missing tabs to the existing `this._tabs` array via `this._tabs.push(tab)`. Tabs already open that weren't part of the investigation were never filtered out. The user expected loading an investigation to *replace* the tab list entirely.

2. **Tab order not preserved** (`src/ui/CodeExplorerViewProvider.ts:1078-1122`): Existing tabs kept their original positions in `this._tabs`, and re-created tabs were appended at the end. The investigation's saved order (from `trailSymbols`) was not used to determine the order of `this._tabs`. The webview renders tabs in the order they appear in `currentTabs`, so the vertical tab bar showed a different order than what was saved.

**Root cause**: The previous fix (execution 40) focused on re-creating closed tabs from cache but treated it as an additive operation — it never replaced the tab list. The `_saveCurrentInvestigationAs()` method captures `this._tabs.map(...)` as the source of truth, but `_restoreInvestigation()` didn't mirror that by setting `this._tabs` to only the investigation's tabs.

## 3. Plan
- Rewrite `_restoreInvestigation()` to build a **new** tab list (`newTabs`) from the investigation's `trailSymbols` in saved order
- For each `trailSymbol`: reuse the existing tab if found in `this._tabs`, otherwise re-create from cache
- After the loop, **replace** `this._tabs = newTabs` (instead of appending)
- Set `_activeTabId` to the first tab
- This naturally removes tabs not in the investigation and preserves the saved order

## 4. Changes Made

### `src/ui/CodeExplorerViewProvider.ts` — `_restoreInvestigation()` (lines 1058-1148)
**Before:**
```typescript
// Build a map of old trail tab IDs to new tab IDs (for tabs we re-create)
const idMap = new Map<string, string>();
let activatedTabId: string | null = null;

for (const ts of investigation.trailSymbols) {
  const existingTab = this._tabs.find((t) => t.id === ts.tabId);
  if (existingTab) {
    if (!activatedTabId) { activatedTabId = existingTab.id; }
    continue;  // ← just skips; doesn't add to any ordered list
  }
  // ... re-create from cache ...
  this._tabs.push(tab);  // ← appends to existing tabs; never removes others
}
if (activatedTabId) {
  this._activeTabId = activatedTabId;
  // ...
}
```

**After:**
```typescript
// Build the new tab list in the investigation's saved order.
// Re-use existing tabs when available; re-create from cache otherwise.
const newTabs: TabState[] = [];
const idMap = new Map<string, string>();

for (const ts of investigation.trailSymbols) {
  const existingTab = this._tabs.find((t) => t.id === ts.tabId);
  if (existingTab) {
    newTabs.push(existingTab);  // ← preserves order, adds to new list
    continue;
  }
  // ... re-create from cache ...
  newTabs.push(tab);  // ← adds to new list in order
}
if (newTabs.length > 0) {
  this._tabs = newTabs;  // ← REPLACES entire tab list
  this._activeTabId = newTabs[0].id;
  // ...
}
```

Key changes:
- Built `newTabs` array instead of mutating `this._tabs`
- Existing tabs are pushed into `newTabs` (preserving investigation order) instead of being skipped
- `this._tabs = newTabs` replaces the entire tab list — tabs not in the investigation are removed
- `_activeTabId` is set to `newTabs[0].id` — the first tab in investigation order
- Updated JSDoc to describe the new behavior

## 5. Commands Run
- `npm run build` → Success (extension.js 237.9kb, webview main.js 2.8mb, main.css 32.2kb)
- `npm run test:unit` → 291 passing (all pass)
- `npx eslint src/ui/CodeExplorerViewProvider.ts --quiet` → No errors

## 6. Result
The "Load Investigation" button now correctly:
1. **Replaces** the vertical tab list with exactly the investigation's saved tabs
2. **Preserves** the saved tab order from the investigation
3. **Removes** tabs that are not part of the investigation
4. **Re-creates** tabs from cache when the original tab was closed
5. **Activates** the first tab in the investigation

All 291 existing tests pass. No new tests were needed since the fix is a behavioral change in the same method.

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `src/ui/CodeExplorerViewProvider.ts` | Modified | Rewrote `_restoreInvestigation()` to replace the tab list with investigation tabs in saved order, removing non-investigation tabs |
| `docs/copilot-executions/41-fix-load-investigation-tab-replacement.md` | Created | Execution log |
