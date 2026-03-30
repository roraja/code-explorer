/**
 * Code Explorer — Unit Tests for TabSessionStore
 *
 * Tests the persistence and restoration of tab session state,
 * including save, load, clear, and validation of corrupt data.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TabSessionStore } from '../../../src/ui/TabSessionStore';
import type { PersistedTab, TabSession } from '../../../src/ui/TabSessionStore';
import type { SymbolInfo } from '../../../src/models/types';

function makeSymbol(name: string, kind: SymbolInfo['kind'] = 'function'): SymbolInfo {
  return {
    name,
    kind,
    filePath: `src/${name}.ts`,
    position: { line: 10, character: 0 },
  };
}

function makeTab(id: string, symbol: SymbolInfo): PersistedTab {
  return { id, symbol };
}

suite('TabSessionStore', () => {
  let tmpDir: string;
  let store: TabSessionStore;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tab-session-test-'));
    store = new TabSessionStore(tmpDir);
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('save and load round-trips tab data', () => {
    const sym1 = makeSymbol('foo');
    const sym2 = makeSymbol('Bar', 'class');
    const tabs = [makeTab('tab-1', sym1), makeTab('tab-2', sym2)];

    store.save(tabs, 'tab-2');

    const session = store.load();
    assert.ok(session, 'session should not be null');
    assert.strictEqual(session.version, 1);
    assert.strictEqual(session.tabs.length, 2);
    assert.strictEqual(session.activeTabId, 'tab-2');
    assert.strictEqual(session.tabs[0].id, 'tab-1');
    assert.strictEqual(session.tabs[0].symbol.name, 'foo');
    assert.strictEqual(session.tabs[0].symbol.kind, 'function');
    assert.strictEqual(session.tabs[1].id, 'tab-2');
    assert.strictEqual(session.tabs[1].symbol.name, 'Bar');
    assert.strictEqual(session.tabs[1].symbol.kind, 'class');
  });

  test('load returns null when no session file exists', () => {
    const session = store.load();
    assert.strictEqual(session, null);
  });

  test('save creates the logs directory if it does not exist', () => {
    const logsDir = path.join(tmpDir, '.vscode', 'code-explorer-logs');
    assert.ok(!fs.existsSync(logsDir), 'logs dir should not exist yet');

    store.save([makeTab('tab-1', makeSymbol('x'))], 'tab-1');

    assert.ok(fs.existsSync(logsDir), 'logs dir should be created');
    const session = store.load();
    assert.ok(session);
    assert.strictEqual(session.tabs.length, 1);
  });

  test('save overwrites previous session', () => {
    store.save([makeTab('tab-1', makeSymbol('old'))], 'tab-1');

    const first = store.load();
    assert.ok(first);
    assert.strictEqual(first.tabs[0].symbol.name, 'old');

    store.save([makeTab('tab-2', makeSymbol('new'))], 'tab-2');

    const second = store.load();
    assert.ok(second);
    assert.strictEqual(second.tabs.length, 1);
    assert.strictEqual(second.tabs[0].symbol.name, 'new');
    assert.strictEqual(second.activeTabId, 'tab-2');
  });

  test('clear removes the session file', () => {
    store.save([makeTab('tab-1', makeSymbol('x'))], 'tab-1');
    assert.ok(store.load(), 'session should exist before clear');

    store.clear();

    assert.strictEqual(store.load(), null, 'session should be null after clear');
  });

  test('clear is safe when no file exists', () => {
    // Should not throw
    store.clear();
  });

  test('load returns null for invalid JSON', () => {
    const filePath = path.join(tmpDir, '.vscode', 'code-explorer-logs', 'tab-session.json');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'not valid json {{{', 'utf-8');

    const session = store.load();
    assert.strictEqual(session, null);
  });

  test('load returns null for wrong version', () => {
    const filePath = path.join(tmpDir, '.vscode', 'code-explorer-logs', 'tab-session.json');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const badSession = {
      version: 99,
      savedAt: new Date().toISOString(),
      tabs: [],
      activeTabId: null,
    };
    fs.writeFileSync(filePath, JSON.stringify(badSession), 'utf-8');

    const session = store.load();
    assert.strictEqual(session, null);
  });

  test('load filters out tabs with missing required fields', () => {
    const filePath = path.join(tmpDir, '.vscode', 'code-explorer-logs', 'tab-session.json');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const session: TabSession = {
      version: 1,
      savedAt: new Date().toISOString(),
      tabs: [
        makeTab('tab-1', makeSymbol('valid')),
        {
          id: 'tab-2',
          symbol: { name: '', kind: 'function', filePath: '', position: { line: 0, character: 0 } },
        },
        { id: 'tab-3', symbol: {} as SymbolInfo }, // missing fields
      ],
      activeTabId: 'tab-1',
    };
    fs.writeFileSync(filePath, JSON.stringify(session), 'utf-8');

    const loaded = store.load();
    assert.ok(loaded);
    // tab-2 has empty name string — still technically has all fields so passes typeof checks
    // tab-3 is missing required fields and should be filtered out
    assert.ok(loaded.tabs.length <= 2, `Expected ≤2 valid tabs, got ${loaded.tabs.length}`);
    assert.ok(
      loaded.tabs.some((t) => t.id === 'tab-1'),
      'tab-1 should be preserved'
    );
  });

  test('save persists activeTabId as null', () => {
    store.save([makeTab('tab-1', makeSymbol('x'))], null);

    const session = store.load();
    assert.ok(session);
    assert.strictEqual(session.activeTabId, null);
  });

  test('save includes savedAt timestamp', () => {
    const before = new Date().toISOString();
    store.save([makeTab('tab-1', makeSymbol('x'))], 'tab-1');
    const after = new Date().toISOString();

    const session = store.load();
    assert.ok(session);
    assert.ok(session.savedAt >= before, 'savedAt should be >= before');
    assert.ok(session.savedAt <= after, 'savedAt should be <= after');
  });

  test('preserves symbol scope chain', () => {
    const sym = makeSymbol('localVar', 'variable');
    sym.scopeChain = ['MyClass', 'myMethod'];
    store.save([makeTab('tab-1', sym)], 'tab-1');

    const session = store.load();
    assert.ok(session);
    assert.deepStrictEqual(session.tabs[0].symbol.scopeChain, ['MyClass', 'myMethod']);
  });
});
