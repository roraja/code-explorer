/**
 * Test Scenario 3: Enhance Analysis (Q&A Appended + Cache Updated)
 *
 * Tests that enhance() takes an existing AnalysisResult, sends a follow-up
 * question to the mock LLM, and the returned result has a new qaHistory
 * entry appended and the cache file is updated.
 * No VS Code runtime required.
 */
import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { CodeExplorerAPI } from '../../../src/api/CodeExplorerAPI';
import { FileSystemSourceReader } from '../../../src/api/FileSystemSourceReader';
import { MockLLMProvider } from './helpers/MockLLMProvider';
import { SAMPLE_SOURCE, EXPLORE_SYMBOL_RESPONSE, ENHANCE_RESPONSE } from './helpers/fixtures';
import type { CursorContext } from '../../../src/models/types';

suite('CodeExplorerAPI.enhance', () => {
  let tmpDir: string;
  let api: CodeExplorerAPI;
  let mockLLM: MockLLMProvider;

  setup(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ce-api-enhance-test-'));
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

  test('appends Q&A entry and updates cache', async () => {
    // First: explore the symbol to get an initial result
    const cursor: CursorContext = {
      word: 'processUser',
      filePath: 'src/main.ts',
      position: { line: 2, character: 16 },
      surroundingSource: SAMPLE_SOURCE,
      cursorLine: 'export function processUser(user: User): Result {',
    };

    const { result: initial } = await api.exploreSymbol(cursor);
    assert.strictEqual((initial.qaHistory || []).length, 0);

    // Now switch the mock to return the enhance response
    mockLLM.whenPromptContains('Enhancement Request', ENHANCE_RESPONSE);

    const enhanced = await api.enhance(initial, 'What happens if user is null?');

    // Q&A was appended
    assert.ok(enhanced.qaHistory, 'Expected qaHistory to exist');
    assert.strictEqual(enhanced.qaHistory!.length, 1);
    assert.strictEqual(enhanced.qaHistory![0].question, 'What happens if user is null?');
    assert.ok(enhanced.qaHistory![0].answer.length > 0);
    assert.ok(enhanced.qaHistory![0].answer.includes('TypeError'));

    // Additional key points were merged
    const initialKeyPointCount = (initial.keyMethods || []).length;
    assert.ok(
      enhanced.keyMethods!.length > initialKeyPointCount,
      'Expected additional key points to be merged'
    );

    // Cache was updated with Q&A
    const cached = await api.readCache(enhanced.symbol);
    assert.ok(cached, 'Expected cache hit after enhance');
    assert.strictEqual(cached!.qaHistory!.length, 1);
    assert.strictEqual(cached!.qaHistory![0].question, 'What happens if user is null?');
  });

  test('additional issues are merged into potentialIssues', async () => {
    const cursor: CursorContext = {
      word: 'processUser',
      filePath: 'src/main.ts',
      position: { line: 2, character: 16 },
      surroundingSource: SAMPLE_SOURCE,
      cursorLine: 'export function processUser(user: User): Result {',
    };

    const { result: initial } = await api.exploreSymbol(cursor);
    const initialIssueCount = (initial.potentialIssues || []).length;

    mockLLM.whenPromptContains('Enhancement Request', ENHANCE_RESPONSE);
    const enhanced = await api.enhance(initial, 'What happens if user is null?');

    assert.ok(
      enhanced.potentialIssues!.length > initialIssueCount,
      'Expected additional issues to be merged'
    );
  });

  test('LLM is called for both explore and enhance', async () => {
    const cursor: CursorContext = {
      word: 'processUser',
      filePath: 'src/main.ts',
      position: { line: 2, character: 16 },
      surroundingSource: SAMPLE_SOURCE,
      cursorLine: 'export function processUser(user: User): Result {',
    };

    await api.exploreSymbol(cursor);
    assert.strictEqual(mockLLM.callCount, 1);

    mockLLM.whenPromptContains('Enhancement Request', ENHANCE_RESPONSE);
    const { result: initial } = await api.exploreSymbol(cursor);
    await api.enhance(initial, 'What happens if user is null?');
    // At least 2 LLM calls total (explore + enhance)
    assert.ok(mockLLM.callCount >= 2);
  });
});
