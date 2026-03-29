# 16 - Ten Improvement Ideas for Code Explorer

**Date**: 2026-03-29 00:00 UTC
**Prompt**: "Go through the current code / features and come up with 10 ideas on how to improve this product to help better understand code. Log in md in docs/next"

## 1. Code Reading & Analysis

Files read to understand the full codebase and identify improvement opportunities:

| File | Why |
|------|-----|
| `.context/FLOORPLAN.md` | Understand module routing, current features, data flow, and what's not yet implemented |
| `CLAUDE.md` | Project conventions, architecture overview, implemented vs planned features, LLM gotchas |
| `src/extension.ts` | Entry point — see all registered commands, DI wiring, understand activation flow |
| `src/analysis/AnalysisOrchestrator.ts` | Core pipeline — cache check → source read → LLM → parse → cache write; enhance flow; file analysis flow |
| `src/analysis/StaticAnalyzer.ts` | **Key finding**: `findReferences()`, `buildCallHierarchy()`, `getTypeHierarchy()` are implemented but NOT wired into the pipeline |
| `src/ui/CodeExplorerViewProvider.ts` | Tab management, message routing, session persistence, webview HTML generation |
| `src/llm/PromptBuilder.ts` | Strategy-based prompts, unified prompt, file analysis prompt, enhance prompt; `_guessLanguage` supports many langs but extension only supports JS/TS |
| `src/llm/prompts/FunctionPromptStrategy.ts` | Detailed function analysis prompt — TypeScript-specific idioms |
| `src/llm/ResponseParser.ts` | Regex-based JSON block extraction, symbol identity parsing, related symbol parsing |
| `src/cache/CacheStore.ts` | Markdown cache with YAML frontmatter, findByCursor, findByCursorWithLLMFallback, listCachedSymbols |
| `src/models/types.ts` | All interfaces — AnalysisResult, SymbolInfo, CursorContext, metadata with stale/hash fields (always empty), MasterIndex (not implemented) |
| `src/models/constants.ts` | SUPPORTED_LANGUAGES (JS/TS only), WATCHED_EXTENSIONS, CONFIG keys (showHoverCards defined but unused), QUEUE settings |
| `webview/src/main.ts` | Full webview renderer — tab bar, analysis sections, mermaid diagrams, auto-linking, enhance Q&A |
| `docs/01-prd.md` | Pain points (tracing call stacks, data flow, onboarding), personas, time savings estimates |
| `docs/07-ui_ux_design.md` | Wireframes, design principles, planned UI components |
| `docs/next/01-symbol-identity-and-cache-keys.md` | Cache key problems documented |
| `docs/next/02-mermaid-diagrams-in-webview.md` | Mermaid implementation plan (already implemented) |

Key observations from code reading:
- `StaticAnalyzer` has 3 major methods that are fully implemented but zero-wired into the orchestrator (lines 16-131 of StaticAnalyzer.ts)
- `AnalysisMetadata.sourceHash` is always `''` — no hash computation exists anywhere
- `AnalysisMetadata.dependentFileHashes` is always `{}` — no cross-file dependency tracking
- `AnalysisMetadata.stale` is defined and checked by the orchestrator, but nothing ever sets it to `true`
- `CONFIG.SHOW_HOVER_CARDS` is defined in constants but no HoverProvider exists
- `SUPPORTED_LANGUAGES` only has 4 JS/TS entries despite `_guessLanguage()` supporting 8 languages
- No file watcher exists despite `WATCHED_EXTENSIONS` being defined
- No navigation history or breadcrumb trail in the tab system
- No CodeLens provider despite being mentioned in design docs
- The webview has no graph/visualization beyond individual Mermaid diagrams per symbol

## 2. Issues Identified

No bugs per se — this was an exploratory/ideation prompt. But the analysis revealed several architectural gaps:

1. **Static analysis is wasted**: `StaticAnalyzer` methods are implemented but produce zero value because they're never called
2. **Cache staleness is undetectable**: No file watcher, no hash computation, no way to know analysis is outdated
3. **Language support is artificially restricted**: LLM can analyze any language but extension blocks non-JS/TS
4. **No inline presence**: All analysis lives in a sidebar — nothing in the editor itself (no hover, no CodeLens)
5. **No navigation history**: Tab model loses the exploration journey

## 3. Plan

- Read all key source files to understand current architecture, implemented features, and gaps
- Cross-reference with design docs (PRD, implementation plan) for planned-but-unbuilt features
- Cross-reference with constants/types for defined-but-unused fields and configs
- Identify 10 improvements that are:
  - Grounded in actual code gaps (not theoretical)
  - Actionable (specify which modules to change)
  - Varied in effort/impact (mix of quick wins and big bets)
  - Focused on the core mission: "help developers understand code"
- Write up in `docs/next/03-ten-improvement-ideas.md`
- Include a priority matrix with recommended implementation order

## 4. Changes Made

- **File created**: `docs/next/03-ten-improvement-ideas.md`
  - 10 detailed improvement ideas, each with: Problem, Idea, How it works, Why it matters, Modules affected
  - Priority matrix ranking by impact, effort, and data readiness
  - Recommended implementation order: 3 → 9 → 4 → 6 → 10 → 5 → 7 → 2 → 8 → 1

No code changes — this was a design/ideation prompt.

## 5. Commands Run

No build/test/lint commands — this was a documentation-only prompt.

## 6. Result

Created `docs/next/03-ten-improvement-ideas.md` with 10 concrete, code-grounded improvement ideas:

1. **Cross-Symbol Dependency Graph View** — interactive graph of all analyzed symbols
2. **Diff-Aware Analysis ("Explain This Change")** — compare current source vs cached analysis
3. **Wire Static Analysis Into Pipeline** — plug in the 3 existing unused StaticAnalyzer methods
4. **Hover Cards** — inline analysis preview on hover (no sidebar needed)
5. **Exploration History & Breadcrumbs** — track and navigate the investigation journey
6. **Smart Auto-Explore** — pre-analyze visible/open files in the background
7. **Multi-Language Support** — expand beyond JS/TS with language-aware prompts
8. **Compare Two Symbols** — structured side-by-side diff of two analyses
9. **Stale Cache Detection** — file watcher + hash-based invalidation
10. **CodeLens Annotations** — inline "why" labels on code lines from cached analysis

Each idea references specific files, line numbers, existing fields, and planned-but-unbuilt features from the codebase.

## 7. Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| `docs/next/03-ten-improvement-ideas.md` | Created | 10 improvement ideas with detailed specs, priority matrix, and recommended order |
| `docs/copilot-executions/16-ten-improvement-ideas.md` | Created | This execution log |
