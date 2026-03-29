# 15 - Fix JSON Blocks Leaking Into Overview Panel

**Date**: 2026-03-29 UTC
**Prompt**: Fix raw `json:additional_key_points` and `json:additional_issues` fenced blocks appearing in the Overview tab of the webview panel instead of being parsed into structured data.

## 1. Code Reading & Analysis
- Read `.context/FLOORPLAN.md` — routing table to understand module responsibilities
- Read `src/llm/ResponseParser.ts` — full file (1200+ lines), the core parser for LLM responses
  - `_extractSections()` (line 1132): splits markdown by `###` headings, extracts section text — **no stripping of json: fenced blocks**
  - `parse()` (line 573): main parse method, sets `overview` from `sections['overview']` directly
  - `parseEnhanceResponse()` (line 495): parses `additional_key_points`/`additional_issues` — only called in enhance flow
- Read `webview/src/main.ts` — full file (1100+ lines), the webview renderer
  - Line 526-533: renders `a.overview` via `_renderMarkdownWithMermaid()` — passes raw text, no stripping
- Read `src/llm/PromptBuilder.ts` — confirmed `additional_key_points`/`additional_issues` are only in the enhance prompt (lines 654-668), but the LLM sometimes produces them in initial analysis too
- Read `src/analysis/AnalysisOrchestrator.ts` (lines 970-1030) — enhance flow correctly merges `additionalKeyPoints` → `keyMethods` and `additionalIssues` → `potentialIssues`
- Searched for `additional_key_points|additional_issues` across the codebase to map all references
- Read `test/unit/llm/ResponseParser.test.ts` — full test suite (802 lines)

## 2. Issues Identified
- **`_extractSections()` does not strip `json:*` fenced blocks** (`src/llm/ResponseParser.ts:1132`):
  When the LLM outputs ```json:additional_key_points``` or ```json:additional_issues``` blocks within a section (e.g. after the `### Overview` heading), they become part of that section's text content. This raw JSON then flows through to `overview` and renders as plain text in the webview.
- **`parse()` does not extract `additional_key_points`/`additional_issues`** (`src/llm/ResponseParser.ts:634`):
  Only `parseEnhanceResponse()` handles these blocks. When the LLM produces them during initial analysis (which it does unpredictably), they're ignored as structured data and instead leak into section text.
- **Duplicated parsing logic** in `parseEnhanceResponse()` (lines 520-553): Manual regex + JSON.parse for `additional_key_points` and `additional_issues` that could be refactored into a shared helper.

## 3. Plan
- Add `_stripJsonFencedBlocks()` private method to strip all ```json:* ... ``` fenced blocks from section text
- Integrate stripping into `_extractSections()` so all sections get cleaned prose text
- Add `_parseStringArrayBlock()` generic helper for parsing named json: blocks containing string arrays
- Use `_parseStringArrayBlock()` in `parse()` to extract `additional_key_points`/`additional_issues` and merge them into `keyMethods`/`potentialIssues`
- Refactor `parseEnhanceResponse()` to use the same `_parseStringArrayBlock()` helper (DRY)
- Add 3 unit tests covering the fix

Alternative considered: Stripping in the webview renderer — rejected because the data should be structured at parse time, not rendered as text and then cleaned up.

## 4. Changes Made

### `src/llm/ResponseParser.ts`

**Change 1: `_extractSections()` now strips json: fenced blocks**
- Before: Section text was the raw substring between headings
- After: Each section's text is passed through `_stripJsonFencedBlocks()` before storing

**Change 2: Added `_stripJsonFencedBlocks()` method (new)**
- Regex: `/```json:\S+\s*\n[\s\S]*?\n\s*```/g` — matches any ```json:<name> ... ``` block
- Returns cleaned text with `.trim()`

**Change 3: Added `_parseStringArrayBlock()` method (new)**
- Generic helper: takes `raw` text and `blockName`, returns `string[]`
- Uses `new RegExp()` for dynamic block name matching
- Handles missing block, malformed JSON, non-array, non-string elements gracefully

**Change 4: `parse()` now extracts additional_key_points and additional_issues**
- Calls `_parseStringArrayBlock(raw, 'additional_key_points')` and `_parseStringArrayBlock(raw, 'additional_issues')`
- Merges results into `keyMethods` and `potentialIssues` arrays alongside the section-parsed items
- Logs when additional items are found

**Change 5: `parseEnhanceResponse()` refactored to use `_parseStringArrayBlock()`**
- Replaced 30+ lines of duplicated manual regex+JSON.parse with two calls to the shared helper
- Same behavior, less code

### `test/unit/llm/ResponseParser.test.ts`

**Added 3 test cases in `parse — basic sections` suite:**
1. `strips json fenced blocks from overview text` — verifies overview is clean and additional_key_points/additional_issues are parsed into proper fields
2. `parses additional_key_points and additional_issues from initial analysis` — verifies merge with existing section items
3. `handles missing additional_key_points and additional_issues gracefully` — verifies no regression when blocks are absent

## 5. Commands Run
- `npm run build` → ✅ Success (extension 156.7kb, webview 2.7mb)
- `npm run test:unit` → ✅ 142 passing (80ms) — 139 original + 3 new
- `npm run lint` → ✅ No errors

## 6. Result
- **Fixed**: Raw `json:additional_key_points` and `json:additional_issues` blocks no longer appear in the overview panel text
- **Bonus**: Any `json:*` fenced block that the LLM produces within a section is now stripped, preventing similar issues with other block types
- **Bonus**: `additional_key_points` and `additional_issues` are now properly parsed into `keyMethods` and `potentialIssues` even in initial analysis (not just enhance)
- **Note**: Existing cached results that already contain the raw JSON in the overview will continue to show it until re-analyzed. Users can run "Clear Cache" + re-analyze to get clean results.

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `src/llm/ResponseParser.ts` | Modified | Strip json: fenced blocks from section text; parse additional_key_points/additional_issues in initial analysis; add _stripJsonFencedBlocks and _parseStringArrayBlock helpers; refactor parseEnhanceResponse to use shared helper |
| `test/unit/llm/ResponseParser.test.ts` | Modified | Added 3 test cases for json block stripping and additional_key_points/additional_issues parsing |
