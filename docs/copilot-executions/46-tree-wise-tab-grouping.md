# 46 - Tree-wise Tab Grouping

**Date**: 2026-03-31 UTC
**Prompt**: Support tree-wise grouping of vertical tabs. Allow user to select multiple tabs and group them into a named group. Groups can be nested into another groups. This config is saved as investigation which can be restored. Allow dragging dropping tabs into and out of the groups.

## 1. Code Reading & Analysis
- Read `.context/FLOORPLAN.md` — routing table for all modules
- Read `src/models/types.ts` — all type definitions (TabState, ExplorerState, message types, PinnedInvestigation, NavigationHistoryState)
- Read `src/ui/CodeExplorerViewProvider.ts` — full file (1400+ lines): tab management, message routing, investigation save/restore, reorder, session persistence
- Read `src/ui/TabSessionStore.ts` — session file format, save/load/clear
- Read `webview/src/main.ts` — full file (2000+ lines): renderTabBar(), _attachDragAndDrop(), attachListeners(), dialog functions, state management
- Read `webview/src/styles/main.css` — tab styles, drag-drop indicators, investigation styles
- Read `src/models/constants.ts` — extension constants
- Read `src/extension.ts` — entry point (no changes needed)

## 2. Issues Identified
- No tree grouping mechanism existed — tabs were a flat list
- No multi-select support — users could only interact with one tab at a time
- Drag-and-drop only supported reordering within the flat list
- Investigations (save/restore) only saved flat tab order, no grouping structure

## 3. Plan
- Add `TabGroup` and `TabTreeNode` types to `types.ts` for the tree structure
- Add group-related message types for webview ↔ extension communication
- Update `PinnedInvestigation` to optionally store `tabGroups`
- Add `_tabGroups` state to `CodeExplorerViewProvider` with full CRUD methods
- Add group tree helpers: find, remove, extract, remap, count
- Update `TabSessionStore` to persist/restore groups
- Update `_pushState` to include groups in the message
- Rewrite `renderTabBar()` to render grouped tree + ungrouped tabs
- Add multi-select with Ctrl/Cmd+click and checkbox UI
- Rewrite `_attachDragAndDrop()` to support:
  - Tab → Tab (reorder, same as before)
  - Tab → Group header (drop into group)
  - Tab → Group children area (drop into group)
  - Group → Group (nesting via middle-third drop zone)
  - Group → Tab (move group to root level)
- Add dialog functions for create group and rename group
- Add CSS for groups, multi-select, drop indicators

## 4. Changes Made

### `src/models/types.ts`
- Added `TabTreeNode` union type (`tab` | `group`)
- Added `TabGroup` interface with id, name, children, collapsed
- Updated `ExplorerState` section (added after it)
- Updated `ExtensionToWebviewMessage` setState to include `tabGroups?: TabGroup[]`
- Added 7 new `WebviewToExtensionMessage` variants: createGroup, renameGroup, deleteGroup, toggleGroupCollapse, moveToGroup, moveGroupToGroup, ungroupTabs
- Updated `PinnedInvestigation` to include optional `tabGroups?: TabGroup[]`

### `src/ui/TabSessionStore.ts`
- Added `TabGroup` to imports
- Added `tabGroups?: TabGroup[]` to `TabSession` interface
- Updated `save()` method signature to accept `tabGroups` parameter

### `src/ui/CodeExplorerViewProvider.ts`
- Added `TabGroup`, `TabTreeNode` to imports
- Added `_tabGroups: TabGroup[]` and `_groupCounter` fields
- Updated `_pushState()` to include `tabGroups` in the message
- Updated `_persistSession()` to pass `_tabGroups` to session store
- Updated `tabClosed` handler to call `_removeTabFromGroups()`
- Updated `_restoreTabsAsync()` to restore groups with remapped IDs
- Added 7 new message handler cases (createGroup, renameGroup, deleteGroup, toggleGroupCollapse, moveToGroup, moveGroupToGroup, ungroupTabs)
- Updated `_saveCurrentInvestigation()` to deep-copy `_tabGroups` into investigation
- Updated `_saveCurrentInvestigationAs()` to deep-copy `_tabGroups` into investigation
- Updated `_restoreInvestigation()` to restore `tabGroups` from investigation
- Added group management methods: `_createGroup`, `_renameGroup`, `_deleteGroup`, `_toggleGroupCollapse`, `_moveTabsToGroup`, `_moveGroupToGroup`, `_ungroupTabs`
- Added tree helpers: `_findGroupById`, `_removeTabFromAllGroups`, `_removeGroupFromTree`, `_removeGroupFromTreeInChildren`, `_extractGroupFromTree`, `_isDescendantGroup`, `_cleanupEmptyGroups`, `_removeTabFromGroups`, `_remapGroupTabIds`, `_countGroups`

