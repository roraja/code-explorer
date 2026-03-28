# Symbol Identity & Cache Key Strategies

## Problem

A "symbol" in a codebase needs a stable, unique identity that works for:
1. **Cache key** — look up prior LLM analysis without re-running it
2. **Tab deduplication** — "is this the same symbol the user already opened?"
3. **Staleness detection** — "has this symbol changed since we last analyzed it?"

### Current approach & its flaws

Today we use `filePath + kind + name + containerName` to build a cache path like `src/User.ts/class.User.md`. This breaks in several ways:

- **Name collisions**: two overloads of the same function, or two identically-named local variables in different scopes, map to the same key.
- **Rename drift**: renaming a symbol invalidates the cache entirely — no migration path.
- **Position fragility**: adding a line above a symbol shifts its position, yet the symbol hasn't changed.
- **Cross-file identity**: the same symbol re-exported from another file has no linkage.
- **Local variable ambiguity**: a variable named `result` in `getUser()` and another `result` in `deleteUser()` both resolve to `var.result.md` — same cache file, wrong analysis.

### The local variable problem

This deserves special attention. Consider:

```typescript
// src/UserService.ts
class UserService {
  getUser(id: string) {
    const result = this.db.query(id);    // ← local var "result"
    return result;
  }
  deleteUser(id: string) {
    const result = this.db.delete(id);   // ← different local var, same name "result"
    return result;
  }
}
```

Both `result` variables have `name: "result"`, `kind: "variable"`, `filePath: "src/UserService.ts"`, `containerName: "UserService"`. The current system cannot distinguish them. Any viable key strategy **must** include the enclosing function/method scope to differentiate.

---

## Idea 1: Qualified Scope Chain Key

**Key format**: `filePath::scope0.scope1.…scopeN.kind:name`

Build the key by walking the full scope chain from the document symbol tree. Every nesting level becomes part of the key. This naturally disambiguates local variables inside different functions because the function name is part of the chain.

```
src/controllers/UserController.ts::UserController.getUser.method:getUser
src/utils/helpers.ts::module.processItems.0.fn:callback

# Local variable disambiguation:
src/UserService.ts::UserService.getUser.var:result      ← getUser's result
src/UserService.ts::UserService.deleteUser.var:result    ← deleteUser's result (different key!)

# Even deeper nesting works:
src/app.ts::main.forEach.if.var:temp                     ← scoped to the if-block inside forEach inside main
```

**How to get it from VS Code**: `vscode.executeDocumentSymbolProvider` already returns a tree of `DocumentSymbol` with `children`. Walk from root to the target, collecting names.

| Aspect | Rating |
|--------|--------|
| Uniqueness | Good — handles local vars in different functions, but anonymous/duplicate names at the same scope level still collide |
| Stability | Medium — renames break it, but position-independent |
| Complexity | Low — just string concatenation from the symbol tree |
| VS Code integration | Native — uses only `DocumentSymbol` tree |

**Best for**: Projects with well-named, non-overloaded symbols. Simple to implement.

---

## Idea 2: Content-Hash Key (Source SHA)

**Key format**: `filePath::sha256(symbolSourceText)[:12]`

Extract the symbol's full source text (using its `range`) and hash it. The hash *is* the identity.

```
src/User.ts::a3f7c9e1b204       → class User { ... }
src/User.ts::8b1d4e6f3a72       → function validateUser() { ... }

# Local variables: different bodies → different hashes, even with same name
src/UserService.ts::e4a1b2c3d5f6 → const result = this.db.query(id)    (in getUser)
src/UserService.ts::7f8e9d0c1b2a → const result = this.db.delete(id)   (in deleteUser)
```

**How to get it from VS Code**: `document.getText(symbol.range)` gives the source. Hash with `crypto.createHash('sha256')`.

| Aspect | Rating |
|--------|--------|
| Uniqueness | Excellent — even identical names in same file get different keys if bodies differ |
| Stability | Inverted — key changes when content changes; stays the same on rename if body is the same. This is actually *ideal for cache invalidation*: key change = cache miss = re-analyze |
| Complexity | Low — hash function + range extraction |
| VS Code integration | Native — needs `DocumentSymbol.range` |

**Best for**: Cache invalidation is automatic. No need for a separate staleness check — if the hash matches, the cache is fresh by definition. But: every whitespace/comment change causes a cache miss, even if semantics are unchanged.

**Variant**: Hash only the AST structure (strip comments/whitespace) for semantic stability. Requires a parser.

---

## Idea 3: LSP-Based Canonical URI

**Key format**: Use the symbol's `DocumentSymbol` identity as surfaced by the LSP + position to construct a canonical URI.

```
symbol://src/User.ts/class/User
symbol://src/User.ts/class/User/method/getUser
symbol://src/routes.ts/function/0/anonymous

# Local variables get scoped under their enclosing function:
symbol://src/UserService.ts/class/UserService/method/getUser/variable/result
symbol://src/UserService.ts/class/UserService/method/deleteUser/variable/result
```

Build it from LSP `SymbolInformation.containerName` chain + `SymbolKind` + name. For anonymous symbols, use an ordinal index among siblings of the same kind.

