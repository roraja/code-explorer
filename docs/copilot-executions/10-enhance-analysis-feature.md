# 10 - Enhance Analysis Feature

**Date**: 2026-03-29 UTC
**Prompt**: Add an "Enhance" command at the top of the LLM analysis page. When clicked, it opens a dialog for the user to type any text (question or enhancement request). The extension uses that prompt text with the current analysis and source file as context, triggers a Copilot CLI call, and either enhances existing sections or adds a new Q&A section. All questions and answers are persisted as part of the analysis cache.

## 1. Code Reading & Analysis

Files read and explored during this prompt:

- `.context/FLOORPLAN.md` — Understand the overall architecture and module routing
- `src/extension.ts` — Extension entry point, dependency wiring, command registration
- `src/models/types.ts` — All TypeScript interfaces (SymbolInfo, AnalysisResult, TabState, message types)
- `src/models/constants.ts` — Extension IDs, command names, config keys
- `src/ui/CodeExplorerViewProvider.ts` — WebviewViewProvider that manages tab state, routes messages, triggers analysis
- `src/analysis/AnalysisOrchestrator.ts` — Coordinates cache check + LLM analysis pipeline
- `src/llm/PromptBuilder.ts` — Builds structured prompts for different symbol kinds
- `src/llm/ResponseParser.ts` — Extracts structured data from LLM responses
- `src/llm/LLMProvider.ts` — LLM provider interface
- `src/cache/CacheStore.ts` — Reads/writes analysis results as markdown with YAML frontmatter
- `webview/src/main.ts` — Webview entry point, renders tabs, analysis sections, handles user interactions
- `webview/src/styles/main.css` — All CSS styles for the webview
- `package.json` — Extension manifest, commands, keybindings, configuration

Key patterns observed:
- Extension uses a single `setState` message pattern to push full state to webview
- Webview is a pure renderer, sends typed messages back to extension
- LLM prompts use `json:block_name` fenced code blocks for structured data
- Cache serialization uses YAML frontmatter + markdown body + JSON blocks
- Analysis orchestrator handles the full pipeline: cache check → source read → LLM call → response parse → cache write

## 2. Issues Identified

No existing bugs found. This is a new feature implementation.

Key design decisions:
- The enhance flow must integrate with the existing tab state management
- Q&A entries need to be persisted in cache markdown files
- The webview dialog must work within the VS Code webview CSP constraints (no external scripts)
- The enhance prompt needs to include existing analysis as context for continuity

## 3. Plan

**Approach: End-to-end feature across 7 files**

1. **Types** (`src/models/types.ts`):
   - Add `QAEntry` interface (question, answer, timestamp)
   - Add `qaHistory` field to `AnalysisResult`
   - Add `enhanceAnalysis` message to `WebviewToExtensionMessage` union

2. **Orchestrator** (`src/analysis/AnalysisOrchestrator.ts`):
   - Add `enhanceAnalysis()` method that takes existing result + user prompt
   - Reads source code for context, builds enhance prompt, calls LLM
   - Parses response, creates Q&A entry, optionally updates analysis sections
   - Writes updated result back to cache

3. **PromptBuilder** (`src/llm/PromptBuilder.ts`):
   - Add `buildEnhance()` static method
   - Includes existing analysis summary, source code, previous Q&A history, and user's prompt
   - Asks LLM for: answer, optional updated overview, additional key points, additional issues

4. **ResponseParser** (`src/llm/ResponseParser.ts`):
   - Add `EnhanceParseResult` interface
   - Add `parseEnhanceResponse()` static method
   - Extracts answer from ### Answer section
   - Extracts optional updated overview, additional key points/issues from JSON blocks

5. **ViewProvider** (`src/ui/CodeExplorerViewProvider.ts`):
   - Handle `enhanceAnalysis` message from webview
   - Add `_handleEnhanceAnalysis()` method that sets loading state, calls orchestrator, updates tab

