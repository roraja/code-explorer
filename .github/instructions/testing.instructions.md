---
applyTo: "test/**"
description: "Use when writing or modifying test files. Enforces Mocha TDD conventions."
---

# Testing Conventions

- **Framework**: Mocha with TDD UI — use `suite`/`test`, never `describe`/`it`
- **Assertions**: Node.js `assert` module (`assert.strictEqual`, `assert.ok`, `assert.throws`) — no Chai, no Jest
- **Run single file**: `TS_NODE_PROJECT=tsconfig.test.json npx mocha test/unit/path/to/file.test.ts`
- **Errors**: Use `CodeExplorerError` subclasses from `src/models/errors.ts` — tests should validate error hierarchy
- **Naming**: Test files end in `.test.ts`, mirror the source path (e.g., `src/cache/CacheStore.ts` → `test/unit/cache/CacheStore.test.ts`)
