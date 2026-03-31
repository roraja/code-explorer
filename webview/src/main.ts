/**
 * Code Explorer — Webview Entry Point
 *
 * Pure renderer. Receives full state from the extension via a single
 * `setState` message and renders it. Never owns or mutates state —
 * all mutations go through messages to the extension, which pushes
 * back the updated state.
 */

import './styles/main.css';
import mermaid from 'mermaid';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vscode = (window as any).acquireVsCodeApi?.() ?? {
  postMessage: (_msg: unknown) => {},
  getState: () => null,
  setState: (_state: unknown) => {},
};

interface Tab {
  id: string;
  symbol: { name: string; kind: string; filePath: string; scopeChain?: string[] };
  status: 'loading' | 'ready' | 'error' | 'stale';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  analysis: any;
  error?: string;
  loadingStage?: string;
  /** True while an enhance (Q&A) request is in progress */
  enhancing?: boolean;
  /** User-added notes for this tab */
  notes?: string;
}

/** Navigation entry from the extension's history stack */
interface NavigationEntry {
  fromTabId: string | null;
  toTabId: string;
  trigger: string;
  timestamp: string;
  symbolName: string;
  symbolKind: string;
}

/** Pinned investigation bookmark */
interface PinnedInvestigation {
  id: string;
  name: string;
  trail: string[];
  trailSymbols: { tabId: string; symbolName: string; symbolKind: string; symbol?: unknown }[];
  pinnedAt: string;
}

/** Navigation history state from the extension */
interface NavigationHistoryState {
  entries: NavigationEntry[];
  currentIndex: number;
  pinnedInvestigations: PinnedInvestigation[];
  currentInvestigationName: string;
  currentInvestigationId: string | null;
  currentInvestigationDirty: boolean;
}

/** A node in the tab group tree (tab reference or nested group) */
type TabTreeNode = { type: 'tab'; tabId: string } | { type: 'group'; group: TabGroup };

/** Named group of tabs — supports nesting */
interface TabGroup {
  id: string;
  name: string;
  children: TabTreeNode[];
  collapsed: boolean;
}

const LOADING_STAGE_LABELS: Record<string, string> = {
  'resolving-symbol': 'Identifying symbol\u2026',
  'cache-check': 'Checking cache\u2026',
  'reading-source': 'Reading source code\u2026',
  'llm-analyzing': 'Running LLM analysis\u2026',
  'writing-cache': 'Saving to cache\u2026',
};

let currentTabs: Tab[] = [];
let currentActiveTabId: string | null = null;
/** Current navigation history state from the extension */
let currentNavHistory: NavigationHistoryState | null = null;
/** Auto-incrementing counter for unique mermaid diagram IDs */
let _mermaidIdCounter = 0;
/** Whether the dependency graph view is currently showing */
let _showingGraph = false;
/** The current graph Mermaid source to render */
let _graphMermaidSource = '';
/** Graph metadata for the header */
let _graphNodeCount = 0;
let _graphEdgeCount = 0;
/** Current tab search filter text (case-insensitive) */
let _tabSearchFilter = '';
/** Tab groups for tree-wise grouping */
let _tabGroups: TabGroup[] = [];
/** Set of currently selected tab IDs (for multi-select) */
const _selectedTabIds: Set<string> = new Set();
/** Currently dragged item info */
let _draggedTabId: string | null = null;
let _draggedGroupId: string | null = null;

function log(msg: string): void {
  console.log(`[CE] ${msg}`);
}

/**
 * Detect whether the current VS Code theme is dark.
 */
function _isDarkTheme(): boolean {
  return (
    document.body.classList.contains('vscode-dark') ||
    document.body.classList.contains('vscode-high-contrast')
  );
}

function init(): void {
  log('init');

  // Initialize mermaid with VS Code theme-aware settings
  mermaid.initialize({
    startOnLoad: false,
    theme: _isDarkTheme() ? 'dark' : 'default',
    securityLevel: 'loose',
    fontFamily: 'var(--vscode-font-family)',
    flowchart: { useMaxWidth: true, htmlLabels: true },
    sequence: { useMaxWidth: true },
    themeVariables: _isDarkTheme()
      ? {
          primaryColor: '#264f78',
          primaryTextColor: '#cccccc',
          primaryBorderColor: '#3c3c3c',
          lineColor: '#6a9955',
          secondaryColor: '#1e1e1e',
          tertiaryColor: '#252526',
          background: '#1e1e1e',
          mainBkg: '#264f78',
          nodeBorder: '#3c3c3c',
          clusterBkg: '#252526',
          titleColor: '#cccccc',
          edgeLabelBackground: '#1e1e1e',
        }
      : {},
  });

  // Restore persisted state if available (avoids flash of empty on re-show)
  const saved = vscode.getState() as {
    tabs: Tab[];
    activeTabId: string | null;
    navigationHistory?: NavigationHistoryState;
    tabGroups?: TabGroup[];
  } | null;
  if (saved && saved.tabs) {
    currentTabs = saved.tabs;
    currentActiveTabId = saved.activeTabId;
    currentNavHistory = saved.navigationHistory || null;
    _tabGroups = saved.tabGroups || [];
    log(
      `restored saved state: ${currentTabs.length} tabs, history=${currentNavHistory?.entries.length ?? 0} entries, groups=${_tabGroups.length}`
    );
  }

  render();

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'setState') {
      currentTabs = msg.tabs || [];
      currentActiveTabId = msg.activeTabId;
      currentNavHistory = msg.navigationHistory || null;
      _tabGroups = msg.tabGroups || [];
      log(
        `setState: ${currentTabs.length} tabs, active=${currentActiveTabId}, history=${currentNavHistory?.entries.length ?? 0} entries, groups=${_tabGroups.length}`
      );
      // Persist for webview re-creation
      vscode.setState({
        tabs: currentTabs,
        activeTabId: currentActiveTabId,
        navigationHistory: currentNavHistory,
        tabGroups: _tabGroups,
      });
      // If a graph is showing and tabs come in, keep showing tabs
      if (_showingGraph) {
        _showingGraph = false;
      }
      render();
    } else if (msg.type === 'showDependencyGraph') {
      log(`showDependencyGraph: ${msg.nodeCount} nodes, ${msg.edgeCount} edges`);
      _showingGraph = true;
      _graphMermaidSource = msg.mermaidSource || '';
      _graphNodeCount = msg.nodeCount || 0;
      _graphEdgeCount = msg.edgeCount || 0;
      render();
    }
  });

  vscode.postMessage({ type: 'ready' });
  log('ready sent');
}

// =====================
// Rendering
// =====================

function render(): void {
  const root = document.getElementById('root');
  if (!root) {
    return;
  }

  // Dependency graph view mode
  if (_showingGraph) {
    root.innerHTML = _renderGraphView();
    _attachGraphListeners();
    _renderGraphDiagram();
    return;
  }

  if (currentTabs.length === 0) {
    root.innerHTML = renderEmpty();
    return;
  }

  const activeTab = currentTabs.find((t) => t.id === currentActiveTabId) || currentTabs[0];

  root.innerHTML =
    '<div class="main-layout">' +
    renderTabBar() +
    '<div class="tab-resize-handle" id="tab-resize-handle"></div>' +
    '<div class="content-panel">' +
    renderContent(activeTab) +
    '</div>' +
    '</div>';
  attachListeners();
  _attachResizeHandle();
  _attachDragAndDrop();
  renderMermaidDiagrams();
}

function renderEmpty(): string {
  return `<div class="empty-state">
    <div class="empty-state__icon">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        <line x1="8" y1="11" x2="14" y2="11"/>
        <line x1="11" y1="8" x2="11" y2="14"/>
      </svg>
    </div>
    <h2 class="empty-state__title">Code Explorer</h2>
    <p class="empty-state__description">
      Place your cursor on any symbol and press<br>
      <kbd>Ctrl+Shift+H</kbd><br>
      <span class="empty-state__hint">or right-click &rarr; Explore Symbol</span>
    </p>
    <div class="empty-state__features">
      <div class="empty-state__feature">
        <span class="empty-state__feature-icon">ƒ</span>
        <span>Functions &amp; Methods</span>
      </div>
      <div class="empty-state__feature">
        <span class="empty-state__feature-icon">🅲</span>
        <span>Classes &amp; Structs</span>
      </div>
      <div class="empty-state__feature">
        <span class="empty-state__feature-icon">𝑥</span>
        <span>Variables &amp; Properties</span>
      </div>
    </div>
  </div>`;
}

function renderTabBar(): string {
  // Investigation header
  const invName = currentNavHistory?.currentInvestigationName || 'Untitled Investigation';
  const isDirty = currentNavHistory?.currentInvestigationDirty ?? false;
  const dirtyIndicator = isDirty
    ? '<span class="inv-header__dirty" title="Unsaved changes">*</span>'
    : '';

  const invHeader = `<div class="inv-header">
    <div class="inv-header__name-row">
      <input class="inv-header__name-input" id="inv-name-input" type="text" value="${escAttr(invName)}" title="Investigation name" />
      ${dirtyIndicator}
    </div>
    <div class="inv-header__actions">
      <button class="inv-header__btn" id="inv-save-btn" title="Save investigation">\uD83D\uDCBE</button>
      <button class="inv-header__btn" id="inv-save-as-btn" title="Save investigation as\u2026">+</button>
    </div>
  </div>`;

  // Search box for filtering tabs
  const searchBox = `<div class="tab-search">
    <input class="tab-search__input" id="tab-search-input" type="text" placeholder="Filter tabs\u2026" value="${escAttr(_tabSearchFilter)}" />
  </div>`;

  // Group action bar (create group from selection)
  const hasSelection = _selectedTabIds.size > 0;
  const groupActions = `<div class="tab-group-actions">
    <button class="tab-group-actions__btn" id="create-group-btn" title="Group selected tabs" ${hasSelection ? '' : 'disabled'}>\uD83D\uDCC1 Group${hasSelection ? ` (${_selectedTabIds.size})` : ''}</button>
  </div>`;

  // Build the tab tree: grouped tabs + ungrouped tabs
  const filterText = _tabSearchFilter.toLowerCase();
  const groupedTabIds = _collectGroupedTabIds(_tabGroups);
  const ungroupedTabs = currentTabs.filter((t) => !groupedTabIds.has(t.id));

  // Render groups
  const groupsHtml = _tabGroups.map((g) => _renderGroup(g, 0, filterText)).join('');

  // Render ungrouped tabs
  const filteredUngrouped = filterText
    ? ungroupedTabs.filter((tab) => _tabMatchesFilter(tab, filterText))
    : ungroupedTabs;

  const positionCounter = { value: _countVisibleTabsInGroups(_tabGroups, filterText) };
  const ungroupedHtml = filteredUngrouped
    .map((tab) => {
      positionCounter.value++;
      return _renderTabItem(tab, positionCounter.value);
    })
    .join('');

  // Saved investigations list (lower section)
  const investigations = currentNavHistory?.pinnedInvestigations || [];
  let invListHtml = '';
  if (investigations.length > 0) {
    const items = investigations
      .map((inv) => {
        const symbolCount = inv.trailSymbols.length;
        const isActive = currentNavHistory?.currentInvestigationId === inv.id;
        const activeClass = isActive ? ' saved-inv--active' : '';
        return `<div class="saved-inv${activeClass}" data-investigation-id="${inv.id}">
          <span class="saved-inv__name" title="${esc(inv.name)}">${esc(inv.name)}</span>
          <span class="saved-inv__count">${symbolCount}</span>
          <button class="saved-inv__restore" data-restore-id="${inv.id}" title="Load">\u2197</button>
          <button class="saved-inv__remove" data-unpin-id="${inv.id}" title="Delete">\u00D7</button>
        </div>`;
      })
      .join('');
    invListHtml = `<div class="saved-inv-list">${items}</div>`;
  } else {
    invListHtml = '<div class="saved-inv-list__empty">No saved investigations</div>';
  }

  return `<div class="tab-bar">
    ${invHeader}
    ${searchBox}
    ${groupActions}
    <div class="tab-bar__divider"></div>
    <div class="tab-bar__tabs" id="tab-list">
      ${groupsHtml}
      ${ungroupedHtml}
    </div>
    <div class="tab-bar__divider"></div>
    <div class="tab-bar__section-label">Saved Investigations</div>
    <div class="tab-bar__investigations">${invListHtml}</div>
  </div>`;
}