6. **Webview** (`webview/src/main.ts`):
   - Add "Enhance" button bar after the symbol header
   - Add Q&A section rendering before metadata
   - Add modal dialog (`_showEnhanceDialog`) with textarea for user input
   - Handle Ctrl+Enter to submit, Escape to close

7. **Cache** (`src/cache/CacheStore.ts`):
   - Serialize `qaHistory` as `## Q&A` section with `json:qa_history` block
   - Deserialize `qaHistory` from `json:qa_history` block

8. **Styles** (`webview/src/styles/main.css`):
   - Enhance bar button styling
   - Modal dialog overlay and form styling
   - Q&A list and item styling

**Alternatives considered:**
- Using VS Code's `showInputBox` instead of a custom dialog → Rejected because it only supports single-line input, and users need multi-line for detailed questions
- Adding a command palette command → Rejected because the enhance action is contextual to a specific tab/analysis; a button in the UI is more discoverable
- Storing Q&A in a separate file → Rejected because keeping it in the same cache file ensures they stay together and get cleared when cache is cleared

## 4. Changes Made

### `src/models/types.ts`
- Added `QAEntry` interface with `question`, `answer`, `timestamp` fields (before `MemberAccessInfo`)
- Added `qaHistory?: QAEntry[]` field to `AnalysisResult` (after `diagrams`)
- Added `{ type: 'enhanceAnalysis'; tabId: string; userPrompt: string }` to `WebviewToExtensionMessage` union

### `src/analysis/AnalysisOrchestrator.ts`
- Added `QAEntry` to the import from `../models/types`
- Added `enhanceAnalysis()` method (~120 lines) before `dispose()`:
  - Reads source code for context
  - Builds enhance prompt via `PromptBuilder.buildEnhance()`
  - Sends to LLM provider
  - Parses response via `ResponseParser.parseEnhanceResponse()`
  - Creates `QAEntry` and appends to `qaHistory`
  - Optionally updates overview, key points, potential issues
  - Writes updated result back to cache
  - Handles errors gracefully (adds error Q&A entry)

### `src/llm/PromptBuilder.ts`
- Changed import to include `AnalysisResult` type
- Added `buildEnhance()` static method (~90 lines) before `getStrategy()`:
  - Takes `existingResult`, `userPrompt`, `sourceCode`
  - Builds context from existing analysis (overview, key points, steps, sub-functions, etc.)
  - Includes previous Q&A history for conversational continuity
  - Asks for: Answer, Updated Overview, Additional Key Points (json:additional_key_points), Additional Issues (json:additional_issues)

### `src/llm/ResponseParser.ts`
- Added `EnhanceParseResult` interface (answer, updatedOverview, additionalKeyPoints, additionalIssues)
- Added `parseEnhanceResponse()` static method (~60 lines) before `parse()`:
  - Extracts answer from ### Answer section (falls back to full response)
  - Extracts optional updated overview from ### Updated Overview section
  - Parses `json:additional_key_points` JSON block
  - Parses `json:additional_issues` JSON block

### `src/ui/CodeExplorerViewProvider.ts`
- Added `case 'enhanceAnalysis'` to `_handleMessage()` switch
- Added `_handleEnhanceAnalysis()` private method before `_exploreSymbolByName()`:
  - Finds the tab, sets it to loading state
  - Calls `orchestrator.enhanceAnalysis()`
  - Updates tab with enhanced result
  - Handles errors (keeps existing analysis visible)

### `src/cache/CacheStore.ts`
- Added Q&A serialization in `_serialize()` (after Potential Issues):
  - Writes `## Q&A` section with each Q&A as `### Q: question` + answer
  - Includes `json:qa_history` JSON block for machine parsing
- Added Q&A deserialization in `_deserialize()`:
  - Parses `json:qa_history` block using existing `_parseJsonBlock` helper
  - Adds `qaHistory` field to the returned `AnalysisResult`

### `webview/src/main.ts`
- Added "Enhance" button bar after the symbol header in `renderAnalysis()`:
  - Button with ✨ icon and "Enhance" label
  - `data-tab-id` attribute for identifying which tab to enhance
