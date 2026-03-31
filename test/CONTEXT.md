# test/

Unit and integration tests for the Code Explorer extension.

## Test Framework

- **Mocha** with **TDD UI**: Use `suite`/`test`, **never** `describe`/`it`
- **Assertions**: Node.js `assert` module (`assert.strictEqual`, `assert.ok`, `assert.throws`) — no Chai, no Jest
- **Config**: `.mocharc.yml` in project root
- **TypeScript**: Uses `tsconfig.test.json` (includes both `src/` and `test/`)

## Running Tests

```bash
npm run test:unit                    # All unit tests
npm run test:api                     # API integration tests only (no VS Code runtime)
TS_NODE_PROJECT=tsconfig.test.json npx mocha test/unit/models/errors.test.ts  # Single file
```

## Directory Structure

```
test/
  __mocks__/vscode.js         # Mock VS Code API for unit tests
  setup.js                     # Mocha setup (registers mocks)
  unit/
    api/
      helpers/
        MockLLMProvider.ts     # Mock LLM provider for API tests
        fixtures.ts            # Shared test fixtures
      cacheRoundTrip.test.ts   # Tests cache write + read round-trip via API
      dependencyGraph.test.ts  # Tests GraphBuilder via API
      enhanceAnalysis.test.ts  # Tests enhance (Q&A) via API
      exploreFile.test.ts      # Tests file-level analysis via API
      exploreSymbol.test.ts    # Tests cursor-based symbol analysis via API
    cache/
      CacheStore.test.ts       # Tests findByCursor fuzzy lookup (uses real filesystem via tmpdir)
    indexing/
      Extractors.test.ts       # Tests C++ and TypeScript symbol extraction, overloads, code-change resilience
      SymbolAddress.test.ts    # Tests address build/parse round-trips, discriminator, cache path derivation
      SymbolIndex.test.ts      # Tests insert, lookup, remove, cursor resolution, persistence
    llm/
      BuildServiceProvider.test.ts  # Tests BuildServiceProvider HTTP interactions
      MockCopilotProvider.test.ts   # Tests MockCopilotProvider
      PromptBuilder.test.ts    # Tests prompt strategy selection, buildUnified, struct support
      ResponseParser.test.ts   # Tests JSON block extraction, parseSymbolIdentity, parseRelatedSymbolCacheEntries, data kind parsing
    models/
      errors.test.ts           # Tests error hierarchy, instanceof checks, getUserMessage()
      types.test.ts            # Tests type definitions, SYMBOL_KIND_PREFIX (including struct), CursorContext
    ui/
      NavigationHistory.test.ts  # Tests navigation history logic
      TabSessionStore.test.ts    # Tests tab session persistence (write + read + validation)
  integration/
    extension.test.ts          # Integration tests requiring VS Code runtime
  suite/
    index.ts                   # VS Code test runner entry point
  runTests.ts                  # VS Code test launcher
```

## Test File Naming

Test files mirror source paths:
- `src/models/errors.ts` -> `test/unit/models/errors.test.ts`
- `src/llm/PromptBuilder.ts` -> `test/unit/llm/PromptBuilder.test.ts`
- `src/cache/CacheStore.ts` -> `test/unit/cache/CacheStore.test.ts`
- `src/api/CodeExplorerAPI.ts` -> `test/unit/api/exploreSymbol.test.ts` (and other api tests)
- `src/indexing/SymbolAddress.ts` -> `test/unit/indexing/SymbolAddress.test.ts`
- `src/ui/TabSessionStore.ts` -> `test/unit/ui/TabSessionStore.test.ts`

## VS Code Mock

`test/__mocks__/vscode.js` provides a mock of the VS Code API for unit tests that don't need the full Extension Development Host. Key mocked items:
- `vscode.SymbolKind` enum
- `vscode.Position`, `vscode.Range` classes
- `vscode.workspace`, `vscode.window`

## Writing New Tests

1. Create file at `test/unit/<mirror-path>.test.ts`
2. Use TDD UI:
   ```typescript
   import * as assert from 'assert';
   suite('ModuleName', () => {
     test('should do something', () => {
       assert.strictEqual(actual, expected);
     });
   });
   ```
3. Import from `src/` directly (test tsconfig includes both)
4. Use `CodeExplorerError` subclasses for error assertion tests
5. For filesystem-dependent tests (e.g., CacheStore), use `os.tmpdir()` with `setup`/`teardown` cleanup
6. For API tests, use `MockLLMProvider` from `test/unit/api/helpers/MockLLMProvider.ts` with canned responses