/**
 * Render a single tab item (used both inside groups and ungrouped).
 */
function _renderTabItem(tab: Tab, position: number, indent: number = 0): string {
  const active = tab.id === currentActiveTabId ? ' tab--active' : '';
  const selected = _selectedTabIds.has(tab.id) ? ' tab--selected' : '';
  const icon = kindIcon(tab.symbol.kind);
  const statusDot =
    tab.status === 'loading'
      ? '<span class="tab__status tab__status--loading">\u27F3</span>'
      : tab.status === 'error'
        ? '<span class="tab__status tab__status--error">\u2715</span>'
        : '';
  const scope =
    tab.symbol.scopeChain && tab.symbol.scopeChain.length > 0
      ? tab.symbol.scopeChain[tab.symbol.scopeChain.length - 1] + ' \u203A '
      : '';
  const indentPx = indent * 16;
  return `<div class="tab${active}${selected}" data-tab-id="${tab.id}" draggable="true" style="padding-left: ${8 + indentPx}px;">
    <span class="tab__select" data-select-id="${tab.id}"></span>
    <span class="tab__position">${position}</span>
    <span class="tab__icon">${icon}</span>
    <span class="tab__label" title="${esc((tab.symbol.scopeChain || []).concat(tab.symbol.name).join('.'))}">${esc(scope)}${esc(tab.symbol.name)}</span>
    ${statusDot}
    <span class="tab__close" data-close-id="${tab.id}">\u00D7</span>
  </div>`;
}

/**
 * Render a group header and its children (recursive for nesting).
 */
function _renderGroup(group: TabGroup, depth: number, filterText: string): string {
  const indentPx = depth * 16;
  const chevron = group.collapsed ? '\u25B6' : '\u25BC';
  const childCount = _countTabsInGroup(group);

  // Render children (unless collapsed)
  let childrenHtml = '';
  if (!group.collapsed) {
    const counter = { value: 0 };
    childrenHtml = group.children
      .map((child) => {
        if (child.type === 'tab') {
          const tab = currentTabs.find((t) => t.id === child.tabId);
          if (!tab) {
            return '';
          }
          if (filterText && !_tabMatchesFilter(tab, filterText)) {
            return '';
          }
          counter.value++;
          return _renderTabItem(tab, counter.value, depth + 1);
        }
        // Nested group
        return _renderGroup(child.group, depth + 1, filterText);
      })
      .join('');
  }

  return `<div class="tab-group" data-group-id="${group.id}" style="padding-left: ${indentPx}px;">
    <div class="tab-group__header" data-group-id="${group.id}" draggable="true">
      <span class="tab-group__chevron" data-toggle-group="${group.id}">${chevron}</span>
      <span class="tab-group__name" data-group-id="${group.id}" title="${escAttr(group.name)}">${esc(group.name)}</span>
      <span class="tab-group__count">${childCount}</span>
      <span class="tab-group__rename" data-rename-group="${group.id}" title="Rename">\u270E</span>
      <span class="tab-group__delete" data-delete-group="${group.id}" title="Delete group">\u00D7</span>
    </div>
    <div class="tab-group__children" data-group-children="${group.id}">
      ${childrenHtml}
    </div>
  </div>`;
}

/**
 * Collect all tab IDs that are inside any group (recursively).
 */
function _collectGroupedTabIds(groups: TabGroup[]): Set<string> {
  const ids = new Set<string>();
  for (const g of groups) {
    for (const child of g.children) {
      if (child.type === 'tab') {
        ids.add(child.tabId);
      } else {
        for (const id of _collectGroupedTabIds([child.group])) {
          ids.add(id);
        }
      }
    }
  }
  return ids;
}

/**
 * Count the number of tabs inside a group (including nested groups).
 */
function _countTabsInGroup(group: TabGroup): number {
  let count = 0;
  for (const child of group.children) {
    if (child.type === 'tab') {
      count++;
    } else {
      count += _countTabsInGroup(child.group);
    }
  }
  return count;
}

/**
 * Count visible tabs in groups (for position numbering).
 */
function _countVisibleTabsInGroups(groups: TabGroup[], filterText: string): number {
  let count = 0;
  for (const g of groups) {
    if (g.collapsed) {
      continue;
    }
    for (const child of g.children) {
      if (child.type === 'tab') {
        const tab = currentTabs.find((t) => t.id === child.tabId);
        if (tab && (!filterText || _tabMatchesFilter(tab, filterText))) {
          count++;
        }
      } else {
        count += _countVisibleTabsInGroups([child.group], filterText);
      }
    }
  }
  return count;
}

/**
 * Check if a tab matches the search filter.
 */
function _tabMatchesFilter(tab: Tab, filterText: string): boolean {
  const name = tab.symbol.name.toLowerCase();
  const kind = tab.symbol.kind.toLowerCase();
  const file = tab.symbol.filePath.toLowerCase();
  const scope = (tab.symbol.scopeChain || []).join('.').toLowerCase();
  return (
    name.includes(filterText) ||
    kind.includes(filterText) ||
    file.includes(filterText) ||
    scope.includes(filterText)
  );
}

function renderContent(tab: Tab): string {
  if (tab.status === 'loading') {
    const stageLabel = tab.loadingStage
      ? LOADING_STAGE_LABELS[tab.loadingStage] || tab.loadingStage
      : 'Starting\u2026';
    return `<div class="loading-state">
      <div class="loading-state__spinner"></div>
      <div class="loading-state__text">Analyzing ${esc(tab.symbol.kind)} ${esc(tab.symbol.name)}</div>
      <div class="loading-state__stage">${esc(stageLabel)}</div>
    </div>`;
  }

  if (tab.status === 'error') {
    return `<div class="error-state">
      <div class="error-state__icon">⚠</div>
      <div class="error-state__message">${esc(tab.error || 'Unknown error')}</div>
      <button class="error-state__retry" data-retry-id="${tab.id}">Retry</button>
    </div>`;
  }

  if (!tab.analysis) {
    return '<div class="loading-state"><div class="loading-state__text">No data</div></div>';
  }

  return renderAnalysis(tab);
}

// =====================
// Auto-Linking Infrastructure
// =====================

/**
 * Represents a known symbol extracted from the analysis data.
 * Used for auto-linking symbol names found in free-text content.
 */
interface KnownSymbol {
  name: string;
  filePath?: string;
  line?: number;
  kind?: string;
}

/**
 * Build a dictionary of known symbol names from the analysis data.
 * These are symbols we can auto-link when they appear in free-text.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _buildKnownSymbols(analysis: any): KnownSymbol[] {
  const symbols: KnownSymbol[] = [];
  const seen = new Set<string>();

  const add = (s: KnownSymbol): void => {
    // Avoid duplicates and very short names (likely false positives like "i", "x")
    if (!s.name || s.name.length < 3 || seen.has(s.name)) {
      return;
    }
    seen.add(s.name);
    symbols.push(s);
  };

  // Sub-functions
  if (analysis.subFunctions) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const sf of analysis.subFunctions as any[]) {
      add({ name: sf.name, filePath: sf.filePath, line: sf.line, kind: sf.kind || 'function' });
    }
  }

  // Function inputs — parameter type names
  if (analysis.functionInputs) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const p of analysis.functionInputs as any[]) {
      if (p.typeFilePath) {
        add({
          name: p.typeName,
          filePath: p.typeFilePath,
          line: p.typeLine,
          kind: p.typeKind || 'type',
        });
      }
    }
  }

  // Function output — return type name
  if (analysis.functionOutput?.typeFilePath) {
    const out = analysis.functionOutput;
    add({
      name: out.typeName,
      filePath: out.typeFilePath,
      line: out.typeLine,
      kind: out.typeKind || 'type',
    });
  }

  // Call stack callers
  if (analysis.callStacks) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const cs of analysis.callStacks as any[]) {
      if (cs.caller) {
        add({
          name: cs.caller.name,
          filePath: cs.caller.filePath,
          line: cs.caller.line,
          kind: cs.caller.kind || 'function',
        });
      }
    }
  }

  // Relationships targets
  if (analysis.relationships) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of analysis.relationships as any[]) {
      add({ name: r.targetName, filePath: r.targetFilePath, line: r.targetLine, kind: 'unknown' });
    }
  }

  // Related symbols (pre-cached)
  if (analysis.relatedSymbols) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const rs of analysis.relatedSymbols as any[]) {
      add({ name: rs.name, filePath: rs.filePath, line: rs.line, kind: rs.kind || 'unknown' });
    }
  }

  // Class members — the member names themselves (within the current file)
  if (analysis.classMembers) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const m of analysis.classMembers as any[]) {
      // Add the member name — even without a line number it can be explored
      add({
        name: m.name,
        filePath: analysis.symbol?.filePath,
        line: m.line,
        kind: m.memberKind === 'method' ? 'method' : 'property',
      });
      // Extract individual type names from the member's typeName.
      // Handles generic types like "Map<string, AnalysisResult>" by splitting
      // on non-identifier characters and adding each component type.
      if (m.typeName) {
        for (const typePart of _extractTypeNames(m.typeName)) {
          add({ name: typePart, kind: 'type' });
        }
      }
    }
  }

  // Member access patterns — readBy/writtenBy method names
  if (analysis.memberAccess) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const ma of analysis.memberAccess as any[]) {
      add({
        name: ma.memberName,
        filePath: analysis.symbol?.filePath,
        kind: 'property',
      });
      if (ma.readBy) {
        for (const r of ma.readBy as string[]) {
          add({ name: r, filePath: analysis.symbol?.filePath, kind: 'method' });
        }
      }
      if (ma.writtenBy) {
        for (const w of ma.writtenBy as string[]) {
          add({ name: w, filePath: analysis.symbol?.filePath, kind: 'method' });
        }
      }
    }
  }

  // Data flow — extract symbol-like names from descriptions
  if (analysis.dataFlow) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const df of analysis.dataFlow as any[]) {
      if (df.description) {
        for (const typePart of _extractTypeNames(df.description)) {
          add({ name: typePart, filePath: df.filePath, line: df.line, kind: 'variable' });
        }
      }
    }
  }

  // Sort by name length descending so longer names match first (avoids partial matches)
  symbols.sort((a, b) => b.name.length - a.name.length);

  return symbols;
}

/**
 * Extract individual type/symbol names from a type expression string.
 * Handles generics like "Map<string, AnalysisResult>", union types like
 * "string | number", array types like "SymbolInfo[]", and callable types
 * like "(symbol: SymbolInfo) => Promise<AnalysisResult>".
 *
 * Returns names that are at least 3 chars, start with uppercase (likely
 * user-defined types), and are not common built-in names.
 */
function _extractTypeNames(typeExpr: string): string[] {
  if (!typeExpr) {
    return [];
  }

  // Built-in type names to skip — these are language primitives, not explorable symbols
  const builtins = new Set([
    'string',
    'number',
    'boolean',
    'void',
    'null',
    'undefined',
    'any',
    'never',
    'unknown',
    'object',
    'symbol',
    'bigint',
    'true',
    'false',
    'int',
    'float',
    'double',
    'char',
    'bool',
    'auto',
    'Map',
    'Set',
    'Array',
    'Record',
    'Promise',
    'Partial',
    'Required',
    'Readonly',
    'Pick',
    'Omit',
    'Exclude',
    'Extract',
    'NonNullable',
    'ReturnType',
    'Parameters',
    'ConstructorParameters',
    'InstanceType',
    'ThisType',
    'Awaited',
  ]);

  // Split on non-identifier characters and filter to likely user-defined type names
  const parts = typeExpr.split(/[^a-zA-Z0-9_]+/).filter((part) => {
    if (!part || part.length < 3) {
      return false;
    }
    if (builtins.has(part)) {
      return false;
    }
    // Must start with uppercase — lowercase names are likely primitives or param names
    if (!/^[A-Z]/.test(part)) {
      return false;
    }
    return true;
  });

  return parts;
}

