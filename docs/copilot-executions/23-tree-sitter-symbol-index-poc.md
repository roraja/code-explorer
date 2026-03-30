# 23 - Tree-Sitter Symbol Index POC and Design Plan

**Date**: 2026-03-29 11:30 UTC
**Prompt**: "Can we use tree-sitter for basic AST analysis of source code to know what the given symbol is - i.e. function declaration or identifier within a method definition. This can be used to generate an accurate 'address' for a symbol being referred. Perform a small POC to check if this library would work and then come up with a plan to implement this in docs/next as an md file. In the plan, clearly tell how the symbol address would look, how the cache would be stored, how would it help in links navigation."

## 1. Code Reading & Analysis

Files read to understand current architecture:

| File | Why |
|------|-----|
| `.context/FLOORPLAN.md` | Understand workspace structure, data flow, current features |
| `src/providers/SymbolResolver.ts` (lines 1-274) | Current symbol resolution approach — uses VS Code document symbol provider |
| `src/cache/CacheStore.ts` (lines 1-1383) | Current cache storage — file naming, lookup strategies (findByCursor, LLM fallback) |
| `src/models/types.ts` (lines 1-766) | All interfaces: SymbolInfo, AnalysisResult, CursorContext, index types |
| `src/models/constants.ts` (lines 1-99) | CACHE constants, SYMBOL_KIND_PREFIX reuse opportunity |
| `package.json` (lines 1-282) | Current dependencies (only `mermaid`), build scripts |
| `sample-workspace/src/main.cpp` (lines 1-93) | C++ sample file for POC testing |
| `sample-workspace/src/UserService.cpp` (lines 1-87) | C++ class implementation for POC testing |
| `sample-workspace/include/UserService.h` (lines 1-37) | C++ header for class definition context |
| `sample-workspace/.vscode/code-explorer/src/main.cpp/fn.printBanner().md` (lines 1-45) | Existing cache file format (YAML frontmatter + markdown) |
| `webview/src/main.ts` (lines 1278-1324) | Current symbol link click handlers — how `exploreSymbol` and `navigateToSource` work |
| `webview/src/main.ts` (lines 613-680) | `_autoLinkSymbols()` and `_symbolExploreLink()` — how links are created |
| `docs/next/` directory listing | Confirmed 4 existing docs; new plan will be `05-` |
| `docs/copilot-executions/` directory listing | Confirmed last execution log is `22-`; this will be `23-` |

Key observations from code reading:
- `SymbolResolver.ts` line 186: kind detection for local variables is crude — checks if parent is a class → property, else → variable
- `CacheStore.ts` line 189-306: `findByCursor()` has a ±3 line tolerance and scans all `.md` files in the cache directory — O(n) per lookup
- Cache file naming uses `kind.Name.md` pattern, but the name is LLM-determined (line 621-636: `_buildCacheKey`)
- The webview's symbol links (line 654) only carry `name`, `filePath`, `line`, `kind` — no deterministic address
- `SYMBOL_KIND_PREFIX` in types.ts (line 33-45) already defines kind prefixes that we can reuse

## 2. Issues Identified

1. **No deterministic symbol addressing** — Current system relies on LLM to identify symbols (via `json:symbol_identity` block in response), making cache keys non-deterministic. Two LLM runs may name the same function differently (e.g., `printBanner` vs `printBanner()`).

2. **Cache lookup is O(n)** — `findByCursor()` at CacheStore.ts:184-306 scans all `.md` files in a directory, reads frontmatter from each, and compares name + line. With many cached symbols in one file, this is slow.

3. **Symbol links carry partial data** — Webview links at main.ts:654 have `data-symbol-name`, `data-symbol-file`, `data-symbol-line` but no unique identifier. Line numbers drift after edits, causing broken links.

4. **No workspace-wide symbol enumeration** — The `analyzeWorkspace` command (extension.ts) is a stub. Without a way to enumerate all symbols, this can't be implemented without expensive LLM calls.

5. **tree-sitter 0.21.1 has size limit** — During POC, files >~30KB failed to parse with `Invalid argument` error. Required upgrading to 0.22.4.

## 3. Plan

**Approach**: Run a tree-sitter POC in an isolated directory (`poc/tree-sitter/`) to validate C++ and TypeScript parsing, symbol extraction, scope chain building, cursor resolution, and index construction. Then document a comprehensive implementation plan in `docs/next/05-tree-sitter-symbol-index.md`.

**Alternatives considered**:
- **web-tree-sitter only**: Better for distribution but harder to set up in a quick POC. Noted in plan as recommendation for production.
- **VS Code built-in symbol provider**: Already used in `SymbolResolver.ts` but requires VS Code runtime, can't enumerate local variables, and can't run headless.
- **regex-based parsing**: Fragile, doesn't handle nested scopes, not language-aware.

## 4. Changes Made

### POC files created

