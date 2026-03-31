# 42 - Fix Investigation Restore Tab Order

**Date**: 2026-03-31 UTC
**Prompt**: "The restore investigation is working but the order seems to be incorrect once restored (probably reversed)"

## 1. Code Reading & Analysis
- `webview/src/main.ts` (line 269): `renderTabBar()` was using `[...currentTabs].reverse()` to render tabs "newest first" — this meant internal storage order was the reverse of visual display order
- `webview/src/main.ts` (lines 1366-1389): Drag-and-drop computed display order by reversing `currentTabs`, did the reorder, then reversed back to "storage order" before sending to extension
- `src/ui/CodeExplorerViewProvider.ts` (lines 197, 274): `openTab()` and `openTabFromCursor()` both used `this._tabs.push(tab)` — appending newest tabs at the end (last in array = newest = displayed at top after reverse)
- `src/ui/CodeExplorerViewProvider.ts` (lines 1241-1247): `_saveCurrentInvestigationAs()` stored `this._tabs.map(...)` — capturing internal (reversed-from-visual) order
- `src/ui/CodeExplorerViewProvider.ts` (lines 1064-1147): `_restoreInvestigation()` rebuilt tabs from `trailSymbols` in saved (internal) order — then webview reversed for display

## 2. Issues Identified
1. **Storage order ≠ display order causing confusion** (`webview/src/main.ts:269`, `src/ui/CodeExplorerViewProvider.ts:197`): The system maintained an implicit "storage order" (oldest first) that was the reverse of "display order" (newest first). The `.reverse()` in `renderTabBar()` bridged between them. This meant:
   - Investigations saved internal order (oldest→newest)
   - Restoring rebuilt internal order (oldest→newest)
   - Display reversed to visual order (newest→oldest)
   
   While logically correct as a round-trip, this indirection made the investigation's `trailSymbols` order non-intuitive — the first symbol in the saved list appeared at the bottom of the visual tab bar. This caused the user to perceive the restored order as "reversed" because the investigation data's natural reading order (first item = first) didn't match the visual order (first item = bottom).

2. **Drag-and-drop had double-reverse logic** (`webview/src/main.ts:1368-1389`): The drop handler had to reverse `currentTabs` to get display order, do the reorder, then reverse back to storage order — adding unnecessary complexity and another potential source of ordering bugs.

## 3. Plan
Eliminate the storage↔display order mismatch by making storage order = display order:
1. Change `this._tabs.push(tab)` → `this._tabs.unshift(tab)` for new tabs, so newest tabs are first in the array (matching display)
2. Remove `.reverse()` from `renderTabBar()` — render `currentTabs` directly since it's now in display order
3. Simplify drag-and-drop — work directly with `currentTabs` order, no reverse needed
4. All other code (session persist/restore, investigation save/restore, `_reorderTabs`) operates on `this._tabs` directly and needs no changes since storage order now equals display order

## 4. Changes Made

### `src/ui/CodeExplorerViewProvider.ts` — `openTab()` (line 197)
**Before:** `this._tabs.push(tab);`
**After:** `this._tabs.unshift(tab);`

### `src/ui/CodeExplorerViewProvider.ts` — `openTabFromCursor()` (line 274)
**Before:** `this._tabs.push(tab);`
**After:** `this._tabs.unshift(tab);`

### `webview/src/main.ts` — `renderTabBar()` (line 269)
**Before:**
```typescript
// Tab list (newest first, draggable)
const tabs = [...currentTabs]
    .reverse()
    .map((tab) => {
```
**After:**
```typescript
// Tab list (draggable, in display order — newest first)
const tabs = currentTabs
    .map((tab) => {
```

### `webview/src/main.ts` — drag-and-drop handler (lines 1366-1389)
**Before:**
```typescript
// Compute new order: the tabs in the sidebar are rendered in reverse order,
// so we need to work with the display order (reversed), then reverse back.
const displayOrder = [...currentTabs].reverse().map((t) => t.id);
// ... reorder logic ...
const newOrder = [...displayOrder].reverse();
vscode.postMessage({ type: 'reorderTabs', tabIds: newOrder });
```
**After:**
```typescript
// Compute new order: tabs are now stored and displayed in the same order
// (display order = storage order), so we work directly with tab IDs.
const tabOrder = currentTabs.map((t) => t.id);
// ... reorder logic ...
vscode.postMessage({ type: 'reorderTabs', tabIds: tabOrder });
```

### No changes needed to:
- `_restoreInvestigation()` — iterates `trailSymbols` in saved order, which now IS display order
- `_saveCurrentInvestigation()` / `_saveCurrentInvestigationAs()` — saves `this._tabs` which is now display order
- `_reorderTabs()` — receives and applies tab IDs in the same order
- `_restoreTabsAsync()` — session restore uses `push` to maintain persisted order (which is now display order)
- `_persistSession()` — persists `this._tabs` order directly

## 5. Commands Run
- `npm run build` → Success (extension.js 237.9kb, webview main.js 2.8mb, main.css 32.2kb)
- `npm run test:unit` → 291 passing (all pass)
- `npx eslint src/ui/CodeExplorerViewProvider.ts webview/src/main.ts --quiet` → No errors

## 6. Result
The tab ordering system is now straightforward:
- **Storage order = display order** — `this._tabs[0]` is the tab at the top of the visual list
- New tabs are prepended (`unshift`) so they appear at the top
- No `.reverse()` anywhere — what you see is what's stored
- Investigation save/restore preserves exact visual order with no reversal confusion
- Drag-and-drop operates directly on tab order without double-reverse

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `src/ui/CodeExplorerViewProvider.ts` | Modified | Changed `push` → `unshift` for new tabs so newest appears first in array |
| `webview/src/main.ts` | Modified | Removed `.reverse()` from tab rendering; simplified drag-and-drop order logic |
| `docs/copilot-executions/42-fix-investigation-restore-tab-order.md` | Created | Execution log |