/**
 * Render a type expression string with individual type components linked.
 * Unlike _escAndLink which operates on HTML-escaped text with word boundaries,
 * this function understands type syntax: it splits a type expression like
 * "Map<string, AnalysisResult>" into structural tokens and links each
 * user-defined type component while preserving the surrounding syntax
 * (angle brackets, commas, pipes, etc.).
 */
function _linkTypeExpression(typeExpr: string, knownSymbols: KnownSymbol[]): string {
  if (!typeExpr) {
    return '';
  }

  // Split type expression into identifier tokens and non-identifier separators.
  // E.g. "Map<string, AnalysisResult>" → ["Map", "<", "string", ", ", "AnalysisResult", ">"]
  const tokenRegex = /([a-zA-Z_][a-zA-Z0-9_]*)|([^a-zA-Z0-9_]+)/g;
  let match: RegExpExecArray | null;
  const parts: string[] = [];

  while ((match = tokenRegex.exec(typeExpr)) !== null) {
    const identifier = match[1];
    const separator = match[2];

    if (identifier) {
      // Check if this identifier is a known symbol
      const sym = knownSymbols.find((s) => s.name === identifier);
      if (sym) {
        parts.push(_symbolExploreLink(sym.name, sym.filePath, sym.line, sym.kind));
      } else {
        parts.push(esc(identifier));
      }
    } else if (separator) {
      parts.push(esc(separator));
    }
  }

  return parts.join('');
}

/**
 * Auto-link known symbol names found in free-text content.
 * Scans `escapedText` for occurrences of known symbol names and wraps them
 * in `<a class="symbol-link">` tags that trigger `exploreSymbol`.
 *
 * The text must already be HTML-escaped before calling this.
 */
function _autoLinkSymbols(escapedText: string, knownSymbols: KnownSymbol[]): string {
  if (!escapedText || knownSymbols.length === 0) {
    return escapedText;
  }

  // Track which ranges have been replaced to avoid overlapping matches
  const replacements: { start: number; end: number; html: string }[] = [];

  for (const sym of knownSymbols) {
    const escapedName = esc(sym.name);
    if (!escapedName) {
      continue;
    }

    // Match the escaped name surrounded by non-identifier characters (word boundary)
    const pattern = new RegExp(
      `(?<![a-zA-Z0-9_])${escapedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-zA-Z0-9_(])`,
      'g'
    );

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(escapedText)) !== null) {
      const start = match.index;
      const end = start + match[0].length;

      // Check this range doesn't overlap with any existing replacement
      const overlaps = replacements.some(
        (r) => (start >= r.start && start < r.end) || (end > r.start && end <= r.end)
      );
      if (overlaps) {
        continue;
      }

      const linkAttrs = sym.filePath
        ? ` data-symbol-name="${esc(sym.name)}" data-symbol-file="${esc(sym.filePath)}" data-symbol-line="${sym.line || 0}" data-symbol-kind="${esc(sym.kind || 'function')}"`
        : ` data-symbol-name="${esc(sym.name)}" data-symbol-kind="${esc(sym.kind || 'function')}"`;

      const linkHtml = `<a class="symbol-link" href="#"${linkAttrs}>${escapedName}</a>`;
      replacements.push({ start, end, html: linkHtml });
    }
  }

  if (replacements.length === 0) {
    return escapedText;
  }

  // Apply replacements in reverse order so indices remain valid
  replacements.sort((a, b) => b.start - a.start);
  let result = escapedText;
  for (const r of replacements) {
    result = result.substring(0, r.start) + r.html + result.substring(r.end);
  }

  return result;
}

/**
 * Escape text and then auto-link any known symbol names found within it.
 */
function _escAndLink(text: string, knownSymbols: KnownSymbol[]): string {
  return _autoLinkSymbols(esc(text), knownSymbols);
}

/**
 * Render markdown-like text that may contain ```mermaid fenced blocks.
 *
 * Splits the text on ```mermaid ... ``` boundaries. Non-mermaid parts
 * are escaped + auto-linked as normal. Mermaid parts are emitted as
 * `<div class="diagram-container" data-mermaid-source="...">` placeholders
 * that `renderMermaidDiagrams()` will pick up after the DOM update.
 *
 * Also handles generic ``` code blocks (non-mermaid) by rendering them
 * as styled `<pre><code>` blocks.
 */
function _renderMarkdownWithMermaid(text: string, knownSymbols: KnownSymbol[]): string {
  if (!text) {
    return '';
  }

  // Regex matches ```mermaid\n...\n``` and generic ```lang\n...\n``` blocks
  const fencedBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  const parts: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fencedBlockRegex.exec(text)) !== null) {
    // Add the text before this fenced block (escaped + auto-linked)
    if (match.index > lastIndex) {
      const before = text.substring(lastIndex, match.index);
      parts.push(_renderPlainMarkdown(_escAndLink(before, knownSymbols)));
    }

    const lang = match[1].toLowerCase();
    const content = match[2];

    if (lang === 'mermaid') {
      // Emit a mermaid diagram placeholder
      const diagramId = `mermaid-inline-${++_mermaidIdCounter}`;
      parts.push(
        `<div class="diagram-container" id="${diagramId}" data-mermaid-source="${escAttr(content.trim())}">` +
          `<div class="diagram-loading">Rendering diagram\u2026</div>` +
          `</div>`
      );
    } else {
      // Render as a styled code block
      const langLabel = lang ? ` data-lang="${esc(lang)}"` : '';
      parts.push(`<pre class="qa-code-block"${langLabel}><code>${esc(content)}</code></pre>`);
    }

    lastIndex = match.index + match[0].length;
  }

  // Add any remaining text after the last fenced block
  if (lastIndex < text.length) {
    const remaining = text.substring(lastIndex);
    parts.push(_renderPlainMarkdown(_escAndLink(remaining, knownSymbols)));
  }

  return parts.join('');
}

/**
 * Minimal markdown-to-HTML for already-escaped text.
 * Converts line breaks to <br> for readability in Q&A answers.
 */
function _renderPlainMarkdown(escapedHtml: string): string {
  return escapedHtml.replace(/\n/g, '<br>');
}

/**
 * Render a symbol name as a clickable explore link (for structured data
 * where we know the symbol info directly, not via text scanning).
 */
function _symbolExploreLink(name: string, filePath?: string, line?: number, kind?: string): string {
  const linkAttrs = filePath
    ? ` data-symbol-name="${esc(name)}" data-symbol-file="${esc(filePath)}" data-symbol-line="${line || 0}" data-symbol-kind="${esc(kind || 'function')}"`
    : ` data-symbol-name="${esc(name)}" data-symbol-kind="${esc(kind || 'function')}"`;
  return `<a class="symbol-link" href="#"${linkAttrs}>${esc(name)}</a>`;
}

