# 18 - Add Pan/Zoom to Dependency Graph and Focus on Current Symbol

**Date**: 2026-03-29 02:00 UTC
**Prompt**: "The graph is very large, not able to see. Modify so that the graph can be navigated by zooming, panning. Also, make sure that the graph is opened with current symbol focused and showing only neighbours zoomed in"

## 1. Code Reading & Analysis

| File | Why |
|------|-----|
| `src/extension.ts` (lines 442-478) | Read the SHOW_DEPENDENCY_GRAPH command handler — it called `buildGraph()` (full workspace), not `buildSubgraph()` |
| `src/graph/GraphBuilder.ts` (lines 206-250) | Confirmed `buildSubgraph()` exists and does 1-hop focused view — just wasn't being called by the command |
| `src/ui/CodeExplorerViewProvider.ts` (lines 72-92, 1088-1122) | Read `showDependencyGraph()` and the `_handleRequestDependencyGraph` / `_handleRequestSymbolGraph` message handlers |
| `webview/src/main.ts` (lines 1668-1732) | Read current graph rendering — static HTML dumped into scrollable div, no zoom/pan, no toolbar |
| `webview/src/styles/main.css` (lines 1479-1615) | Read current graph CSS — body was `overflow: auto` with no transform support |
| `src/models/types.ts` | Confirmed `showDependencyGraph` message shape and `requestDependencyGraph` message already existed |

## 2. Issues Identified

1. **`extension.ts` line 457**: Command called `graphBuilder.buildGraph()` (ALL nodes) instead of `buildSubgraph()` — this is why the graph was enormous and unusable.
2. **`webview/src/main.ts` line 1700**: Graph body was a simple `overflow: auto` div — no zoom/pan capability at all. Large Mermaid SVGs render at native size (can be thousands of pixels).
3. **No toolbar**: No zoom in/out/fit/reset controls.
4. **No auto-fit**: After rendering, the SVG was not scaled to fit the viewport.

## 3. Plan

1. **Change command to use `buildSubgraph()`**: Get current cursor word + filePath from the active editor, pass to `buildSubgraph()`. Fall back to `buildGraph()` only if subgraph is empty.
2. **Add pan/zoom to webview**: CSS transform-based zoom/pan on a container element. Mouse wheel for zoom, mouse drag for pan. No external library needed.
3. **Add toolbar**: Zoom in (+), Zoom out (−), Fit to view, Reset (1:1), zoom percentage label, and "Full graph" button for optionally expanding.
4. **Auto-fit on render**: After Mermaid renders the SVG, calculate scale to fit viewport and apply.
5. **Update CSS**: Change body from `overflow: auto` to `overflow: hidden` (pan/zoom handles it). Add toolbar styles. Add pan container with `transform-origin: 0 0`.

## 4. Changes Made

### `src/extension.ts` — Focus on current symbol
- Before: `const graph = await graphBuilder.buildGraph();` (all nodes)
- After: Gets current editor word + filePath → `graphBuilder.buildSubgraph(cursorWord, cursorFilePath)` → falls back to `buildGraph()` only if subgraph is empty (symbol not cached)
- Passes `centerId` to `toMermaid()` so the focused symbol gets the highlighted style

### `webview/src/main.ts` — Pan/zoom graph view
- Added 6 state variables: `_graphScale`, `_graphPanX`, `_graphPanY`, `_graphDragging`, `_graphLastX`, `_graphLastY`
- **`_renderGraphView()`**: Added toolbar row (zoom +/−/Fit/1:1, zoom label, "Full graph" button). Wrapped diagram in `graph-view__pan-container` div with CSS transform.
- **`_attachGraphListeners()`**:
  - Zoom buttons → `_graphZoom(delta)`
  - Fit button → `_graphFitToView()` (calculates scale from SVG dimensions vs viewport)
  - Reset button → scale=1, pan=0,0
  - Full graph button → `postMessage({ type: 'requestDependencyGraph' })`
  - Mouse wheel on viewport → zoom
  - Mouse drag on viewport → pan (mousedown/move/up/leave)
- **`_graphZoom(delta)`**: Clamps to 0.1–5x range
- **`_graphFitToView()`**: Measures SVG dimensions, calculates scale to fit viewport with padding
- **`_applyGraphTransform()`**: Sets `transform: translate(X, Y) scale(S)` on pan container, updates zoom label
- **`_renderGraphDiagram()`**: After mermaid render, calls `_graphFitToView()` after 100ms delay so SVG dimensions are available

### `webview/src/styles/main.css` — Pan/zoom container + toolbar
- `.graph-view__body`: Changed `overflow: auto; padding: 8px` → `overflow: hidden; position: relative; cursor: grab`
- `.graph-view__pan-container`: `transform-origin: 0 0`, `will-change: transform`, `display: inline-block`
- `.graph-view__diagram svg`: Removed `max-width: 100%; height: auto` (would fight with transforms)
- `.graph-view__toolbar`: flex row with gap, background, border
- `.graph-view__tool-btn`: 22px height buttons with border, hover state
- `.graph-view__zoom-label`: min-width 36px, centered
- `.graph-view__toolbar-spacer`: flex: 1 to push "Full graph" button to right

## 5. Commands Run

| Command | Result |
|---------|--------|
| `npm run lint` | ✅ 0 errors, 0 warnings |
| `npm run build` | ✅ extension.js 178.8kb, webview main.js 2.8mb, main.css 30.6kb |
| `npm run test:unit` | ✅ 150 tests passing (105ms) |

## 6. Result

The dependency graph now:

1. **Opens focused on the current symbol**: If your cursor is on `analyzeSymbol`, you see only `analyzeSymbol` + its direct callers, sub-functions, and dependencies (typically 5-15 nodes instead of 100+)
2. **Auto-fits on load**: The graph is scaled to fit the sidebar viewport, so you see the whole subgraph immediately without scrolling
3. **Supports zoom**: Mouse wheel to zoom in/out (0.1x–5x range), or use toolbar buttons (+/−/Fit/1:1)
4. **Supports pan**: Click and drag to pan the graph around
5. **Shows zoom level**: Toolbar displays current zoom percentage
6. **"Full graph" escape hatch**: Click "Full graph" button to load the entire workspace graph if you want the big picture
7. **Falls back gracefully**: If the cursor symbol isn't cached, falls back to the full workspace graph

## 7. Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| `src/extension.ts` | Modified | Changed graph command to use `buildSubgraph()` focused on current cursor symbol |
| `webview/src/main.ts` | Modified | Added pan/zoom controls, toolbar, auto-fit, mouse wheel zoom, drag panning |
| `webview/src/styles/main.css` | Modified | Added toolbar CSS, changed body to overflow:hidden with transform-based pan/zoom |
| `docs/copilot-executions/18-graph-pan-zoom-focus.md` | Created | This execution log |
