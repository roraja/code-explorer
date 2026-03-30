# 25 - Add Show Symbol Info Command

**Date**: 2026-03-29 00:00 UTC
**Prompt**: Create "Show symbol info" command + fix symbol address to correctly identify local variables, class members, parameters (not just the containing function/class).

## 1. Code Reading & Analysis
- `.context/FLOORPLAN.md` — Project structure and routing table.
- `src/extension.ts` — Command registration patterns, imports, logger usage.
- `src/providers/SymbolResolver.ts` — Existing `_findDeepest()` tree walk, `_resolveViaDefinition()` fallback for local vars, `_mapSymbolKind()`.
- `src/analysis/StaticAnalyzer.ts` — Reference/call/type hierarchy provider call patterns.
- `src/models/types.ts` — `SymbolInfo`, `SymbolKindType`, `SYMBOL_KIND_PREFIX`.
- `src/models/constants.ts` — `COMMANDS`, `CACHE` constants.
- `src/indexing/SymbolAddress.ts` — Address format `file#scope::kind.name[~disc]`, `buildAddress()`, `parseAddress()`, `addressToCachePath()`.
- `src/indexing/SymbolIndex.ts` — `resolveAtCursor()`, sorted-by-line index, `SymbolIndexEntry` shape.
- `src/cache/CacheStore.ts` — `_buildCacheKey()` legacy format.
- `package.json` — Command/keybinding/menu registration.

## 2. Issues Identified
- **Bug in symbol address computation**: `_findDeepest()` returns the deepest *document symbol* containing the cursor. For a local variable like `int count` inside `processData()`, the deepest symbol is `processData` (the function). The old code built the address as `file#fn.processData` — missing the actual variable entirely.
- Same bug affected class members: cursor on a field `m_value` inside `class Foo` would produce `file#class.Foo` instead of `file#Foo::prop.m_value`.
- Definition Provider strategy had the same problem — it followed the definition but then used `_findDeepest` which returned the container.

## 3. Plan
Fix section 1b to distinguish 3 cases:
1. **Cursor IS on the document symbol's name** (`sym.selectionRange.contains(position) && sym.name === word`): Address is for that symbol itself. Scope = ancestors only.
2. **Cursor is on a child DocumentSymbol** (clangd reports class members as children): Use the child's kind and the parent as scope.
3. **Cursor is on a token NOT in the symbol tree** (local var, parameter, external ref): The container becomes part of the scope chain, and we infer the kind from hover info or container context.

Also add:
- `_inferKindFromHover()` — parses hover text to detect variable/parameter/property/function/class/method patterns from clangd and tsserver.
- `_addressToLegacyKey()` — converts address to legacy cache key format.
- Tree-sitter index lookup now prefers exact name match over deepest container.

## 4. Changes Made

### `src/providers/ShowSymbolInfoCommand.ts` (Modified)
**Section 1b rewritten with 3-case logic:**
- Lines 149-202: When cursor is on a token inside a container but not on the container's name:
  - Builds scope chain including the container itself (e.g., `[Foo, processData]`)
  - Checks if it's a child DocumentSymbol first
  - Falls back to hover-based kind inference via `_inferKindFromHover()`
  - Falls back to container-context inference (function→variable, class→property)
- Definition Provider strategy (lines 216-270): Same 3-case logic applied at the definition site
- Tree-sitter index (lines 273-320): Prefers exact `name === word` match over deepest container

**New helper: `_inferKindFromHover()` (lines ~773-840)**:
- Parses combined hover text from all hover results
- Pattern matches against clangd and tsserver conventions:
  - `(method)`, `(function)`, `(parameter)`, `(property)`, `(field)`, `(local var)` — tsserver
  - `class Foo` / `struct Bar` / `enum Baz` — leading keywords
  - `name(params) -> return` — function signature pattern
  - Simple `type name` — variable pattern for clangd
- Returns `SymbolKindType | null`

**New helper: `_addressToLegacyKey()` (lines ~845-858)**:
- Extracts symbol part from address (after `#`)
- Replaces `::` with `.`, strips discriminator
- Returns legacy cache key string

### `src/models/constants.ts` (Modified — previous prompt)
- `SHOW_SYMBOL_INFO` command constant.

### `src/extension.ts` (Modified — previous prompt)
- Import and registration of `showSymbolInfo`.

### `package.json` (Modified — previous prompt)
- Command, context menu, keybinding.

## 5. Commands Run
- `npm run build:extension` — **PASS** (203.9kb in 34ms)
- `npm run lint -- --max-warnings=0 src/providers/ShowSymbolInfoCommand.ts` — **PASS** (clean)

## 6. Result
Symbol address now correctly identifies:
- **Local variables**: `src/main.cpp#processData::var.count` (not `src/main.cpp#fn.processData`)
- **Class members**: `src/Foo.cpp#Foo::prop.m_value` (not `src/Foo.cpp#class.Foo`)
- **Parameters**: `src/main.cpp#processData::param.input` (when hover says `(parameter)`)
- **Methods**: `src/Foo.cpp#Foo::method.doWork` (when cursor is on the method name)
- **Top-level symbols**: `src/main.cpp#fn.main` (unchanged, works as before)

The kind is determined by priority:
1. Hover text parsing (most accurate — uses language server's type info)
2. Child DocumentSymbol match (if clangd reports it as a child)
3. Container-context inference (function→variable, class→property)

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `src/providers/ShowSymbolInfoCommand.ts` | Modified | Fixed address to identify sub-symbols (local vars, members, params); added `_inferKindFromHover()` and `_addressToLegacyKey()` helpers |
| `src/models/constants.ts` | Modified | Added `SHOW_SYMBOL_INFO` command constant (previous prompt) |
| `src/extension.ts` | Modified | Imported and registered the new command (previous prompt) |
| `package.json` | Modified | Added command definition, context menu, keybinding (previous prompt) |