function renderAnalysis(tab: Tab): string {
  const a = tab.analysis;
  const sections: string[] = [];

  // Build the known symbols dictionary for auto-linking free text
  const ks = _buildKnownSymbols(a);

  // Header with file breadcrumb (clickable — navigates to the symbol's position)
  const fileBreadcrumb = tab.symbol.filePath
    ? `<a class="symbol-header__breadcrumb file-link" href="#" data-file="${esc(tab.symbol.filePath)}" data-line="${tab.symbol.kind !== 'unknown' && tab.analysis?.symbol?.position ? tab.analysis.symbol.position.line + 1 : 1}" data-char="0" title="${esc(tab.symbol.filePath)}">${esc(shortPath(tab.symbol.filePath))}</a>`
    : '';
  sections.push(`<div class="symbol-header">
    <div class="symbol-header__main">
      <span class="symbol-header__icon">${kindIcon(tab.symbol.kind)}</span>
      <span class="symbol-header__kind">${esc(tab.symbol.kind)}</span>
      <span class="symbol-header__name">${esc(tab.symbol.name)}</span>
    </div>
    ${fileBreadcrumb}
  </div>`);

  // Enhance button — show loading state when enhancing
  if (tab.enhancing) {
    sections.push(`<div class="enhance-bar">
    <button class="enhance-bar__button enhance-bar__button--enhancing" data-tab-id="${tab.id}" disabled>
      <span class="enhance-bar__spinner"></span>
      <span class="enhance-bar__label">Enhancing\u2026</span>
    </button>
    <button class="reanalyze-btn" data-tab-id="${tab.id}" title="Re-analyze this symbol from scratch, ignoring cached results">\uD83D\uDD04 Re-analyze</button>
    <button class="notes-btn" data-tab-id="${tab.id}" title="Edit notes">\uD83D\uDCDD Notes</button>
  </div>`);
  } else {
    sections.push(`<div class="enhance-bar">
    <button class="enhance-bar__button" data-tab-id="${tab.id}">
      <span class="enhance-bar__icon">\u2728</span>
      <span class="enhance-bar__label">Enhance</span>
    </button>
    <button class="reanalyze-btn" data-tab-id="${tab.id}" title="Re-analyze this symbol from scratch, ignoring cached results">\uD83D\uDD04 Re-analyze</button>
    <button class="notes-btn" data-tab-id="${tab.id}" title="Edit notes">\uD83D\uDCDD Notes</button>
  </div>`);
  }

  // User notes (shown at top of analysis, before the LLM badge)
  if (tab.notes) {
    sections.push(`<div class="user-notes">
      <div class="user-notes__label">\uD83D\uDCDD Notes</div>
      <div class="user-notes__content">${esc(tab.notes).replace(/\n/g, '<br>')}</div>
    </div>`);
  }

  // LLM badge
  if (a.metadata?.llmProvider) {
    sections.push(
      `<div class="badge badge--llm">✨ Analyzed with ${esc(a.metadata.llmProvider)}</div>`
    );
  } else {
    sections.push('<div class="badge badge--static">📊 Static analysis only</div>');
  }

  // Overview
  if (a.overview) {
    sections.push(
      renderSection(
        'Overview',
        `<p class="overview-text">${_renderMarkdownWithMermaid(a.overview, ks)}</p>`
      )
    );
  }

  // Data Kind (for variables — what kind of data this variable holds)
  if (a.dataKind && a.dataKind.label) {
    const dk = a.dataKind;
    const parts: string[] = [];
    parts.push(`<div class="data-kind-item">`);
    parts.push(
      `<div class="data-kind-item__label"><span class="badge badge--data-kind">📦 ${esc(dk.label)}</span></div>`
    );
    if (dk.description) {
      parts.push(`<div class="data-kind-item__desc">${_escAndLink(dk.description, ks)}</div>`);
    }
    if (dk.examples && dk.examples.length > 0) {
      parts.push(`<div class="data-kind-item__section-label">Examples:</div>`);
      parts.push(`<ul class="data-kind-item__list">`);
      for (const ex of dk.examples) {
        parts.push(`<li><code>${esc(ex)}</code></li>`);
      }
      parts.push(`</ul>`);
    }
    if (dk.references && dk.references.length > 0) {
      parts.push(`<div class="data-kind-item__section-label">References:</div>`);
      parts.push(`<ul class="data-kind-item__list">`);
      for (const ref of dk.references) {
        parts.push(`<li>${_escAndLink(ref, ks)}</li>`);
      }
      parts.push(`</ul>`);
    }
    parts.push(`</div>`);
    sections.push(renderSection('Data Kind', parts.join('')));
  }

  // Step-by-Step Breakdown (numbered functionalities)
  if (a.functionSteps && a.functionSteps.length > 0) {
    const items = a.functionSteps
      .map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (s: any) =>
          `<li class="step-item"><span class="step-item__number">${s.step}.</span> ${_escAndLink(s.description, ks)}</li>`
      )
      .join('');
    sections.push(renderSection('Step-by-Step Breakdown', `<ol class="step-list">${items}</ol>`));
  }

  // Sub-Functions
  if (a.subFunctions && a.subFunctions.length > 0) {
    const items = a.subFunctions
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((sf: any) => {
        const linkAttrs = sf.filePath
          ? ` data-symbol-name="${esc(sf.name)}" data-symbol-file="${esc(sf.filePath)}" data-symbol-line="${sf.line || 0}" data-symbol-kind="${esc(sf.kind || 'function')}"`
          : '';
        const nameHtml = sf.filePath
          ? `<a class="symbol-link" href="#"${linkAttrs}>${esc(sf.name)}</a>`
          : `<strong>${esc(sf.name)}</strong>`;
        return `<div class="subfunction-item">
        <div class="subfunction-item__header">${nameHtml}</div>
        <div class="subfunction-item__desc">${_escAndLink(sf.description, ks)}</div>
        <div class="subfunction-item__io">
          <span class="subfunction-item__label">Input:</span> <span>${_escAndLink(sf.input, ks)}</span>
        </div>
        <div class="subfunction-item__io">
          <span class="subfunction-item__label">Output:</span> <span>${_escAndLink(sf.output, ks)}</span>
        </div>
        ${sf.filePath ? `<a class="subfunction-item__file file-link" href="#" data-file="${esc(sf.filePath)}" data-line="${sf.line || 1}" data-char="0">${esc(shortPath(sf.filePath))}${sf.line ? ':' + sf.line : ''}</a>` : ''}
      </div>`;
      })
      .join('');
    sections.push(
      renderSection(
        `Sub-Functions (${a.subFunctions.length})`,
        `<div class="subfunction-list">${items}</div>`
      )
    );
  }

  // Function Input
  if (a.functionInputs && a.functionInputs.length > 0) {
    const items = a.functionInputs
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((p: any) => {
        const typeLinkAttrs = p.typeFilePath
          ? ` data-symbol-name="${esc(p.typeName)}" data-symbol-file="${esc(p.typeFilePath)}" data-symbol-line="${p.typeLine || 0}" data-symbol-kind="${esc(p.typeKind || 'type')}"`
          : '';
        const typeHtml = p.typeFilePath
          ? `<a class="symbol-link" href="#"${typeLinkAttrs}>${esc(p.typeName)}</a>`
          : `<code>${_linkTypeExpression(p.typeName, ks)}</code>`;
        const mutatedBadge = p.mutated
          ? `<span class="badge badge--mutated" title="${esc(p.mutationDetail || 'Mutates this parameter')}">⚡ mutated</span>`
          : '<span class="badge badge--readonly">readonly</span>';
        return `<div class="fn-param-item">
        <div class="fn-param-item__header">
          <span class="fn-param-item__name">${esc(p.name)}</span>
          <span class="fn-param-item__type">${typeHtml}</span>
          ${mutatedBadge}
        </div>
        <div class="fn-param-item__desc">${_escAndLink(p.description, ks)}</div>
        ${p.mutated && p.mutationDetail ? `<div class="fn-param-item__mutation">⚡ ${_escAndLink(p.mutationDetail, ks)}</div>` : ''}
        ${p.typeOverview ? `<div class="fn-param-item__type-overview">${_escAndLink(p.typeOverview, ks)}</div>` : ''}
      </div>`;
      })
      .join('');
    sections.push(
      renderSection(
        `Function Input (${a.functionInputs.length})`,
        `<div class="fn-param-list">${items}</div>`
      )
    );
  }

  // Function Output
  if (a.functionOutput && a.functionOutput.typeName) {
    const out = a.functionOutput;
    const typeLinkAttrs = out.typeFilePath
      ? ` data-symbol-name="${esc(out.typeName)}" data-symbol-file="${esc(out.typeFilePath)}" data-symbol-line="${out.typeLine || 0}" data-symbol-kind="${esc(out.typeKind || 'type')}"`
      : '';
    const typeHtml = out.typeFilePath
      ? `<a class="symbol-link" href="#"${typeLinkAttrs}>${esc(out.typeName)}</a>`
      : `<code>${_linkTypeExpression(out.typeName, ks)}</code>`;
    const content = `<div class="fn-output-item">
      <div class="fn-output-item__header">
        <span class="fn-output-item__label">Returns:</span>
        <span class="fn-output-item__type">${typeHtml}</span>
      </div>
      <div class="fn-output-item__desc">${_escAndLink(out.description, ks)}</div>
      ${out.typeOverview ? `<div class="fn-output-item__type-overview">${_escAndLink(out.typeOverview, ks)}</div>` : ''}
    </div>`;
    sections.push(renderSection('Function Output', content));
  }

  // Class Members
  if (a.classMembers && a.classMembers.length > 0) {
    const items = a.classMembers
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((m: any) => {
        const staticBadge = m.isStatic
          ? '<span class="badge badge--static-member">static</span>'
          : '';
        const visBadge = `<span class="badge badge--visibility badge--vis-${esc(m.visibility || 'public')}">${esc(m.visibility || 'public')}</span>`;
        // Member name is clickable — explores the member symbol
        const memberNameHtml = tab.symbol.filePath
          ? `<a class="symbol-link" href="#" data-symbol-name="${esc(m.name)}" data-symbol-file="${esc(tab.symbol.filePath)}" data-symbol-line="${m.line || 0}" data-symbol-kind="${esc(m.memberKind === 'method' ? 'method' : 'property')}">${esc(m.name)}</a>`
          : `<span>${esc(m.name)}</span>`;
        // Type name — auto-link individual type components (handles generics like Map<string, AnalysisResult>)
        const typeHtml = m.typeName ? _linkTypeExpression(m.typeName, ks) : '';
        return `<div class="class-member-item">
        <div class="class-member-item__header">
          <span class="class-member-item__kind">${memberKindIcon(m.memberKind)}</span>
          <span class="class-member-item__name">${memberNameHtml}</span>
          <code class="class-member-item__type">${typeHtml}</code>
          ${visBadge}${staticBadge}
        </div>
        <div class="class-member-item__desc">${_escAndLink(m.description || '', ks)}</div>
      </div>`;
      })
      .join('');
    sections.push(
      renderSection(
        `Class Members (${a.classMembers.length})`,
        `<div class="class-member-list">${items}</div>`
      )
    );
  }

  // Member Access Patterns
  if (a.memberAccess && a.memberAccess.length > 0) {
    const items = a.memberAccess
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((ma: any) => {
        const externalBadge = ma.externalAccess
          ? '<span class="badge badge--external">external</span>'
          : '';
        // Render readBy and writtenBy as individual symbol links
        const readersHtml =
          (ma.readBy || []).length > 0
            ? (ma.readBy as string[])
                .map((r: string) => _symbolExploreLink(r, tab.symbol.filePath, undefined, 'method'))
                .join(', ')
            : 'none';
        const writersHtml =
          (ma.writtenBy || []).length > 0
            ? (ma.writtenBy as string[])
                .map((w: string) => _symbolExploreLink(w, tab.symbol.filePath, undefined, 'method'))
                .join(', ')
            : 'none';
        // Member name itself is an explore link
        const memberNameHtml = _symbolExploreLink(
          ma.memberName,
          tab.symbol.filePath,
          undefined,
          'property'
        );
        return `<div class="member-access-item">
        <div class="member-access-item__header">
          <strong>${memberNameHtml}</strong> ${externalBadge}
        </div>
        <div class="member-access-item__row">
          <span class="member-access-item__label">Read by:</span> <span>${readersHtml}</span>
        </div>
        <div class="member-access-item__row">
          <span class="member-access-item__label">Written by:</span> <span>${writersHtml}</span>
        </div>
      </div>`;
      })
      .join('');
    sections.push(
      renderSection('Member Access Patterns', `<div class="member-access-list">${items}</div>`)
    );
  }

  // Variable Lifecycle
  if (a.variableLifecycle) {
    const vl = a.variableLifecycle;
    const parts: string[] = [];
    if (vl.declaration) {
      parts.push(
        `<div class="lifecycle-item"><span class="lifecycle-item__label">Declaration:</span> ${_escAndLink(vl.declaration, ks)}</div>`
      );
    }
    if (vl.initialization) {
      parts.push(
        `<div class="lifecycle-item"><span class="lifecycle-item__label">Initialization:</span> ${_escAndLink(vl.initialization, ks)}</div>`
      );
    }
    if (vl.mutations && vl.mutations.length > 0) {
      const muts = vl.mutations.map((m: string) => `<li>${_escAndLink(m, ks)}</li>`).join('');
      parts.push(
        `<div class="lifecycle-item"><span class="lifecycle-item__label">Mutations:</span><ul class="lifecycle-sublist">${muts}</ul></div>`
      );
    }
    if (vl.consumption && vl.consumption.length > 0) {
      const cons = vl.consumption.map((c: string) => `<li>${_escAndLink(c, ks)}</li>`).join('');
      parts.push(
        `<div class="lifecycle-item"><span class="lifecycle-item__label">Consumption:</span><ul class="lifecycle-sublist">${cons}</ul></div>`
      );
    }
    if (vl.scopeAndLifetime) {
      parts.push(
        `<div class="lifecycle-item"><span class="lifecycle-item__label">Scope & Lifetime:</span> ${_escAndLink(vl.scopeAndLifetime, ks)}</div>`
      );
    }
    if (parts.length > 0) {
      sections.push(
        renderSection('Variable Lifecycle', `<div class="lifecycle-list">${parts.join('')}</div>`)
      );
    }
  }

  // Data Flow
  if (a.dataFlow && a.dataFlow.length > 0) {
    const items = a.dataFlow
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((df: any) => {
        const typeLabel = dataFlowIcon(df.type);
        const fileRef = df.filePath
          ? `<a class="data-flow-item__file file-link" href="#" data-file="${esc(df.filePath)}" data-line="${df.line || 1}" data-char="0">${esc(shortPath(df.filePath))}:${df.line}</a>`
          : '';
        return `<div class="data-flow-item">
        <span class="data-flow-item__type">${typeLabel}</span>
        <span class="data-flow-item__desc">${_escAndLink(df.description, ks)}</span>
        ${fileRef}
      </div>`;
      })
      .join('');
    sections.push(
      renderSection(
        `Data Flow (${a.dataFlow.length})`,
        `<div class="data-flow-list">${items}</div>`
      )
    );
  }

  // Key methods / points
  if (a.keyMethods && a.keyMethods.length > 0) {
    const items = a.keyMethods.map((m: string) => `<li>${_escAndLink(m, ks)}</li>`).join('');
    sections.push(renderSection('Key Points', `<ul class="list">${items}</ul>`));
  }

  // Usages
  if (a.usages && a.usages.length > 0) {
    const rows = a.usages
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((u: any) => {
        const defBadge = u.isDefinition ? ' <span class="badge badge--def">def</span>' : '';
        return `<div class="usage-row" data-file="${esc(u.filePath)}" data-line="${u.line}" data-char="${u.character}">
          <span class="usage-row__file">${esc(shortPath(u.filePath))}:${u.line}</span>${defBadge}
          <span class="usage-row__context">${esc(u.contextLine?.trim() || '')}</span>
        </div>`;
      })
      .join('');
    sections.push(
      renderSection(`Usages (${a.usages.length})`, `<div class="usage-list">${rows}</div>`)
    );
  }

  // Call stacks
  if (a.callStacks && a.callStacks.length > 0) {
    const items = a.callStacks
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((c: any) => {
        const chain = c.chain || `${c.caller.name} → ${tab.symbol.name}`;
        const nameHtml = c.caller.filePath
          ? `<a class="symbol-link" href="#" data-symbol-name="${esc(c.caller.name)}" data-symbol-file="${esc(c.caller.filePath)}" data-symbol-line="${c.caller.line || 0}" data-symbol-kind="${esc(c.caller.kind || 'function')}">${esc(c.caller.name)}</a>`
          : `<strong>${esc(c.caller.name)}</strong>`;
        return `<li class="callstack-item">
          ${nameHtml}
          <a class="callstack-item__file file-link" href="#" data-file="${esc(c.caller.filePath)}" data-line="${c.caller.line || 1}" data-char="0">${esc(shortPath(c.caller.filePath))}:${c.caller.line}</a>
          <div class="callstack-item__chain">${_escAndLink(chain, ks)}</div>
        </li>`;
      })
      .join('');
    sections.push(
      renderSection(`Call Stacks (${a.callStacks.length})`, `<ul class="list">${items}</ul>`)
    );
  }

  // Relationships
  if (a.relationships && a.relationships.length > 0) {
    const items = a.relationships
      .map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (r: any) => {
          const targetLink = _symbolExploreLink(
            r.targetName,
            r.targetFilePath,
            r.targetLine,
            'unknown'
          );
          return `<li><span class="rel-type">${esc(r.type)}</span> ${targetLink} <a class="rel-file file-link" href="#" data-file="${esc(r.targetFilePath)}" data-line="${r.targetLine || 1}" data-char="0">${esc(shortPath(r.targetFilePath))}</a></li>`;
        }
      )
      .join('');
    sections.push(renderSection('Relationships', `<ul class="list">${items}</ul>`));
  }

  // Dependencies
  if (a.dependencies && a.dependencies.length > 0) {
    const items = a.dependencies.map((d: string) => `<li>${_escAndLink(d, ks)}</li>`).join('');
    sections.push(renderSection('Dependencies', `<ul class="list">${items}</ul>`));
  }

  // Usage pattern
  if (a.usagePattern) {
    sections.push(renderSection('Usage Pattern', `<p>${_escAndLink(a.usagePattern, ks)}</p>`));
  }

  // Potential issues
  if (a.potentialIssues && a.potentialIssues.length > 0) {
    const items = a.potentialIssues.map((i: string) => `<li>⚠ ${_escAndLink(i, ks)}</li>`).join('');
    sections.push(renderSection('Potential Issues', `<ul class="list">${items}</ul>`));
  }

  // Diagrams (Mermaid) — rendered as placeholder divs, filled by renderMermaidDiagrams()
  if (a.diagrams && a.diagrams.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const d of a.diagrams as any[]) {
      if (!d.mermaidSource) {
        continue;
      }
      const diagramId = `mermaid-${++_mermaidIdCounter}`;
      const content = `<div class="diagram-container" id="${diagramId}" data-mermaid-source="${escAttr(d.mermaidSource)}">
        <div class="diagram-loading">Rendering diagram\u2026</div>
      </div>`;
      sections.push(renderSection(d.title || 'Diagram', content));
    }
  }

  // Q&A History
  if (a.qaHistory && a.qaHistory.length > 0) {
    const items = a.qaHistory
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((qa: any, index: number) => {
        const time = qa.timestamp ? new Date(qa.timestamp).toLocaleString() : '';
        return `<div class="qa-item" id="qa-item-${index}">
          <div class="qa-item__question">
            <span class="qa-item__q-label">Q:</span>
            <span class="qa-item__q-text">${esc(qa.question)}</span>
          </div>
          <div class="qa-item__time">${esc(time)}</div>
          <div class="qa-item__answer">${_renderMarkdownWithMermaid(qa.answer, ks)}</div>
        </div>`;
      })
      .join('');
    sections.push(
      renderSection(`Q&A (${a.qaHistory.length})`, `<div class="qa-list">${items}</div>`)
    );
  }

  // Timestamp + cache file path
  if (a.metadata?.analyzedAt) {
    const time = new Date(a.metadata.analyzedAt).toLocaleString();
    const cachePath = a.metadata?.cacheFilePath
      ? `<span class="metadata__cache-path file-link" data-file="${esc(a.metadata.cacheFilePath)}" data-line="1" data-char="0" title="Click to open cache file">${esc(a.metadata.cacheFilePath)}</span>`
      : '';
    sections.push(
      `<div class="metadata">Analyzed: ${esc(time)}${cachePath ? ` · ${cachePath}` : ''}</div>`
    );
  }

  return `<div class="analysis-content">${sections.join('')}</div>`;
}

