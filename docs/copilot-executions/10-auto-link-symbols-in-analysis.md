# 10 - Auto-Link Symbol Names Across All Analysis Sections

**Date**: 2026-03-29 00:00 UTC
**Prompt**: "Ensure that anywhere in any analysis if you are referring to any class or data structure or variable or a method invocation, then the UI should show a link on that word or line which is clickable, which navigates to either the symbol in the code, or opens a new LLM analysis tab for that symbol. Make the documentation highly interconnected."

## 1. Code Reading & Analysis
- Read `webview/src/main.ts` (951 lines) — full webview renderer
- Read `src/models/types.ts` — all analysis data structures (`AnalysisResult`, `SubFunctionInfo`, `ClassMemberInfo`, `MemberAccessInfo`, `RelatedSymbolAnalysis`, etc.)
- Read `src/ui/CodeExplorerViewProvider.ts` — `exploreSymbol` message handler, `_exploreSymbolByName()` method
- Read `webview/src/styles/main.css` — existing styles

Identified sections with plain-text symbol references needing linking:
1. **Overview** — free-text mentioning symbol names
2. **Step-by-step breakdown** — descriptions referencing functions/types
3. **Sub-function descriptions** — mentioning other symbols
4. **Function input descriptions** — mentioning types/functions
5. **Function output descriptions** — mentioning types
6. **Class member names** — should link to source line
7. **Class member types** — should link to type definition
8. **Class member descriptions** — mentioning other symbols
9. **Member access `memberName`** — should link to member
10. **Member access `readBy`/`writtenBy`** — should link to methods
11. **Variable lifecycle** — all text fields
12. **Data flow descriptions** — mentioning symbols
13. **Key points** — mentioning symbols
14. **Relationship `targetName`** — should be an explore link
15. **Dependencies** — mentioning symbols
16. **Usage pattern** — mentioning symbols
17. **Potential issues** — mentioning symbols
18. **Q&A answers** — mentioning symbols
19. **Call stack chain** — mentioning symbols
20. **Data kind description/references** — mentioning symbols

## 2. Issues Identified
- All free-text content used `esc()` only — no linking of symbol names
- Class member names were plain `<span>` text — no navigation
- Class member type names were plain `<code>` text — no linking
- Member access `readBy`/`writtenBy` were comma-joined strings — no links
- Relationship `targetName` was plain escaped text — no explore link
- Data kind references were plain text

## 3. Plan
Two-pronged approach:
1. **Auto-linking engine** (`_buildKnownSymbols` + `_autoLinkSymbols`): Build a dictionary of known symbols from all structured analysis data (subFunctions, functionInputs, callStacks callers, relationships, relatedSymbols, classMembers). Scan free-text for word-boundary matches and wrap in `<a class="symbol-link">`.
2. **Direct symbol links** (`_symbolExploreLink`): For structured data with explicit symbol names (class member names, member access readBy/writtenBy, relationship targetName), render directly as explore links.

Combined with existing `.symbol-link` click handler that sends `exploreSymbol` message → opens new analysis tab.

## 4. Changes Made

### `webview/src/main.ts`

**New infrastructure (3 interfaces + 4 functions):**

- `KnownSymbol` interface — `{ name, filePath?, line?, kind? }`
- `_buildKnownSymbols(analysis)` — Extracts known symbols from subFunctions, functionInputs, functionOutput, callStacks, relationships, relatedSymbols, classMembers. Deduplicates by name, filters names < 3 chars, sorts by length descending (longest-first matching).
- `_autoLinkSymbols(escapedText, knownSymbols)` — Regex-based scanner that finds word-boundary-delimited occurrences of known symbol names in already-escaped HTML text. Tracks replacement ranges to avoid overlaps. Returns HTML with `<a class="symbol-link">` wrappers.
- `_escAndLink(text, knownSymbols)` — Convenience: `esc()` then `_autoLinkSymbols()`.
- `_symbolExploreLink(name, filePath?, line?, kind?)` — Renders a single symbol as an `<a class="symbol-link">` for structured data where we know the symbol info directly.

**Section-by-section changes:**

| Section | Before | After |
|---------|--------|-------|
| Overview | `esc(a.overview)` | `_escAndLink(a.overview, ks)` |
| Step-by-step | `esc(s.description)` | `_escAndLink(s.description, ks)` |
| Sub-function desc/io | `esc(sf.description)`, `esc(sf.input)`, `esc(sf.output)` | `_escAndLink(...)` |
| Function input desc | `esc(p.description)`, `esc(p.mutationDetail)`, `esc(p.typeOverview)` | `_escAndLink(...)` |
| Function output | `esc(out.description)`, `esc(out.typeOverview)` | `_escAndLink(...)` |
| Class member name | `esc(m.name)` | `_symbolExploreLink()` if has line + filePath |
| Class member type | `esc(m.typeName)` | `_escAndLink(m.typeName, ks)` |
| Class member desc | `esc(m.description)` | `_escAndLink(m.description, ks)` |
| Member access memberName | `esc(ma.memberName)` | `_symbolExploreLink(ma.memberName, ...)` |
| Member access readBy | `esc(readers)` (comma-joined) | Individual `_symbolExploreLink()` per name |
| Member access writtenBy | `esc(writers)` (comma-joined) | Individual `_symbolExploreLink()` per name |
| Variable lifecycle | All `esc()` calls | All `_escAndLink()` calls |
| Data flow desc | `esc(df.description)` | `_escAndLink(df.description, ks)` |
| Key points | `esc(m)` | `_escAndLink(m, ks)` |
| Relationship targetName | `esc(r.targetName)` | `_symbolExploreLink(r.targetName, ...)` |
| Dependencies | `esc(d)` | `_escAndLink(d, ks)` |
| Usage pattern | `esc(a.usagePattern)` | `_escAndLink(a.usagePattern, ks)` |
| Potential issues | `esc(i)` | `_escAndLink(i, ks)` |
| Q&A answers | `esc(qa.answer)` | `_escAndLink(qa.answer, ks)` |
| Call stack chain | `esc(chain)` | `_escAndLink(chain, ks)` |
| Data kind desc | `esc(dk.description)` | `_escAndLink(dk.description, ks)` |
| Data kind references | `esc(ref)` | `_escAndLink(ref, ks)` |

## 5. Commands Run
- `npm run build` — ✅ Pass (extension: 141.4kb, webview: main.js 2.7mb + main.css 23.3kb)
- `npm run lint` — ✅ Pass (no errors)
- `npm run test:unit` — ✅ Pass (127 passing)

## 6. Result
The analysis sidebar is now highly interconnected:

1. **Structured symbols** (class members, member access, relationship targets) are directly clickable explore links — clicking opens a new analysis tab for that symbol.
2. **Free-text content** (overview, descriptions, lifecycle, data flow, Q&A, etc.) is automatically scanned for known symbol names and those names become clickable links.
3. The known symbol dictionary is built from all available analysis data: sub-functions, input/output types, callers, relationships, related symbols, and class members.
4. Word-boundary matching prevents false positives (e.g., "get" inside "getUser" won't match if "get" is a known symbol).
5. Names shorter than 3 characters are excluded to avoid false positives on common variable names.

Users can now jump between symbols freely — from overview text to a sub-function, from a class member description to a related type, from a data flow description to the called function, etc.

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `webview/src/main.ts` | Modified | Added auto-linking engine (KnownSymbol, _buildKnownSymbols, _autoLinkSymbols, _escAndLink, _symbolExploreLink) and updated 20+ text rendering points to use auto-linking |
| `docs/copilot-executions/10-auto-link-symbols-in-analysis.md` | Created | This execution log |