**How to get it from VS Code**: Walk the `DocumentSymbol` tree. For each level, emit `kind/name`. For unnamed symbols (anonymous functions, arrow functions), emit `kind/index`.

| Aspect | Rating |
|--------|--------|
| Uniqueness | Excellent — ordinal indexing handles anonymous/duplicate names |
| Stability | Good — survives position shifts, but ordinal indices shift if a sibling is added above |
| Complexity | Medium — need to define ordinal indexing rules |
| VS Code integration | Native — DocumentSymbol tree only |

**Best for**: Extensibility. This is the URI approach used by Eclipse, IntelliJ, and some LSP servers. Natural to extend with cross-file identity later (via `DefinitionProvider`).

---

## Idea 4: Hybrid Key (Scope Chain + Content Hash)

**Key format**: `filePath::scopeChain::contentHash[:8]`

Combine Ideas 1 and 2. The scope chain provides human readability and fast lookup; the content hash provides uniqueness and automatic invalidation.

```
src/User.ts::User.getUser::a3f7c9e1
src/User.ts::module.processItems.callback::8b1d4e6f

# Local variable "result" in two different methods — different scope chain, different hash:
src/UserService.ts::UserService.getUser.result::e4a1b2c3
src/UserService.ts::UserService.deleteUser.result::7f8e9d0c
```

**Cache strategy**: 
- **Primary lookup** by scope chain (fast, O(1) with an index)
- **Validation** by comparing stored content hash with current hash
- **On hash mismatch**: cache is stale → re-analyze, update hash

This cleanly separates **identity** (scope chain — "what am I looking at?") from **freshness** (hash — "has it changed?").

| Aspect | Rating |
|--------|--------|
| Uniqueness | Excellent — scope chain + hash handles all edge cases |
| Stability | Excellent — scope chain survives whitespace changes; hash catches real edits |
| Complexity | Medium — two mechanisms to maintain |
| VS Code integration | Native — DocumentSymbol tree + getText |

**Best for**: The "do it right" approach. Identity is stable, freshness is accurate. The cache file lives at a human-readable path (scope chain) and contains the hash in frontmatter for validation.

---

## Idea 5: Git-Aware Blame-Line Key

**Key format**: `blame(filePath, symbolStartLine) → commitSha::filePath::lineInCommit`

Use `git blame` to find the commit that last touched the symbol's start line. The symbol's identity is tied to its *origin commit + original file + original line number*. This survives renames, moves, and even cross-file refactors if `git log --follow` is used.

```
abc123f::src/User.ts::42       → class User (last changed in commit abc123f at line 42)
def456a::src/helpers.ts::10    → function validate (last changed in def456a)
```

**How to get it from VS Code**: Shell out to `git blame -L <start>,<end> --porcelain <file>`. Parse the output for the originating commit + original filename + original line.

| Aspect | Rating |
|--------|--------|
| Uniqueness | Excellent — commit+file+line is globally unique across history |
| Stability | Excellent — survives renames, moves, reformatting (as long as the line itself doesn't change) |
| Complexity | High — requires git, async shell, parsing blame output |
| VS Code integration | External — needs `git` CLI, but VS Code's built-in git extension provides some APIs |

**Best for**: Long-lived analysis in large repos where files get renamed/moved frequently. Natural integration with PR review workflows ("show me the analysis from when this was last changed"). But: adds latency (git blame is not instant), doesn't work outside git repos, and requires careful handling of uncommitted changes.

---

## Comparison Matrix

| | Scope Chain | Content Hash | LSP URI | Hybrid | Git Blame |
|---|---|---|---|---|---|
| **Unique local vars across fns** | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| **Unique across overloads** | ⚠ Partial | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| **Survives renames** | ❌ No | ✅ Yes | ❌ No | ⚠ Hash part | ✅ Yes |
| **Survives position shifts** | ✅ Yes | ✅ Yes | ⚠ Ordinals | ✅ Yes | ⚠ Depends |
| **Auto-detects staleness** | ❌ Separate | ✅ Built-in | ❌ Separate | ✅ Built-in | ✅ Built-in |
| **Human-readable** | ✅ Yes | ❌ Hash only | ✅ Yes | ✅ Yes | ❌ Hash only |
| **Implementation cost** | Low | Low | Medium | Medium | High |
| **Works without git** | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | ❌ No |

## Recommendation

**Idea 4 (Hybrid)** is the strongest overall approach:
- **Cache file path** uses the scope chain → human-readable, browseable in file explorer
- **Frontmatter** stores the content hash → automatic staleness detection on read
- **Tab dedup** uses the scope chain alone → fast, position-independent
- Falls back to position-based matching only for truly anonymous symbols

Implementation order: start with Idea 1 (scope chain only) as the immediate improvement over the current name-only approach, then layer on content hashing (Idea 2) for staleness detection. This gets 80% of the benefit with low risk.

### Critical invariant

Every approach **must** include the full enclosing scope chain when identifying local variables. A variable `result` inside `getUser()` and `result` inside `deleteUser()` are completely different symbols with different types, lifetimes, and semantics. The scope chain (`UserService.getUser.result` vs `UserService.deleteUser.result`) is the minimal discriminator. Content hashing adds a redundant safety net (different function bodies → different hashes), but the scope chain alone is sufficient and should be the primary identity axis.