function renderSection(title: string, content: string): string {
  return `<details class="section" open>
    <summary class="section__title">${title}</summary>
    <div class="section__body">${content}</div>
  </details>`;
}

// =====================
// Resize Handle
// =====================

/** Persisted tab sidebar width — survives re-renders within the same session */
let _tabSidebarWidth: number | null = null;

function _attachResizeHandle(): void {
  const handle = document.getElementById('tab-resize-handle');
  const tabBar = document.querySelector('.tab-bar') as HTMLElement | null;
  if (!handle || !tabBar) {
    return;
  }

  // Restore persisted width if available
  if (_tabSidebarWidth !== null) {
    tabBar.style.width = `${_tabSidebarWidth}px`;
  }

  let startX = 0;
  let startWidth = 0;

  const onMouseMove = (e: MouseEvent) => {
    e.preventDefault();
    const delta = e.clientX - startX;
    const newWidth = Math.max(60, Math.min(startWidth + delta, window.innerWidth * 0.5));
    tabBar.style.width = `${newWidth}px`;
    _tabSidebarWidth = newWidth;
  };

  const onMouseUp = () => {
    handle.classList.remove('resizing');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };

  handle.addEventListener('mousedown', (e: Event) => {
    const me = e as MouseEvent;
    me.preventDefault();
    startX = me.clientX;
    startWidth = tabBar.getBoundingClientRect().width;
    handle.classList.add('resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

// =====================
// Drag and Drop (Tab Reordering)
// =====================

function _attachDragAndDrop(): void {
  const tabList = document.getElementById('tab-list');
  if (!tabList) {
    return;
  }

  // Clear all drop indicators
  const _clearDropIndicators = (): void => {
    tabList
      .querySelectorAll(
        '.tab--drop-above, .tab--drop-below, .tab-group--drop-into, .tab-group--drop-above, .tab-group--drop-below'
      )
      .forEach((t) => {
        t.classList.remove(
          'tab--drop-above',
          'tab--drop-below',
          'tab-group--drop-into',
          'tab-group--drop-above',
          'tab-group--drop-below'
        );
      });
  };

  // --- Tab drag-and-drop ---
  tabList.querySelectorAll('.tab[draggable="true"]').forEach((el) => {
    el.addEventListener('dragstart', (e) => {
      const de = e as DragEvent;
      const tabEl = de.currentTarget as HTMLElement;
      _draggedTabId = tabEl.dataset.tabId || null;
      _draggedGroupId = null;
      tabEl.classList.add('tab--dragging');
      if (de.dataTransfer) {
        de.dataTransfer.effectAllowed = 'move';
        de.dataTransfer.setData('text/plain', `tab:${_draggedTabId || ''}`);
      }
    });

    el.addEventListener('dragend', () => {
      (el as HTMLElement).classList.remove('tab--dragging');
      _draggedTabId = null;
      _draggedGroupId = null;
      _clearDropIndicators();
    });

    el.addEventListener('dragover', (e) => {
      const de = e as DragEvent;
      de.preventDefault();
      if (de.dataTransfer) {
        de.dataTransfer.dropEffect = 'move';
      }
      const target = de.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      _clearDropIndicators();
      if (de.clientY < midY) {
        target.classList.add('tab--drop-above');
      } else {
        target.classList.add('tab--drop-below');
      }
    });

    el.addEventListener('dragleave', () => {
      (el as HTMLElement).classList.remove('tab--drop-above', 'tab--drop-below');
    });

    el.addEventListener('drop', (e) => {
      const de = e as DragEvent;
      de.preventDefault();
      const target = de.currentTarget as HTMLElement;
      const targetId = target.dataset.tabId;
      _clearDropIndicators();

      if (!targetId) {
        return;
      }

      if (_draggedTabId && _draggedTabId !== targetId) {
        // Tab dropped on tab — reorder
        const tabOrder = currentTabs.map((t) => t.id);
        const fromIdx = tabOrder.indexOf(_draggedTabId);
        const toIdx = tabOrder.indexOf(targetId);
        if (fromIdx < 0 || toIdx < 0) {
          return;
        }
        const rect = target.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        let insertIdx = de.clientY < midY ? toIdx : toIdx + 1;
        if (fromIdx < insertIdx) {
          insertIdx--;
        }
        tabOrder.splice(fromIdx, 1);
        tabOrder.splice(insertIdx, 0, _draggedTabId);
        vscode.postMessage({ type: 'reorderTabs', tabIds: tabOrder });
      } else if (_draggedGroupId) {
        // Group dropped on a tab — move group to root level near this tab
        vscode.postMessage({
          type: 'moveGroupToGroup',
          sourceGroupId: _draggedGroupId,
          targetGroupId: null,
        });
      }
    });
  });

  // --- Group header drag-and-drop ---
  tabList.querySelectorAll('.tab-group__header[draggable="true"]').forEach((el) => {
    el.addEventListener('dragstart', (e) => {
      const de = e as DragEvent;
      const groupEl = de.currentTarget as HTMLElement;
      _draggedGroupId = groupEl.dataset.groupId || null;
      _draggedTabId = null;
      groupEl.classList.add('tab-group__header--dragging');
      if (de.dataTransfer) {
        de.dataTransfer.effectAllowed = 'move';
        de.dataTransfer.setData('text/plain', `group:${_draggedGroupId || ''}`);
      }
    });

    el.addEventListener('dragend', () => {
      (el as HTMLElement).classList.remove('tab-group__header--dragging');
      _draggedGroupId = null;
      _draggedTabId = null;
      _clearDropIndicators();
    });

    el.addEventListener('dragover', (e) => {
      const de = e as DragEvent;
      de.preventDefault();
      if (de.dataTransfer) {
        de.dataTransfer.dropEffect = 'move';
      }
      const target = de.currentTarget as HTMLElement;
      const targetGroupId = target.dataset.groupId;
      _clearDropIndicators();

      // Can't drop a group onto itself
      if (_draggedGroupId && _draggedGroupId === targetGroupId) {
        return;
      }

      const rect = target.getBoundingClientRect();
      const thirdHeight = rect.height / 3;
      const relY = de.clientY - rect.top;

      const groupContainer = target.closest('.tab-group');
      if (!groupContainer) {
        return;
      }

      if (relY < thirdHeight) {
        // Top third — drop above
        (groupContainer as HTMLElement).classList.add('tab-group--drop-above');
      } else if (relY > thirdHeight * 2) {
        // Bottom third — drop below
        (groupContainer as HTMLElement).classList.add('tab-group--drop-below');
      } else {
        // Middle — drop into group
        (groupContainer as HTMLElement).classList.add('tab-group--drop-into');
      }
    });

    el.addEventListener('dragleave', (e) => {
      const target = (e as DragEvent).currentTarget as HTMLElement;
      const groupContainer = target.closest('.tab-group');
      if (groupContainer) {
        groupContainer.classList.remove(
          'tab-group--drop-into',
          'tab-group--drop-above',
          'tab-group--drop-below'
        );
      }
    });

    el.addEventListener('drop', (e) => {
      const de = e as DragEvent;
      de.preventDefault();
      de.stopPropagation();
      const target = de.currentTarget as HTMLElement;
      const targetGroupId = target.dataset.groupId;
      _clearDropIndicators();

      if (!targetGroupId) {
        return;
      }

      const rect = target.getBoundingClientRect();
      const thirdHeight = rect.height / 3;
      const relY = de.clientY - rect.top;
      const dropInto = relY >= thirdHeight && relY <= thirdHeight * 2;

      if (_draggedTabId) {
        if (dropInto) {
          // Tab dropped INTO a group
          const tabIds =
            _selectedTabIds.size > 0 && _selectedTabIds.has(_draggedTabId)
              ? Array.from(_selectedTabIds)
              : [_draggedTabId];
          vscode.postMessage({
            type: 'moveToGroup',
            tabIds,
            groupId: targetGroupId,
          });
          _selectedTabIds.clear();
        } else {
          // Tab dropped above/below a group — ungroup it (move to root)
          vscode.postMessage({
            type: 'moveToGroup',
            tabIds: [_draggedTabId],
            groupId: null,
          });
        }
      } else if (_draggedGroupId && _draggedGroupId !== targetGroupId) {
        if (dropInto) {
          // Group dropped INTO another group (nesting)
          vscode.postMessage({
            type: 'moveGroupToGroup',
            sourceGroupId: _draggedGroupId,
            targetGroupId: targetGroupId,
          });
        } else {
          // Group dropped above/below — reorder at same level (move to root for now)
          vscode.postMessage({
            type: 'moveGroupToGroup',
            sourceGroupId: _draggedGroupId,
            targetGroupId: null,
          });
        }
      }
    });
  });

  // --- Group children area: accept drops into the group ---
  tabList.querySelectorAll('.tab-group__children').forEach((el) => {
    el.addEventListener('dragover', (e) => {
      const de = e as DragEvent;
      de.preventDefault();
      if (de.dataTransfer) {
        de.dataTransfer.dropEffect = 'move';
      }
      const target = de.currentTarget as HTMLElement;
      const groupContainer = target.closest('.tab-group');
      if (groupContainer) {
        _clearDropIndicators();
        (groupContainer as HTMLElement).classList.add('tab-group--drop-into');
      }
    });

    el.addEventListener('dragleave', (e) => {
      const target = (e as DragEvent).currentTarget as HTMLElement;
      const groupContainer = target.closest('.tab-group');
      if (groupContainer) {
        groupContainer.classList.remove('tab-group--drop-into');
      }
    });

    el.addEventListener('drop', (e) => {
      const de = e as DragEvent;
      de.preventDefault();
      de.stopPropagation();
      const target = de.currentTarget as HTMLElement;
      const groupId = target.dataset.groupChildren;
      _clearDropIndicators();

      if (!groupId) {
        return;
      }

      if (_draggedTabId) {
        const tabIds =
          _selectedTabIds.size > 0 && _selectedTabIds.has(_draggedTabId)
            ? Array.from(_selectedTabIds)
            : [_draggedTabId];
        vscode.postMessage({ type: 'moveToGroup', tabIds, groupId });
        _selectedTabIds.clear();
      } else if (_draggedGroupId && _draggedGroupId !== groupId) {
        vscode.postMessage({
          type: 'moveGroupToGroup',
          sourceGroupId: _draggedGroupId,
          targetGroupId: groupId,
        });
      }
    });
  });
}

// =====================
// Event Listeners
// =====================

function attachListeners(): void {
  // Tab click — with multi-select support (Ctrl/Cmd+click)
  document.querySelectorAll('.tab').forEach((el) => {
    el.addEventListener('click', (e) => {
      const target = e.currentTarget as HTMLElement;
      const tabId = target.dataset.tabId;
      if (!tabId) {
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        // Multi-select toggle
        e.preventDefault();
        e.stopPropagation();
        if (_selectedTabIds.has(tabId)) {
          _selectedTabIds.delete(tabId);
        } else {
          _selectedTabIds.add(tabId);
        }
        render();
        return;
      }

      // Normal click — clear selection and activate tab
      _selectedTabIds.clear();
      vscode.postMessage({ type: 'tabClicked', tabId });
    });
  });

  // Tab select checkbox/area
  document.querySelectorAll('.tab__select').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const tabId = (el as HTMLElement).dataset.selectId;
      if (!tabId) {
        return;
      }
      if (_selectedTabIds.has(tabId)) {
        _selectedTabIds.delete(tabId);
      } else {
        _selectedTabIds.add(tabId);
      }
      render();
    });
  });

  document.querySelectorAll('.tab__close').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const target = e.currentTarget as HTMLElement;
      const tabId = target.dataset.closeId;
      if (tabId) {
        vscode.postMessage({ type: 'tabClosed', tabId });
      }
    });
  });

  document.querySelectorAll('.error-state__retry').forEach((el) => {
    el.addEventListener('click', () => {
      const tabId = (el as HTMLElement).dataset.retryId;
      if (tabId) {
        vscode.postMessage({ type: 'retryAnalysis', tabId });
      }
    });
  });

  document.querySelectorAll('.usage-row').forEach((el) => {
    el.addEventListener('click', () => {
      const row = el as HTMLElement;
      const filePath = row.dataset.file;
      const line = parseInt(row.dataset.line || '0', 10);
      const character = parseInt(row.dataset.char || '0', 10);
      if (filePath) {
        vscode.postMessage({ type: 'navigateToSource', filePath, line, character });
      }
    });
  });

  // All file:line references rendered as <a class="file-link"> are clickable
  document.querySelectorAll('.file-link').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const link = el as HTMLElement;
      const filePath = link.dataset.file;
      const line = parseInt(link.dataset.line || '1', 10);
      const character = parseInt(link.dataset.char || '0', 10);
      if (filePath) {
        vscode.postMessage({ type: 'navigateToSource', filePath, line, character });
      }
    });
  });

  // Symbol links navigate to the code location instead of triggering LLM analysis.
  // The user can then manually trigger analysis from the code location if desired.
  document.querySelectorAll('.symbol-link').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const link = el as HTMLElement;
      const symbolName = link.dataset.symbolName;
      const filePath = link.dataset.symbolFile;
      const line = parseInt(link.dataset.symbolLine || '0', 10);
      if (symbolName && filePath && line > 0) {
        // Navigate directly to the exact file:line location
        vscode.postMessage({
          type: 'navigateToSource',
          filePath,
          line,
          character: 0,
        });
      } else if (symbolName && filePath) {
        // Have file but no line — navigate to file line 1
        vscode.postMessage({
          type: 'navigateToSource',
          filePath,
          line: 1,
          character: 0,
        });
      } else if (symbolName) {
        // No file path — ask the extension to find the symbol and navigate there
        vscode.postMessage({
          type: 'navigateToSymbol',
          symbolName,
        });
      }
    });
  });

  // Enhance button — opens input dialog for user question/enhancement request
  document.querySelectorAll('.enhance-bar__button').forEach((el) => {
    el.addEventListener('click', () => {
      const tabId = (el as HTMLElement).dataset.tabId;
      if (!tabId) {
        return;
      }
      _showEnhanceDialog(tabId);
    });
  });

  // Re-analyze button — re-triggers full analysis from scratch, ignoring cache
  document.querySelectorAll('.reanalyze-btn').forEach((el) => {
    el.addEventListener('click', () => {
      const tabId = (el as HTMLElement).dataset.tabId;
      if (!tabId) {
        return;
      }
      log(`reAnalyze: requesting re-analysis for tab ${tabId}`);
      vscode.postMessage({ type: 'reAnalyze', tabId });
    });
  });

  // Notes button — opens notes editor dialog
  document.querySelectorAll('.notes-btn').forEach((el) => {
    el.addEventListener('click', () => {
      const tabId = (el as HTMLElement).dataset.tabId;
      if (tabId) {
        _showNotesDialog(tabId);
      }
    });
  });

  // Investigation name input — rename on change
  const invNameInput = document.getElementById('inv-name-input') as HTMLInputElement | null;
  if (invNameInput) {
    invNameInput.addEventListener('change', () => {
      const name = invNameInput.value.trim();
      if (name) {
        vscode.postMessage({ type: 'renameInvestigation', name });
      }
    });
  }

  // Tab search filter input
  const tabSearchInput = document.getElementById('tab-search-input') as HTMLInputElement | null;
  if (tabSearchInput) {
    tabSearchInput.addEventListener('input', () => {
      _tabSearchFilter = tabSearchInput.value;
      render();
      // Re-focus the search input and restore cursor position after re-render
      const newInput = document.getElementById('tab-search-input') as HTMLInputElement | null;
      if (newInput) {
        newInput.focus();
        newInput.selectionStart = newInput.selectionEnd = newInput.value.length;
      }
    });
  }

  // Investigation save button
  const invSaveBtn = document.getElementById('inv-save-btn');
  if (invSaveBtn) {
    invSaveBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'saveInvestigation' });
    });
  }

  // Investigation save-as button
  const invSaveAsBtn = document.getElementById('inv-save-as-btn');
  if (invSaveAsBtn) {
    invSaveAsBtn.addEventListener('click', () => {
      _showSaveInvestigationAsDialog();
    });
  }

  // Saved investigation restore buttons
  document.querySelectorAll('.saved-inv__restore').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const investigationId = (el as HTMLElement).dataset.restoreId;
      if (investigationId) {
        vscode.postMessage({ type: 'restoreInvestigation', investigationId });
      }
    });
  });

  // Saved investigation remove buttons
  document.querySelectorAll('.saved-inv__remove').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const investigationId = (el as HTMLElement).dataset.unpinId;
      if (investigationId) {
        vscode.postMessage({ type: 'unpinInvestigation', investigationId });
      }
    });
  });

  // --- Tab Group event listeners ---

  // Group collapse toggle
  document.querySelectorAll('.tab-group__chevron').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const groupId = (el as HTMLElement).dataset.toggleGroup;
      if (groupId) {
        vscode.postMessage({ type: 'toggleGroupCollapse', groupId });
      }
    });
  });

  // Group rename (double-click on name)
  document.querySelectorAll('.tab-group__rename').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const groupId = (el as HTMLElement).dataset.renameGroup;
      if (groupId) {
        _showRenameGroupDialog(groupId);
      }
    });
  });

  // Group delete
  document.querySelectorAll('.tab-group__delete').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const groupId = (el as HTMLElement).dataset.deleteGroup;
      if (groupId) {
        vscode.postMessage({ type: 'deleteGroup', groupId });
      }
    });
  });

  // Create group button
  const createGroupBtn = document.getElementById('create-group-btn');
  if (createGroupBtn) {
    createGroupBtn.addEventListener('click', () => {
      if (_selectedTabIds.size > 0) {
        _showCreateGroupDialog();
      }
    });
  }
}

