/**
 * Code Explorer — Unit Tests for CacheStore.findByCursor and LLM Fallback
 *
 * Tests the fuzzy cursor-based cache lookup that scans the cache
 * directory for matching symbol names within ±3 lines, plus the
 * LLM-assisted cache fallback that matches cursor context against
 * cached symbol descriptions.
 */
import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { CacheStore } from '../../../src/cache/CacheStore';
import type { AnalysisResult, SymbolInfo } from '../../../src/models/types';

/** Create a minimal AnalysisResult for writing to cache. */
function makeResult(symbol: SymbolInfo, overview: string): AnalysisResult {
  return {
    symbol,
    overview,
    callStacks: [],
    usages: [],
    dataFlow: [],
    relationships: [],
    metadata: {
      analyzedAt: new Date().toISOString(),
      sourceHash: '',
      dependentFileHashes: {},
      llmProvider: 'test-provider',
      analysisVersion: '1.0.0',
      stale: false,
    },
  };
}

suite('CacheStore', () => {
  let tmpDir: string;
  let store: CacheStore;

  setup(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'code-explorer-test-'));
    store = new CacheStore(tmpDir);
  });

  teardown(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  suite('findByCursor', () => {
    test('finds a cached symbol matching name and line within tolerance', async () => {
      // Write a cache entry for a function at line 10
      const sym: SymbolInfo = {
        name: 'processUser',
        kind: 'function',
        filePath: 'src/main.ts',
        position: { line: 10, character: 0 },
      };
      const result = makeResult(sym, 'Processes user data.');
      await store.write(result);

      // Search from cursor at line 11 (delta=1, within ±3)
      const found = await store.findByCursor('processUser', 'src/main.ts', 11);
      assert.ok(found, 'Should find the cached entry');
      assert.strictEqual(found!.symbol.name, 'processUser');
      assert.strictEqual(found!.symbol.kind, 'function');
      assert.strictEqual(found!.result.overview, 'Processes user data.');
    });

    test('finds a cached symbol at exact same line', async () => {
      const sym: SymbolInfo = {
        name: 'myVar',
        kind: 'variable',
        filePath: 'src/store.ts',
        position: { line: 25, character: 0 },
        scopeChain: ['calculate'],
      };
      await store.write(makeResult(sym, 'Counter variable.'));

      const found = await store.findByCursor('myVar', 'src/store.ts', 25);
      assert.ok(found, 'Should find at exact line');
      assert.strictEqual(found!.symbol.name, 'myVar');
      assert.strictEqual(found!.symbol.kind, 'variable');
    });

    test('finds a cached symbol at max tolerance (±3)', async () => {
      const sym: SymbolInfo = {
        name: 'doWork',
        kind: 'method',
        filePath: 'src/worker.ts',
        position: { line: 50, character: 0 },
        scopeChain: ['Worker'],
        containerName: 'Worker',
      };
      await store.write(makeResult(sym, 'Does work.'));

      // line 47 → delta = 3 (still within tolerance)
      const found = await store.findByCursor('doWork', 'src/worker.ts', 47);
      assert.ok(found, 'Should find at delta=3');
      assert.strictEqual(found!.symbol.name, 'doWork');

      // line 53 → delta = 3 (still within tolerance)
      const found2 = await store.findByCursor('doWork', 'src/worker.ts', 53);
      assert.ok(found2, 'Should find at delta=3 on the other side');
    });

    test('returns null when line delta exceeds tolerance', async () => {
      const sym: SymbolInfo = {
        name: 'farAway',
        kind: 'function',
        filePath: 'src/far.ts',
        position: { line: 10, character: 0 },
      };
      await store.write(makeResult(sym, 'Too far.'));

      // line 14 → delta = 4 (exceeds ±3)
      const found = await store.findByCursor('farAway', 'src/far.ts', 14);
      assert.strictEqual(found, null, 'Should not find when delta > 3');
    });

    test('returns null when symbol name does not match', async () => {
      const sym: SymbolInfo = {
        name: 'alpha',
        kind: 'function',
        filePath: 'src/abc.ts',
        position: { line: 10, character: 0 },
      };
      await store.write(makeResult(sym, 'Alpha function.'));

      const found = await store.findByCursor('beta', 'src/abc.ts', 10);
      assert.strictEqual(found, null, 'Should not find when name differs');
    });

    test('returns null when cache directory does not exist', async () => {
      const found = await store.findByCursor('nope', 'nonexistent/file.ts', 0);
      assert.strictEqual(found, null, 'Should return null for missing dir');
    });

    test('returns null for empty cache directory', async () => {
      // Create the cache dir without any files
      const cacheDir = path.join(store.cacheRoot, 'src', 'empty.ts');
      await fs.mkdir(cacheDir, { recursive: true });

      const found = await store.findByCursor('something', 'src/empty.ts', 0);
      assert.strictEqual(found, null, 'Should return null for empty dir');
    });

    test('distinguishes between multiple symbols in the same file', async () => {
      // Write two symbols in the same file at different lines
      const sym1: SymbolInfo = {
        name: 'getData',
        kind: 'function',
        filePath: 'src/data.ts',
        position: { line: 10, character: 0 },
      };
      const sym2: SymbolInfo = {
        name: 'getData',
        kind: 'method',
        filePath: 'src/data.ts',
        position: { line: 80, character: 0 },
        scopeChain: ['DataService'],
        containerName: 'DataService',
      };
      await store.write(makeResult(sym1, 'Free function getData.'));
      await store.write(makeResult(sym2, 'Method getData in DataService.'));

      // Cursor at line 11 → should match sym1 (line 10, delta=1)
      const found1 = await store.findByCursor('getData', 'src/data.ts', 11);
      assert.ok(found1, 'Should find sym1');
      assert.strictEqual(found1!.result.overview, 'Free function getData.');

      // Cursor at line 79 → should match sym2 (line 80, delta=1)
      const found2 = await store.findByCursor('getData', 'src/data.ts', 79);
      assert.ok(found2, 'Should find sym2');
      assert.strictEqual(found2!.result.overview, 'Method getData in DataService.');
    });

    test('reconstructs SymbolInfo from frontmatter including scope chain', async () => {
      const sym: SymbolInfo = {
        name: 'count',
        kind: 'variable',
        filePath: 'src/counter.ts',
        position: { line: 15, character: 0 },
        scopeChain: ['Counter', 'increment'],
        containerName: 'increment',
      };
      await store.write(makeResult(sym, 'Count variable.'));

      const found = await store.findByCursor('count', 'src/counter.ts', 15);
      assert.ok(found, 'Should find the symbol');
      assert.strictEqual(found!.symbol.kind, 'variable');
      assert.deepStrictEqual(found!.symbol.scopeChain, ['Counter', 'increment']);
      assert.strictEqual(found!.symbol.containerName, 'increment');
    });

    test('skips stale entries but still returns them (caller decides)', async () => {
      const sym: SymbolInfo = {
        name: 'staleFunc',
        kind: 'function',
        filePath: 'src/stale.ts',
        position: { line: 5, character: 0 },
      };
      const result = makeResult(sym, 'Stale function.');
      result.metadata.stale = true;
      await store.write(result);

      // findByCursor returns the match regardless of staleness
      // — the caller (orchestrator) decides what to do with it
      const found = await store.findByCursor('staleFunc', 'src/stale.ts', 5);
      assert.ok(found, 'Should return stale entry (caller decides)');
      assert.strictEqual(found!.result.metadata.stale, true);
    });
  });

  suite('listCachedSymbols', () => {
    test('returns all cached symbols for a source file', async () => {
      // Write two symbols in the same source file
      const sym1: SymbolInfo = {
        name: 'FooClass',
        kind: 'class',
        filePath: 'src/foo.ts',
        position: { line: 5, character: 0 },
      };
      const sym2: SymbolInfo = {
        name: 'barMethod',
        kind: 'method',
        filePath: 'src/foo.ts',
        position: { line: 20, character: 0 },
        scopeChain: ['FooClass'],
        containerName: 'FooClass',
      };
      await store.write(makeResult(sym1, 'FooClass manages foo operations.'));
      await store.write(makeResult(sym2, 'barMethod performs bar.'));

      const symbols = await store.listCachedSymbols('src/foo.ts');
      assert.strictEqual(symbols.length, 2, 'Should find 2 cached symbols');

      // Check that both are present (order may vary)
      const names = symbols.map((s) => s.name).sort();
      assert.deepStrictEqual(names, ['FooClass', 'barMethod']);

      // Check that overview snippets are extracted
      const fooEntry = symbols.find((s) => s.name === 'FooClass');
      assert.ok(fooEntry, 'FooClass should be in the list');
      assert.strictEqual(fooEntry!.kind, 'class');
      assert.strictEqual(fooEntry!.line, 5);
      assert.ok(
        fooEntry!.overviewSnippet.includes('FooClass manages foo'),
        'Overview snippet should be extracted'
      );

      const barEntry = symbols.find((s) => s.name === 'barMethod');
      assert.ok(barEntry, 'barMethod should be in the list');
      assert.strictEqual(barEntry!.kind, 'method');
      assert.deepStrictEqual(barEntry!.scopeChain, ['FooClass']);
    });

    test('returns empty array when cache directory does not exist', async () => {
      const symbols = await store.listCachedSymbols('nonexistent/file.ts');
      assert.strictEqual(symbols.length, 0);
    });

    test('returns empty array when cache directory has no .md files', async () => {
      const cacheDir = path.join(store.cacheRoot, 'src', 'empty.ts');
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.writeFile(path.join(cacheDir, 'not-a-cache.txt'), 'hello');

      const symbols = await store.listCachedSymbols('src/empty.ts');
      assert.strictEqual(symbols.length, 0);
    });

    test('skips files with invalid frontmatter', async () => {
      const sym: SymbolInfo = {
        name: 'validSym',
        kind: 'function',
        filePath: 'src/mixed.ts',
        position: { line: 10, character: 0 },
      };
      await store.write(makeResult(sym, 'Valid symbol.'));

      // Write an invalid cache file in the same directory
      const cacheDir = path.join(store.cacheRoot, 'src', 'mixed.ts');
      await fs.writeFile(
        path.join(cacheDir, 'fn.broken.md'),
        'This file has no frontmatter at all.'
      );

      const symbols = await store.listCachedSymbols('src/mixed.ts');
      assert.strictEqual(symbols.length, 1, 'Should only return the valid symbol');
      assert.strictEqual(symbols[0].name, 'validSym');
    });

    test('truncates overview snippet to ~150 chars', async () => {
      const longOverview = 'A'.repeat(300);
      const sym: SymbolInfo = {
        name: 'longDoc',
        kind: 'function',
        filePath: 'src/long.ts',
        position: { line: 1, character: 0 },
      };
      await store.write(makeResult(sym, longOverview));

      const symbols = await store.listCachedSymbols('src/long.ts');
      assert.strictEqual(symbols.length, 1);
      assert.ok(
        symbols[0].overviewSnippet.length <= 150,
        `Overview snippet should be truncated (got ${symbols[0].overviewSnippet.length})`
      );
    });
  });

  suite('findByCursorWithLLMFallback', () => {
    test('returns exact match from findByCursor without invoking LLM', async () => {
      // Write a cache entry
      const sym: SymbolInfo = {
        name: 'exactMatch',
        kind: 'function',
        filePath: 'src/exact.ts',
        position: { line: 10, character: 0 },
      };
      await store.write(makeResult(sym, 'Exact match function.'));

      const cursor = {
        word: 'exactMatch',
        filePath: 'src/exact.ts',
        position: { line: 11, character: 0 },
        surroundingSource: 'function exactMatch() {}',
        cursorLine: 'function exactMatch() {}',
      };

      // Should find via findByCursor and never call the LLM
      const found = await store.findByCursorWithLLMFallback(cursor, tmpDir);
      assert.ok(found, 'Should find via exact match');
      assert.strictEqual(found!.symbol.name, 'exactMatch');
      assert.strictEqual(found!.result.overview, 'Exact match function.');
    });

    test('returns null when no cache directory exists (no LLM call)', async () => {
      const cursor = {
        word: 'missing',
        filePath: 'nonexistent/file.ts',
        position: { line: 5, character: 0 },
        surroundingSource: 'const missing = 42;',
        cursorLine: 'const missing = 42;',
      };

      const found = await store.findByCursorWithLLMFallback(cursor, tmpDir);
      assert.strictEqual(found, null, 'Should return null — no cache dir');
    });

    test('returns null when no cached symbols exist for the file', async () => {
      // Create cache dir but with no .md files
      const cacheDir = path.join(store.cacheRoot, 'src', 'empty.ts');
      await fs.mkdir(cacheDir, { recursive: true });

      const cursor = {
        word: 'nope',
        filePath: 'src/empty.ts',
        position: { line: 1, character: 0 },
        surroundingSource: 'const nope = 0;',
        cursorLine: 'const nope = 0;',
      };

      const found = await store.findByCursorWithLLMFallback(cursor, tmpDir);
      assert.strictEqual(found, null, 'Should return null — no cached symbols');
    });
  });
});
