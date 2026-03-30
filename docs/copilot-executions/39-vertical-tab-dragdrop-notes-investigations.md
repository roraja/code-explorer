# 39 - Vertical Tab Drag-Drop, Notes, Investigation Sidebar

**Date**: 2026-03-30 UTC
**Prompt**: "The vertical tabs should allow dragging and dropping to re-order the tabs. Also allow adding custom notes to the analysis by having a button 'Edit notes'. Notes show at the top. Remove the horizontal investigation breadcrumbs. Instead the left vertical bar would be the breadcrumbs. Show investigation name at the top of vertical bar, if changed show star. Divide sidebar into two sections. Lower sections shows all investigation names, 'Save investigation as' and 'Save investigation button' appears at the top (next to investigation name)"

## 1. Code Reading & Analysis
- Read `webview/src/main.ts` — full webview renderer (1900+ lines)
  - `render()` (line 178) — composing layout
  - `renderTabBar()` (line 246) — horizontal tab rendering
  - `renderBreadcrumbBar()` (line 279) — breadcrumb trail with history back/forward
  - `_buildBreadcrumbTrail()` (line 309) — trail construction
  - `_renderPinnedInvestigations()` (line 325) — pinned investigation details panel
  - `renderAnalysis()` (line 774) — analysis content with enhance button
  - `attachListeners()` (line 1305) — event handlers for tabs, breadcrumbs, investigations
  - `_showPinInvestigationDialog()` (line 1565) — dialog for naming investigations
- Read `webview/src/styles/main.css` — all CSS
  - `.breadcrumb-bar`, `.breadcrumb-nav`, `.breadcrumb-item` (lines 1739-1846)
  - `.pinned-investigations-section`, `.pinned-investigation` (lines 1852-2212)
- Read `src/ui/CodeExplorerViewProvider.ts` — extension-side tab/investigation management
  - `_handleMessage()` (line 508) — message routing
  - `_recordNavigation()` (line 863) — navigation history
  - `_pinCurrentInvestigation()` (line 1000) — pin investigation logic
  - `_restoreInvestigation()` (line 1057) — restore investigation
  - `_getNavigationHistoryState()` (line 1087) — state builder for webview
- Read `src/models/types.ts` — type definitions
  - `TabState` (line 672) — tab state interface
  - `NavigationHistoryState` (line 638) — history state
  - `PinnedInvestigation` (line 622) — investigation type
  - `WebviewToExtensionMessage` (line 739) — message type union

## 2. Issues Identified
- **No drag-and-drop**: Tabs couldn't be reordered by the user
- **No per-tab notes**: No way to annotate symbols during investigation
- **Horizontal breadcrumbs wasted space**: The breadcrumb bar took horizontal space in the content area
- **Investigation management scattered**: Pin dialog, breadcrumb trail, and investigation list were spread across breadcrumb bar and collapsible details section
- **No "current investigation" concept**: There was no editable investigation name or save/dirty tracking

## 3. Plan
1. Add `draggable="true"` to tabs with HTML5 drag-and-drop event handlers
2. Add `notes?: string` field to `TabState`
3. Remove `renderBreadcrumbBar()`, `_buildBreadcrumbTrail()`, `_renderPinnedInvestigations()`
4. Redesign sidebar into 3 sections: investigation header (name + save buttons), tab list (draggable), saved investigations list
5. Add new message types: `reorderTabs`, `updateNotes`, `saveInvestigation`, `saveInvestigationAs`, `renameInvestigation`
6. Add extension-side handlers for all new messages
7. Track current investigation state (name, id, dirty flag) in `NavigationHistoryState`
8. Add Notes button in enhance bar, notes dialog, notes display at top of analysis
9. Remove all old breadcrumb/pinned investigation CSS, add new sidebar structure CSS

## 4. Changes Made

### `src/models/types.ts`
- Added `notes?: string` to `TabState`
- Added `currentInvestigationName`, `currentInvestigationId`, `currentInvestigationDirty` to `NavigationHistoryState`
- Added 5 new message types to `WebviewToExtensionMessage`: `reorderTabs`, `updateNotes`, `saveInvestigation`, `saveInvestigationAs`, `renameInvestigation`

