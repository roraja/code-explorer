# 44 - Add Tab Search Filter Box

**Date**: 2026-03-31 00:30 UTC
**Prompt**: On the left vertical tabs side bar, below the investigation name panel, add a search box where if I type text, it filters the list based on search (case insensitive)

## 1. Code Reading & Analysis
- Read `webview/src/main.ts` — full rendering pipeline, `renderTabBar()` function (lines 252-323), `attachListeners()` (lines 1398-1572)
- Read `webview/src/styles/main.css` — existing styles for investigation header (`.inv-header`), tab bar (`.tab-bar`), dividers (`.tab-bar__divider`)
- Identified that `renderTabBar()` generates the left sidebar with: investigation header → divider → tab list → divider → saved investigations
- Identified that `currentTabs` is the in-memory tab array and `attachListeners()` wires up event handlers

## 2. Issues Identified
- No search/filter capability existed in the tab sidebar
- Users with many open tabs had no way to quickly find a specific tab

## 3. Plan
- Add a `_tabSearchFilter` global variable to track the current search text
- Insert a search input box in `renderTabBar()` between the investigation header and the tab list divider
- Filter `currentTabs` using case-insensitive matching on symbol name, kind, file path, and scope chain
- Add `input` event listener on the search input that updates `_tabSearchFilter` and re-renders
- Re-focus the search input after re-render to maintain typing experience
- Add CSS styles matching the VS Code theme variables

## 4. Changes Made

### `webview/src/main.ts`
1. Added `_tabSearchFilter` global variable (line ~84)
2. In `renderTabBar()`: Added search box HTML template with `<input>` element (id=`tab-search-input`)
3. In `renderTabBar()`: Added filtering logic — filters `currentTabs` by case-insensitive match on `name`, `kind`, `filePath`, `scopeChain`
4. In `renderTabBar()`: Inserted `${searchBox}` between `${invHeader}` and the first divider
5. In `attachListeners()`: Added `input` event listener on `#tab-search-input` that updates `_tabSearchFilter`, re-renders, then re-focuses the input with cursor at end

### `webview/src/styles/main.css`
1. Added `.tab-search` container (padding, flex-shrink)
2. Added `.tab-search__input` (VS Code theme-aware background, border, color, font, border-radius)
3. Added `.tab-search__input::placeholder` (themed placeholder color)
4. Added `.tab-search__input:focus` (focus border color)

## 5. Commands Run
- `npm run build` — success (dist/extension.js 239.5kb, webview/dist/main.js 2.8mb)
- `npm run lint` — 1 pre-existing error in `src/utils/logger.ts` (not from changes)
- `npm run test:unit` — 291 passing

## 6. Result
- Search box appears below the investigation name panel and above the tab list
- Typing filters tabs in real-time (case-insensitive)
- Matches against: symbol name, symbol kind, file path, scope chain
- Search input maintains focus during filtering (cursor stays at end)
- Empty search shows all tabs
- Styled consistently with VS Code theme variables

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `webview/src/main.ts` | Modified | Added tab search filter: global state, search box HTML, filter logic, event listener |
| `webview/src/styles/main.css` | Modified | Added CSS styles for `.tab-search` and `.tab-search__input` |
