# 18 - Exploration History & Breadcrumb Trail

**Date**: 2026-03-29 UTC
**Prompt**: Implement 5. Exploration History & Breadcrumb Trail of docs/next/03-ten-improvement-ideas.md

## 1. Code Reading & Analysis
- Read `docs/next/03-ten-improvement-ideas.md` — full spec for feature #5 (lines 85-100)
- Read `.context/FLOORPLAN.md` — routing table for modules
- Read `src/ui/CodeExplorerViewProvider.ts` — full file, the primary target for navigation history tracking
- Read `src/models/types.ts` — type definitions, message passing interfaces
- Read `webview/src/main.ts` — full file (~1257 lines), the webview renderer
- Read `webview/src/styles/main.css` — full CSS file (~1460+ lines)
- Read `src/ui/TabSessionStore.ts` — session persistence for tabs
- Read `src/extension.ts` — command registration, DI wiring
- Read `src/models/constants.ts` — configuration keys
- Read `test/unit/ui/TabSessionStore.test.ts` — test patterns

## 2. Issues Identified
- **No navigation tracking**: `openTab()` and `openTabFromCursor()` had no mechanism to record which tab the user came from
- **No back/forward**: No message types for history-back/forward existed
- **No breadcrumb state**: The `setState` message to the webview didn't include any navigation context
- **No pinned investigations**: No concept of named trails existed
- **Tab clicks not tracked**: `tabClicked` handler just set `_activeTabId` without recording navigation
- **Symbol-link navigations not distinguished**: `_exploreSymbolByName` called `openTab()` without indicating the trigger was a symbol-link

## 3. Plan
- Add new types: `NavigationEntry`, `PinnedInvestigation`, `NavigationHistoryState`, `NavigationTrigger`
- Add new message types: `historyBack`, `historyForward`, `pinInvestigation`, `unpinInvestigation`, `restoreInvestigation`
- Add navigation history stack to `CodeExplorerViewProvider` with `_recordNavigation()`, `_navigateHistoryBack()`, `_navigateHistoryForward()`
- Add breadcrumb trail rendering in the webview between tab bar and content
- Add CSS for breadcrumb bar, navigation buttons, pinned investigations
- Persist navigation history in `TabSessionStore`
- Add unit tests for persistence round-trip

## 4. Changes Made

### `src/models/types.ts`
- Added `NavigationTrigger` type (11 trigger values: explore-command, symbol-link, sub-function, caller, relationship, type-link, breadcrumb, history-back, history-forward, tab-click, session-restore)
- Added `NavigationEntry` interface (fromTabId, toTabId, trigger, timestamp, symbolName, symbolKind)
- Added `PinnedInvestigation` interface (id, name, trail, trailSymbols, pinnedAt)
- Added `NavigationHistoryState` interface (entries, currentIndex, pinnedInvestigations)
- Updated `ExtensionToWebviewMessage` to include optional `navigationHistory` field
- Added 5 new message types to `WebviewToExtensionMessage`: historyBack, historyForward, pinInvestigation, unpinInvestigation, restoreInvestigation

### `src/ui/CodeExplorerViewProvider.ts`
- Added 6 new private fields: `_navigationHistory`, `_navigationIndex`, `_isHistoryNavigation`, `_pinnedInvestigations`, `_investigationCounter`
- Updated `openTab()` to accept `trigger` parameter and record navigation via `_recordNavigation()`
- Updated `openTabFromCursor()` to record navigation
- Updated `_pushState()` to include `_getNavigationHistoryState()` in the message
- Updated `_handleMessage()` to handle tabClicked with navigation recording, tabClosed with history cleanup, and 5 new message types
- Updated `_exploreSymbolByName()` to pass `'symbol-link'` trigger to `openTab()`
- Added `_recordNavigation()` — pushes entries, truncates forward history on branch, caps at 100 entries
- Added `_navigateHistoryBack()` — walks back, skips closed tabs
- Added `_navigateHistoryForward()` — walks forward, skips closed tabs
- Added `_cleanupNavigationHistory()` — stub for closed tab cleanup (skipping is lazy)
- Added `_pinCurrentInvestigation()` — builds trail from history, creates PinnedInvestigation
- Added `_unpinInvestigation()` — removes by ID
- Added `_restoreInvestigation()` — activates first existing tab in trail
- Added `_getNavigationHistoryState()` — builds state for webview
- Added `getBreadcrumbTrail()` — public method for building trail
- Updated `_restoreTabsAsync()` to restore navigation history and pinned investigations with ID mapping
- Updated `_persistSession()` to pass navigation history and investigations to TabSessionStore

