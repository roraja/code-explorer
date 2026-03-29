# 09 - Clickable File:Line References in Sidebar View

**Date**: 2026-03-29 00:00 UTC
**Prompt**: "In the sidebar view, whenever you're referencing any line in any file, like in the data flow section or anywhere, make sure that that reference is clickable. So when I click that reference, the VS Code jumps to that line number and file."

## 1. Code Reading & Analysis
- Read `.context/FLOORPLAN.md` — routing table for the codebase
- Read `webview/src/main.ts` — full webview renderer, identified all file:line reference rendering points
- Read `src/ui/CodeExplorerViewProvider.ts` — extension-side message handler, confirmed `navigateToSource` message type and `_navigateToSource()` method already exist
- Read `src/models/types.ts` — confirmed `WebviewToExtensionMessage` includes `navigateToSource` message type
- Read `webview/src/styles/main.css` — all existing styles for file references and symbol links

Identified 5 places where file:line references were rendered as plain (non-clickable) text:
1. **Symbol header breadcrumb** (`renderAnalysis`, line ~188) — `<div class="symbol-header__breadcrumb">` showing the file path
2. **Sub-function file paths** (`renderAnalysis`, line ~276) — `<div class="subfunction-item__file">` showing file:line
3. **Data flow items** (`renderAnalysis`, line ~445) — `<span class="data-flow-item__file">` showing file:line
4. **Call stack file paths** (`renderAnalysis`, line ~491) — `<span class="callstack-item__file">` showing file:line
5. **Relationship file paths** (`renderAnalysis`, line ~507) — `<span class="rel-file">` showing file path

The infrastructure for navigation already existed:
- `navigateToSource` message type in `WebviewToExtensionMessage`
- `_navigateToSource()` handler in `CodeExplorerViewProvider.ts` that opens the file and positions the cursor
- Usage rows already had click-to-navigate behavior

## 2. Issues Identified
- All file:line references in Data Flow, Call Stacks, Relationships, Sub-Functions, and the header breadcrumb were plain `<div>` or `<span>` elements — no click handlers, no cursor:pointer, no link styling
- Users had no visual indication these references were interactive
- The navigation infrastructure existed but was only wired to usage rows and symbol links

## 3. Plan
- Convert all plain file:line references from `<div>`/`<span>` to `<a>` tags with a shared `file-link` CSS class
- Add `data-file`, `data-line`, `data-char` attributes to each link for the navigation handler
- Add a single delegated click handler for `.file-link` in `attachListeners()` that sends `navigateToSource`
- Add CSS styling for `a.file-link` and each specific file reference class to show link colors and hover underlines
- Reuse the existing VS Code theme link variables (`--vscode-textLink-foreground`, `--vscode-textLink-activeForeground`)

## 4. Changes Made

### `webview/src/main.ts`

1. **Symbol header breadcrumb** (line ~188):
   - Before: `<div class="symbol-header__breadcrumb" title="...">path</div>`
   - After: `<a class="symbol-header__breadcrumb file-link" href="#" data-file="..." data-line="..." data-char="0" title="...">path</a>`
   - Also computes the correct line from the analysis symbol position

2. **Sub-function file path** (line ~276):
   - Before: `<div class="subfunction-item__file">path:line</div>`
   - After: `<a class="subfunction-item__file file-link" href="#" data-file="..." data-line="..." data-char="0">path:line</a>`

3. **Data flow file reference** (lines ~440-448):
   - Before: `<span class="data-flow-item__file">path:line</span>`
   - After: `<a class="data-flow-item__file file-link" href="#" data-file="..." data-line="..." data-char="0">path:line</a>`

4. **Call stack file reference** (line ~494):
   - Before: `<span class="callstack-item__file">path:line</span>`
   - After: `<a class="callstack-item__file file-link" href="#" data-file="..." data-line="..." data-char="0">path:line</a>`

5. **Relationship file reference** (line ~510):
   - Before: `<span class="rel-file">path</span>`
   - After: `<a class="rel-file file-link" href="#" data-file="..." data-line="..." data-char="0">path</a>`

6. **New click handler** (lines ~596-609): Added `.file-link` click handler in `attachListeners()` that calls `e.preventDefault()`, `e.stopPropagation()`, reads `data-file`/`data-line`/`data-char`, and posts `navigateToSource` message.

### `webview/src/styles/main.css`

Added `a.*` rule variants for all file reference classes plus a shared `.file-link` class:
- `.file-link` / `.file-link:hover` — base clickable link style
- `a.symbol-header__breadcrumb` / `:hover` — breadcrumb link style
- `a.subfunction-item__file` / `:hover` — sub-function file link style
- `a.callstack-item__file` / `:hover` — call stack file link style
- `a.rel-file` / `:hover` — relationship file link style
- `a.data-flow-item__file` / `:hover` — data flow file link style

All use `--vscode-textLink-foreground` and `--vscode-textLink-activeForeground` for theme integration.

## 5. Commands Run
- `npm run build` — ✅ Pass (extension: 128.1kb, webview: main.css 17.8kb + main.js 16.3kb)
- `npm run lint` — ✅ Pass (no errors)
- `npm run test:unit` — ✅ Pass (127 passing)

## 6. Result
All file:line references throughout the sidebar view are now clickable blue links. Clicking any of them sends a `navigateToSource` message to the extension host, which opens the file in the editor and positions the cursor at the referenced line. This works in:
- Header breadcrumb (symbol file path)
- Data Flow section entries
- Sub-Functions section file paths
- Call Stacks section file paths
- Relationships section file paths
- Usage rows (already worked before)

No remaining issues. The existing `_navigateToSource()` handler in `CodeExplorerViewProvider.ts` handles all the navigation — no extension-side changes were needed.

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `webview/src/main.ts` | Modified | Converted 5 plain file:line references to `<a class="file-link">` links with data attributes; added `.file-link` click handler |
| `webview/src/styles/main.css` | Modified | Added `.file-link` base styles + `a.*` variants for all 5 file reference classes with theme-aware link colors |
