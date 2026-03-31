# 45 - Add Tab Position Numbers in Vertical Sidebar

**Date**: 2026-03-31 UTC
**Prompt**: "In the vertical sidebar tabs, show number like 1, 2, 3 at the start of each tab (representing tab position vertically, topmost being 1)."

## 1. Code Reading & Analysis
- Read `.context/FLOORPLAN.md` — identified `webview/src/main.ts` and `webview/src/styles/main.css` as the target files for webview tab rendering
- Read `webview/src/main.ts` — full file, identified tab rendering logic in the `filteredTabs.map()` call around lines 295–317. Each tab renders `tab__icon`, `tab__label`, `tab__status`, and `tab__close` spans inside a `.tab` div.
- Read `webview/src/styles/main.css` — full file, identified `.tab` layout (flexbox with `align-items: center`, `gap: 4px`) and existing child element styles (`.tab__icon`, `.tab__label`, `.tab__status`, `.tab__close`).
- Grepped for tab rendering patterns to locate relevant code sections.

## 2. Issues Identified
- No position numbers were shown on sidebar tabs — users had no visual indicator of tab ordering position.

## 3. Plan
- Add an `index` parameter to the `.map()` callback in the tab rendering code.
- Compute `position = index + 1` (1-based).
- Insert a `<span class="tab__position">${position}</span>` as the first child inside each `.tab` div (before the icon).
- Add CSS for `.tab__position` with subdued opacity, small font, fixed min-width for alignment, and `tabular-nums` for consistent digit widths.
- Add a `.tab--active .tab__position` rule for slightly brighter opacity on the active tab.

## 4. Changes Made

### `webview/src/main.ts` (line ~295–317)
- Changed `.map((tab) =>` to `.map((tab, index) =>` to capture the iteration index.
- Added `const position = index + 1;` to compute 1-based position.
- Inserted `<span class="tab__position">${position}</span>` as the first child inside the `.tab` div, before `tab__icon`.

### `webview/src/styles/main.css` (inserted before `.tab__icon` at line 213)
- Added `.tab__position` style: `font-size: 10px`, `min-width: 14px`, `text-align: center`, `opacity: 0.5`, `flex-shrink: 0`, `font-variant-numeric: tabular-nums`.
- Added `.tab--active .tab__position` style: `opacity: 0.8` for better visibility on the active tab.

## 5. Commands Run
- `npm run build` — ✅ Passed (extension 239.5kb, webview 2.8mb JS + 33.4kb CSS)
- `npm run lint` — ✅ Passed (no errors or warnings)

## 6. Result
- Each tab in the vertical sidebar now displays a position number (1, 2, 3, ...) at the start, before the kind icon.
- Numbers are subtly styled (small, semi-transparent) to avoid visual clutter.
- Active tab's position number is slightly brighter.
- Numbers use tabular-nums for consistent column alignment.
- Numbers update automatically when tabs are reordered (since they're based on render-time array index).

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `webview/src/main.ts` | Modified | Added `index` to `.map()` callback, inserted `tab__position` span with 1-based position number |
| `webview/src/styles/main.css` | Modified | Added `.tab__position` and `.tab--active .tab__position` styles |
