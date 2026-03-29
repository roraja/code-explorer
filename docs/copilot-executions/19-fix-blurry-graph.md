# 19 - Fix Blurry Dependency Graph with SVG viewBox Zoom

**Date**: 2026-03-29 03:00 UTC
**Prompt**: "The graph is very blurred"

## 1. Code Reading & Analysis

| File | Why |
|------|-----|
| `webview/src/main.ts` (lines 1668-1870) | Read the full graph zoom/pan implementation — CSS `transform: scale()` on a wrapper div was the root cause of blurriness |
| `webview/src/styles/main.css` (lines 1479-1600) | Read graph CSS — `graph-view__pan-container` with `transform-origin: 0 0` and `will-change: transform` confirmed CSS-based scaling |

## 2. Issues Identified

**Root cause**: The zoom was implemented using `CSS transform: scale()` on a wrapper `<div>` around the SVG. This tells the browser to:
1. Rasterize the SVG at its native pixel dimensions
2. Then scale those pixels up/down using bitmap interpolation

This produces blurry results because SVG is a **vector** format — it should be re-rendered at the target resolution, not bitmap-scaled.

The pan was also done via CSS `transform: translate()` on the same wrapper, which was correct but tied to the broken scale approach.

## 3. Plan

Replace CSS `transform: scale()` with **SVG `viewBox` manipulation**:
- **Zoom**: shrink/grow the `viewBox` width/height (smaller viewBox = zoom in, bigger = zoom out). The SVG renderer re-draws vectors at the correct resolution.
- **Pan**: shift the `viewBox` origin (x, y).
- **Size**: set the SVG `width`/`height` to fill the viewport container.

This gives pixel-perfect, crisp vector rendering at every zoom level.

## 4. Changes Made

### `webview/src/main.ts` — Complete rewrite of zoom/pan

**Added state**: `_graphSvgNativeW` and `_graphSvgNativeH` to capture the SVG's original (Mermaid-rendered) dimensions.

**Changed `_renderGraphView()`**: Renamed wrapper from `graph-view__pan-container` to `graph-view__svg-wrapper` (semantic — no CSS transform, just sizing).

**Changed `_attachGraphListeners()`**:
- Zoom buttons now use multiplicative factors (1.25x in, 0.8x out) instead of additive deltas — feels consistent at all zoom levels
- Pan now works in viewBox coordinates: `_graphPanX -= dx / _graphScale` — moving the mouse right shifts the viewBox origin left, making the content appear to move right. The division by scale ensures pan speed feels the same at all zoom levels.

**Replaced `_graphZoom(delta)`** with `_graphZoom(factor)` — multiplicative: `_graphScale *= factor`, clamped to 0.1–10x.

**Replaced `_graphFitToView()`**: Now uses captured native SVG dimensions (`_graphSvgNativeW/H`) instead of trying to read live SVG size (which would be wrong after transforms).

**Replaced `_applyGraphTransform()`** — the key change:
- Before: `container.style.transform = translate(...) scale(...)` → blurry bitmap scaling
- After: `svg.setAttribute('viewBox', ...)` → crisp vector re-rendering
  - `viewBox` width/height = native size / scale (zooming in = smaller viewBox = bigger content)
  - `viewBox` origin x/y = pan offset
  - SVG `width`/`height` attributes set to fill the viewport

**Changed `_renderGraphDiagram()`**: After Mermaid render, captures the SVG's native bounding box via `svg.getBBox()`, stores in `_graphSvgNativeW/H`, then calls `_graphFitToView()`.

### `webview/src/styles/main.css`

- Removed `.graph-view__pan-container` (no longer needed — no CSS transform)
- Added `.graph-view__svg-wrapper` — simple `width: 100%; height: 100%` container
- Changed `.graph-view__diagram` to `width: 100%; height: 100%`
- Removed `max-width: 100%; height: auto` from SVG (would fight with viewBox sizing)

## 5. Commands Run

| Command | Result |
|---------|--------|
| `npm run lint` | ✅ 0 errors, 0 warnings |
| `npm run build` | ✅ extension.js 178.3kb, webview main.js 2.8mb, main.css 30.5kb |
| `npm run test:unit` | ✅ 150 tests passing (88ms) |

## 6. Result

The graph is now **pixel-perfect crisp at every zoom level** because:
- Zoom manipulates the SVG `viewBox` → the browser re-renders vectors at the correct resolution
- No bitmap scaling involved at any point
- Pan moves the viewBox origin → smooth dragging with correct speed at all zoom levels
- Auto-fit on load calculates scale from the SVG's actual bounding box dimensions

## 7. Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| `webview/src/main.ts` | Modified | Replaced CSS transform zoom/pan with SVG viewBox manipulation for crisp rendering |
| `webview/src/styles/main.css` | Modified | Replaced pan-container CSS with simple svg-wrapper; removed bitmap-scaling styles |
| `docs/copilot-executions/19-fix-blurry-graph.md` | Created | This execution log |