### `webview/src/main.ts`
- Added `TabTreeNode` and `TabGroup` interfaces
- Added state variables: `_tabGroups`, `_selectedTabIds` (Set), `_draggedGroupId`
- Moved `_draggedTabId` to the state variables section (removed duplicate)
- Updated `setState` handler to capture `tabGroups`
- Updated `vscode.setState()` and `vscode.getState()` to include `tabGroups`
- Rewrote `renderTabBar()` to render tree structure:
  - Groups rendered first with `_renderGroup()` (recursive for nesting)
  - Ungrouped tabs rendered after groups
  - Added "Group" action bar button
- Added helper functions: `_renderTabItem`, `_renderGroup`, `_collectGroupedTabIds`, `_countTabsInGroup`, `_countVisibleTabsInGroups`, `_tabMatchesFilter`
- Rewrote `_attachDragAndDrop()` with full support for:
  - Tab ↔ tab reordering
  - Tab → group header (3-zone: above/into/below)
  - Tab → group children area
  - Group → group (nesting)
  - Group → tab (move to root)
- Updated `attachListeners()`:
  - Tab click now supports Ctrl/Cmd+click multi-select
  - Added `.tab__select` click handler
  - Added group chevron toggle handler
  - Added group rename handler
  - Added group delete handler
  - Added create-group button handler
- Added `_showCreateGroupDialog()` function
- Added `_showRenameGroupDialog()` function
- Added `_findGroupName()` helper

### `webview/src/styles/main.css`
- Added `.tab--selected` multi-select highlight style
- Added `.tab__select` checkbox element styles (hidden until hover/selected)
- Added `.tab-group` container styles
- Added `.tab-group__header` styles (draggable, with chevron/name/count/actions)
- Added `.tab-group__chevron` expand/collapse toggle
- Added `.tab-group__name` truncation
- Added `.tab-group__count` badge
- Added `.tab-group__rename` and `.tab-group__delete` action buttons (visible on hover)
- Added `.tab-group--drop-into`, `.tab-group--drop-above`, `.tab-group--drop-below` drop indicators
- Added `.tab-group-actions` bar with create group button
- Added `.tab-group-actions__btn` and disabled state

## 5. Commands Run

| Command | Result |
|---------|--------|
| `npm run build` | Pass — extension.js 244.8kb, webview main.js 2.8mb, main.css 36.3kb |
| `npm run lint` | 2 errors (prefer-const) — fixed |
| `npm run lint` (2nd) | Pass — 0 errors |
| `npm run test:unit` | Pass — 291 tests passing |
| `npm run build` (final) | Pass — clean build |

## 6. Result
Successfully implemented tree-wise tab grouping with the following capabilities:
- **Multi-select**: Ctrl/Cmd+click tabs or click the checkbox to select multiple tabs
- **Create group**: Select tabs, click "Group (N)" button, enter a name
- **Nested groups**: Drag a group onto another group's middle zone to nest it
- **Drag into group**: Drag a tab (or multi-selected tabs) onto a group header's middle zone
- **Drag out of group**: Drag a tab onto an ungrouped area to ungroup it
- **Collapse/expand**: Click the chevron to toggle group visibility
- **Rename**: Click the pencil icon on a group header
- **Delete group**: Click the × icon (children are promoted to parent level)
- **Persistence**: Groups are saved in tab sessions and survive reloads
- **Investigation save/restore**: Groups are saved with investigations and restored when loaded

No remaining issues. All 291 existing tests pass.

## 7. Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| `src/models/types.ts` | Modified | Added TabGroup, TabTreeNode types; new message types; updated PinnedInvestigation |
| `src/ui/TabSessionStore.ts` | Modified | Added tabGroups to session format and save method |
| `src/ui/CodeExplorerViewProvider.ts` | Modified | Added group CRUD, tree helpers, message handlers, session/investigation persistence |
| `webview/src/main.ts` | Modified | Tree rendering, multi-select, group drag-drop, create/rename dialogs |
| `webview/src/styles/main.css` | Modified | Group styles, multi-select highlight, drop indicators, action bar |
| `docs/copilot-executions/46-tree-wise-tab-grouping.md` | Created | This execution log |
