/**
 * Code Explorer — Unit Tests for Navigation History & Breadcrumb Trail
 *
 * Tests the navigation history tracking, back/forward navigation,
 * pinned investigations, and breadcrumb trail building in the
 * CodeExplorerViewProvider. Since the provider depends on vscode APIs,
 * these tests focus on the TabSessionStore's ability to persist and
 * restore navigation history and pinned investigations.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TabSessionStore } from '../../../src/ui/TabSessionStore';
import type { PersistedTab } from '../../../src/ui/TabSessionStore';
import type {
  SymbolInfo,
  NavigationEntry,
  PinnedInvestigation,
} from '../../../src/models/types';

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

function makeNavEntry(
  fromTabId: string | null,
  toTabId: string,
  symbolName: string,
  trigger: string = 'explore-command',
  symbolKind: string = 'function'
): NavigationEntry {
  return {
    fromTabId,
    toTabId,
    trigger: trigger as NavigationEntry['trigger'],
    timestamp: new Date().toISOString(),
    symbolName,
    symbolKind,
  };
}

function makeInvestigation(
  id: string,
  name: string,
  trailSymbols: PinnedInvestigation['trailSymbols']
): PinnedInvestigation {
  return {
    id,
    name,
    trail: trailSymbols.map((ts) => ts.tabId),
    trailSymbols,
    pinnedAt: new Date().toISOString(),
  };
}

suite('Navigation History Persistence', () => {
  let tmpDir: string;
  let store: TabSessionStore;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-history-test-'));
    store = new TabSessionStore(tmpDir);
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('save and load preserves navigation history', () => {
    const tabs = [
      makeTab('tab-1', makeSymbol('foo')),
      makeTab('tab-2', makeSymbol('bar')),
      makeTab('tab-3', makeSymbol('baz')),
    ];
    const history: NavigationEntry[] = [
      makeNavEntry(null, 'tab-1', 'foo', 'explore-command'),
      makeNavEntry('tab-1', 'tab-2', 'bar', 'symbol-link'),
      makeNavEntry('tab-2', 'tab-3', 'baz', 'sub-function'),
    ];

    store.save(tabs, 'tab-3', history, 2);

    const session = store.load();
    assert.ok(session, 'session should not be null');
    assert.ok(session.navigationHistory, 'navigation history should exist');
    assert.strictEqual(session.navigationHistory!.length, 3);
    assert.strictEqual(session.navigationIndex, 2);

    // Verify first entry
    assert.strictEqual(session.navigationHistory![0].fromTabId, null);
    assert.strictEqual(session.navigationHistory![0].toTabId, 'tab-1');
    assert.strictEqual(session.navigationHistory![0].symbolName, 'foo');
    assert.strictEqual(session.navigationHistory![0].trigger, 'explore-command');

    // Verify second entry
    assert.strictEqual(session.navigationHistory![1].fromTabId, 'tab-1');
    assert.strictEqual(session.navigationHistory![1].toTabId, 'tab-2');
    assert.strictEqual(session.navigationHistory![1].symbolName, 'bar');
    assert.strictEqual(session.navigationHistory![1].trigger, 'symbol-link');

    // Verify third entry
    assert.strictEqual(session.navigationHistory![2].fromTabId, 'tab-2');
    assert.strictEqual(session.navigationHistory![2].toTabId, 'tab-3');
    assert.strictEqual(session.navigationHistory![2].trigger, 'sub-function');
  });

  test('save and load preserves pinned investigations', () => {
    const tabs = [
      makeTab('tab-1', makeSymbol('foo')),
      makeTab('tab-2', makeSymbol('bar')),
    ];
    const investigations: PinnedInvestigation[] = [
      makeInvestigation('inv-1', 'Cache debugging', [
        { tabId: 'tab-1', symbolName: 'foo', symbolKind: 'function' },
        { tabId: 'tab-2', symbolName: 'bar', symbolKind: 'class' },
      ]),
    ];

    store.save(tabs, 'tab-2', [], 0, investigations);

    const session = store.load();
    assert.ok(session, 'session should not be null');
    assert.ok(session.pinnedInvestigations, 'pinned investigations should exist');
    assert.strictEqual(session.pinnedInvestigations!.length, 1);

    const inv = session.pinnedInvestigations![0];
    assert.strictEqual(inv.id, 'inv-1');
    assert.strictEqual(inv.name, 'Cache debugging');
    assert.strictEqual(inv.trail.length, 2);
    assert.strictEqual(inv.trail[0], 'tab-1');
    assert.strictEqual(inv.trail[1], 'tab-2');
    assert.strictEqual(inv.trailSymbols[0].symbolName, 'foo');
    assert.strictEqual(inv.trailSymbols[1].symbolName, 'bar');
    assert.strictEqual(inv.trailSymbols[1].symbolKind, 'class');
  });

  test('backward-compatible load without navigation history', () => {
    // Simulate a session saved by the old version (no history fields)
    const filePath = path.join(
      tmpDir,
      '.vscode',
      'code-explorer-logs',
      'tab-session.json'
    );
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const oldSession = {
      version: 1,
      savedAt: new Date().toISOString(),
      tabs: [makeTab('tab-1', makeSymbol('x'))],
      activeTabId: 'tab-1',
      // No navigationHistory, no pinnedInvestigations
    };
    fs.writeFileSync(filePath, JSON.stringify(oldSession), 'utf-8');

    const session = store.load();
    assert.ok(session, 'session should not be null');
    assert.strictEqual(session.tabs.length, 1);
    assert.strictEqual(session.navigationHistory, undefined);
    assert.strictEqual(session.pinnedInvestigations, undefined);
  });

  test('save with empty navigation history', () => {
    const tabs = [makeTab('tab-1', makeSymbol('foo'))];
    store.save(tabs, 'tab-1', [], -1, []);

    const session = store.load();
    assert.ok(session);
    assert.deepStrictEqual(session.navigationHistory, []);
    assert.strictEqual(session.navigationIndex, -1);
    assert.deepStrictEqual(session.pinnedInvestigations, []);
  });

  test('multiple pinned investigations are preserved', () => {
    const tabs = [
      makeTab('tab-1', makeSymbol('a')),
      makeTab('tab-2', makeSymbol('b')),
      makeTab('tab-3', makeSymbol('c')),
    ];
    const investigations: PinnedInvestigation[] = [
      makeInvestigation('inv-1', 'Bug A', [
        { tabId: 'tab-1', symbolName: 'a', symbolKind: 'function' },
      ]),
      makeInvestigation('inv-2', 'Feature B', [
        { tabId: 'tab-2', symbolName: 'b', symbolKind: 'class' },
        { tabId: 'tab-3', symbolName: 'c', symbolKind: 'variable' },
      ]),
    ];

    store.save(tabs, 'tab-1', [], 0, investigations);

    const session = store.load();
    assert.ok(session);
    assert.strictEqual(session.pinnedInvestigations!.length, 2);
    assert.strictEqual(session.pinnedInvestigations![0].name, 'Bug A');
    assert.strictEqual(session.pinnedInvestigations![1].name, 'Feature B');
    assert.strictEqual(session.pinnedInvestigations![1].trailSymbols.length, 2);
  });

  test('navigation entry timestamps are preserved', () => {
    const tabs = [makeTab('tab-1', makeSymbol('foo'))];
    const timestamp = '2026-03-29T10:00:00.000Z';
    const history: NavigationEntry[] = [
      {
        fromTabId: null,
        toTabId: 'tab-1',
        trigger: 'explore-command',
        timestamp,
        symbolName: 'foo',
        symbolKind: 'function',
      },
    ];

    store.save(tabs, 'tab-1', history, 0);

    const session = store.load();
    assert.ok(session);
    assert.strictEqual(session.navigationHistory![0].timestamp, timestamp);
  });

  test('navigation history with all trigger types', () => {
    const tabs = [
      makeTab('tab-1', makeSymbol('a')),
      makeTab('tab-2', makeSymbol('b')),
      makeTab('tab-3', makeSymbol('c')),
    ];
    const history: NavigationEntry[] = [
      makeNavEntry(null, 'tab-1', 'a', 'explore-command'),
      makeNavEntry('tab-1', 'tab-2', 'b', 'symbol-link'),
      makeNavEntry('tab-2', 'tab-3', 'c', 'tab-click'),
    ];

    store.save(tabs, 'tab-3', history, 2);

    const session = store.load();
    assert.ok(session);
    assert.strictEqual(session.navigationHistory![0].trigger, 'explore-command');
    assert.strictEqual(session.navigationHistory![1].trigger, 'symbol-link');
    assert.strictEqual(session.navigationHistory![2].trigger, 'tab-click');
  });

  test('pinned investigation pinnedAt timestamp is preserved', () => {
    const tabs = [makeTab('tab-1', makeSymbol('x'))];
    const pinnedAt = '2026-03-29T14:30:00.000Z';
    const investigations: PinnedInvestigation[] = [
      {
        id: 'inv-1',
        name: 'Test',
        trail: ['tab-1'],
        trailSymbols: [{ tabId: 'tab-1', symbolName: 'x', symbolKind: 'function' }],
        pinnedAt,
      },
    ];

    store.save(tabs, 'tab-1', [], 0, investigations);

    const session = store.load();
    assert.ok(session);
    assert.strictEqual(session.pinnedInvestigations![0].pinnedAt, pinnedAt);
  });
});