// =====================
// Enhance Dialog
// =====================

/**
 * Show a modal dialog for the user to enter their question or enhancement request.
 * When submitted, sends an 'enhanceAnalysis' message to the extension.
 */
function _showEnhanceDialog(tabId: string): void {
  // Remove any existing dialog
  const existing = document.getElementById('enhance-dialog-overlay');
  if (existing) {
    existing.remove();
  }

  const overlay = document.createElement('div');
  overlay.id = 'enhance-dialog-overlay';
  overlay.className = 'enhance-dialog-overlay';

  overlay.innerHTML = `<div class="enhance-dialog">
    <div class="enhance-dialog__header">
      <span class="enhance-dialog__title">✨ Enhance Analysis</span>
      <button class="enhance-dialog__close" id="enhance-dialog-close">×</button>
    </div>
    <div class="enhance-dialog__body">
      <label class="enhance-dialog__label" for="enhance-dialog-input">
        Ask a question or request an enhancement:
      </label>
      <textarea
        class="enhance-dialog__input"
        id="enhance-dialog-input"
        rows="4"
        placeholder="e.g., How does this function handle errors? What are the edge cases? Can you explain the algorithm in more detail?"
      ></textarea>
    </div>
    <div class="enhance-dialog__footer">
      <button class="enhance-dialog__cancel" id="enhance-dialog-cancel">Cancel</button>
      <button class="enhance-dialog__submit" id="enhance-dialog-submit">Send</button>
    </div>
  </div>`;

  document.body.appendChild(overlay);

  const input = document.getElementById('enhance-dialog-input') as HTMLTextAreaElement;
  const submitBtn = document.getElementById('enhance-dialog-submit') as HTMLButtonElement;
  const cancelBtn = document.getElementById('enhance-dialog-cancel') as HTMLButtonElement;
  const closeBtn = document.getElementById('enhance-dialog-close') as HTMLButtonElement;

  // Focus the input
  setTimeout(() => input.focus(), 50);

  const close = (): void => {
    overlay.remove();
  };

  const submit = (): void => {
    const userPrompt = input.value.trim();
    if (!userPrompt) {
      input.classList.add('enhance-dialog__input--error');
      input.focus();
      return;
    }

    log(`enhance: submitting prompt for tab ${tabId}: "${userPrompt.substring(0, 80)}"`);
    vscode.postMessage({
      type: 'enhanceAnalysis',
      tabId,
      userPrompt,
    });
    close();
  };

  submitBtn.addEventListener('click', submit);
  cancelBtn.addEventListener('click', close);
  closeBtn.addEventListener('click', close);

  // Close on Escape, submit on Ctrl+Enter
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      close();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      submit();
    }
  });

  // Close on overlay click (outside dialog)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      close();
    }
  });
}

