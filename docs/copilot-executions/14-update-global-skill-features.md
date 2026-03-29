# 14 - Update Global Skill to Include Mermaid Diagrams, Code Links, and Related Symbols

**Date**: 2026-03-29 00:00 UTC
**Prompt**: "Ensure that the global claude skill install command knows about latest features like mermaid, code links, etc"

## 1. Code Reading & Analysis
- Read `src/skills/SkillInstaller.ts` (lines 1-621) — the full skill installer including `_buildSharedSkillContent()` which generates the skill instruction text
- Read `src/llm/PromptBuilder.ts` (lines 300-397) — the actual unified prompt that includes `json:diagrams` and `json:related_symbol_analyses` sections with full format specifications
- Read `src/cache/CacheStore.ts` (lines 780-903) — how the cache serializes diagrams (both `mermaid` fenced blocks AND `json:diagrams`), Q&A history (`json:qa_history`)
- Read `.context/FLOORPLAN.md` (lines 36-83) — feature matrix showing all implemented features including:
  - Mermaid diagram generation (`json:diagrams`)
  - Mermaid diagram rendering (SVG in webview)
  - Interactive Q&A enhancement (✨ Enhance button)
  - Q&A history persistence in cache
  - Auto-linking symbols in analysis text
  - Clickable file:line references
- Grepped for `json:diagrams`, `json:qa_history`, `json:related_symbol_analyses` across `src/` to understand all usages

## 2. Issues Identified
- `src/skills/SkillInstaller.ts`, `_buildSharedSkillContent()` — **6 features missing** from the installed skill:

  1. **Mermaid Diagrams section** (`json:diagrams` + ````mermaid` fences) — completely absent from the skill template
     - The actual PromptBuilder includes detailed Mermaid instructions (line 313-333)
     - The CacheStore serializes both `mermaid` fenced blocks AND `json:diagrams` (lines 782-797)

  2. **Related Symbol Analyses** (`json:related_symbol_analyses`) — completely absent
     - The PromptBuilder includes this section (lines 356-397) with cache_file_path, full analysis entry format
     - The ResponseParser parses it (line 206-267)
     - The Orchestrator pre-caches them

  3. **Clickable file:line references** — the skill doesn't mention the `\`filePath:line\`` format that the webview auto-detects and makes clickable

  4. **Section Inclusion Rules table** — missing "Diagrams" and "Related Symbol Analyses" rows

  5. **Line number convention** — the skill only said "Use 0-based line numbers" but the actual convention is 0-based in JSON/YAML and 1-based in human-readable markdown text

  6. **Important Rules** — missing rules about mermaid fences and clickable file references

## 3. Plan
- Update `_buildSharedSkillContent()` to add all missing features:
  1. Add Step 3q: Mermaid Diagrams — with instructions matching PromptBuilder
  2. Add Step 3r: Related Symbol Analyses — with `json:related_symbol_analyses` format
  3. Add Diagrams section in the cache file template (Step 5) with both ````mermaid` and ````json:diagrams` blocks
  4. Add Related Symbol Analyses section in the cache file template
  5. Update Section Inclusion Rules table with Diagrams and Related Symbol Analyses rows
  6. Add "Clickable File:Line References" subsection explaining the `filePath:line` format
  7. Add "Related Symbol Cache File Naming" subsection with examples
  8. Add "Mermaid Diagram Guidelines" subsection
  9. Update Important Rules with mermaid, file reference, and line number conventions
- Keep the overall structure unchanged — just extend it with the missing sections

## 4. Changes Made

### File: `src/skills/SkillInstaller.ts` — `_buildSharedSkillContent()` method

**Step 3 additions (analysis sections):**
- Added **3q. Mermaid Diagrams** — describes when to use flowchart/sequence/class diagrams, Mermaid syntax requirements, conciseness guidelines
- Added **3r. Related Symbol Analyses** — describes gathering related symbols for pre-caching with cache file path

**Step 5 (cache file template) additions:**
- Added `## Diagrams` section template showing the dual format: human-readable ````mermaid` block + machine-readable ````json:diagrams` block, matching the exact CacheStore serialization format
- Added `## Related Symbol Analyses` section template with ````json:related_symbol_analyses` block

**Section Inclusion Rules table update:**
- Added `Diagrams` row: ✓ for function/method, ✓ for class/struct/interface, ✓ for variable/property, — for enum, — for parameter
- Added `Related Symbol Analyses` row: ✓ for function/method, ✓ for class/struct/interface, ✓ for variable/property, ✓ for enum, — for parameter

**New subsections after the table:**
- **Clickable File:Line References** — explains the `` `filePath:line` `` backtick format that the webview auto-detects, with examples like `` `src/cache/CacheStore.ts:78` ``
- **Related Symbol Cache File Naming** — explains the cache_file_path convention with concrete examples
- **Mermaid Diagram Guidelines** — concise rules: valid syntax, ≤20 nodes, short labels, dual fenced blocks required, webview renders as interactive SVG

**Important Rules updates (rules 1-13, was 1-10):**
- Rule 2: Split into two rules — 0-based in YAML/JSON, 1-based in human-readable markdown
- Rule 3 (new): Added "Use 1-based line numbers in human-readable markdown text"
- Rule 7 (new): "Mermaid blocks use ````mermaid` fences — the webview renders them as interactive SVG diagrams"
- Rule 13 (new): "Format file references as clickable links — use `` `filePath:line` `` format throughout"

## 5. Commands Run
- `npm run build` → ✅ Success (extension 156.3kb — grew by 6kb from added skill content)
- `npm run lint` → ✅ Clean
- `npm run test:unit` → ✅ 139 passing (82ms)

## 6. Result
The global skill installed by "Install Global Skills" now covers all current Code Explorer features:
- **Mermaid diagrams**: Step 3q + Diagrams section in template + Guidelines subsection
- **Clickable file:line references**: Clickable File:Line References subsection + Important Rule #13
- **Related symbol pre-caching**: Step 3r + Related Symbol Analyses section in template + Cache File Naming subsection
- **Updated section inclusion table**: Diagrams and Related Symbol Analyses rows added
- **Line number conventions**: Clarified 0-based vs 1-based usage

Q&A History (`json:qa_history`) was intentionally NOT added to the skill because it is only generated by the interactive ✨ Enhance feature (which requires the VS Code webview), not by the initial analysis that the skill performs.

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `src/skills/SkillInstaller.ts` | Modified | Updated `_buildSharedSkillContent()` to include mermaid diagrams, related symbol analyses, clickable file:line references, and updated section inclusion rules |
| `docs/copilot-executions/14-update-global-skill-features.md` | Created | Execution log |