- Added Q&A history rendering before the metadata timestamp:
  - Collapsible section showing question, timestamp, and answer
  - Styled as a list of Q&A cards with left border accent
- Added enhance button click listener in `attachListeners()`:
  - Calls `_showEnhanceDialog(tabId)` on click
- Added `_showEnhanceDialog()` function (~90 lines):
  - Creates a modal overlay with dialog
  - Contains: title, close button, label, textarea, Cancel/Send buttons
  - Keyboard shortcuts: Ctrl+Enter to submit, Escape to close
  - Click outside dialog to close
  - Sends `enhanceAnalysis` message with `tabId` and `userPrompt`
  - Validates non-empty input

### `webview/src/styles/main.css`
- Added `.enhance-bar` and `.enhance-bar__button` styles (~30 lines):
  - Compact bar below the header
  - VS Code-themed secondary button
- Added `.enhance-dialog-overlay` and `.enhance-dialog` styles (~120 lines):
  - Fixed overlay with centered dialog
  - VS Code-themed form elements (input, buttons)
  - Proper focus and error states
- Added `.qa-list` and `.qa-item` styles (~50 lines):
  - Card-style Q&A items
  - Blue accent left border on answers
  - Timestamp and question/answer formatting

## 5. Commands Run

| Command | Result |
|---------|--------|
| `npm run build` | ✅ Pass — extension.js 141.4kb, webview main.js 2.7mb, main.css 23.3kb |
| `npm run lint` | ✅ Pass — no errors |
| `npm run test:unit` | ✅ Pass — 127 tests passing (74ms) |
| `npx tsc --noEmit` | ✅ Pass — no TypeScript errors |
| `TS_NODE_PROJECT=tsconfig.test.json npx tsc -p tsconfig.test.json --noEmit` | ⚠️ Pre-existing error: @types/glob not found (unrelated to our changes) |

## 6. Result

**Achieved:**
- Full "Enhance" feature implemented end-to-end across 7 files
- Users can click "Enhance" on any analysis page to open a dialog
- They can type any question or enhancement request in multi-line textarea
- The extension sends the prompt to the LLM with full context (existing analysis + source code + previous Q&A)
- The LLM response is parsed and the answer is stored as a Q&A entry
- Optionally, the LLM can also update the overview, add key points, or flag new issues
- All Q&A entries are persisted in the cache markdown file and survive across sessions
- Previous Q&A history is included in the prompt for conversational continuity
- The dialog supports keyboard shortcuts (Ctrl+Enter to submit, Escape to close)

**Verification:**
- Build passes cleanly
- No lint errors
- All 127 existing unit tests pass
- No TypeScript type errors introduced
- Pre-existing glob type error is unrelated

**Follow-up potential:**
- Could add a "clear Q&A" button to remove all Q&A history for a symbol
- Could add syntax highlighting in Q&A answers (currently plain text)
- Could add unit tests for `parseEnhanceResponse()` and `buildEnhance()`

## 7. Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| `src/models/types.ts` | Modified | Added `QAEntry` interface, `qaHistory` field on `AnalysisResult`, `enhanceAnalysis` message type |
| `src/analysis/AnalysisOrchestrator.ts` | Modified | Added `enhanceAnalysis()` method for the enhance pipeline |
| `src/llm/PromptBuilder.ts` | Modified | Added `buildEnhance()` static method for enhance prompts |
| `src/llm/ResponseParser.ts` | Modified | Added `EnhanceParseResult` interface and `parseEnhanceResponse()` method |
| `src/ui/CodeExplorerViewProvider.ts` | Modified | Added `enhanceAnalysis` message handler and `_handleEnhanceAnalysis()` method |
| `src/cache/CacheStore.ts` | Modified | Added Q&A serialization/deserialization in `_serialize()`/`_deserialize()` |
| `webview/src/main.ts` | Modified | Added Enhance button, Q&A rendering, and modal dialog |
| `webview/src/styles/main.css` | Modified | Added styles for enhance bar, dialog, and Q&A section |
| `docs/copilot-executions/10-enhance-analysis-feature.md` | Created | This execution log |