// =====================
// Pin Investigation Dialog
// =====================

/**
 * Show a dialog to name and pin the current investigation trail.
 */
// =====================
// Notes Dialog
// =====================

/**
 * Show a modal dialog for editing notes on a tab.
 */
function _showNotesDialog(tabId: string): void {
  const tab = currentTabs.find((t) => t.id === tabId);
  if (!tab) {
    return;
  }

  const existing = document.getElementById('notes-dialog-overlay');
  if (existing) {
    existing.remove();
  }

  const overlay = document.createElement('div');
  overlay.id = 'notes-dialog-overlay';
  overlay.className = 'enhance-dialog-overlay';

  overlay.innerHTML = `<div class="enhance-dialog">
    <div class="enhance-dialog__header">
      <span class="enhance-dialog__title">\uD83D\uDCDD Edit Notes</span>
      <button class="enhance-dialog__close" id="notes-dialog-close">\u00D7</button>
    </div>
    <div class="enhance-dialog__body">
      <label class="enhance-dialog__label" for="notes-dialog-input">
        Notes for ${esc(tab.symbol.name)}:
      </label>
      <textarea
        class="enhance-dialog__input"
        id="notes-dialog-input"
        rows="6"
        placeholder="Add your notes here..."
      >${esc(tab.notes || '')}</textarea>
    </div>
    <div class="enhance-dialog__footer">
      <button class="enhance-dialog__cancel" id="notes-dialog-cancel">Cancel</button>
      <button class="enhance-dialog__submit" id="notes-dialog-submit">Save</button>
    </div>
  </div>`;

  document.body.appendChild(overlay);

  const input = document.getElementById('notes-dialog-input') as HTMLTextAreaElement;
  const submitBtn = document.getElementById('notes-dialog-submit') as HTMLButtonElement;
  const cancelBtn = document.getElementById('notes-dialog-cancel') as HTMLButtonElement;
  const closeBtn = document.getElementById('notes-dialog-close') as HTMLButtonElement;

  setTimeout(() => input.focus(), 50);

  const close = (): void => {
    overlay.remove();
  };

  const submit = (): void => {
    const notes = input.value.trim();
    vscode.postMessage({ type: 'updateNotes', tabId, notes });
    close();
  };

  submitBtn.addEventListener('click', submit);
  cancelBtn.addEventListener('click', close);
  closeBtn.addEventListener('click', close);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      close();
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      close();
    }
  });
}

// =====================
// Save Investigation As Dialog
// =====================

function _showSaveInvestigationAsDialog(): void {
  const existing = document.getElementById('save-inv-dialog-overlay');
  if (existing) {
    existing.remove();
  }

  const overlay = document.createElement('div');
  overlay.id = 'save-inv-dialog-overlay';
  overlay.className = 'enhance-dialog-overlay';

  const currentName = currentNavHistory?.currentInvestigationName || 'Untitled Investigation';

  overlay.innerHTML = `<div class="enhance-dialog">
    <div class="enhance-dialog__header">
      <span class="enhance-dialog__title">Save Investigation As</span>
      <button class="enhance-dialog__close" id="save-inv-dialog-close">\u00D7</button>
    </div>
    <div class="enhance-dialog__body">
      <label class="enhance-dialog__label" for="save-inv-dialog-input">
        Name this investigation:
      </label>
      <input
        class="enhance-dialog__input"
        id="save-inv-dialog-input"
        type="text"
        value="${escAttr(currentName)}"
        placeholder="e.g., Tracing the cache miss bug"
      />
    </div>
    <div class="enhance-dialog__footer">
      <button class="enhance-dialog__cancel" id="save-inv-dialog-cancel">Cancel</button>
      <button class="enhance-dialog__submit" id="save-inv-dialog-submit">Save</button>
    </div>
  </div>`;

  document.body.appendChild(overlay);

  const input = document.getElementById('save-inv-dialog-input') as HTMLInputElement;
  const submitBtn = document.getElementById('save-inv-dialog-submit') as HTMLButtonElement;
  const cancelBtn = document.getElementById('save-inv-dialog-cancel') as HTMLButtonElement;
  const closeBtn = document.getElementById('save-inv-dialog-close') as HTMLButtonElement;

  setTimeout(() => {
    input.focus();
    input.select();
  }, 50);

  const close = (): void => {
    overlay.remove();
  };

  const submit = (): void => {
    const name = input.value.trim();
    if (!name) {
      input.classList.add('enhance-dialog__input--error');
      input.focus();
      return;
    }
    log(`save investigation as: "${name}"`);
    vscode.postMessage({ type: 'saveInvestigationAs', name });
    close();
  };

  submitBtn.addEventListener('click', submit);
  cancelBtn.addEventListener('click', close);
  closeBtn.addEventListener('click', close);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      close();
    } else if (e.key === 'Enter') {
      submit();
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      close();
    }
  });
}

// =====================
// Create Group Dialog
// =====================

function _showCreateGroupDialog(): void {
  const existing = document.getElementById('create-group-dialog-overlay');
  if (existing) {
    existing.remove();
  }

  const overlay = document.createElement('div');
  overlay.id = 'create-group-dialog-overlay';
  overlay.className = 'enhance-dialog-overlay';

  overlay.innerHTML = `<div class="enhance-dialog">
    <div class="enhance-dialog__header">
      <span class="enhance-dialog__title">\uD83D\uDCC1 Create Group</span>
      <button class="enhance-dialog__close" id="create-group-dialog-close">\u00D7</button>
    </div>
    <div class="enhance-dialog__body">
      <label class="enhance-dialog__label" for="create-group-dialog-input">
        Group ${_selectedTabIds.size} selected tab${_selectedTabIds.size > 1 ? 's' : ''}:
      </label>
      <input
        class="enhance-dialog__input"
        id="create-group-dialog-input"
        type="text"
        placeholder="e.g., Auth Flow, Error Handling"
      />
    </div>
    <div class="enhance-dialog__footer">
      <button class="enhance-dialog__cancel" id="create-group-dialog-cancel">Cancel</button>
      <button class="enhance-dialog__submit" id="create-group-dialog-submit">Create</button>
    </div>
  </div>`;

  document.body.appendChild(overlay);

  const input = document.getElementById('create-group-dialog-input') as HTMLInputElement;
  const submitBtn = document.getElementById('create-group-dialog-submit') as HTMLButtonElement;
  const cancelBtn = document.getElementById('create-group-dialog-cancel') as HTMLButtonElement;
  const closeBtn = document.getElementById('create-group-dialog-close') as HTMLButtonElement;

  setTimeout(() => input.focus(), 50);

  const close = (): void => {
    overlay.remove();
  };

  const submit = (): void => {
    const name = input.value.trim();
    if (!name) {
      input.classList.add('enhance-dialog__input--error');
      input.focus();
      return;
    }
    const tabIds = Array.from(_selectedTabIds);
    log(`create group: "${name}" with ${tabIds.length} tabs`);
    vscode.postMessage({ type: 'createGroup', name, tabIds });
    _selectedTabIds.clear();
    close();
  };

  submitBtn.addEventListener('click', submit);
  cancelBtn.addEventListener('click', close);
  closeBtn.addEventListener('click', close);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      close();
    } else if (e.key === 'Enter') {
      submit();
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      close();
    }
  });
}

// =====================
// Rename Group Dialog
// =====================

function _showRenameGroupDialog(groupId: string): void {
  // Find the group name from _tabGroups
  const currentName = _findGroupName(groupId, _tabGroups) || '';

  const existing = document.getElementById('rename-group-dialog-overlay');
  if (existing) {
    existing.remove();
  }

  const overlay = document.createElement('div');
  overlay.id = 'rename-group-dialog-overlay';
  overlay.className = 'enhance-dialog-overlay';

  overlay.innerHTML = `<div class="enhance-dialog">
    <div class="enhance-dialog__header">
      <span class="enhance-dialog__title">Rename Group</span>
      <button class="enhance-dialog__close" id="rename-group-dialog-close">\u00D7</button>
    </div>
    <div class="enhance-dialog__body">
      <label class="enhance-dialog__label" for="rename-group-dialog-input">
        New name:
      </label>
      <input
        class="enhance-dialog__input"
        id="rename-group-dialog-input"
        type="text"
        value="${escAttr(currentName)}"
      />
    </div>
    <div class="enhance-dialog__footer">
      <button class="enhance-dialog__cancel" id="rename-group-dialog-cancel">Cancel</button>
      <button class="enhance-dialog__submit" id="rename-group-dialog-submit">Rename</button>
    </div>
  </div>`;

  document.body.appendChild(overlay);

  const input = document.getElementById('rename-group-dialog-input') as HTMLInputElement;
  const submitBtn = document.getElementById('rename-group-dialog-submit') as HTMLButtonElement;
  const cancelBtn = document.getElementById('rename-group-dialog-cancel') as HTMLButtonElement;
  const closeBtn = document.getElementById('rename-group-dialog-close') as HTMLButtonElement;

  setTimeout(() => {
    input.focus();
    input.select();
  }, 50);

  const close = (): void => {
    overlay.remove();
  };

  const submit = (): void => {
    const name = input.value.trim();
    if (!name) {
      input.classList.add('enhance-dialog__input--error');
      input.focus();
      return;
    }
    log(`rename group: ${groupId} → "${name}"`);
    vscode.postMessage({ type: 'renameGroup', groupId, name });
    close();
  };

  submitBtn.addEventListener('click', submit);
  cancelBtn.addEventListener('click', close);
  closeBtn.addEventListener('click', close);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      close();
    } else if (e.key === 'Enter') {
      submit();
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      close();
    }
  });
}

/**
 * Find a group name by ID (recursive).
 */
function _findGroupName(groupId: string, groups: TabGroup[]): string | null {
  for (const g of groups) {
    if (g.id === groupId) {
      return g.name;
    }
    for (const child of g.children) {
      if (child.type === 'group') {
        const found = _findGroupName(groupId, [child.group]);
        if (found) {
          return found;
        }
      }
    }
  }
  return null;
}

// =====================
// Helpers
// =====================

function kindIcon(kind: string): string {
  const icons: Record<string, string> = {
    class: '🅲',
    function: 'ƒ',
    method: '𝑚',
    variable: '𝑥',
    interface: '𝐼',
    type: '𝑇',
    enum: 'ℰ',
    property: '𝑝',
    parameter: '𝑎',
    struct: '🅂',
  };
  return icons[kind] || '◆';
}

function memberKindIcon(memberKind: string): string {
  const icons: Record<string, string> = {
    field: '𝑥',
    method: '𝑚',
    property: '𝑝',
    constructor: '⊕',
    getter: '↗',
    setter: '↙',
  };
  return icons[memberKind] || '·';
}

