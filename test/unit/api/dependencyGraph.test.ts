/**
 * Test Scenario 5: Dependency Graph (Multiple Cached Symbols → Graph)
 *
 * Tests that after caching several symbols with sub-function and caller
 * relationships, buildDependencyGraph() correctly builds nodes and edges,
 * and toMermaid() produces valid Mermaid output.
 * No VS Code runtime required.
 */
import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { CodeExplorerAPI } from '../../../src/api/CodeExplorerAPI';
import { FileSystemSourceReader } from '../../../src/api/FileSystemSourceReader';
import { MockLLMProvider } from './helpers/MockLLMProvider';
import {
  SAMPLE_SOURCE,
  EXPLORE_SYMBOL_RESPONSE,
  VALIDATE_INPUT_RESPONSE,
  SAVE_USER_RESPONSE,
} from './helpers/fixtures';
import type { CursorContext } from '../../../src/models/types';

suite('CodeExplorerAPI.buildDependencyGraph', function () {
  // These tests do 3 sequential LLM calls + cache writes, need more time
  this.timeout(30000);

  let tmpDir: string;
  let api: CodeExplorerAPI;
  let mockLLM: MockLLMProvider;

  setup(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ce-api-graph-test-'));
    const srcDir = path.join(tmpDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, 'main.ts'), SAMPLE_SOURCE);

    mockLLM = new MockLLMProvider(EXPLORE_SYMBOL_RESPONSE);
    // Route different symbols to different canned responses
    mockLLM.whenPromptContains('"validateInput"', VALIDATE_INPUT_RESPONSE);
    mockLLM.whenPromptContains('"saveUser"', SAVE_USER_RESPONSE);

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

  test('builds graph with correct nodes from cached analyses', async () => {
    // Cache 3 symbols
    await api.exploreSymbol(makeCursor('processUser', 2));
    await api.exploreSymbol(makeCursor('validateInput', 9));
    await api.exploreSymbol(makeCursor('saveUser', 16));

    const graph = await api.buildDependencyGraph();

    // At least 3 nodes (could have more if related symbols are cached)
    assert.ok(graph.nodes.length >= 3, `Expected >= 3 nodes, got ${graph.nodes.length}`);

    // Check expected nodes exist
    const nodeNames = graph.nodes.map((n) => n.name);
    assert.ok(nodeNames.includes('processUser'), 'Expected processUser node');
    assert.ok(nodeNames.includes('validateInput'), 'Expected validateInput node');
    assert.ok(nodeNames.includes('saveUser'), 'Expected saveUser node');
  });

  test('builds edges from sub-function and caller relationships', async () => {
    await api.exploreSymbol(makeCursor('processUser', 2));
    await api.exploreSymbol(makeCursor('validateInput', 9));
    await api.exploreSymbol(makeCursor('saveUser', 16));

    const graph = await api.buildDependencyGraph();

    // There should be edges (calls or dependsOn)
    assert.ok(graph.edges.length >= 1, `Expected >= 1 edge, got ${graph.edges.length}`);
  });

  test('toMermaid produces valid flowchart output', async () => {
    await api.exploreSymbol(makeCursor('processUser', 2));
    await api.exploreSymbol(makeCursor('validateInput', 9));
    await api.exploreSymbol(makeCursor('saveUser', 16));

    const graph = await api.buildDependencyGraph();
    const mermaid = api.toMermaid(graph);

    assert.ok(mermaid.startsWith('flowchart TD'), 'Expected Mermaid to start with flowchart TD');
    assert.ok(mermaid.includes('processUser'), 'Expected processUser in Mermaid output');
    assert.ok(mermaid.includes('validateInput'), 'Expected validateInput in Mermaid output');
    assert.ok(mermaid.includes('saveUser'), 'Expected saveUser in Mermaid output');
  });

  test('buildSubgraph returns a focused subset', async () => {
    await api.exploreSymbol(makeCursor('processUser', 2));
    await api.exploreSymbol(makeCursor('validateInput', 9));
    await api.exploreSymbol(makeCursor('saveUser', 16));

    const sub = await api.buildSubgraph('processUser', 'src/main.ts');

    // The subgraph should have at least processUser
    assert.ok(sub.nodes.length >= 1, 'Expected at least 1 node in subgraph');
    assert.ok(
      sub.nodes.some((n) => n.name === 'processUser'),
      'Expected processUser in subgraph'
    );
  });

  test('empty graph when no analyses are cached', async () => {
    const graph = await api.buildDependencyGraph();
    assert.strictEqual(graph.nodes.length, 0);
    assert.strictEqual(graph.edges.length, 0);
  });

  test('toMermaid handles empty graph', async () => {
    const graph = await api.buildDependencyGraph();
    const mermaid = api.toMermaid(graph);
    assert.ok(mermaid.includes('flowchart TD'));
    assert.ok(mermaid.includes('No cached analyses'));
  });

  function makeCursor(word: string, line: number): CursorContext {
    return {
      word,
      filePath: 'src/main.ts',
      position: { line, character: 0 },
      surroundingSource: SAMPLE_SOURCE,
      cursorLine: SAMPLE_SOURCE.split('\n')[line] || '',
    };
  }
});
