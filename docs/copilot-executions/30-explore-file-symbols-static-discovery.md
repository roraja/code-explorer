# 30 - Use Static Analysis for Explore All File Symbols Command

**Date**: 2026-03-29 UTC
**Prompt**: "Modify the explore all symbols in file command so that it will list all functions in the file using vscode static analyzers and then performs analysis. Don't send complete code in prompt, just mention file name (since copilot runs in src context, it can anyways access file. Just mention that need to investigate the given functions)"

## 1. Code Reading & Analysis
- `.context/FLOORPLAN.md` — overall architecture and feature routing
- `src/extension.ts` (lines 310–374) — `EXPLORE_FILE_SYMBOLS` command handler, passes `filePath` and `fileSource` to `orchestrator.analyzeFile()`
- `src/analysis/AnalysisOrchestrator.ts` (lines 835–994) — `analyzeFile()` method; previously sent full file source to LLM via `PromptBuilder.buildFileAnalysis()`
- `src/llm/PromptBuilder.ts` (lines 400–541) — `buildFileAnalysis()` method; embeds entire source code in prompt
- `src/analysis/StaticAnalyzer.ts` — existing methods including `resolveSymbolAtPosition()` using `vscode.executeDocumentSymbolProvider`
- `src/utils/symbolHelpers.ts` — `findDeepestSymbol()`, `buildScopeChainForPosition()`, `mapVscodeSymbolKind()` helper functions
- `src/models/types.ts` (lines 1–28) — `SymbolKindType` type definition
- `src/models/constants.ts` — command names, config keys
- `src/llm/ResponseParser.ts` (lines 279–482) — `parseFileSymbolAnalyses()` method (unchanged)
- `src/analysis/CONTEXT.md`, `src/llm/CONTEXT.md` — module documentation

## 2. Issues Identified
- **Inefficient prompt size** (`src/llm/PromptBuilder.ts`, `buildFileAnalysis` line 414): The full source code of the file was embedded in the LLM prompt. For large files this wastes tokens and increases latency, even though the LLM (copilot/claude) runs in the workspace context and can read files directly.
- **No symbol pre-discovery** (`src/analysis/AnalysisOrchestrator.ts`, `analyzeFile` line 878): The LLM was asked to both discover AND analyze symbols in one pass. The language server already knows all symbols in the file — using it first gives the LLM a precise list to investigate.

## 3. Plan
1. Add `listFileSymbols()` method to `StaticAnalyzer` — uses `vscode.executeDocumentSymbolProvider` to enumerate all symbols, flattens the tree into a list with kind, name, line, and scope chain
2. Add `buildFileAnalysisFromSymbolList()` to `PromptBuilder` — lightweight prompt that only names the file and lists discovered symbols (no source code)
3. Modify `analyzeFile()` in `AnalysisOrchestrator` — call `listFileSymbols()` first, use lightweight prompt if symbols found, fall back to full-source prompt if language server returns nothing
4. Keep `extension.ts` unchanged (it still passes `fileSource` which is used as fallback)
5. Update CONTEXT.md files to document the new flow

**Alternative considered**: Removing `fileSource` parameter entirely from `analyzeFile()`. Rejected because the fallback path (no language server support) still needs it.

## 4. Changes Made

### `src/analysis/StaticAnalyzer.ts`
- **Added** `listFileSymbols()` public method (after `readContainingScopeSource`)
  - Uses `vscode.executeDocumentSymbolProvider` to get the symbol tree
  - Calls new private method `_flattenSymbols()` to recursively walk the tree
  - Returns `FileSymbolDescriptor[]` with name, kind, filePath, line, scopeChain, container
  - Filters out `unknown` kind symbols
- **Added** `_flattenSymbols()` private method — recursive tree walker
- **Added** `FileSymbolDescriptor` exported interface

### `src/llm/PromptBuilder.ts`
- **Added** import for `FileSymbolDescriptor` from `../analysis/StaticAnalyzer`
- **Added** `buildFileAnalysisFromSymbolList()` static method
  - Takes filePath, symbols array, and optional cacheRoot
  - Builds a prompt that instructs the LLM to read the file from workspace context
  - Lists each discovered symbol as `- **kind** \`name\` at line N (in Scope.Chain)`
  - Uses the same `json:file_symbol_analyses` output format as `buildFileAnalysis()`
  - Same rules section but emphasizes reading the file and using the provided line numbers

### `src/analysis/AnalysisOrchestrator.ts`
- **Modified** `analyzeFile()` method:
  - Added step 2: `this._staticAnalyzer.listFileSymbols(filePath)` to discover symbols
  - Step 3 now branches: if symbols found → `buildFileAnalysisFromSymbolList()`, else → `buildFileAnalysis()` (fallback)
  - Steps 4–6 (LLM call, parse, write cache) remain unchanged
  - Updated JSDoc to describe the new flow

### Context/doc files updated:
- `src/analysis/CONTEXT.md` — Updated `analyzeFile` pipeline steps
- `src/llm/CONTEXT.md` — Added `buildFileAnalysisFromSymbolList` entry, clarified `buildFileAnalysis` is fallback
- `.context/FLOORPLAN.md` — Updated full-file analysis feature row

## 5. Commands Run
- `npm run build` — **PASS** (extension.js 212.2kb, webview/dist built)
- `npm run lint` — **PASS** (no errors)
- `npm run test:unit` — **PASS** (223 passing, 277ms)

## 6. Result
The "Explore All Symbols in File" command now:
1. First uses VS Code's `executeDocumentSymbolProvider` to discover all symbols in the file
2. Sends a lightweight prompt to the LLM listing only the file path and symbol names — no source code
3. The LLM reads the file itself from workspace context to perform the analysis
4. Falls back to the old full-source prompt if the language server returns no symbols

This significantly reduces prompt size (especially for large files) while producing the same output format. No changes needed to the command handler in `extension.ts` or the response parser.

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `src/analysis/StaticAnalyzer.ts` | Modified | Added `listFileSymbols()`, `_flattenSymbols()`, and `FileSymbolDescriptor` interface |
| `src/llm/PromptBuilder.ts` | Modified | Added `buildFileAnalysisFromSymbolList()` method and `FileSymbolDescriptor` import |
| `src/analysis/AnalysisOrchestrator.ts` | Modified | Updated `analyzeFile()` to use static symbol discovery first, with full-source fallback |
| `src/analysis/CONTEXT.md` | Modified | Updated `analyzeFile` pipeline documentation |
| `src/llm/CONTEXT.md` | Modified | Added `buildFileAnalysisFromSymbolList` entry |
| `.context/FLOORPLAN.md` | Modified | Updated full-file analysis feature row |
| `docs/copilot-executions/30-explore-file-symbols-static-discovery.md` | Created | This execution log |
