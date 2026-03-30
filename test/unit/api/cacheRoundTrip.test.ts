/**
 * Test Scenario 4: Cache Round-Trip (Write → Read → Clear → Read)
 *
 * Tests the full cache serialization/deserialization lifecycle through
 * the API. Exercises CacheStore directly through CodeExplorerAPI.
 * No VS Code runtime required.
 */
import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { CodeExplorerAPI } from '../../../src/api/CodeExplorerAPI';
import { FileSystemSourceReader } from '../../../src/api/FileSystemSourceReader';
import { MockLLMProvider } from './helpers/MockLLMProvider';
import { SAMPLE_SOURCE, EXPLORE_SYMBOL_RESPONSE } from './helpers/fixtures';
import type { CursorContext } from '../../../src/models/types';

suite('CodeExplorerAPI cache round-trip', () => {
  let tmpDir: string;
  let api: CodeExplorerAPI;
  let mockLLM: MockLLMProvider;

  setup(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ce-api-cache-test-'));
    const srcDir = path.join(tmpDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, 'main.ts'), SAMPLE_SOURCE);

    mockLLM = new MockLLMProvider(EXPLORE_SYMBOL_RESPONSE);

    api = new CodeExplorerAPI({
      workspaceRoot: tmpDir,
      llmProviderInstance: mockLLM,
      sourceReader: new FileSystemSourceReader(tmpDir),
    });
  });

  teardown(async () => {
    api.dispose();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('write, read, clear, read-again cycle preserves all fields', async () => {
    const cursor: CursorContext = {
      word: 'processUser',
      filePath: 'src/main.ts',
      position: { line: 2, character: 16 },
      surroundingSource: SAMPLE_SOURCE,
      cursorLine: 'export function processUser(user: User): Result {',
    };

    // Run analysis to populate cache
    const { symbol, result } = await api.exploreSymbol(cursor);

    // Read back and verify key fields
    const cached = await api.readCache(symbol);
    assert.ok(cached, 'Expected cache hit');
    assert.strictEqual(cached!.symbol.name, result.symbol.name);
    assert.strictEqual(cached!.symbol.kind, result.symbol.kind);
    assert.strictEqual(cached!.overview, result.overview);
    assert.strictEqual(cached!.metadata.llmProvider, result.metadata.llmProvider);

    // Verify function steps survived round-trip
    assert.deepStrictEqual(cached!.functionSteps, result.functionSteps);

    // Verify sub-functions survived round-trip
    if (result.subFunctions && result.subFunctions.length > 0) {
      assert.ok(cached!.subFunctions);
      assert.strictEqual(cached!.subFunctions!.length, result.subFunctions.length);
      assert.strictEqual(cached!.subFunctions![0].name, result.subFunctions[0].name);
    }

    // Clear cache
    await api.clearCache();

    // Verify cache is empty
    const afterClear = await api.readCache(symbol);
    assert.strictEqual(afterClear, null, 'Expected null after clearCache');
  });

  test('readCache returns null for non-existent symbol', async () => {
    const result = await api.readCache({
      name: 'nonExistent',
      kind: 'function',
      filePath: 'src/nope.ts',
      position: { line: 0, character: 0 },
    });
    assert.strictEqual(result, null);
  });

  test('cache file is created on disk', async () => {
    const cursor: CursorContext = {
      word: 'processUser',
      filePath: 'src/main.ts',
      position: { line: 2, character: 16 },
      surroundingSource: SAMPLE_SOURCE,
      cursorLine: 'export function processUser(user: User): Result {',
    };

    await api.exploreSymbol(cursor);

    // Verify the cache directory was created
    const cacheDir = path.join(tmpDir, '.vscode', 'code-explorer', 'src', 'main.ts');
    const exists = await fs.access(cacheDir).then(
      () => true,
      () => false
    );
    assert.ok(exists, `Expected cache directory to exist at ${cacheDir}`);

    // Verify at least one .md file was created
    const files = await fs.readdir(cacheDir);
    const mdFiles = files.filter((f) => f.endsWith('.md'));
    assert.ok(mdFiles.length > 0, 'Expected at least one .md cache file');
  });

  test('clearCache removes the cache directory', async () => {
    const cursor: CursorContext = {
      word: 'processUser',
      filePath: 'src/main.ts',
      position: { line: 2, character: 16 },
      surroundingSource: SAMPLE_SOURCE,
      cursorLine: 'export function processUser(user: User): Result {',
    };

    await api.exploreSymbol(cursor);
    await api.clearCache();

    const cacheRoot = path.join(tmpDir, '.vscode', 'code-explorer');
    const exists = await fs.access(cacheRoot).then(
      () => true,
      () => false
    );
    assert.ok(!exists, 'Expected cache directory to be removed after clearCache');
  });
});
