# 27 - Promote Cache File When findByCursor Hits After readByAddress Miss

**Date**: 2026-03-29 00:00 UTC
**Prompt**: If CacheStore.readByAddress was a miss but CacheStore.findByCursor was a hit, move/link that md file so that next time, readByAddress works.

## 1. Code Reading & Analysis
- Read `.context/FLOORPLAN.md` — understood tiered cache lookup architecture
- Read `src/cache/CacheStore.ts` (full file, ~1435 lines) — studied:
  - `readByAddress()` (line 110–160): derives cache path from symbol address `<file>#<scope>::<kind>.<name>` → `.vscode/code-explorer/<file>/<scope>.<kind>.<name>.md`
  - `findByCursor()` (line 246–368): scans cache directory, matches by frontmatter `symbol` name + ±3 line tolerance
  - `findByCursorWithLLMFallback()` (line 459–650): two-tier — exact match then lightweight LLM fallback
  - `write()` (line 657–669): uses `_resolvePath()` → `_buildCacheKey()` which builds `<sanitizedScope>.<kindPrefix>.<sanitizedName>.md`
  - `_buildCacheKey()` (line 682–698): scope chain sanitized, joined with dots
  - `_resolvePath()` (line 700–704): joins cacheRoot + filePath + cacheKey.md
  - `_sanitizeName()` (line 1427–1433): replaces special chars with `_`
- Read `src/indexing/SymbolAddress.ts` — studied `addressToCachePath()` (line 170–183): replaces `::` with `.` in the symbol part
- Read `src/analysis/AnalysisOrchestrator.ts` — studied `analyzeFromCursor()` (line 327–691):
  - Tier 1 (line 343–418): VS Code static analysis → `buildAddress()` → `readByAddress()`
  - Tier 2 (line 425–461): tree-sitter index → `readByAddress()`
  - Tier 3 (line 464–520): `findByCursorWithLLMFallback()` fuzzy scan
  - The address from Tier 1/2 is scoped to its `if` block; not available in Tier 3
- Read `src/cache/CONTEXT.md` — confirmed cache key resolution docs

## 2. Issues Identified
- **File**: `src/analysis/AnalysisOrchestrator.ts`, lines 343–520
- **Problem**: When `readByAddress()` misses (Tier 1/2) but `findByCursor()` hits (Tier 3), the cache file exists on disk but under a different filename than what the address-based path expects. The mismatch comes from scope chains or symbol kinds differing between VS Code's static analysis resolution and what the LLM originally produced when writing the cache.
- **Effect**: Every subsequent lookup for the same symbol goes through the expensive directory-scan Tier 3 path (or even the LLM fallback), instead of getting an O(1) hit via address. This adds latency on every re-visit.
- **Root cause**: `write()` uses `_buildCacheKey()` which sanitizes the scope chain from whatever the LLM reported, while `readByAddress()` derives a path from what VS Code/tree-sitter resolves — these can produce different file names for the same symbol.

## 3. Plan
- Add a `promoteToAddress()` method on `CacheStore` that creates a symlink (with copy fallback for Windows) from the address-derived path to the existing cache file
- In `AnalysisOrchestrator.analyzeFromCursor()`:
  - Track addresses that missed (`missedAddresses` array)
  - When Tier 3 hits, call `promoteToAddress()` for each missed address
- This is a non-breaking, additive change — symlinks are transparent to `fs.readFile()`
- Alternatives considered:
  - Renaming/moving the file: rejected because it would break `findByCursor` and any other path that found it at the legacy location
  - Writing a second copy: rejected because duplicating cache data wastes disk and creates sync issues
  - Symlink was chosen because it's zero-copy, transparent, and keeps the original file in place

## 4. Changes Made

### File: `src/cache/CacheStore.ts`
- **Added**: `promoteToAddress(address, symbol)` method (after `write()`, before path resolution section)
- Creates a relative symlink from the address-derived path to the legacy `_resolvePath()` path
- Falls back to `fs.copyFile()` if symlink fails (e.g., Windows without developer mode)
- No-ops when paths are identical, target doesn't exist, or link already exists
- Full safety checks: validates address format, checks both paths exist/don't exist before acting

### File: `src/analysis/AnalysisOrchestrator.ts`
- **Added**: `missedAddresses: string[]` array at top of `analyzeFromCursor()` (line 340)
- **Modified**: Tier 1 cache miss (line 417) — pushes address to `missedAddresses`
- **Modified**: Tier 2 cache miss (line 458) — pushes address to `missedAddresses`
- **Modified**: Tier 3 HIT block (line 495–504) — iterates `missedAddresses` and calls `promoteToAddress()` for each, with error handling

## 5. Commands Run
- `npm run build` — ✅ Pass (extension 206.3kb, webview 2.8mb)
- `npm run lint` — ✅ Pass (only pre-existing warnings in ShowSymbolInfoCommand.ts)
- `npm run test:unit` — ✅ 223 passing (223ms)

## 6. Result
- When `readByAddress()` misses but `findByCursor()` hits, the system now automatically creates a symlink so that the next `readByAddress()` call succeeds directly with O(1) lookup.
- This is a "self-healing" cache: the first lookup for a mismatched symbol is still slow (Tier 3), but all subsequent lookups become instant (Tier 1).
- No existing behavior is changed — the symlink is transparent to all read operations.

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `src/cache/CacheStore.ts` | Modified | Added `promoteToAddress()` method — creates symlink (or copy fallback) from address path to legacy path |
| `src/analysis/AnalysisOrchestrator.ts` | Modified | Track missed addresses across tiers; call `promoteToAddress()` on Tier 3 HIT |
