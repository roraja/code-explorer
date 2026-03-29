# 08 - Mermaid Diagrams in Webview Planning

**Date**: 2026-03-29 UTC
**Prompt**: "I want to be able to see mermaid diagrams in the LM analysis page view on the sidebar. Give me top three options to achieve this and log this in docs slash next. Don't implement yet. Just give me the best plan possible."

## 1. Code Reading & Analysis

- `.context/FLOORPLAN.md` — Read to understand module routing and overall architecture
- `webview/src/main.ts` (1-687) — Read entire file to understand the webview rendering pipeline: vanilla TS, innerHTML-based rendering, `postMessage` state flow, all section rendering functions, event listeners, helper functions
- `src/ui/CodeExplorerViewProvider.ts` (1-511) — Read entire file to understand: CSP policy (lines 486-490: `default-src 'none'`, `script-src 'nonce-${nonce}'`, `style-src ${webview.cspSource} 'nonce-${nonce}'`), HTML template generation, `postMessage` routing, tab management
- `webview/esbuild.config.mjs` (1-37) — Read to understand build setup: single IIFE entry point, esbuild bundler, browser platform target
- `src/llm/ResponseParser.ts` (1-1034) — Read entire file to understand the JSON block parsing pattern: regex-based extraction of fenced `json:*` blocks, consistent parse-filter-map pattern across 10+ block types
- `src/llm/PromptBuilder.ts` (1-557) — Read entire file to understand prompt structure: `buildUnified()` method (lines 88-376) that specifies all JSON output blocks the LLM must produce
- `webview/src/styles/main.css` (1-1061) — Read entire file to understand CSS conventions: VS Code theme variables only, no hardcoded colors, BEM naming
- `src/models/types.ts` (1-210) — Read to understand `AnalysisResult` interface (lines 121-162) with all optional fields, and `DiagramEntry` would need to follow the same pattern
- `package.json` (1-50) — Read to check dependencies and VS Code engine requirements
- `docs/next/01-symbol-identity-and-cache-keys.md` — Read to understand the format/convention for `docs/next/` planning documents

## 2. Issues Identified

No bugs found — this was a planning exercise. Key constraints identified:

1. **CSP restriction** (CodeExplorerViewProvider.ts:486-490): The webview has `default-src 'none'` and `script-src 'nonce-${nonce}'`. Mermaid.js injects inline `<style>` elements, which would be blocked by the current `style-src` policy. This is the primary technical risk.

2. **Single IIFE bundle** (webview/esbuild.config.mjs:8-22): The webview is one bundle. Adding mermaid (~2.5 MB) would significantly increase bundle size from ~50 KB to ~2.5 MB.

3. **innerHTML rendering pattern** (webview/src/main.ts:77-92): The webview uses `innerHTML` assignment to render content. Mermaid needs DOM elements to exist before rendering, requiring a post-render callback pattern.

4. **No existing diagram field** (src/models/types.ts:121-162): `AnalysisResult` has no diagram field. A new `DiagramEntry` type and `diagrams?` field must be added.

## 3. Plan

- Researched three distinct approaches: (1) bundle mermaid.js directly in the webview, (2) render SVG server-side in the extension host, (3) lazy-load mermaid as a separate webview script
- Evaluated each against: bundle size, CSP compatibility, render quality, implementation complexity, maintenance burden, risk
- Recommended Option 1 (bundle mermaid) as the best balance of simplicity and capability
- Wrote a comprehensive planning document at `docs/next/02-mermaid-diagrams-in-webview.md`

## 4. Changes Made

- **Created** `docs/next/02-mermaid-diagrams-in-webview.md` — Comprehensive planning document with three options, detailed implementation plans for each, comparison matrix, recommendation, and implementation order

No code changes made (planning only, as requested).

## 5. Commands Run

No build/test commands run — this was a planning-only task.

## 6. Result

Created a thorough planning document with:
- Three distinct approaches (bundle mermaid, server-side SVG, lazy-load split)
- Detailed pipeline changes for each (prompt, parser, types, cache, webview, CSP)
- Implementation code sketches for each option
- Pros/cons analysis with risk assessment tables
- Comparison matrix across 12 criteria
- Clear recommendation (Option 1) with rationale
- Three-phase implementation order
- Complete list of files to touch
- Open questions for future decisions

## 7. Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| `docs/next/02-mermaid-diagrams-in-webview.md` | Created | Comprehensive planning document with three options for Mermaid diagram rendering in the webview sidebar |
| `docs/copilot-executions/08-mermaid-diagrams-planning.md` | Created | This execution log |
