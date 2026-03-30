/**
 * Code Explorer — Unit Tests for SymbolIndex
 *
 * Tests insert, lookup by address/name/file/cursor, persistence
 * round-trip, and overload detection.
 */
import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { SymbolIndex, type SymbolIndexEntry } from '../../../src/indexing/SymbolIndex';

/** Create a minimal SymbolIndexEntry for testing. */
function makeEntry(overrides: Partial<SymbolIndexEntry> & Pick<SymbolIndexEntry, 'address' | 'name' | 'kind' | 'filePath'>): SymbolIndexEntry {
  return {
    startLine: 0,
    endLine: 10,
    startColumn: 0,
    scopeChain: [],
    paramSignature: null,
    overloadDiscriminator: null,
    sourceHash: 'sha256:test',
    isLocal: false,
    ...overrides,
  };
}

suite('SymbolIndex', () => {
  let tmpDir: string;
  let index: SymbolIndex;

  setup(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'code-explorer-idx-'));
    index = new SymbolIndex(tmpDir);
  });

  teardown(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  suite('addFileEntries / lookups', () => {
    test('inserts entries and looks up by address', () => {
      const entry = makeEntry({
        address: 'src/main.cpp#fn.printBanner',
        name: 'printBanner',
        kind: 'function',
        filePath: 'src/main.cpp',
        startLine: 13,
        endLine: 17,
      });

      index.addFileEntries('src/main.cpp', [entry], 'sha256:abc');

      const found = index.getByAddress('src/main.cpp#fn.printBanner');
      assert.ok(found);
      assert.strictEqual(found.name, 'printBanner');
      assert.strictEqual(found.kind, 'function');
    });

    test('looks up by name', () => {
      const entry1 = makeEntry({
        address: 'src/a.ts#fn.parse',
        name: 'parse',
        kind: 'function',
        filePath: 'src/a.ts',
      });
      const entry2 = makeEntry({
        address: 'src/b.ts#fn.parse',
        name: 'parse',
        kind: 'function',
        filePath: 'src/b.ts',
      });

      index.addFileEntries('src/a.ts', [entry1], 'sha256:a');
      index.addFileEntries('src/b.ts', [entry2], 'sha256:b');

      const results = index.getByName('parse');
      assert.strictEqual(results.length, 2);
    });

    test('looks up by file', () => {
      const entry1 = makeEntry({
        address: 'src/main.cpp#fn.main',
        name: 'main',
        kind: 'function',
        filePath: 'src/main.cpp',
      });
      const entry2 = makeEntry({
        address: 'src/main.cpp#var.verbose',
        name: 'verbose',
        kind: 'variable',
        filePath: 'src/main.cpp',
      });

      index.addFileEntries('src/main.cpp', [entry1, entry2], 'sha256:abc');

      const results = index.getByFile('src/main.cpp');
      assert.strictEqual(results.length, 2);
    });

    test('returns empty array for unknown name', () => {
      assert.deepStrictEqual(index.getByName('nonexistent'), []);
    });

    test('returns undefined for unknown address', () => {
      assert.strictEqual(index.getByAddress('nonexistent#fn.x'), undefined);
    });

    test('returns empty array for unknown file', () => {
      assert.deepStrictEqual(index.getByFile('unknown.ts'), []);
    });

    test('symbolCount tracks total entries', () => {
      assert.strictEqual(index.symbolCount, 0);

      index.addFileEntries('a.ts', [
        makeEntry({ address: 'a.ts#fn.x', name: 'x', kind: 'function', filePath: 'a.ts' }),
        makeEntry({ address: 'a.ts#fn.y', name: 'y', kind: 'function', filePath: 'a.ts' }),
      ], 'sha256:a');

      assert.strictEqual(index.symbolCount, 2);
    });
  });

  suite('removeFile', () => {
    test('removes all entries for a file', () => {
      index.addFileEntries('src/a.ts', [
        makeEntry({ address: 'src/a.ts#fn.foo', name: 'foo', kind: 'function', filePath: 'src/a.ts' }),
      ], 'sha256:a');

      assert.strictEqual(index.symbolCount, 1);
      index.removeFile('src/a.ts');
      assert.strictEqual(index.symbolCount, 0);
      assert.strictEqual(index.getByAddress('src/a.ts#fn.foo'), undefined);
      assert.deepStrictEqual(index.getByName('foo'), []);
    });

    test('removing one file does not affect other files', () => {
      index.addFileEntries('a.ts', [
        makeEntry({ address: 'a.ts#fn.x', name: 'x', kind: 'function', filePath: 'a.ts' }),
      ], 'sha256:a');
      index.addFileEntries('b.ts', [
        makeEntry({ address: 'b.ts#fn.y', name: 'y', kind: 'function', filePath: 'b.ts' }),
      ], 'sha256:b');

      index.removeFile('a.ts');
      assert.strictEqual(index.symbolCount, 1);
      assert.ok(index.getByAddress('b.ts#fn.y'));
    });
  });

  suite('addFileEntries replaces existing', () => {
    test('replaces old entries when re-adding file', () => {
      index.addFileEntries('a.ts', [
        makeEntry({ address: 'a.ts#fn.old', name: 'old', kind: 'function', filePath: 'a.ts' }),
      ], 'sha256:a');

      index.addFileEntries('a.ts', [
        makeEntry({ address: 'a.ts#fn.new', name: 'new', kind: 'function', filePath: 'a.ts' }),
      ], 'sha256:a2');

      assert.strictEqual(index.symbolCount, 1);
      assert.strictEqual(index.getByAddress('a.ts#fn.old'), undefined);
      assert.ok(index.getByAddress('a.ts#fn.new'));
    });
  });

  suite('resolveAtCursor', () => {
    test('resolves cursor to the correct symbol', () => {
      index.addFileEntries('src/main.cpp', [
        makeEntry({
          address: 'src/main.cpp#fn.printBanner',
          name: 'printBanner',
          kind: 'function',
          filePath: 'src/main.cpp',
          startLine: 13,
          endLine: 17,
        }),
        makeEntry({
          address: 'src/main.cpp#fn.main',
          name: 'main',
          kind: 'function',
          filePath: 'src/main.cpp',
          startLine: 27,
          endLine: 92,
        }),
      ], 'sha256:abc');

      const result = index.resolveAtCursor('src/main.cpp', 15, 0);
      assert.ok(result);
      assert.strictEqual(result.name, 'printBanner');
    });

    test('resolves cursor to deepest (most specific) symbol', () => {
      index.addFileEntries('src/main.cpp', [
        makeEntry({
          address: 'src/main.cpp#fn.main',
          name: 'main',
          kind: 'function',
          filePath: 'src/main.cpp',
          startLine: 27,
          endLine: 92,
          scopeChain: [],
        }),
        makeEntry({
          address: 'src/main.cpp#main::var.logger',
          name: 'logger',
          kind: 'variable',
          filePath: 'src/main.cpp',
          startLine: 37,
          endLine: 37,
          scopeChain: ['main'],
        }),
      ], 'sha256:abc');

      const result = index.resolveAtCursor('src/main.cpp', 37, 0);
      assert.ok(result);
      assert.strictEqual(result.name, 'logger');
      assert.strictEqual(result.address, 'src/main.cpp#main::var.logger');
    });

    test('returns undefined for cursor outside any symbol', () => {
      index.addFileEntries('src/main.cpp', [
        makeEntry({
          address: 'src/main.cpp#fn.foo',
          name: 'foo',
          kind: 'function',
          filePath: 'src/main.cpp',
          startLine: 10,
          endLine: 20,
        }),
      ], 'sha256:abc');

      assert.strictEqual(index.resolveAtCursor('src/main.cpp', 5, 0), undefined);
    });

    test('returns undefined for unknown file', () => {
      assert.strictEqual(index.resolveAtCursor('unknown.ts', 0, 0), undefined);
    });
  });

  suite('getFileHash', () => {
    test('returns stored hash', () => {
      index.addFileEntries('a.ts', [], 'sha256:abc123');
      assert.strictEqual(index.getFileHash('a.ts'), 'sha256:abc123');
    });

    test('returns undefined for unknown file', () => {
      assert.strictEqual(index.getFileHash('unknown.ts'), undefined);
    });
  });

  suite('persistence (save/load)', () => {
    test('round-trips through save and load', async () => {
      index.addFileEntries('src/main.cpp', [
        makeEntry({
          address: 'src/main.cpp#fn.printBanner',
          name: 'printBanner',
          kind: 'function',
          filePath: 'src/main.cpp',
          startLine: 13,
          endLine: 17,
          paramSignature: '',
        }),
        makeEntry({
          address: 'src/main.cpp#main::var.logger',
          name: 'logger',
          kind: 'variable',
          filePath: 'src/main.cpp',
          startLine: 37,
          endLine: 37,
          scopeChain: ['main'],
          isLocal: true,
        }),
      ], 'sha256:abc');

      await index.save();

      // Create a new index and load
      const index2 = new SymbolIndex(tmpDir);
      const loaded = await index2.load();
      assert.ok(loaded);
      assert.strictEqual(index2.symbolCount, 2);

      const entry = index2.getByAddress('src/main.cpp#fn.printBanner');
      assert.ok(entry);
      assert.strictEqual(entry.name, 'printBanner');
      assert.strictEqual(entry.kind, 'function');
      assert.strictEqual(entry.filePath, 'src/main.cpp');

      const localVar = index2.getByAddress('src/main.cpp#main::var.logger');
      assert.ok(localVar);
      assert.strictEqual(localVar.isLocal, true);
      assert.deepStrictEqual(localVar.scopeChain, ['main']);
    });

    test('load returns false when no index file exists', async () => {
      const loaded = await index.load();
      assert.strictEqual(loaded, false);
    });

    test('persists overload discriminators', async () => {
      index.addFileEntries('a.ts', [
        makeEntry({
          address: 'a.ts#fn.parse~d1a0',
          name: 'parse',
          kind: 'function',
          filePath: 'a.ts',
          paramSignature: 'string',
          overloadDiscriminator: 'd1a0',
        }),
        makeEntry({
          address: 'a.ts#fn.parse~e5b3',
          name: 'parse',
          kind: 'function',
          filePath: 'a.ts',
          paramSignature: 'Buffer',
          overloadDiscriminator: 'e5b3',
        }),
      ], 'sha256:abc');

      await index.save();

      const index2 = new SymbolIndex(tmpDir);
      await index2.load();

      const byName = index2.getByName('parse');
      assert.strictEqual(byName.length, 2);

      const d1 = index2.getByAddress('a.ts#fn.parse~d1a0');
      assert.ok(d1);
      assert.strictEqual(d1.overloadDiscriminator, 'd1a0');
      assert.strictEqual(d1.paramSignature, 'string');
    });
  });

  suite('clear', () => {
    test('clears all entries', () => {
      index.addFileEntries('a.ts', [
        makeEntry({ address: 'a.ts#fn.x', name: 'x', kind: 'function', filePath: 'a.ts' }),
      ], 'sha256:a');

      assert.strictEqual(index.symbolCount, 1);
      index.clear();
      assert.strictEqual(index.symbolCount, 0);
    });
  });
});