**`poc/tree-sitter/poc.js`** (new file, 300 lines):
- TEST 1: Parses `sample-workspace/src/main.cpp` into AST using `tree-sitter-cpp`
- TEST 2: Extracts all 16 symbols from `main.cpp` with kind, scope chain, and addresses
- TEST 3: Resolves cursor positions (line 14→`fn.printBanner`, line 28→`fn.main`, line 31→`main::var.arg`, line 10→`var.MAX_USERS`)
- TEST 4: Parses `src/cache/CacheStore.ts` (46KB) and extracts 151 symbols including nested class methods and local variables
- TEST 5: Parses `sample-workspace/src/UserService.cpp` with namespace-scoped class methods
- TEST 6: Builds a symbol index mapping name → address → cache path
- TEST 7: Tests symbol link resolution with disambiguation by file context
- TEST 8: Enumerates all AST node types encountered in C++ and TypeScript

**`poc/tree-sitter/package.json`** (auto-generated by `npm init`):
- Dependencies: `tree-sitter@0.22.4`, `tree-sitter-cpp@0.23.4`, `tree-sitter-typescript@0.23.2`

### Design document created

**`docs/next/05-tree-sitter-symbol-index.md`** (new file):
- Section 1: Problem statement (5 concrete issues)
- Section 2: POC results table (all tests passed)
- Section 3: Symbol address format specification with examples
- Section 4: Symbol index data structure (in-memory + on-disk)
- Section 5: How the index helps (5 use cases with flow diagrams)
- Section 6: Phased implementation plan (5 sprints)
- Section 7: Migration strategy (backward compatibility)
- Section 8: Performance characteristics table
- Section 9: Risk assessment matrix
- Section 10: Testing plan
- Section 11: Open questions

No changes made to any existing source files.

## 5. Commands Run

| Command | Result |
|---------|--------|
| `mkdir -p poc/tree-sitter && npm init -y` | Created POC directory |
| `npm install tree-sitter tree-sitter-cpp tree-sitter-typescript tree-sitter-python tree-sitter-c-sharp tree-sitter-java` | FAILED — peer dep conflicts between tree-sitter versions |
| `npm install tree-sitter@0.21.1 tree-sitter-cpp tree-sitter-typescript` | OK — installed with warnings |
| `node poc.js` (first run, tree-sitter 0.21.1) | PARTIAL — C++ tests passed, TypeScript CacheStore.ts (46KB) failed with "Invalid argument" |
| `npm install tree-sitter@0.22.4 tree-sitter-typescript@0.23.2 tree-sitter-cpp@0.23.4 --legacy-peer-deps` | OK — upgraded tree-sitter |
| Various `node -e "..."` tests | Confirmed tree-sitter 0.22.4 handles all file sizes |
| `node poc.js` (second run, tree-sitter 0.22.4) | PASS — All 8 tests passed, 16 C++ symbols, 151 TypeScript symbols, 19 namespaced C++ class symbols |
| `npm install web-tree-sitter --legacy-peer-deps` | OK — installed WASM alternative |
| `node -e "const { Parser } = require('web-tree-sitter'); Parser.init()..."` | OK — web-tree-sitter initializes correctly |

## 6. Result

### POC Outcome: PASS

Tree-sitter works excellently for the intended use case:
- **C++ parsing**: Correctly identifies functions, variables, namespaces, qualified identifiers, scope chains
- **TypeScript parsing**: Correctly identifies classes, methods, properties, interfaces, type aliases, local variables
- **Cursor resolution**: Given a line/column, correctly returns the deepest enclosing symbol
- **Symbol addressing**: Produces deterministic, human-readable addresses like `src/main.cpp#main::var.logger`
- **Symbol index**: Maps symbol names to addresses to cache paths, enabling O(1) lookups and disambiguation

### Design Document Produced

`docs/next/05-tree-sitter-symbol-index.md` contains a complete implementation plan covering:
- Symbol address format specification with overload discriminator (`~XXXX` suffix)
- Overload disambiguation via parameter signature hashing (Section 3.1)
- Code change resilience analysis — addresses are AST-derived, never line-number-based (Section 3.2)
- Disambiguation context menu (QuickPick) when multiple symbols match a name (Section 5.2.1)
- Index data structure (in-memory Map-based lookups + JSON persistence)
- 5-phase implementation plan with file-level detail
- Migration strategy for backward compatibility with existing cache files
- Performance projections (<10ms per file parse, <2s for 100-file workspace)
- Risk assessment (8 risks including overload edge cases) and testing plan (18 test cases)

### Remaining Follow-up
- Decide native vs WASM (recommendation: WASM for production)
- Implement Phase 1 when ready to proceed
- The POC code in `poc/tree-sitter/` can be cleaned up or kept as a reference

## 7. Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| `poc/tree-sitter/poc.js` | Created | Tree-sitter POC: 8 tests covering C++ parsing, TS parsing, symbol extraction, cursor resolution, index building, link resolution |
| `poc/tree-sitter/package.json` | Created | POC npm package with tree-sitter dependencies |
| `poc/tree-sitter/node_modules/` | Created | Installed dependencies (tree-sitter, tree-sitter-cpp, tree-sitter-typescript, web-tree-sitter) |
| `docs/next/05-tree-sitter-symbol-index.md` | Created | Comprehensive design plan for tree-sitter symbol index implementation |
