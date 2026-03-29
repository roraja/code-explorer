# 09 - Implement Mermaid Diagrams in Webview Sidebar

**Date**: 2026-03-29 UTC
**Prompt**: "Implement Option 1: Bundle Mermaid.js into the Webview (Client-Side Rendering). Make sure to modify prompts everywhere so that mermaid diagrams are generated during copilot prompts"

## 1. Code Reading & Analysis

- `.context/FLOORPLAN.md` — Module routing and architecture overview
- `src/models/types.ts` (1-646) — All type definitions; `AnalysisResult` interface (line 121) where `diagrams?` field needed to be added
- `src/llm/ResponseParser.ts` (1-1034) — Full parser; needed `_parseDiagrams()` method following existing `_parseXxx()` pattern
- `src/llm/PromptBuilder.ts` (1-557) — Unified prompt builder; `buildUnified()` (line 88-376) and `buildFileAnalysis()` (line 392-520)
- `src/llm/prompts/FunctionPromptStrategy.ts` (1-165) — Function prompt; diagram section added before Related Symbols
- `src/llm/prompts/ClassPromptStrategy.ts` (1-144) — Class prompt; diagram section with class diagram guidance
- `src/llm/prompts/VariablePromptStrategy.ts` (1-164) — Variable prompt; diagram section with data flow flowchart guidance
- `src/llm/prompts/PropertyPromptStrategy.ts` (1-145) — Property prompt; diagram section with member access flow guidance
- `src/llm/prompts/PromptStrategy.ts` (1-35) — Strategy interface (unchanged)
- `src/cache/CacheStore.ts` (1-1130) — Cache serialization/deserialization; added diagrams JSON block + mermaid code block
- `src/ui/CodeExplorerViewProvider.ts` (1-511) — CSP policy (line 486-490); changed `style-src` to include `'unsafe-inline'`
- `webview/src/main.ts` (1-705) — Full webview renderer; added mermaid import, init, diagram rendering with fallback
- `webview/src/styles/main.css` (1-1133) — Full CSS; added `.diagram-container`, `.diagram-loading`, `.diagram-error` styles
- `webview/esbuild.config.mjs` (1-37) — Build config (unchanged)
- `webview/tsconfig.json` (1-22) — TS config (unchanged)
- `package.json` — Checked dependencies section

## 2. Issues Identified

1. **No `DiagramEntry` type** — `AnalysisResult` had no field for diagrams. Created `DiagramEntry` interface with `title`, `type`, `mermaidSource`.
2. **No parser for diagrams** — `ResponseParser` had no `_parseDiagrams()` method. Added following the exact same pattern as `_parseDataFlow()`.
3. **No prompt section for diagrams** — None of the 5 prompt templates (unified + 4 strategies) asked the LLM for Mermaid diagrams. Added a `### Diagrams` section to each with kind-specific guidance.
4. **CSP blocks mermaid styles** — The webview CSP had `style-src ${webview.cspSource} 'nonce-${nonce}'` which would block mermaid's injected `<style>` elements. Changed to `'unsafe-inline'` (acceptable for local-only webview).
5. **No mermaid dependency** — The project had no mermaid package. Installed via `npm install mermaid --save`.
6. **No diagram rendering in webview** — The webview had no mermaid import, initialization, or diagram rendering logic.

## 3. Plan

Implemented Option 1 from the planning doc (docs/next/02-mermaid-diagrams-in-webview.md):
- Bundle mermaid.js directly into the webview via npm import
- Add `DiagramEntry` type and `diagrams?` field to `AnalysisResult`
- Add `_parseDiagrams()` to `ResponseParser` following existing JSON block pattern
- Add `### Diagrams` section to all 5 prompt templates with kind-specific diagram guidance
- Add diagrams serialization/deserialization to `CacheStore`
- Relax CSP `style-src` to allow mermaid's inline styles
- Initialize mermaid with VS Code dark theme detection
- Render diagrams asynchronously after DOM update with error fallback

## 4. Changes Made

### `package.json`
- Added `mermaid` as a production dependency (`npm install mermaid --save`)

### `src/models/types.ts`
- Added `DiagramEntry` interface (title, type, mermaidSource) before `MemberAccessInfo` (line ~370)
- Added `diagrams?: DiagramEntry[]` to `AnalysisResult` (line ~160)

### `src/llm/ResponseParser.ts`
- Added `DiagramEntry` to import list
- Added `_parseDiagrams(raw)` static method — extracts `json:diagrams` fenced block, parses array of `{title, type, mermaidSource}`
- Wired `_parseDiagrams()` into `parse()` method — called after `_parseMemberAccess()`, result included in return object as `diagrams`

### `src/llm/PromptBuilder.ts` — `buildUnified()`
- Added `### Diagrams` section between "Potential Issues" and "Related Symbols" in the unified prompt
- Includes guidance on diagram type selection by symbol kind, conciseness rules, and `json:diagrams` output format

### `src/llm/prompts/FunctionPromptStrategy.ts`
- Added `### Diagrams` section requesting flowchart or sequence diagram of execution flow

### `src/llm/prompts/ClassPromptStrategy.ts`
- Added `### Diagrams` section requesting class diagram of relationships or lifecycle flowchart

