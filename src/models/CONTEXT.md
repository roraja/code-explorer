# src/models/

Single source of truth for all TypeScript interfaces, error classes, and configuration constants used across the extension.

## Modules

| File | Contains |
|------|----------|
| `types.ts` | All interfaces: `SymbolInfo`, `AnalysisResult`, `TabState`, message types, cache/index types, LLM request types, `SYMBOL_KIND_PREFIX` map |
| `errors.ts` | `CodeExplorerError` base class + subclasses (`LLMError`, `CacheError`, `AnalysisError`, `SystemError`), `ErrorCode` enum, helper functions `isCodeExplorerError()`, `getUserMessage()` |
| `constants.ts` | Extension IDs, command names (`COMMANDS`), config keys (`CONFIG`), cache constants (`CACHE`), queue defaults (`QUEUE`), supported languages, analysis version |

## Key Types

- **`SymbolInfo`** — Primary input to the analysis pipeline. Contains name, kind, filePath, position, optional range, containerName, scopeChain.
- **`AnalysisResult`** — Complete output including overview, callStacks, usages, dataFlow, relationships, functionSteps, subFunctions, functionInputs, functionOutput, classMembers, memberAccess, variableLifecycle, relatedSymbols, and metadata.
- **`TabState`** — UI state for a single sidebar tab (loading/ready/error/stale).
- **`ExtensionToWebviewMessage`** / **`WebviewToExtensionMessage`** — Message protocol between extension host and webview.

## Error Hierarchy

```
CodeExplorerError (base)
  +-- LLMError         (LLM_UNAVAILABLE, LLM_TIMEOUT, LLM_RATE_LIMITED, LLM_PARSE_ERROR, LLM_AUTH_ERROR)
  +-- CacheError       (CACHE_READ_ERROR, CACHE_WRITE_ERROR, CACHE_CORRUPT, INDEX_CORRUPT)
  +-- AnalysisError    (SYMBOL_NOT_FOUND, ANALYSIS_TIMEOUT, FILE_NOT_FOUND, LANGUAGE_NOT_SUPPORTED)
  +-- SystemError      (WORKSPACE_NOT_OPEN, DISK_FULL, PERMISSION_DENIED)
```

All LLM/cache/analysis errors are `recoverable: true`. System errors are `recoverable: false`.

## Do NOT

- Add new constants outside `constants.ts`
- Create new error types without extending `CodeExplorerError`
- Import from `webview/` (separate TypeScript project)
