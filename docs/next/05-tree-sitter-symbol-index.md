# Tree-Sitter Symbol Index: Design Plan

**Date**: 2026-03-29
**Status**: Proposed
**Depends on**: None (additive feature, no breaking changes)

---

## 1. Problem Statement

Code Explorer currently identifies symbols in two ways:

1. **VS Code document symbol provider** (`SymbolResolver.ts`) — requires a running VS Code instance, cannot determine symbol kind for identifiers *within* method bodies (e.g., a local variable `user` vs a reference to `UserService`).
2. **LLM-based identification** (unified prompt) — slow (~5-15s), expensive (consumes LLM tokens), and non-deterministic.

Neither approach produces a reliable, deterministic, stable **symbol address** that uniquely identifies a symbol across the codebase. This causes several problems:

- **Cache key fragility**: Cache files use `kind.Name.md` naming (e.g., `fn.printBanner().md`). When the LLM identifies a symbol slightly differently between runs (e.g., `printBanner` vs `printBanner()`), cache lookups fail.
- **Symbol link resolution is unreliable**: When the webview renders a clickable symbol name (e.g., `createUser` in a sub-functions list), it only has `name + filePath + line`. If the line number drifts after edits, the link breaks. There's no deterministic way to resolve the link to the correct cached analysis.
- **No cross-file symbol discovery**: The extension cannot enumerate all symbols in a workspace without LLM calls. The planned `AnalyzeWorkspace` command requires this.
- **Ambiguous symbols**: Common names like `user`, `result`, `config` appear in many scopes. Without a full address (including scope chain), the extension cannot disambiguate which `user` the user is exploring.

## 2. POC Results

A proof-of-concept was run with `tree-sitter` (native Node.js binding, v0.22.4) and grammar packages for C++ and TypeScript. Key findings:

### What Works

| Capability | Result |
|------------|--------|
| Parse C++ files into AST | Full AST in <10ms for 94-line file |
| Parse TypeScript files into AST | Full AST in <10ms for 46KB file (1383 lines) |
| Extract function definitions with names | Correctly identifies `printBanner`, `main`, `UserService::createUser`, etc. |
| Extract class/struct definitions | Identifies classes within namespaces |
| Extract variable declarations (const/let/var, C++ auto) | Identifies local variables within function bodies |
| Build scope chains | Correctly produces `main::var.logger`, `app::UserService::createUser::var.nextId` |
| Resolve cursor position to symbol | Given (line, col), returns the deepest enclosing symbol with full address |
| Handle namespaces (C++) | `namespace app { ... }` correctly becomes prefix `app::` in addresses |
| Handle qualified identifiers (C++) | `UserService::createUser` parsed correctly |

### Version Requirements

| Package | Version | Notes |
|---------|---------|-------|
| `tree-sitter` | `0.22.4` | v0.21.1 fails on files >~30KB |
| `tree-sitter-cpp` | `0.23.4` | Works with tree-sitter 0.22.4 |
| `tree-sitter-typescript` | `0.23.2` | Exports `.typescript` and `.tsx` sub-languages |
| `web-tree-sitter` | Latest | WASM alternative; avoids native compilation, better for VS Code extension distribution |

### Alternative: `web-tree-sitter` (WASM)

For VS Code extension distribution, `web-tree-sitter` (WASM-based) is recommended over the native `tree-sitter` binding because:

- No native compilation needed during `npm install` (avoids `node-gyp` issues)
- Works across all platforms without prebuilt binaries
- VS Code extension host supports WASM
- Grammar files are `.wasm` files (small, downloadable, platform-independent)
- Slight performance trade-off (~2-5x slower than native) but still <50ms for most files

**Recommendation**: Use `web-tree-sitter` for production; keep native `tree-sitter` for POC/testing.

---

## 3. Symbol Address Format

A **symbol address** is a deterministic, human-readable string that uniquely identifies any symbol within a workspace. It is composed of the file path and a scope-qualified symbol identifier.

### Format

```
<relative-file-path>#<scope-chain>::<kind-prefix>.<symbol-name>[~<overload-discriminator>]
```

### Components

| Component | Description | Example |
|-----------|-------------|---------|
| `relative-file-path` | Path from workspace root to source file | `src/main.cpp`, `src/cache/CacheStore.ts` |
| `#` | Separator between file path and symbol path | |
| `scope-chain` | `::` separated ancestor scope names (namespaces, classes, functions) | `app::UserService::createUser` |
| `kind-prefix` | Short prefix indicating symbol kind (reuses existing `SYMBOL_KIND_PREFIX` map) | `fn`, `class`, `var`, `method`, `prop` |
| `symbol-name` | The symbol's identifier name | `printBanner`, `_cacheRoot`, `MAX_USERS` |
| `~<overload-discriminator>` | **Optional**. Present only when multiple symbols share the same `scope::kind.name`. A short hash derived from the parameter signature, used to disambiguate overloads. See Section 3.1. | `~a3f2`, `~0` |

### Kind Prefixes

Reuse existing `SYMBOL_KIND_PREFIX` from `src/models/types.ts`:

```typescript
{
  class: 'class',
  function: 'fn',
  method: 'method',
  variable: 'var',
  interface: 'interface',
  type: 'type',
  enum: 'enum',
  property: 'prop',
  parameter: 'param',
  struct: 'struct',
  unknown: 'sym',
}
```

### Examples

