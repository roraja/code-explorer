# 19 - Keep Existing Content Visible During Enhancement

**Date**: 2026-03-29 UTC
**Prompt**: "When enhancing an analysis, don't hide the existing content. Show loading icon next to enhancing command only, keep the current content intact"

## 1. Code Reading & Analysis
- Read `.context/FLOORPLAN.md` — understood the enhance flow architecture
- Searched for "enhance" across all `.ts` files — found 6 files involved
- Read `src/ui/CodeExplorerViewProvider.ts` — found `_handleEnhanceAnalysis()` at line 654 sets `tab.status = 'loading'`
- Read `webview/src/main.ts` — found `renderContent()` at line 310 replaces ALL content with a loading spinner when `tab.status === 'loading'`
- Read `src/models/types.ts` — found `TabState` interface at line 666, `LoadingStage` type at line 646
- Read `webview/src/styles/main.css` — found enhance button styles at line 1215, loading-state spinner at line 229

## 2. Issues Identified
- **`src/ui/CodeExplorerViewProvider.ts`, line 661-663**: `_handleEnhanceAnalysis` sets `tab.status = 'loading'` and `tab.loadingStage = 'llm-analyzing'`. This reuses the same loading state used for initial analysis.
- **`webview/src/main.ts`, line 311-319**: `renderContent()` checks `tab.status === 'loading'` and returns ONLY a loading spinner, completely replacing the existing analysis content. This is correct for initial loading but wrong for enhancement — the user loses sight of all their analysis while the enhancement runs.
- **Root cause**: No distinction between "loading for the first time" and "enhancing existing content". Both paths used the same `status = 'loading'` mechanism.

## 3. Plan
- Add an `enhancing?: boolean` flag to `TabState` (both in extension types and webview interface)
- During enhancement, keep `tab.status = 'ready'` and set `tab.enhancing = true` instead
- Since status remains `'ready'`, `renderContent()` continues to render the full analysis
- Modify the Enhance button rendering in `renderAnalysis()` to show a spinner when `tab.enhancing` is true
- Add CSS for the enhancing button state (inline spinner, disabled appearance)
- Alternative considered: adding `'enhancing'` as a new status value — rejected because it would require changes in many places that check status (persistence, session restore, tab bar rendering, etc.)

## 4. Changes Made

### `src/models/types.ts` (line 674)
- **Added**: `enhancing?: boolean` field to `TabState` interface
- **Why**: Allows the webview to distinguish between initial loading and enhancement-in-progress

### `src/ui/CodeExplorerViewProvider.ts` (`_handleEnhanceAnalysis` method, line 654)
- **Before**: Set `tab.status = 'loading'` and `tab.loadingStage = 'llm-analyzing'`, then reset to `'ready'` on completion
- **After**: Set `tab.enhancing = true` (status stays `'ready'`), then set `tab.enhancing = false` on completion
- **Why**: Keeps the tab in 'ready' status so the webview continues to render existing analysis content

### `webview/src/main.ts` (Tab interface, line 21)
- **Added**: `enhancing?: boolean` field to local `Tab` interface
- **Why**: Webview needs to know about the enhancing state to adjust button rendering

### `webview/src/main.ts` (Enhance button in `renderAnalysis`, ~line 779)
- **Before**: Always rendered the same `✨ Enhance` button
- **After**: When `tab.enhancing` is true, renders a disabled button with a spinner and "Enhancing…" label. Otherwise renders the normal `✨ Enhance` button.
- **Why**: Provides visual feedback that enhancement is in progress without hiding content

### `webview/src/styles/main.css` (after `.enhance-bar__label`, line 1245)
- **Added**: `.enhance-bar__button--enhancing` styles (reduced opacity, default cursor, no hover effect change)
- **Added**: `.enhance-bar__spinner` styles (12px inline spinner using the same spin animation as the loading state)
- **Why**: Visual styling for the enhancing state button

## 5. Commands Run
- `npm run build` — ✅ Pass (extension 178.4kb, webview 2.7mb)
- `npm run lint` — ✅ Pass (no errors)
- `npm run test:unit` — ✅ Pass (150 passing)

## 6. Result
- Enhancement now keeps existing analysis content fully visible
- Only the Enhance button shows a loading spinner ("Enhancing…") during the LLM call
- Button is disabled during enhancement to prevent duplicate requests
- On completion (success or failure), button returns to normal `✨ Enhance` state
- No changes to the initial loading flow — that still shows the full-screen spinner as before

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `src/models/types.ts` | Modified | Added `enhancing?: boolean` to `TabState` interface |
| `src/ui/CodeExplorerViewProvider.ts` | Modified | Use `enhancing` flag instead of changing status to `'loading'` during enhancement |
| `webview/src/main.ts` | Modified | Added `enhancing` to local Tab interface; show spinner on Enhance button when enhancing |
| `webview/src/styles/main.css` | Modified | Added CSS for enhancing button state (spinner + disabled appearance) |
