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
TS_NODE_PROJECT=tsconfig.test.json npx mocha test/unit/models/errors.test.ts  # Single file
```

## Directory Structure

```
test/
  __mocks__/vscode.js         # Mock VS Code API for unit tests
  setup.js                     # Mocha setup (registers mocks)
  unit/
    llm/
      PromptBuilder.test.ts    # Tests prompt strategy selection and output
      ResponseParser.test.ts   # Tests JSON block extraction and section parsing
    models/
      errors.test.ts           # Tests error hierarchy, instanceof checks, getUserMessage()
      types.test.ts            # Tests type definitions and SYMBOL_KIND_PREFIX map
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