| Source Code | Symbol Address |
|-------------|---------------|
| `void printBanner()` in `src/main.cpp` | `src/main.cpp#fn.printBanner` |
| `int main(int argc, char* argv[])` in `src/main.cpp` | `src/main.cpp#fn.main` |
| Local var `logger` inside `main()` in `src/main.cpp` | `src/main.cpp#main::var.logger` |
| `User UserService::createUser(...)` inside `namespace app` | `src/UserService.cpp#app::fn.UserService::createUser` |
| Local var `nextId` inside `createUser` inside `app` namespace | `src/UserService.cpp#app::UserService::createUser::var.nextId` |
| Class `CacheStore` in `src/cache/CacheStore.ts` | `src/cache/CacheStore.ts#class.CacheStore` |
| Method `write` of `CacheStore` class | `src/cache/CacheStore.ts#CacheStore::method.write` |
| Private property `_cacheRoot` of `CacheStore` | `src/cache/CacheStore.ts#CacheStore::prop._cacheRoot` |
| Interface `CachedSymbolSummary` | `src/cache/CacheStore.ts#interface.CachedSymbolSummary` |
| Static variable `MAX_USERS` in `main.cpp` | `src/main.cpp#var.MAX_USERS` |
| **Overloaded** `void log(string msg)` | `src/Logger.cpp#app::fn.Logger::log~a3f2` |
| **Overloaded** `void log(int code, string msg)` | `src/Logger.cpp#app::fn.Logger::log~b7e1` |

### Properties

1. **Deterministic**: Same source code always produces the same address. No LLM involved.
2. **Stable across minor edits**: Adding a comment, changing whitespace, or reordering lines doesn't change addresses. Only renaming/moving a symbol changes its address.
3. **Line-number-independent**: Addresses are derived from the AST structure (name + scope + kind + parameter signature), never from line numbers. Line numbers are stored in the index for navigation but are *not* part of the address identity.
4. **Human-readable**: Developers can read and understand addresses without tooling.
5. **Unique within workspace**: The combination of file path + scope chain + kind + name + overload discriminator is unique.
6. **Parseable**: Can be split into components for lookup, filtering, or display.

### 3.1 Overload Disambiguation Strategy

Function overloads (same name, same scope, different parameter lists) are common in C++, TypeScript, Java, and C#. The address must distinguish between overloads without relying on line numbers.

#### Approach: Parameter Signature Hash

When tree-sitter extracts a function/method definition, it also extracts the **parameter type list** from the AST. For overloaded symbols (detected when multiple symbols share the same `file#scope::kind.name`), a short discriminator suffix `~XXXX` is appended.

**Discriminator derivation**:

```
1. Extract parameter types from the AST:
   - C++:  void log(const std::string& msg)       → ["const std::string&"]
   - C++:  void log(int code, const std::string& msg) → ["int", "const std::string&"]
   - TS:   function parse(input: string): Result   → ["string"]
   - TS:   function parse(input: Buffer): Result   → ["Buffer"]

2. Normalize the type list:
   - Remove whitespace variations
   - Sort by parameter position (already ordered)
   - Join with commas: "const std::string&" or "int,const std::string&"

3. Compute a 4-character hex hash (first 4 hex chars of SHA-256):
   - sha256("const std::string&")[0..4] → "a3f2"
   - sha256("int,const std::string&")[0..4] → "b7e1"

4. Append to address: fn.log~a3f2, fn.log~b7e1
```

**When the `~` suffix is NOT added**:
- If a symbol name is unique within its scope (no overloads), no suffix is added. This is the common case.
- The suffix is only added when the extractor detects two or more symbols with identical `file#scope::kind.name`.

**Why not use full parameter signatures in the address?**
- Signatures can be very long (e.g., C++ templates: `std::vector<std::pair<std::string, int>>&`)
- Signatures make file names excessively long and contain characters illegal in file paths (`<`, `>`, `&`, `*`)
- A 4-char hash is sufficient for disambiguation within a scope (collision probability is negligible for <100 overloads)

**Why not use ordinal position (e.g., `~0`, `~1`)?**
- Ordinals depend on declaration order, which changes when a developer reorders overloads. This would invalidate cache files on harmless refactors.
- Hash-based discriminators are stable: they only change if the parameter types change, which genuinely represents a different overload.

#### Example: C++ Overloads

```cpp
// Logger.h
namespace app {
class Logger {
public:
    void log(const std::string& msg);                    // Overload 1
    void log(int level, const std::string& msg);         // Overload 2
    void log(int level, const char* fmt, ...);           // Overload 3
};
}
```

Addresses:
```
include/Logger.h#app::class.Logger::method.log~a3f2   // (const std::string&)
include/Logger.h#app::class.Logger::method.log~b7e1   // (int, const std::string&)
include/Logger.h#app::class.Logger::method.log~c42d   // (int, const char*, ...)
```

Cache file paths:
```
.vscode/code-explorer/include/Logger.h/app.class.Logger.method.log~a3f2.md
.vscode/code-explorer/include/Logger.h/app.class.Logger.method.log~b7e1.md
.vscode/code-explorer/include/Logger.h/app.class.Logger.method.log~c42d.md
```

#### Example: TypeScript Overloads

```typescript
// parser.ts
function parse(input: string): ASTNode;
function parse(input: Buffer): ASTNode;
function parse(input: string | Buffer): ASTNode {
  // implementation
}
```

TypeScript overloads have declaration signatures + one implementation signature. The extractor indexes the **declaration signatures** (which are the user-facing API):
```
src/parser.ts#fn.parse~d1a0   // (string)
src/parser.ts#fn.parse~e5b3   // (Buffer)
```

