# 10 - Render Mermaid Diagrams Embedded in Q&A Answers

**Date**: 2026-03-29 UTC
**Prompt**: "The mermaid diagrams, present in q-a section is not being rendered. If mermaid diagrams are embedded in md, they should be rendered on ui"

## 1. Code Reading & Analysis

- `webview/src/main.ts` (full file, 1149 lines) — Read to understand the Q&A rendering pipeline:
  - Line 806: Q&A answers rendered via `_escAndLink(qa.answer, ks)` which HTML-escapes everything
  - Line 387-389: `_escAndLink` just calls `esc()` then `_autoLinkSymbols()` — no markdown/mermaid handling
  - Lines 1105-1141: `renderMermaidDiagrams()` only processes `.diagram-container[data-mermaid-source]` elements
  - Lines 780-792: The structured `a.diagrams` array creates proper placeholder divs, but embedded mermaid blocks in free-text fields get escaped to plain text

## 2. Issues Identified

1. **Q&A answer text with mermaid blocks is fully HTML-escaped** (webview/src/main.ts:806) — When the LLM returns a Q&A answer containing ` ```mermaid\nflowchart TD\n  A-->B\n``` `, the `_escAndLink()` function escapes all the backticks and angle brackets, rendering them as literal text instead of diagrams.

2. **No fenced code block parsing in any free-text field** — The same issue affects the overview field and any other free-text fields that use `_escAndLink()`. The webview has no mechanism to detect ` ```mermaid ``` ` blocks within arbitrary text content and convert them to renderable diagram placeholders.

3. **Q&A answer CSS uses `white-space: pre-wrap`** (main.css:1433) — This preserves whitespace but prevents any HTML structure within the answer. Needs to be removed since we're now generating proper HTML with `<br>`, `<pre>`, and `<div>` elements.

## 3. Plan

Add a new function `_renderMarkdownWithMermaid()` that:
1. Scans raw text for ` ```mermaid\n...\n``` ` fenced code blocks using regex
2. Extracts each mermaid block and creates a `<div class="diagram-container" data-mermaid-source="...">` placeholder
3. Handles generic ` ```lang\n...\n``` ` code blocks by rendering them as styled `<pre><code>` blocks
4. Escapes + auto-links all surrounding non-fenced text normally
5. Converts newlines to `<br>` for readability in the remaining text

Apply this function to the Q&A answer rendering and the overview field.

The existing `renderMermaidDiagrams()` async function already handles `.diagram-container[data-mermaid-source]` elements after DOM update — no changes needed there.

## 4. Changes Made

### `webview/src/main.ts`

**Added `_renderMarkdownWithMermaid()` function** (after `_escAndLink`):
- Uses regex `/```(\w*)\n([\s\S]*?)```/g` to find all fenced code blocks in raw text
- For `mermaid` blocks: creates `<div class="diagram-container" data-mermaid-source="...">` placeholder with loading spinner
- For other language blocks: renders as `<pre class="qa-code-block"><code>...</code></pre>`
- For surrounding non-fenced text: escapes + auto-links + converts `\n` to `<br>`

**Added `_renderPlainMarkdown()` helper**:
- Converts `\n` to `<br>` in already-escaped HTML

**Changed Q&A answer rendering** (line ~806):
- Before: `_escAndLink(qa.answer, ks)` — full escape, no markdown handling
- After: `_renderMarkdownWithMermaid(qa.answer, ks)` — detects and renders mermaid + code blocks

**Changed overview rendering** (line ~441):
- Before: `_escAndLink(a.overview, ks)`
- After: `_renderMarkdownWithMermaid(a.overview, ks)` — allows mermaid blocks in overview too

### `webview/src/styles/main.css`

**Modified `.qa-item__answer`**:
- Removed `white-space: pre-wrap` — no longer needed since `_renderMarkdownWithMermaid()` generates proper `<br>` tags

**Added `.qa-code-block` styles**:
- Styled `<pre>` block for generic (non-mermaid) code blocks appearing in Q&A answers
- VS Code themed background, border, font, overflow

**Added `.qa-code-block code` styles**:
- Monospace font, proper sizing, `white-space: pre`

**Added `.qa-item__answer .diagram-container` margin**:
- 8px vertical margin for mermaid diagrams embedded within Q&A text

## 5. Commands Run

| Command | Result |
|---------|--------|
| `npm run build` | Extension: 141.4kb, Webview: 2.7mb, CSS: 23.6kb — success |
| `npm run lint` | Zero errors |
| `npm run test:unit` | 127 passing (75ms) |
| `npm run format:check` | 4 files needed formatting |
| `npm run format` | Fixed 4 files |
| `npm run build` (rebuild) | Success |
| `npm run lint` (re-check) | Zero errors |
| `npm run test:unit` (re-check) | 127 passing |

## 6. Result

Mermaid diagrams embedded in Q&A answers (and overview text) are now detected and rendered as interactive SVGs. The flow is:

1. LLM returns Q&A answer containing ` ```mermaid\n...\n``` `
2. `_renderMarkdownWithMermaid()` splits the text on fenced block boundaries
3. Mermaid blocks become `<div class="diagram-container" data-mermaid-source="...">` placeholders
4. Non-mermaid code blocks become styled `<pre><code>` elements
5. Surrounding text gets escaped + auto-linked + line-break converted
6. After DOM update, `renderMermaidDiagrams()` picks up all `.diagram-container[data-mermaid-source]` elements (both from structured `a.diagrams` AND from inline Q&A text) and renders them via `mermaid.render()`
7. On render failure, the raw mermaid source is shown as a fallback code block

## 7. Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| `webview/src/main.ts` | Modified | Added `_renderMarkdownWithMermaid()` + `_renderPlainMarkdown()`, changed Q&A answer + overview rendering |
| `webview/src/styles/main.css` | Modified | Removed `white-space: pre-wrap` from `.qa-item__answer`, added `.qa-code-block` and inline diagram margin styles |
| `docs/copilot-executions/10-render-mermaid-in-qa.md` | Created | This execution log |
