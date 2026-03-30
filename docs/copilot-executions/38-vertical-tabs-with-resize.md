# 38 - Vertical Tabs with Resizable Sidebar

**Date**: 2026-03-30 UTC
**Prompt**: "Currently the tabs in extension are horizontal, which makes it hard when multiple tabs are present. Change so that instead vertical tabs are shown (with scroll) whose width is adjustable. Also, the latest opened tab should be shown first (currently it shows last)."

## 1. Code Reading & Analysis
- Read `.context/FLOORPLAN.md` to understand the routing table
- Read `webview/src/main.ts` — the main webview renderer, specifically:
  - `render()` function (line 178) — composes `renderTabBar() + renderBreadcrumbBar() + renderContent(activeTab)`
  - `renderTabBar()` function (line 237) — renders horizontal `.tab-bar` with `.tab` items
  - `attachListeners()` function (line 1253) — tab click/close event handlers
- Read `webview/src/styles/main.css` — all styling, specifically:
  - `#root` (line 31) — `flex-direction: column` (vertical stack: tab bar on top, content below)
  - `.tab-bar` (line 121) — `display: flex; overflow-x: auto` (horizontal scrolling tabs)
  - `.tab` (line 138) — `white-space: nowrap; border-right: 1px solid` (horizontal tab items)
  - `.tab--active` (line 156) — `border-bottom: 2px solid` (active indicator on bottom)
  - `.tab__label` (line 167) — `max-width: 120px` (truncated label)
  - `.analysis-content` (line 299) — `flex: 1; overflow-y: auto`
- Read `src/ui/CodeExplorerViewProvider.ts` — extension-side tab state management (no changes needed there)

## 2. Issues Identified
- **Horizontal tabs don't scale**: With many tabs, the horizontal tab bar grows wide and requires horizontal scrolling, making it hard to find/manage tabs (file: `webview/src/styles/main.css`, line 121-136)
- **Newest tab appears last**: `renderTabBar()` renders tabs in array order (oldest first), so the most recently opened tab is at the bottom/end (file: `webview/src/main.ts`, line 238)
- **No width adjustment**: Tab bar width is fixed, no way for user to customize (file: `webview/src/styles/main.css`)

## 3. Plan
- **Layout change**: Switch `#root` from `flex-direction: column` to `flex-direction: row`, wrapping the tab bar + resize handle + content panel in a `.main-layout` container
- **Tab bar vertical**: Change `.tab-bar` from horizontal (`overflow-x: auto`) to vertical (`flex-direction: column; overflow-y: auto`) with `border-right` instead of `border-bottom`
- **Active indicator**: Move from `border-bottom` to `border-left` for vertical active tab indicator
- **Tab label**: Remove `max-width: 120px`, use `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` with `min-width: 0` for flex child text truncation
- **Resize handle**: Add a 4px-wide draggable resize handle between tab sidebar and content area, with visual feedback on hover/drag
- **Reverse order**: Use `[...currentTabs].reverse()` in `renderTabBar()` to show newest tabs first
- **Persist width**: Store `_tabSidebarWidth` in a module-level variable so it survives re-renders within a session
- **Content panel**: Wrap breadcrumb bar + content in a `.content-panel` div with `flex: 1` and column layout

## 4. Changes Made

### `webview/src/styles/main.css`

1. **`#root`** (line 31): Changed `flex-direction: column` → `flex-direction: row` and added `.main-layout`, `.content-panel`, `.tab-resize-handle` styles
2. **`.tab-bar`** (line 121): Rewritten from horizontal to vertical — `flex-direction: column`, `overflow-y: auto`, `width: var(--tab-sidebar-width, 140px)`, `min-width: 60px`, `max-width: 50%`, `height: 100%`, `border-right` instead of `border-bottom`
3. **`.tab`** (line 138): Changed `border-right` → `border-bottom`, added `flex-shrink: 0`, removed `white-space: nowrap` (moved to `.tab__label`)
4. **`.tab--active`** (line 156): Changed `border-bottom: 2px solid` → `border-left: 2px solid` for vertical active indicator
5. **`.tab__label`** (line 167): Removed `max-width: 120px`, added `white-space: nowrap; min-width: 0`
6. **`.tab__close`** (line 186): Added `flex-shrink: 0; margin-left: auto` to push close button to the right

### `webview/src/main.ts`

1. **`render()`** (line 199): Wrapped tab bar + resize handle + content in `<div class="main-layout">` with a `.content-panel` wrapper, added `_attachResizeHandle()` call
2. **`renderTabBar()`** (line 237): Changed from `currentTabs.map(...)` to `[...currentTabs].reverse().map(...)` so newest tab appears first
3. **Added `_attachResizeHandle()`** (new function): Implements drag-to-resize for the tab sidebar with mousedown/mousemove/mouseup handlers, min/max width constraints, and session-persistent width via `_tabSidebarWidth` variable

## 5. Commands Run
- `npm run build` — Succeeded (extension.js 232.4kb, webview main.js 2.8mb, main.css 31.5kb)
- `npm run lint` — 1 pre-existing error in `src/utils/logger.ts` (not from this change), webview/src/main.ts lints clean
- `npm run test:unit` — All 291 tests pass

## 6. Result
- Tab bar is now a vertical sidebar on the left with vertical scrolling
- Tab sidebar width is adjustable by dragging the resize handle (visual highlight on hover/drag)
- Width constraints: min 60px, max 50% of viewport
- Newest opened tab appears first in the list
- Active tab indicator is a left border accent instead of bottom border
- Close button is right-aligned within each tab
- Width persists across re-renders within the same session
- All existing functionality (breadcrumbs, navigation, analysis content) is preserved

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `webview/src/styles/main.css` | Modified | Changed layout from horizontal tabs to vertical sidebar with resize handle styles |
| `webview/src/main.ts` | Modified | Added layout wrapper, resize handle logic, reversed tab order (newest first) |
| `docs/copilot-executions/38-vertical-tabs-with-resize.md` | Created | Execution log |