### `src/llm/prompts/VariablePromptStrategy.ts`
- Added `### Diagrams` section requesting data flow lifecycle flowchart

### `src/llm/prompts/PropertyPromptStrategy.ts`
- Added `### Diagrams` section requesting member access flow flowchart

### `src/cache/CacheStore.ts`
- **Serialization**: Added diagrams section after member access — writes both human-readable mermaid code blocks and `json:diagrams` machine-readable block
- **Deserialization**: Added `_parseJsonBlock('diagrams')` call and `diagrams` field to the returned `AnalysisResult`

### `src/ui/CodeExplorerViewProvider.ts`
- Changed CSP `style-src` from `${webview.cspSource} 'nonce-${nonce}'` to `${webview.cspSource} 'unsafe-inline'` — required for mermaid's dynamically injected `<style>` elements

### `webview/src/main.ts`
- Added `import mermaid from 'mermaid'`
- Added `_mermaidIdCounter` for unique diagram element IDs
- Added `_isDarkTheme()` helper to detect VS Code dark/high-contrast themes
- Updated `init()` to call `mermaid.initialize()` with dark theme detection and custom theme variables
- Updated `render()` to call `renderMermaidDiagrams()` after DOM update
- Added diagram placeholder rendering in `renderAnalysis()` — creates `<div class="diagram-container" data-mermaid-source="...">` elements
- Added `escAttr()` helper for HTML attribute escaping (handles newlines in mermaid source)
- Added `renderMermaidDiagrams()` async function — finds all `diagram-container` elements with `data-mermaid-source`, calls `mermaid.render()`, shows rendered SVG or fallback code block on error

### `webview/src/styles/main.css`
- Added `.diagram-container` — flex container with VS Code themed borders, min-height, overflow handling
- Added `.diagram-container--rendered` — adjusts sizing for rendered SVG
- Added `.diagram-container--rendered svg` — responsive SVG with max-width: 100%
- Added `.diagram-loading` — loading spinner with animation
- Added `.diagram-error` — error display with red border
- Added `.diagram-error__label` — error header styling
- Added `.diagram-error__source` — code block fallback for raw mermaid source
- Added `.diagram-container--error` — error border styling

## 5. Commands Run

| Command | Result |
|---------|--------|
| `npm install mermaid --save` | Added 125 packages, mermaid installed as dependency |
| `npm run build` | Extension: 133.2kb, Webview: 2.7mb (includes mermaid), CSS: 19.1kb |
| `npm run lint` | No errors |
| `npm run format:check` | 2 files needed formatting (CacheStore.ts, ResponseParser.ts) |
| `npm run format` | Fixed formatting in 2 files |
| `npm run build` (rebuild) | Success |
| `npm run lint` (re-run) | No errors |
| `npm run test:unit` | 127 passing (72ms) — all tests pass |

## 6. Result

Successfully implemented Option 1 (Bundle Mermaid.js into Webview) from the planning doc. The complete pipeline is wired:

1. **LLM prompt** → All 5 prompt templates (unified + function/class/variable/property strategies) now request `json:diagrams` blocks with kind-specific diagram guidance
2. **Response parsing** → `ResponseParser._parseDiagrams()` extracts `DiagramEntry[]` from LLM response
3. **Cache storage** → `CacheStore` serializes diagrams as both human-readable mermaid code blocks and `json:diagrams` JSON blocks, and deserializes them back
4. **Webview rendering** → Mermaid.js bundled into the webview, initialized with VS Code dark theme detection, renders diagrams asynchronously after DOM update with graceful error fallback

The webview bundle increased from ~50 KB to 2.7 MB (expected, includes mermaid + D3 + dagre). Build, lint, and all 127 unit tests pass.

## 7. Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| `package.json` | Modified | Added `mermaid` production dependency |
| `src/models/types.ts` | Modified | Added `DiagramEntry` interface and `diagrams?` field to `AnalysisResult` |
| `src/llm/ResponseParser.ts` | Modified | Added `DiagramEntry` import, `_parseDiagrams()` method, wired into `parse()` |
| `src/llm/PromptBuilder.ts` | Modified | Added `### Diagrams` section to unified prompt |
| `src/llm/prompts/FunctionPromptStrategy.ts` | Modified | Added `### Diagrams` section for function/method analysis |
| `src/llm/prompts/ClassPromptStrategy.ts` | Modified | Added `### Diagrams` section for class/struct analysis |
| `src/llm/prompts/VariablePromptStrategy.ts` | Modified | Added `### Diagrams` section for variable analysis |
| `src/llm/prompts/PropertyPromptStrategy.ts` | Modified | Added `### Diagrams` section for property/member analysis |
| `src/cache/CacheStore.ts` | Modified | Added diagrams serialization (mermaid blocks + JSON) and deserialization |
| `src/ui/CodeExplorerViewProvider.ts` | Modified | Relaxed CSP `style-src` to `'unsafe-inline'` for mermaid |
| `webview/src/main.ts` | Modified | Added mermaid import, init, theme detection, async diagram rendering with fallback |
| `webview/src/styles/main.css` | Modified | Added diagram container, loading, error, and rendered SVG styles |
| `docs/copilot-executions/09-implement-mermaid-diagrams.md` | Created | This execution log |