### `src/ui/CodeExplorerViewProvider.ts`
- Added fields: `_currentInvestigationName`, `_currentInvestigationId`, `_currentInvestigationDirty`
- Added message handlers for all 5 new message types
- Added methods: `_reorderTabs()`, `_updateTabNotes()`, `_markInvestigationDirty()`, `_saveCurrentInvestigation()`, `_saveCurrentInvestigationAs()`, `_renameCurrentInvestigation()`
- Updated `_getNavigationHistoryState()` to include new investigation fields
- Updated `_recordNavigation()` to mark investigation dirty
- Updated `_restoreInvestigation()` to set current investigation context

### `webview/src/main.ts`
- Updated `Tab` interface with `notes?: string`
- Updated `NavigationHistoryState` interface with new investigation fields
- Removed `renderBreadcrumbBar()`, `_buildBreadcrumbTrail()`, `_renderPinnedInvestigations()` functions
- Rewrote `renderTabBar()` to produce 3-section sidebar: investigation header (name input + save/save-as buttons), draggable tab list, saved investigations list
- Updated `render()` to remove breadcrumb bar from content panel
- Added `_attachDragAndDrop()` function with full HTML5 drag/drop logic (dragstart, dragend, dragover, dragleave, drop) with visual drop indicators
- Added `_showNotesDialog()` — modal dialog for editing per-tab notes
- Added `_showSaveInvestigationAsDialog()` — dialog for naming saved investigations
- Replaced `_showPinInvestigationDialog()` with the new save-as dialog
- Added notes button in enhance bar
- Added user notes section at top of analysis content (before LLM badge)
- Updated `attachListeners()` — replaced breadcrumb/pin handlers with notes, investigation name, save, save-as, and saved investigation restore/remove handlers

### `webview/src/styles/main.css`
- Removed all breadcrumb CSS (`.breadcrumb-bar`, `.breadcrumb-nav`, `.breadcrumb-item`, `.breadcrumb-separator`)
- Removed all pinned investigation CSS (`.pinned-investigations-section`, `.pinned-investigation`, etc.)
- Added drag-and-drop visual indicators (`.tab--dragging`, `.tab--drop-above`, `.tab--drop-below`)
- Added investigation header styles (`.inv-header`, `.inv-header__name-input`, `.inv-header__dirty`, `.inv-header__btn`)
- Added tab bar internal structure (`.tab-bar__divider`, `.tab-bar__tabs`, `.tab-bar__section-label`, `.tab-bar__investigations`)
- Added saved investigation list styles (`.saved-inv`, `.saved-inv__name`, `.saved-inv__restore`, `.saved-inv__remove`)
- Added user notes styles (`.user-notes`, `.user-notes__label`, `.user-notes__content`)
- Added notes button style (`.notes-btn`)
- Changed `.tab-bar` overflow from `overflow-y: auto` to `overflow: hidden` (scroll is now on `.tab-bar__tabs` inner container)

## 5. Commands Run
- `npm run build` — Succeeded (extension.js 237.2kb, webview main.js 2.8mb, main.css 32.2kb)
- `npx eslint webview/src/main.ts src/ui/CodeExplorerViewProvider.ts src/models/types.ts` — Clean, no errors
- `npm run test:unit` — All 291 tests pass

## 6. Result
- Tabs in the vertical sidebar can now be reordered via drag-and-drop with visual drop indicators
- Users can add/edit per-tab notes via a "Notes" button in the enhance bar; notes appear at top of analysis
- Horizontal breadcrumb bar is removed; the vertical tab sidebar serves as the investigation trail
- Investigation name is shown and editable at the top of the sidebar, with a dirty indicator (*) when unsaved
- Save and Save-As buttons allow persisting the current investigation
- Lower section of sidebar shows all saved investigations with restore/delete buttons
- All 291 existing tests pass

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `src/models/types.ts` | Modified | Added notes field, investigation tracking, 5 new message types |
| `src/ui/CodeExplorerViewProvider.ts` | Modified | Added investigation management, tab reorder, notes handlers |
| `webview/src/main.ts` | Modified | Rewrote sidebar, added drag-drop, notes UI, removed breadcrumbs |
| `webview/src/styles/main.css` | Modified | Replaced breadcrumb/pin CSS with new sidebar structure CSS |
| `docs/copilot-executions/39-vertical-tab-dragdrop-notes-investigations.md` | Created | Execution log |