### `src/ui/TabSessionStore.ts`
- Added imports for `NavigationEntry`, `PinnedInvestigation`
- Added `navigationHistory`, `navigationIndex`, `pinnedInvestigations` fields to `TabSession` interface (all optional for backward compatibility)
- Updated `save()` method signature to accept navigation history and investigations

### `webview/src/main.ts`
- Added `NavigationEntry`, `PinnedInvestigation`, `NavigationHistoryState` interfaces (webview-local copies)
- Added `currentNavHistory` state variable
- Updated `setState` message handler to capture navigation history
- Updated `vscode.setState()` / `vscode.getState()` to include navigation history
- Updated `render()` to call `renderBreadcrumbBar()` between tab bar and content
- Added `renderBreadcrumbBar()` — renders back/forward buttons, breadcrumb trail, pin button, and pinned investigations
- Added `_buildBreadcrumbTrail()` — deduplicates navigation entries into a trail
- Added `_renderPinnedInvestigations()` — renders collapsible list of pinned investigations
- Added `_showPinInvestigationDialog()` — modal dialog for naming an investigation
- Added event listeners for: history-back, history-forward, breadcrumb-item click, pin-investigation, restore/remove investigation buttons

### `webview/src/styles/main.css`
- Added `.breadcrumb-bar` — container with border and background
- Added `.breadcrumb-nav` — flex row for buttons and trail
- Added `.breadcrumb-nav__btn` — styled navigation buttons with hover/disabled states
- Added `.breadcrumb-nav__pin` — pin button aligned right
- Added `.breadcrumb-trail` — horizontally scrollable trail container
- Added `.breadcrumb-item` — clickable crumb with icon and name, active highlight
- Added `.breadcrumb-separator` — `›` separator between crumbs
- Added `.pinned-investigations-section` — collapsible details element
- Added `.pinned-investigations__toggle` — summary with arrow indicator
- Added `.pinned-investigation` — card with name, time, restore/remove buttons, trail preview

### `test/unit/ui/NavigationHistory.test.ts` (new file)
- 8 test cases covering navigation history persistence round-trip, pinned investigations, backward compatibility, trigger types, timestamps

## 5. Commands Run
- `npm run build` — PASS (extension: 174.3kb, webview: 2.7mb + 29.2kb CSS)
- `npm run test:unit` — PASS (150 tests, 86ms)
- `npm run lint` — PASS (no errors)

## 6. Result
Feature #5 (Exploration History & Breadcrumb Trail) is fully implemented:

1. **Navigation History Stack**: Every tab navigation is recorded with source, destination, trigger type, and timestamp. Back/forward navigation works like a browser, with proper handling of closed tabs and branching.
2. **Breadcrumb Trail**: Rendered as a horizontal bar between the tab bar and content, showing the exploration path with symbol icons and clickable crumb items.
3. **Back/Forward Navigation**: Arrow buttons with disabled states, navigating through history without re-analyzing.
4. **Pin Investigation**: Users can name and save a trail (e.g., "Tracing the cache miss bug") as a persistent bookmark.
5. **Pinned Investigations List**: Collapsible section showing saved investigations with restore and remove actions.
6. **Session Persistence**: Navigation history, current index, and pinned investigations survive window reloads via TabSessionStore.
7. **Backward Compatible**: Old session files without navigation history load without errors.

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `src/models/types.ts` | Modified | Added NavigationEntry, PinnedInvestigation, NavigationHistoryState types and new message types |
| `src/ui/CodeExplorerViewProvider.ts` | Modified | Added navigation history tracking, back/forward, pin investigations, breadcrumb state |
| `src/ui/TabSessionStore.ts` | Modified | Added navigation history and investigations persistence |
| `webview/src/main.ts` | Modified | Added breadcrumb bar rendering, pin dialog, history event handlers |
| `webview/src/styles/main.css` | Modified | Added breadcrumb bar, navigation buttons, pinned investigations CSS |
| `test/unit/ui/NavigationHistory.test.ts` | Created | 8 unit tests for navigation history persistence |
