/**
 * Test Scenario 2: Explore File (Full File → Multiple Cached Symbols)
 *
 * Tests that exploreFile() sends a file to the LLM, gets back multiple
 * symbol analyses, and caches each one individually.
 * No VS Code runtime required.
 */
import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { CodeExplorerAPI } from '../../../src/api/CodeExplorerAPI';
import { FileSystemSourceReader } from '../../../src/api/FileSystemSourceReader';
import { MockLLMProvider } from './helpers/MockLLMProvider';
import { SERVICE_SOURCE, EXPLORE_FILE_RESPONSE } from './helpers/fixtures';

suite('CodeExplorerAPI.exploreFile', () => {
  let tmpDir: string;
  let api: CodeExplorerAPI;
  let mockLLM: MockLLMProvider;

  setup(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ce-api-file-test-'));
    const srcDir = path.join(tmpDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, 'service.ts'), SERVICE_SOURCE);

    mockLLM = new MockLLMProvider(EXPLORE_FILE_RESPONSE);

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

  test('analyzes all symbols in a file and caches each one', async () => {
    const cachedCount = await api.exploreFile('src/service.ts', SERVICE_SOURCE);

    assert.strictEqual(cachedCount, 3, 'Expected 3 symbols cached');
  });

  test('LLM was called exactly once for the entire file', async () => {
    await api.exploreFile('src/service.ts', SERVICE_SOURCE);
    assert.strictEqual(mockLLM.callCount, 1);
  });

  test('class symbol is individually retrievable from cache', async () => {
    await api.exploreFile('src/service.ts', SERVICE_SOURCE);

    const classResult = await api.readCache({
      name: 'UserService',
      kind: 'class',
      filePath: 'src/service.ts',
      position: { line: 5, character: 0 },
    });
    assert.ok(classResult, 'Expected cache hit for UserService class');
    assert.strictEqual(classResult!.symbol.kind, 'class');
    assert.ok(classResult!.overview.includes('UserService'));
  });

  test('method symbol with scope chain is retrievable from cache', async () => {
    await api.exploreFile('src/service.ts', SERVICE_SOURCE);

    const methodResult = await api.readCache({
      name: 'getUser',
      kind: 'method',
      filePath: 'src/service.ts',
      position: { line: 12, character: 0 },
      scopeChain: ['UserService'],
    });
    assert.ok(methodResult, 'Expected cache hit for getUser method');
    assert.strictEqual(methodResult!.symbol.kind, 'method');
    assert.ok(
      methodResult!.overview.includes('getUser') || methodResult!.overview.includes('user')
    );
  });

  test('progress callback is called', async () => {
    const stages: string[] = [];
    await api.exploreFile('src/service.ts', SERVICE_SOURCE, (stage) => {
      stages.push(stage);
    });

    assert.ok(stages.length > 0, 'Expected at least one progress callback');
  });
});
