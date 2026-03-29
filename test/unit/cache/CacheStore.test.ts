/**
 * Code Explorer — Unit Tests for CacheStore.findByCursor
 *
 * Tests the fuzzy cursor-based cache lookup that scans the cache
 * directory for matching symbol names within ±3 lines.
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
});
