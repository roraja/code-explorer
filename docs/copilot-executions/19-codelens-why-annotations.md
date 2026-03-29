# 19 - Contextual "Why?" Annotations on Code (CodeLens)

**Date**: 2026-03-29 UTC
**Prompt**: Implement 10. Contextual "Why?" Annotations on Code of docs/next/03-ten-improvement-ideas.md

## 1. Code Reading & Analysis
- Read `docs/next/03-ten-improvement-ideas.md` (lines 183-202) — full spec for feature #10
- Read `src/providers/CodeExplorerHoverProvider.ts` — existing provider pattern to follow
- Read `src/extension.ts` — how hover provider is registered, pattern for CodeLens registration
- Read `src/cache/CacheStore.ts` — methods for reading cache, needed a `readAllForFile` method
- Read `src/models/constants.ts` — CONFIG keys
- Read `package.json` — configuration schema for adding `showCodeLens` setting
- Checked `src/models/types.ts` — `FunctionStep`, `DataFlowEntry` interfaces for CodeLens data

## 2. Issues Identified
- **No CodeLens provider**: Planned in design docs but never implemented
- **No `readAllForFile` method on CacheStore**: Only had `read(symbol)` for exact match and `findByCursor(word, filePath, cursorLine)` for fuzzy match. Neither returns all analyses for a file.
- **No `showCodeLens` config key**: Was not in `constants.ts` or `package.json`
- **Function steps lack line numbers**: `FunctionStep` only has `step` (number) and `description` (string), no explicit line mapping. Need to approximate line positions.

## 3. Plan
- Add `readAllForFile(filePath)` to `CacheStore` — scans cache directory, reads all `.md` files, deserializes all analyses
- Add `CONFIG.SHOW_CODE_LENS` to `constants.ts`
- Add `codeExplorer.showCodeLens` to `package.json` (default: false)
- Create `CodeExplorerCodeLensProvider` with:
  - Overview lens at symbol definition line
  - Function step lenses distributed across function body
  - Data flow lenses at explicit line positions
  - Potential issue lenses as warnings
  - All clickable — command opens sidebar analysis
- Register in `extension.ts` for same languages as hover provider
- Support `onDidChangeCodeLenses` for cache updates

## 4. Changes Made

### `src/cache/CacheStore.ts`
- Added `readAllForFile(filePath: string): Promise<AnalysisResult[]>` — scans cache directory for a source file, reads and deserializes all `.md` cache files, returns array of `AnalysisResult`

### `src/models/constants.ts`
- Added `SHOW_CODE_LENS: 'codeExplorer.showCodeLens'` to `CONFIG` object

### `src/providers/CodeExplorerCodeLensProvider.ts` (new file)
- Full implementation of `vscode.CodeLensProvider`:
  - `provideCodeLenses()` — reads all cached analyses for the current file, generates CodeLens items
  - `resolveCodeLens()` — no-op (command provided at creation time)
  - `refresh()` — fires `onDidChangeCodeLenses` event for cache updates
  - `_buildStepLenses()` — distributes function steps approximately across function body using line heuristics
  - `_buildDataFlowLenses()` — creates lenses at explicit data flow line positions
  - `_createCodeLens()` — creates CodeLens with `exploreSymbol` command
  - `_kindToIcon()` — maps symbol kinds to VS Code icon names
  - `_dataFlowTypeIcon()` — compact icons for data flow types
  - `_truncateToOneLine()` — cleans markdown and truncates for inline display
  - `dispose()` — disposes event emitter

### `src/extension.ts`
- Added import for `CodeExplorerCodeLensProvider`
- Created and registered `codeLensProvider` for 9 languages
- Added disposable for the provider

### `package.json`
- Added `codeExplorer.showCodeLens` configuration property (boolean, default: false, with description)

## 5. Commands Run
- `npm run build` — PASS (extension: 178.4kb, webview: 2.7mb)
- `npm run lint` — PASS (0 errors, 0 warnings)
- `npm run test:unit` — PASS (150 tests, 88ms)

## 6. Result
Feature #10 (Contextual "Why?" Annotations on Code) is fully implemented:

1. **Overview Annotations**: When a symbol has been analyzed, a one-line summary appears as a CodeLens above the symbol definition (e.g., `$(symbol-method) Code Explorer: Coordinates cache check + LLM analysis pipeline...`)
2. **Function Step Annotations**: For functions with `functionSteps`, numbered step annotations are distributed across the function body at approximate line positions
3. **Data Flow Annotations**: For variables with `dataFlow`, flow point annotations appear at each explicit line position (e.g., `⊕ Data: created here, assigned to cache map`)
4. **Issue Warnings**: For symbols with `potentialIssues`, warning annotations appear at the symbol line (e.g., `$(warning) Issue: No error handling for cache write failure`)
5. **Clickable**: All CodeLens items are clickable — clicking opens the full analysis in the sidebar via `exploreSymbol` command
6. **Configurable**: Controlled by `codeExplorer.showCodeLens` setting (default: false) — users opt in
7. **Multi-language**: Registered for TS, JS, TSX, JSX, C++, C, Python, Java, C#
8. **Refreshable**: `refresh()` method fires `onDidChangeCodeLenses` for live updates after cache writes

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `src/cache/CacheStore.ts` | Modified | Added `readAllForFile()` method to read all cached analyses for a source file |
| `src/models/constants.ts` | Modified | Added `SHOW_CODE_LENS` config key |
| `src/providers/CodeExplorerCodeLensProvider.ts` | Created | Full CodeLens provider with overview, steps, data flow, and issue annotations |
| `src/extension.ts` | Modified | Registered CodeLens provider for 9 languages |
| `package.json` | Modified | Added `codeExplorer.showCodeLens` configuration (boolean, default: false) |