function dataFlowIcon(flowType: string): string {
  const icons: Record<string, string> = {
    created: '⊕ created',
    assigned: '← assigned',
    read: '→ read',
    modified: '⚡ modified',
    consumed: '✓ consumed',
    returned: '↩ returned',
    passed: '→ passed',
  };
  return icons[flowType] || flowType;
}

function shortPath(filePath: string): string {
  if (!filePath) {
    return '';
  }
  const parts = filePath.split('/');
  if (parts.length <= 2) {
    return filePath;
  }
  return '…/' + parts.slice(-2).join('/');
}

function esc(text: string): string {
  if (!text) {
    return '';
  }
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Escape a string for use in an HTML attribute value.
 * Handles double quotes and newlines so mermaid source can be stored in data-* attributes.
 */
function escAttr(text: string): string {
  if (!text) {
    return '';
  }
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '&#10;');
}

/**
 * After DOM is updated, find all diagram-container elements with
 * data-mermaid-source and render them via mermaid.
 */
async function renderMermaidDiagrams(): Promise<void> {
  const containers = document.querySelectorAll('.diagram-container[data-mermaid-source]');
  if (containers.length === 0) {
    return;
  }

  log(`renderMermaidDiagrams: rendering ${containers.length} diagram(s)`);

  for (const container of containers) {
    const el = container as HTMLElement;
    const source = el.dataset.mermaidSource;
    if (!source) {
      continue;
    }

    const diagramId = el.id || `mermaid-auto-${++_mermaidIdCounter}`;

    try {
      const { svg } = await mermaid.render(diagramId + '-svg', source);
      el.innerHTML = svg;
      el.classList.add('diagram-container--rendered');
      el.classList.remove('diagram-container--error');
      // Remove the data attribute so we don't re-render
      delete el.dataset.mermaidSource;
    } catch (err) {
      log(`renderMermaidDiagrams: failed to render ${diagramId}: ${err}`);
      // Show the raw source as a fallback code block
      el.innerHTML = `<div class="diagram-error">
        <div class="diagram-error__label">Diagram render failed</div>
        <pre class="diagram-error__source"><code>${esc(source)}</code></pre>
      </div>`;
      el.classList.add('diagram-container--error');
      // Remove the data attribute so we don't retry
      delete el.dataset.mermaidSource;
    }
  }
}

// =====================
// Dependency Graph View
// =====================

/** Current graph zoom/pan state */
let _graphScale = 1;
let _graphPanX = 0;
let _graphPanY = 0;
let _graphDragging = false;
let _graphLastX = 0;
let _graphLastY = 0;
/** The SVG's original (native) dimensions, captured once after Mermaid render */
let _graphSvgNativeW = 0;
let _graphSvgNativeH = 0;

/**
 * Render the dependency graph view with header, controls, zoom/pan container.
 */
function _renderGraphView(): string {
  const graphId = `graph-${++_mermaidIdCounter}`;
  return `<div class="graph-view">
    <div class="graph-view__header">
      <div class="graph-view__title">
        <span class="graph-view__icon">\uD83D\uDD17</span>
        <span>Dependency Graph</span>
      </div>
      <div class="graph-view__stats">
        <span class="badge badge--llm">${_graphNodeCount} symbols</span>
        <span class="badge badge--static">${_graphEdgeCount} edges</span>
      </div>
      <button class="graph-view__close" id="graph-close-btn" title="Close graph">\u00D7</button>
    </div>
    <div class="graph-view__toolbar">
      <button class="graph-view__tool-btn" id="graph-zoom-in" title="Zoom in">+</button>
      <button class="graph-view__tool-btn" id="graph-zoom-out" title="Zoom out">\u2212</button>
      <button class="graph-view__tool-btn" id="graph-zoom-fit" title="Fit to view">Fit</button>
      <button class="graph-view__tool-btn" id="graph-zoom-reset" title="Reset zoom">1:1</button>
      <span class="graph-view__zoom-label" id="graph-zoom-label">100%</span>
      <div class="graph-view__toolbar-spacer"></div>
      <button class="graph-view__tool-btn" id="graph-show-full" title="Show full workspace graph">Full graph</button>
    </div>
    <div class="graph-view__legend">
      <span class="graph-view__legend-item"><span class="graph-view__legend-swatch graph-view__legend-swatch--fn"></span> function</span>
      <span class="graph-view__legend-item"><span class="graph-view__legend-swatch graph-view__legend-swatch--class"></span> class</span>
      <span class="graph-view__legend-item"><span class="graph-view__legend-swatch graph-view__legend-swatch--iface"></span> interface</span>
      <span class="graph-view__legend-item"><span class="graph-view__legend-swatch graph-view__legend-swatch--var"></span> variable</span>
      <span class="graph-view__legend-item">\u2192 calls</span>
      <span class="graph-view__legend-item">\u21E2 depends</span>
    </div>
    <div class="graph-view__body" id="graph-viewport">
      ${
        _graphNodeCount === 0
          ? '<div class="graph-view__empty">No cached analyses found.<br>Use <kbd>Ctrl+Shift+H</kbd> to analyze symbols first.</div>'
          : `<div class="graph-view__svg-wrapper" id="graph-svg-wrapper">
            <div class="diagram-container graph-view__diagram" id="${graphId}" data-mermaid-source="${escAttr(_graphMermaidSource)}">
              <div class="diagram-loading">Rendering graph\u2026</div>
            </div>
          </div>`
      }
    </div>
  </div>`;
}

/**
 * Attach event listeners for the graph view — close, zoom, pan, drag.
 * Zoom/pan operates directly on the SVG viewBox for crisp rendering.
 */
function _attachGraphListeners(): void {
  // Reset zoom state
  _graphScale = 1;
  _graphPanX = 0;
  _graphPanY = 0;
  _graphSvgNativeW = 0;
  _graphSvgNativeH = 0;

  const closeBtn = document.getElementById('graph-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      _showingGraph = false;
      vscode.postMessage({ type: 'closeDependencyGraph' });
      render();
    });
  }

  // Zoom buttons
  const zoomInBtn = document.getElementById('graph-zoom-in');
  const zoomOutBtn = document.getElementById('graph-zoom-out');
  const zoomFitBtn = document.getElementById('graph-zoom-fit');
  const zoomResetBtn = document.getElementById('graph-zoom-reset');
  const showFullBtn = document.getElementById('graph-show-full');

  if (zoomInBtn) {
    zoomInBtn.addEventListener('click', () => _graphZoom(1.25));
  }
  if (zoomOutBtn) {
    zoomOutBtn.addEventListener('click', () => _graphZoom(0.8));
  }
  if (zoomFitBtn) {
    zoomFitBtn.addEventListener('click', _graphFitToView);
  }
  if (zoomResetBtn) {
    zoomResetBtn.addEventListener('click', () => {
      _graphScale = 1;
      _graphPanX = 0;
      _graphPanY = 0;
      _applyGraphTransform();
    });
  }
  if (showFullBtn) {
    showFullBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'requestDependencyGraph' });
    });
  }

  // Mouse wheel zoom on the viewport
  const viewport = document.getElementById('graph-viewport');
  if (viewport) {
    viewport.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        _graphZoom(factor);
      },
      { passive: false }
    );

    // Mouse drag to pan
    viewport.addEventListener('mousedown', (e) => {
      if (e.button !== 0) {
        return;
      }
      _graphDragging = true;
      _graphLastX = e.clientX;
      _graphLastY = e.clientY;
      viewport.style.cursor = 'grabbing';
      e.preventDefault();
    });

    viewport.addEventListener('mousemove', (e) => {
      if (!_graphDragging) {
        return;
      }
      const dx = e.clientX - _graphLastX;
      const dy = e.clientY - _graphLastY;
      // Pan in viewBox coordinates (inverse of scale)
      _graphPanX -= dx / _graphScale;
      _graphPanY -= dy / _graphScale;
      _graphLastX = e.clientX;
      _graphLastY = e.clientY;
      _applyGraphTransform();
    });

    viewport.addEventListener('mouseup', () => {
      _graphDragging = false;
      viewport.style.cursor = 'grab';
    });

    viewport.addEventListener('mouseleave', () => {
      _graphDragging = false;
      viewport.style.cursor = 'grab';
    });
  }
}

/**
 * Zoom by a multiplicative factor (>1 = zoom in, <1 = zoom out).
 * Uses multiplicative zooming for consistent feel at all levels.
 */
function _graphZoom(factor: number): void {
  _graphScale = Math.max(0.1, Math.min(10, _graphScale * factor));
  _applyGraphTransform();
}

/** Fit the graph SVG into the visible viewport area. */
function _graphFitToView(): void {
  const viewport = document.getElementById('graph-viewport');
  if (!viewport || _graphSvgNativeW === 0 || _graphSvgNativeH === 0) {
    return;
  }
  const vw = viewport.clientWidth;
  const vh = viewport.clientHeight;
  if (vw === 0 || vh === 0) {
    return;
  }
  const scaleX = vw / _graphSvgNativeW;
  const scaleY = vh / _graphSvgNativeH;
  _graphScale = Math.min(scaleX, scaleY) * 0.95; // 5% padding
  _graphPanX = 0;
  _graphPanY = 0;
  _applyGraphTransform();
}

/**
 * Apply the current zoom/pan by manipulating the SVG's viewBox.
 *
 * This is the key to crisp rendering: instead of CSS transform: scale()
 * which rasterizes then stretches (blurry), we change the SVG viewBox
 * so the browser re-renders the vector graphics at the correct resolution.
 */
function _applyGraphTransform(): void {
  const wrapper = document.getElementById('graph-svg-wrapper');
  const svg = wrapper?.querySelector('svg');
  if (!svg || _graphSvgNativeW === 0) {
    return;
  }

  // viewBox dimensions = native size / scale (zooming in = smaller viewBox = bigger content)
  const vbW = _graphSvgNativeW / _graphScale;
  const vbH = _graphSvgNativeH / _graphScale;
  // viewBox origin = pan offset (clamped)
  const vbX = _graphPanX;
  const vbY = _graphPanY;

  svg.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);

  // Make the SVG fill the viewport
  const viewport = document.getElementById('graph-viewport');
  if (viewport) {
    svg.setAttribute('width', `${viewport.clientWidth}`);
    svg.setAttribute('height', `${viewport.clientHeight}`);
  }

  const label = document.getElementById('graph-zoom-label');
  if (label) {
    label.textContent = `${Math.round(_graphScale * 100)}%`;
  }
}

/**
 * Render the Mermaid diagram in the graph view container,
 * capture native SVG dimensions, then auto-fit to viewport.
 */
async function _renderGraphDiagram(): Promise<void> {
  await renderMermaidDiagrams();
  // After rendering, capture the SVG's native dimensions and fit to view
  setTimeout(() => {
    const wrapper = document.getElementById('graph-svg-wrapper');
    const svg = wrapper?.querySelector('svg');
    if (!svg) {
      return;
    }
    // Capture native dimensions from the rendered SVG
    // Mermaid sets width/height attributes or we can use getBBox
    const bbox = (svg as SVGSVGElement).getBBox?.();
    if (bbox && bbox.width > 0 && bbox.height > 0) {
      _graphSvgNativeW = bbox.x + bbox.width + bbox.x; // include padding
      _graphSvgNativeH = bbox.y + bbox.height + bbox.y;
    } else {
      _graphSvgNativeW = svg.clientWidth || parseFloat(svg.getAttribute('width') || '800');
      _graphSvgNativeH = svg.clientHeight || parseFloat(svg.getAttribute('height') || '600');
    }
    log(`graph SVG native size: ${_graphSvgNativeW} x ${_graphSvgNativeH}`);
    _graphFitToView();
  }, 150);
}

// Initialize entry point
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