The implementation signature is not separately indexed (it's not a distinct overload the user would explore independently).

#### Cursor Resolution with Overloads

When resolving a cursor to an overloaded symbol:

```
Cursor at line 15 (inside the "log(int level, const string& msg)" body)
  -> tree-sitter finds the function_definition node at line 15
  -> extracts parameter types: ["int", "const std::string&"]
  -> computes discriminator: ~b7e1
  -> returns address: include/Logger.h#app::class.Logger::method.log~b7e1
```

The cursor line is used to **find the AST node**, but the address is derived from the **AST structure** (scope + name + parameter types). If the function moves from line 15 to line 25, the tree-sitter re-parse finds the same AST node at the new location, and the address remains identical.

### 3.2 Resilience to Code Changes

The address design is intentionally **structure-based, not location-based**. Here's how it handles common edit scenarios:

| Edit Scenario | Line Numbers Change? | Address Changes? | Cache Impact |
|---------------|---------------------|-------------------|--------------|
| Add a comment above a function | Yes | **No** — name, scope, kind, params unchanged | Cache valid |
| Add blank lines / reformat | Yes | **No** | Cache valid |
| Reorder functions within a file | Yes | **No** | Cache valid |
| Rename a function | N/A | **Yes** — name is part of address | Cache stale (new address, old cache orphaned) |
| Move a function to a different scope | Maybe | **Yes** — scope chain changes | Cache stale |
| Change parameter types of an overload | Maybe | **Yes** — discriminator hash changes | Cache stale |
| Add a new overload to a non-overloaded function | No | **Yes** — existing address gets `~XXXX` suffix | Special handling (see below) |
| Delete a function | N/A | Address no longer exists in index | Cache orphaned, cleaned on next index rebuild |
| Move a function to a different file | N/A | **Yes** — file path changes | Cache stale |

**Special case: Non-overloaded function becomes overloaded**

When a function `fn.log` gains a second overload, the existing unsuffixed address `fn.log` becomes ambiguous. The index handles this by:
1. Detecting the new collision during re-indexing
2. Adding discriminators to ALL overloads: `fn.log~a3f2`, `fn.log~b7e1`
3. Renaming the existing cache file from `fn.log.md` to `fn.log~a3f2.md`
4. The old `fn.log.md` path is kept as a redirect (symlink or small stub file pointing to the new name) for a transition period

**Index entries always store the AST-derived data, never raw line numbers as identity**. Line numbers are stored as metadata for navigation (jump-to-source) and are updated on re-index, but they play no role in address computation, cache key derivation, or symbol matching.

---

## 4. Symbol Index Structure

### 4.1 In-Memory Index

The index lives in memory during the extension session and is persisted to disk for fast startup.

```typescript
/**
 * A single entry in the symbol index.
 * Represents one symbol definition found by tree-sitter.
 *
 * IMPORTANT: The symbol's identity is determined by its `address` field,
 * which is derived from (filePath + scopeChain + kind + name + overloadDiscriminator).
 * Line numbers are metadata for navigation — they are NOT part of identity.
 * This ensures addresses remain stable when code is reformatted, reordered,
 * or when comments/blank lines are added.
 */
interface SymbolIndexEntry {
  /** Full symbol address (file#scope::kind.name[~discriminator]) — the identity key */
  address: string;
  /** Symbol name (just the identifier) */
  name: string;
  /** Symbol kind */
  kind: SymbolKindType;
  /** Relative file path from workspace root */
  filePath: string;
  /**
   * Start line (0-based) — navigation metadata, NOT part of identity.
   * Updated on every re-index; never used for address computation or cache key derivation.
   */
  startLine: number;
  /** End line (0-based) — navigation metadata */
  endLine: number;
  /** Start column (0-based) — navigation metadata */
  startColumn: number;
  /** Scope chain (ancestor names, root to parent) */
  scopeChain: string[];
  /**
   * Normalized parameter signature for functions/methods.
   * Used to compute the overload discriminator hash.
   * Examples: "const std::string&", "int,const std::string&", "string", "Buffer"
   * Null for non-callable symbols (variables, classes, etc.).
   */
  paramSignature: string | null;
  /**
   * Overload discriminator suffix (e.g., "a3f2").
   * Present only when this symbol is one of multiple overloads sharing the same
   * scope::kind.name. Derived from paramSignature hash. See Section 3.1.
   */
  overloadDiscriminator: string | null;
  /** Path to cached analysis markdown file, if analysis exists */
  cachePath?: string;
  /** Hash of the source file when this entry was indexed */
  sourceHash: string;
  /** Whether this is a local variable inside a function body */
  isLocal: boolean;
}

/**
 * The full symbol index for a workspace.
 * Multiple lookup strategies for different use cases.
 *
 * Identity is always based on the symbol's address (derived from AST structure).
 * Line numbers are stored in entries for navigation but never used as keys.
 */
interface SymbolIndex {
  /** Version of the index format */
  version: string;
  /** When the index was last fully rebuilt */
  lastRebuilt: string;
  /** Total symbol count */
  symbolCount: number;

  /** Primary lookup: address -> entry (O(1)) */
  byAddress: Map<string, SymbolIndexEntry>;

  /** Name lookup: symbol name -> entries[] (for link resolution, may return overloads) */
  byName: Map<string, SymbolIndexEntry[]>;

  /** File lookup: relative file path -> entries[] (for file-level operations) */
  byFile: Map<string, SymbolIndexEntry[]>;

  /**
   * Cursor lookup: file path -> entries sorted by startLine.
   * Used for resolving which symbol contains a given cursor position.
   * After finding the candidate by line range, the entry's `address` (not line number)
   * is used for all subsequent operations (cache lookup, linking, etc.).
   */
  byFileSorted: Map<string, SymbolIndexEntry[]>;
}
```

### 4.2 On-Disk Persistence

The index is stored as a JSON file at:

```
.vscode/code-explorer/_symbol_index.json
```

```json
{
  "version": "1.0.0",
  "lastRebuilt": "2026-03-29T11:00:00.000Z",
  "symbolCount": 245,
  "files": {
    "src/main.cpp": {
      "hash": "sha256:abc123...",
      "indexedAt": "2026-03-29T11:00:00.000Z",
      "symbols": [
        {
          "address": "src/main.cpp#fn.printBanner",
          "name": "printBanner",
          "kind": "function",
          "startLine": 13,
          "endLine": 17,
          "startColumn": 0,
          "scopeChain": [],
          "paramSignature": "",
          "overloadDiscriminator": null,
          "isLocal": false
        },
        {
          "address": "src/main.cpp#fn.main",
          "name": "main",
          "kind": "function",
          "startLine": 27,
          "endLine": 92,
          "startColumn": 0,
          "scopeChain": [],
          "paramSignature": "int,char**",
          "overloadDiscriminator": null,
          "isLocal": false
        },
        {
          "address": "src/main.cpp#main::var.logger",
          "name": "logger",
          "kind": "variable",
          "startLine": 37,
          "endLine": 37,
          "startColumn": 4,
          "scopeChain": ["main"],
          "paramSignature": null,
          "overloadDiscriminator": null,
          "isLocal": true
        }
      ]
    },
    "include/Logger.h": {
      "hash": "sha256:789def...",
      "indexedAt": "2026-03-29T11:00:00.000Z",
      "symbols": [
        {
          "address": "include/Logger.h#app::class.Logger::method.log~a3f2",
          "name": "log",
          "kind": "method",
          "startLine": 10,
          "endLine": 10,
          "startColumn": 4,
          "scopeChain": ["app", "Logger"],
          "paramSignature": "const std::string&",
          "overloadDiscriminator": "a3f2",
          "isLocal": false
        },
        {
          "address": "include/Logger.h#app::class.Logger::method.log~b7e1",
          "name": "log",
          "kind": "method",
          "startLine": 11,
          "endLine": 11,
          "startColumn": 4,
          "scopeChain": ["app", "Logger"],
          "paramSignature": "int,const std::string&",
          "overloadDiscriminator": "b7e1",
          "isLocal": false
        }
      ]
    },
    "src/UserService.cpp": {
      "hash": "sha256:def456...",
      "indexedAt": "2026-03-29T11:00:00.000Z",
      "symbols": []
    }
  }
}
```

### 4.3 Cache Path Derivation

Given a symbol address, the cache file path is deterministic:

```
Symbol address:  src/UserService.cpp#app::fn.UserService::createUser
Cache file path: .vscode/code-explorer/src/UserService.cpp/app.fn.UserService.createUser.md
```

**Derivation rule**:
```
.vscode/code-explorer/<filePath>/<address-after-#, with :: replaced by .>.md
```

This replaces the current naming scheme where the LLM decides the cache file name, which causes inconsistencies.

---

## 5. How the Symbol Index Helps

### 5.1 Reliable Cache Lookups

**Current problem**: Cache lookup uses fuzzy name matching and ±3 line tolerance. If a symbol moves by more than 3 lines, or the LLM names it differently, cache is missed.

**With symbol index**:
```
Ctrl+Shift+E on cursor at line 38 in main.cpp
  -> tree-sitter parses main.cpp (if not already cached) [<10ms]
  -> finds deepest symbol at line 38: address = "src/main.cpp#main::var.logger"
  -> derives cache path: ".vscode/code-explorer/src/main.cpp/main.var.logger.md"
  -> direct file read — O(1), no scanning, no LLM fallback needed
```

### 5.2 Symbol Link Navigation

**Current problem**: When the LLM says "calls `createUser`" in the analysis, the webview creates a clickable link with `data-symbol-name="createUser"` and maybe `data-symbol-file="src/UserService.cpp"` and `data-symbol-line="10"`. If line 10 drifts after an edit, or the file isn't specified, the link can't resolve to a cached analysis.

**With symbol index**:
```
User clicks "createUser" link in webview
  -> webview sends: { type: 'exploreSymbol', symbolName: 'createUser', filePath: 'src/UserService.cpp' }
  -> extension looks up index.byName.get('createUser')
     -> finds: [
          { address: 'src/UserService.cpp#app::fn.UserService::createUser', ... },
        ]
  -> if 1 result: navigate directly to that analysis
  -> if multiple: disambiguate by file proximity or show picker
  -> derive cache path from address -> instant cache hit
```

Additionally, the analysis itself can store symbol addresses in the JSON blocks (sub-functions, callers, etc.), making links fully deterministic:

```json
{
  "name": "createUser",
  "address": "src/UserService.cpp#app::fn.UserService::createUser",
  "description": "Creates a new user...",
  "input": "name, email",
  "output": "User"
}
```

### 5.3 Workspace-Wide Symbol Enumeration

The symbol index enables the planned **Analyze Workspace** command:

```
"Analyze Workspace" command
  -> for each source file in workspace (respecting excludePatterns):
     -> tree-sitter parse -> extract symbols [<10ms per file]
  -> build full workspace symbol index
  -> queue LLM analysis for each top-level symbol (functions, classes, methods)
  -> skip already-cached symbols (address -> cache path -> exists check)
```

### 5.4 Incremental Re-indexing

When a file changes (via file watcher or on-save):

```
File saved: src/UserService.cpp
  -> compute SHA-256 of new content
  -> compare with index entry hash for src/UserService.cpp
  -> if different:
     -> re-parse with tree-sitter [<10ms]
     -> diff old symbols vs new symbols
     -> mark removed symbols' cache as stale
     -> mark moved symbols' cache as stale (line changed but name+scope same)
     -> update index entries
  -> if same: no-op
```

### 5.5 Cross-Reference Resolution

With a full symbol index, the extension can resolve references without VS Code language server:

```
Analysis of printBanner mentions "APP_NAME"
  -> index.byName.get('APP_NAME')
  -> returns: [{ address: 'src/main.cpp#var.APP_NAME', startLine: 10, kind: 'variable' }]
  -> direct link to analysis at .vscode/code-explorer/src/main.cpp/var.APP_NAME.md
```

---

## 6. Implementation Plan

### Phase 1: Core Tree-Sitter Infrastructure (Sprint 1)

**Goal**: Add tree-sitter as a dependency, implement language-specific symbol extractors, build the `SymbolIndex` class.

#### Files to Create

| File | Purpose |
|------|---------|
| `src/indexing/TreeSitterParser.ts` | Manages tree-sitter parser instances per language. Lazy initialization. |
| `src/indexing/extractors/CppExtractor.ts` | Extracts symbols from C++ AST nodes |
| `src/indexing/extractors/TypeScriptExtractor.ts` | Extracts symbols from TypeScript AST nodes |
| `src/indexing/extractors/BaseExtractor.ts` | Abstract base with shared logic (address building, scope chain) |
| `src/indexing/SymbolIndex.ts` | In-memory index with multiple lookup maps, persistence to/from JSON |
| `src/indexing/SymbolAddress.ts` | Utility functions: `buildAddress()`, `parseAddress()`, `addressToCachePath()` |
| `src/indexing/CONTEXT.md` | Module documentation |

#### Dependencies to Add

```json
{
  "dependencies": {
    "web-tree-sitter": "^0.24.0"
  }
}
```

Plus WASM grammar files bundled in `grammars/`:
- `tree-sitter-cpp.wasm`
- `tree-sitter-typescript.wasm`
- `tree-sitter-python.wasm` (future)
- `tree-sitter-java.wasm` (future)
- `tree-sitter-c-sharp.wasm` (future)

#### Key Interfaces

```typescript
// src/indexing/SymbolAddress.ts

/**
 * Build a symbol address string from components.
 * The overloadDiscriminator is only provided when multiple symbols
 * share the same (filePath, scopeChain, kind, name) — i.e., overloads.
 *
 * @example
 * buildAddress('src/main.cpp', ['app', 'UserService'], 'function', 'createUser')
 * // => 'src/main.cpp#app::UserService::fn.createUser'
 *
 * buildAddress('include/Logger.h', ['app', 'Logger'], 'method', 'log', 'a3f2')
 * // => 'include/Logger.h#app::Logger::method.log~a3f2'
 */
function buildAddress(
  filePath: string,
  scopeChain: string[],
  kind: SymbolKindType,
  name: string,
  overloadDiscriminator?: string
): string;

/**
 * Parse a symbol address into its components.
 *
 * @example
 * parseAddress('src/main.cpp#app::UserService::fn.createUser')
 * // => { filePath: 'src/main.cpp', scopeChain: ['app', 'UserService'], kind: 'function', name: 'createUser', overloadDiscriminator: null }
 *
 * parseAddress('include/Logger.h#app::Logger::method.log~a3f2')
 * // => { filePath: 'include/Logger.h', scopeChain: ['app', 'Logger'], kind: 'method', name: 'log', overloadDiscriminator: 'a3f2' }
 */
function parseAddress(address: string): {
  filePath: string;
  scopeChain: string[];
  kind: SymbolKindType;
  name: string;
  overloadDiscriminator: string | null;
};

/**
 * Compute the overload discriminator from a normalized parameter signature.
 * Returns a 4-character hex string derived from SHA-256 of the signature.
 *
 * @example
 * computeDiscriminator("const std::string&") // => "a3f2"
 * computeDiscriminator("int,const std::string&") // => "b7e1"
 */
function computeDiscriminator(paramSignature: string): string;

/**
 * Derive the cache file path from a symbol address.
 *
 * @example
 * addressToCachePath('src/main.cpp#app::fn.UserService::createUser')
 * // => '.vscode/code-explorer/src/main.cpp/app.fn.UserService.createUser.md'
 *
 * addressToCachePath('include/Logger.h#app::Logger::method.log~a3f2')
 * // => '.vscode/code-explorer/include/Logger.h/app.Logger.method.log~a3f2.md'
 */
function addressToCachePath(address: string): string;
```

```typescript
// src/indexing/TreeSitterParser.ts

class TreeSitterParser {
  /** Parse a source file and return the AST root node */
  async parse(filePath: string, content: string): Promise<Tree>;

  /** Get or initialize parser for a language */
  private async _getParser(languageId: string): Promise<Parser>;

  /** Map file extension to language ID */
  static languageForFile(filePath: string): string | null;
}
```

```typescript
// src/indexing/extractors/BaseExtractor.ts

abstract class BaseExtractor {
  /** Extract all symbol definitions from an AST root node */
  abstract extract(rootNode: SyntaxNode, filePath: string): SymbolIndexEntry[];

  /** Build a symbol address from components */
  protected buildAddress(
    filePath: string,
    scopeChain: string[],
    kind: SymbolKindType,
    name: string,
    overloadDiscriminator?: string
  ): string;

  /**
   * Extract and normalize the parameter type list from a function/method AST node.
   * Language-specific implementations handle different AST shapes.
   * Returns null for non-callable symbols.
   */
  protected abstract extractParamSignature(node: SyntaxNode): string | null;

  /**
   * Post-process extracted symbols to detect overloads and assign discriminators.
   * Called after all symbols in a file are extracted.
   * Groups symbols by (scope + kind + name), and for groups with >1 member,
   * computes and assigns overloadDiscriminator from paramSignature.
   */
  protected assignOverloadDiscriminators(entries: SymbolIndexEntry[]): void;
}
```

### Phase 2: Integrate Index into Analysis Pipeline (Sprint 2)

**Goal**: Wire the symbol index into the existing flow. Replace LLM-based symbol identification with tree-sitter-based identification. Update cache key derivation.

#### Changes to Existing Files

| File | Change |
|------|--------|
| `src/extension.ts` | Construct `TreeSitterParser`, `SymbolIndex`, inject into orchestrator |
| `src/analysis/AnalysisOrchestrator.ts` | Use `SymbolIndex.resolveAtCursor()` before LLM call; use index-derived cache path |
| `src/cache/CacheStore.ts` | Add `readByAddress(address)` method; keep existing `findByCursor()` as fallback |
| `src/models/types.ts` | Add `address` field to `SymbolInfo` (optional, for backward compat) |
| `src/models/constants.ts` | Add `SYMBOL_INDEX` constants (file name, version) |

#### New Data Flow

```
User clicks symbol -> Ctrl+Shift+E
  -> extension.ts gathers CursorContext (unchanged)
  -> NEW: SymbolIndex.resolveAtCursor(filePath, line, col)
     -> tree-sitter parse (if not cached) [<10ms]
     -> binary search in sorted-by-line entries [O(log n)]
     -> returns SymbolIndexEntry with full address
  -> AnalysisOrchestrator.analyzeFromCursor(cursor, indexEntry)
     -> CacheStore.readByAddress(indexEntry.address) [direct file read, O(1)]
     -> if cache hit: return immediately
     -> if cache miss: proceed with LLM analysis (as today)
     -> CacheStore.write() uses address-derived path (deterministic)
```

### Phase 3: Enhanced Symbol Linking (Sprint 3)

**Goal**: Use the symbol index to make webview symbol links reliable. When the LLM mentions a symbol, resolve it via the index and embed the address.

#### Changes

| File | Change |
|------|--------|
| `src/llm/ResponseParser.ts` | After parsing sub-functions/callers, resolve each name against `SymbolIndex.byName` to populate `address` field |
| `src/ui/CodeExplorerViewProvider.ts` | Handle `exploreSymbol` message with index-based resolution instead of LLM fallback |
| `webview/src/main.ts` | Add `data-symbol-address` attribute to symbol links; send address in `exploreSymbol` message when available |
| `src/models/types.ts` | Add `address?: string` to `SubFunctionInfo`, `CallStackEntry.caller`, `RelationshipEntry`, `SymbolInfo` |
| `src/ui/CodeExplorerViewProvider.ts` (new method) | Add `_disambiguateSymbol()` to show QuickPick when multiple candidates match |

#### Link Resolution Flow

```
User clicks "createUser" link in webview
  -> webview sends: {
       type: 'exploreSymbol',
       symbolName: 'createUser',
       symbolAddress: 'src/UserService.cpp#app::fn.UserService::createUser'  // NEW
     }
  -> CodeExplorerViewProvider receives message
  -> if address provided:
     -> derive cache path from address
     -> CacheStore.readByAddress() -> instant cache hit -> open tab
  -> if no address (legacy link or auto-linked text):
     -> SymbolIndex.byName.get('createUser') -> resolve candidates
     -> if 1 result: proceed directly (derive cache path, open tab)
     -> if multiple results: show disambiguation context menu (see 5.2.1)
     -> if 0 results: fall back to navigateToSource (current behavior)
```

#### 5.2.1 Disambiguation Context Menu

When a symbol name resolves to multiple index entries (overloads, same-name symbols in different files/scopes), the extension presents a **VS Code QuickPick** with all candidates. Each item shows the full symbol address so the user can choose the right one.

**QuickPick item format**:
```
┌──────────────────────────────────────────────────────────────┐
│ 🔍 Multiple symbols found for "log" — select one:           │
│                                                              │
│  ▸ method log(const string&)                                 │
│    include/Logger.h#app::class.Logger::method.log~a3f2       │
│                                                              │
│  ▸ method log(int, const string&)                            │
│    include/Logger.h#app::class.Logger::method.log~b7e1       │
│                                                              │
│  ▸ method log(int, const char*, ...)                         │
│    include/Logger.h#app::class.Logger::method.log~c42d       │
│                                                              │
│  ▸ function log(message: string)                             │
│    src/utils/logger.ts#fn.log                                │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**Implementation**:
```typescript
// In CodeExplorerViewProvider.ts

private async _disambiguateSymbol(
  symbolName: string,
  candidates: SymbolIndexEntry[]
): Promise<SymbolIndexEntry | undefined> {
  const items = candidates.map(entry => ({
    label: `$(symbol-${entry.kind}) ${entry.name}${entry.paramSignature ? '(' + entry.paramSignature + ')' : ''}`,
    description: entry.filePath,
    detail: entry.address,
    entry,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: `Multiple symbols found for "${symbolName}"`,
    placeHolder: 'Select the symbol to explore',
    matchOnDescription: true,
    matchOnDetail: true,
  });

  return picked?.entry;
}
```

**When disambiguation is triggered**:

| Scenario | Example | Behavior |
|----------|---------|----------|
| Single match | `printBanner` exists once in workspace | No picker, navigate directly |
| Overloads in same file | `log(string)` and `log(int, string)` in `Logger.h` | Show picker with parameter signatures |
| Same name in different files | `parse()` in `parser.ts` and `parse()` in `xmlParser.ts` | Show picker with file paths |
| Same name in different scopes | `validate()` in `UserService` and `validate()` in `OrderService` | Show picker with scope chains |
| Address provided by webview | Link has `data-symbol-address` attribute | No picker, navigate directly to address |

**Ranking heuristic**: When showing the picker, candidates are sorted by relevance:
1. Same file as the currently active analysis tab (highest priority)
2. Same directory as the active tab
3. Alphabetical by address (fallback)

### Phase 4: File Watcher Integration (Sprint 4)

**Goal**: Keep the symbol index up to date as files change.

#### Components

| File | Purpose |
|------|---------|
| `src/indexing/FileWatcher.ts` | Listens to workspace file changes, triggers re-indexing |
| `src/indexing/IndexUpdater.ts` | Computes diffs between old and new symbol sets, marks stale caches |

#### Flow

```
File saved -> FileWatcher detects change
  -> compute new file hash
  -> if hash unchanged: skip
  -> re-parse with tree-sitter [<10ms]
  -> extract new symbol set (addresses computed from AST structure, NOT line numbers)
  -> diff old addresses vs new addresses for this file:
     -> SAME address in old & new: symbol still exists
        -> update line numbers in index (navigation metadata only)
        -> cache remains valid (address unchanged = same symbol)
     -> Address in old but NOT in new: symbol was removed or renamed
        -> mark cache file as stale (update frontmatter stale: true)
        -> remove from index
     -> Address in new but NOT in old: new symbol added
        -> add to index (no cache yet)
     -> Address collision changes (non-overloaded became overloaded):
        -> old address "fn.log" now needs discriminator "fn.log~a3f2"
        -> rename cache file from "fn.log.md" to "fn.log~a3f2.md"
        -> update index entry with new address
  -> persist updated index to disk
```

**Key principle**: The diff is based on **addresses** (AST-derived structural identity), never on line numbers. A symbol that moves from line 10 to line 50 but keeps the same name, scope, kind, and parameter types will have the same address before and after — its cache remains valid, and only the navigation line numbers are updated in the index.

### Phase 5: Additional Languages (Sprint 5+)

Extend the extractor pattern to support more languages:

| Language | Grammar | Priority |
|----------|---------|----------|
| Python | `tree-sitter-python.wasm` | High (popular) |
| Java | `tree-sitter-java.wasm` | Medium |
| C# | `tree-sitter-c-sharp.wasm` | Medium |
| C | `tree-sitter-c.wasm` (comes with cpp) | Low (covered by C++ grammar) |
| Go | `tree-sitter-go.wasm` | Low |
| Rust | `tree-sitter-rust.wasm` | Low |

Each language gets an extractor class (e.g., `PythonExtractor.ts`) that implements `BaseExtractor` and maps language-specific AST node types to our unified `SymbolKindType`.

---

## 7. Migration Strategy

### Backward Compatibility

The existing cache files (e.g., `fn.printBanner().md`) will not be invalidated. The migration strategy:

1. **Phase 2** adds `address` as an optional field on `SymbolInfo`. Old cache files without addresses remain readable.
2. **`CacheStore.readByAddress()`** is a new method alongside existing `read()` and `findByCursor()`. Old code paths continue to work.
3. When writing new cache files, use the address-derived path. If a legacy cache file exists at a different path for the same symbol, the old file is left in place (not deleted). Over time, `clearCache` or TTL expiry removes orphans.
4. A one-time migration command (`codeExplorer.rebuildIndex`) can re-index the workspace and optionally rename cache files to address-derived paths.

### Cache File Name Changes

| Scenario | Old Name | New Name |
|----------|----------|----------|
| Top-level function | `fn.printBanner().md` | `fn.printBanner.md` |
| Namespaced method | `fn.app.info(const_std__string_&).md` | `app.fn.Logger.info.md` |
| Class | `class.CacheStore.md` | `class.CacheStore.md` (same) |
| Local variable | (not cached today) | `main.var.logger.md` |

Key change: **parameter signatures are removed from file names**. The address uses only the symbol name, not its full signature. This makes names stable across parameter type refactors.

---

## 8. Performance Characteristics

| Operation | Time | Notes |
|-----------|------|-------|
| Parse a single file (tree-sitter) | <10ms | Even for 1000+ line files |
| Extract symbols from AST | <5ms | Recursive walk, no I/O |
| Build index for one file | <15ms | Parse + extract + insert into maps |
| Full workspace index (100 files) | <2s | Parallelizable; dominated by file I/O |
| Full workspace index (1000 files) | <15s | Can run in background worker |
| Cursor-to-symbol resolution | <1ms | Binary search on sorted array |
| Address-to-cache-path derivation | <0.1ms | String manipulation |
| Index persistence (write JSON) | <50ms | For typical workspace |
| Index load (read JSON) | <30ms | For typical workspace |

---

## 9. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| tree-sitter grammar doesn't cover language feature | Low | Medium | Fallback to LLM-based identification; tree-sitter grammars are mature |
| Native binding compilation fails on user's platform | Medium | High | Use `web-tree-sitter` (WASM) — platform-independent |
| WASM grammar files increase extension size | Low | Low | Each `.wasm` is ~200KB-1MB; ship only popular languages, lazy-load others |
| Symbol address format changes break existing cache | Low | Medium | Version the address format; migration path documented |
| Performance regression on very large workspaces | Low | Medium | Lazy indexing (only index opened files); optional full-workspace indexing |
| Overload discriminator hash collision | Very Low | Low | 4 hex chars = 65536 buckets; collision within a single scope is negligible. If detected, fall back to 6 or 8 chars. |
| Non-overload→overload transition breaks cache links | Low | Medium | Handled by automatic cache file rename + stub redirect (see Section 3.2) |
| Code refactoring changes scope chain (e.g., move function into class) | Medium | Low | Old address invalidated, new address created. Cache for old address marked stale. This is correct behavior — the symbol's context has genuinely changed. |

---

## 10. Testing Plan

| Test | Type | Description |
|------|------|-------------|
| `CppExtractor` unit tests | Unit | Parse sample C++ files, verify extracted symbols match expected addresses |
| `TypeScriptExtractor` unit tests | Unit | Parse sample TS files, verify extracted symbols match expected addresses |
| `SymbolAddress` unit tests | Unit | Test `buildAddress()`, `parseAddress()`, `addressToCachePath()`, `computeDiscriminator()` with edge cases |
| `SymbolIndex` unit tests | Unit | Test insert, lookup by name/address/cursor, persistence round-trip |
| Overload detection | Unit | Parse file with 3 C++ overloads, verify each gets unique address with `~XXXX` suffix |
| Overload discriminator stability | Unit | Verify same parameter types always produce same discriminator hash |
| Non-overload-to-overload transition | Unit | Parse file without overloads, add overload, re-index, verify old address gains discriminator |
| Code change resilience: add comments | Unit | Parse file, add comments between functions, re-parse, verify all addresses identical |
| Code change resilience: reorder functions | Unit | Parse file, reorder function definitions, re-parse, verify all addresses identical |
| Code change resilience: rename function | Unit | Parse file, rename a function, re-parse, verify old address gone and new address present |
| Disambiguation QuickPick | Unit | Mock 3 candidates for "log", verify QuickPick items show address and param signature |
| `TreeSitterParser` integration | Integration | Parse real files from `sample-workspace/`, verify no errors |
| Cursor resolution accuracy | Integration | Place cursor at various positions in sample files, verify correct symbol resolved |
| Cursor resolution with overloads | Integration | Place cursor inside 2nd overload, verify correct overload address returned |
| Cache read-by-address | Integration | Write cache file, read by address, verify round-trip |
| Link resolution (single match) | Integration | Click symbol name with 1 index match, verify direct navigation (no picker) |
| Link resolution (multiple matches) | Integration | Click symbol name with 3 index matches, verify QuickPick shown with all candidates |
| File watcher re-index | Integration | Modify file (reorder + rename), verify index updated correctly, stale caches marked |

---

## 11. Open Questions

1. **Should the index include symbols from `node_modules` / third-party code?**
   - Recommendation: No. Respect `codeExplorer.excludePatterns` setting.

2. **Should we index header files (`.h`) in C++ separately or merge with `.cpp`?**
   - Recommendation: Index both. The address includes the file path, so `include/UserService.h#app::class.UserService` is different from `src/UserService.cpp#app::fn.UserService::createUser`. This is correct — the class declaration is in the header, method implementations are in the `.cpp`.

3. **Should local variables (inside function bodies) be indexed?**
   - Recommendation: Yes, but mark them with a flag (`isLocal: true`). Include them in cursor resolution but exclude from workspace-level enumeration. They're useful when the user ctrl+shift+E's on a local variable.

4. **How to handle template/generic parameters?**
   - Recommendation: Omit template parameters from addresses. `vector<User>` and `vector<string>` are the same symbol `vector`. If the user explores a specific instantiation, the LLM handles the type-specific analysis.

5. **How to handle function overloads?**
   - **Resolved** — See Section 3.1. Overloads are disambiguated using a 4-character hash of the normalized parameter signature, appended as `~XXXX` suffix to the address. This is stable across code reformatting and reordering. When the user clicks a symbol name that maps to multiple overloads, a VS Code QuickPick context menu is shown with all candidates displaying their full address and parameter signature (see Section 5.2.1). The user selects the desired overload, and navigation proceeds to that specific analysis.

6. **How are addresses kept stable when code changes?**
   - **Resolved** — See Section 3.2. Addresses are derived entirely from AST structure (name + scope chain + kind + parameter types), never from line numbers. Line numbers are stored as navigation metadata only and are updated on re-index without affecting the address or cache validity. The file watcher (Section Phase 4) diffs old vs new **addresses** to detect actual symbol changes vs harmless reformatting.
