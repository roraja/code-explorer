/**
 * Code Explorer — Sidebar Webview View Provider
 *
 * The extension side is the single source of truth for all tab state.
 * On every mutation (tab open, close, analysis result, error) the full
 * state snapshot is pushed to the webview via a single `setState` message.
 * The webview is a pure renderer — it never owns state.
 */
import * as vscode from 'vscode';
import type {
  SymbolInfo,
  CursorContext,
  TabState,
  WebviewToExtensionMessage,
  NavigationEntry,
  NavigationTrigger,
  PinnedInvestigation,
  NavigationHistoryState,
} from '../models/types';
import type { AnalysisOrchestrator } from '../analysis/AnalysisOrchestrator';
import type { CacheStore } from '../cache/CacheStore';
import type { GraphBuilder } from '../graph/GraphBuilder';
import { logger } from '../utils/logger';
import { TabSessionStore } from './TabSessionStore';
import type { PersistedTab } from './TabSessionStore';

export class CodeExplorerViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codeExplorer.sidebar';

  private _view?: vscode.WebviewView;
  private _tabs: TabState[] = [];
  private _activeTabId: string | null = null;
  private _tabCounter = 0;
  private _webviewReady = false;
  private readonly _sessionStore: TabSessionStore | null;
  private readonly _cacheStore: CacheStore | null;
  private _sessionRestored = false;

  /** Navigation history entries — records every navigation step */
  private _navigationHistory: NavigationEntry[] = [];
  /** Current position in the history stack (index into _navigationHistory). -1 means empty. */
  private _navigationIndex = -1;
  /** Whether the current navigation is a history back/forward (skip pushing to history) */
  private _isHistoryNavigation = false;
  /** Pinned investigations saved by the user */
  private _pinnedInvestigations: PinnedInvestigation[] = [];
  /** Counter for generating unique pinned investigation IDs */
  private _investigationCounter = 0;
  /** Graph builder instance for generating dependency graphs */
  private _graphBuilder: GraphBuilder | null = null;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _orchestrator: AnalysisOrchestrator | null,
    cacheStore?: CacheStore | null,
    workspaceRoot?: string
  ) {
    this._cacheStore = cacheStore ?? null;
    this._sessionStore = workspaceRoot ? new TabSessionStore(workspaceRoot) : null;
  }

  /**
   * Set the graph builder instance for generating dependency graphs.
   * Called by extension.ts after construction.
   */
  public setGraphBuilder(graphBuilder: GraphBuilder): void {
    this._graphBuilder = graphBuilder;
  }

  /**
   * Push a dependency graph to the webview for rendering.
   * Called by the "Show Dependency Graph" command.
   */
  public showDependencyGraph(
    mermaidSource: string,
    nodeCount: number,
    edgeCount: number
  ): void {
    if (!this._view || !this._webviewReady) {
      logger.warn('ViewProvider.showDependencyGraph: webview not ready');
      return;
    }
    logger.info(
      `ViewProvider.showDependencyGraph: sending graph with ${nodeCount} nodes, ${edgeCount} edges`
    );
    this._view.webview.postMessage({
      type: 'showDependencyGraph',
      mermaidSource,
      nodeCount,
      edgeCount,
    });
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    logger.info('ViewProvider.resolveWebviewView: initializing webview');
    this._view = webviewView;
    this._webviewReady = false;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.onDidChangeVisibility(() => {
      logger.debug(`ViewProvider: visibility changed → ${webviewView.visible}`);
    });

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => {
      this._handleMessage(message);
    });

    webviewView.onDidDispose(() => {
      logger.info('ViewProvider: webview disposed');
      this._view = undefined;
      this._webviewReady = false;
    });

    // Restore previously saved tab session (only on first resolve)
    if (!this._sessionRestored) {
      this._sessionRestored = true;
      this._restoreSession();
    }
  }

  /**
   * Open a tab for a symbol and trigger analysis.
   * @param trigger — what caused this tab to open (for breadcrumb trail)
   */
  public async openTab(
    symbol: SymbolInfo,
    trigger: NavigationTrigger = 'explore-command'
  ): Promise<void> {
    logger.info(`ViewProvider.openTab: ${symbol.kind} "${symbol.name}" in ${symbol.filePath}`);

    // Track which tab we're navigating from (for history)
    const previousTabId = this._activeTabId;

    // Find existing tab for this symbol using scope chain for unique identity.
    // Scope chain distinguishes local variables with the same name in different functions.
    const existingIdx = this._tabs.findIndex((t) => {
      if (t.symbol.filePath !== symbol.filePath || t.symbol.name !== symbol.name) {
        return false;
      }
      const a = t.symbol.scopeChain ?? [];
      const b = symbol.scopeChain ?? [];
      if (a.length !== b.length) {
        return false;
      }
      return a.every((v, i) => v === b[i]);
    });

    if (existingIdx >= 0) {
      const existing = this._tabs[existingIdx];

      // If already has results, just focus it
      if (existing.status === 'ready' && existing.analysis) {
        this._activeTabId = existing.id;
        this._recordNavigation(previousTabId, existing.id, trigger, symbol.name, symbol.kind);
        logger.info(`ViewProvider.openTab: focusing existing ready tab ${existing.id}`);
        this._pushState();
        return;
      }

      // If loading, just focus
      if (existing.status === 'loading') {
        this._activeTabId = existing.id;
        this._recordNavigation(previousTabId, existing.id, trigger, symbol.name, symbol.kind);
        logger.info(`ViewProvider.openTab: focusing existing loading tab ${existing.id}`);
        this._pushState();
        return;
      }

      // If error/stale, remove it — will create fresh below
      logger.info(`ViewProvider.openTab: removing ${existing.status} tab ${existing.id}`);
      this._tabs.splice(existingIdx, 1);
    }

    // Create new tab in loading state
    const tabId = `tab-${++this._tabCounter}`;
    const tab: TabState = {
      id: tabId,
      symbol,
      status: 'loading',
      analysis: null,
      loadingStage: 'cache-check',
    };

    this._tabs.push(tab);
    this._activeTabId = tabId;
    this._recordNavigation(previousTabId, tabId, trigger, symbol.name, symbol.kind);
    this._pushState();
    logger.info(`ViewProvider.openTab: created tab ${tabId}, triggering analysis`);

    // Trigger analysis
    if (!this._orchestrator) {
      logger.warn('ViewProvider.openTab: no orchestrator');
      return;
    }

    try {
      const result = await this._orchestrator.analyzeSymbol(symbol, false, (stage) => {
        const t = this._tabs.find((x) => x.id === tabId);
        if (t && t.status === 'loading') {
          t.loadingStage = stage;
          this._pushState();
        }
      });

      // Update the tab in place (it might still be in our array)
      const t = this._tabs.find((x) => x.id === tabId);
      if (t) {
        t.status = 'ready';
        t.analysis = result;
        delete t.loadingStage;
        logger.info(`ViewProvider.openTab: analysis ready for tab ${tabId}`);
      } else {
        logger.warn(`ViewProvider.openTab: tab ${tabId} was removed during analysis`);
      }
      this._pushState();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const t = this._tabs.find((x) => x.id === tabId);
      if (t) {
        t.status = 'error';
        t.error = message;
      }
      this._pushState();
      logger.error(`ViewProvider.openTab: analysis failed for ${symbol.name}: ${message}`);
    }
  }

  /**
   * Open a tab from a CursorContext — the LLM resolves the symbol kind
   * and performs analysis in a single call (no VS Code symbol resolution).
   *
   * This is the primary entry point for the "Explore Symbol" command.
   * The tab is created with a temporary SymbolInfo using kind='unknown',
   * then updated with the resolved kind once the LLM responds.
   */
  public async openTabFromCursor(cursor: CursorContext): Promise<void> {
    logger.info(
      `ViewProvider.openTabFromCursor: "${cursor.word}" in ${cursor.filePath}:${cursor.position.line}`
    );

    // Track which tab we're navigating from (for history)
    const previousTabId = this._activeTabId;

    // Create a temporary tab while the LLM resolves and analyzes
    const tabId = `tab-${++this._tabCounter}`;
    const tempSymbol: SymbolInfo = {
      name: cursor.word,
      kind: 'unknown',
      filePath: cursor.filePath,
      position: cursor.position,
    };

    const tab: TabState = {
      id: tabId,
      symbol: tempSymbol,
      status: 'loading',
      analysis: null,
      loadingStage: 'resolving-symbol',
    };

    this._tabs.push(tab);
    this._activeTabId = tabId;
    this._recordNavigation(previousTabId, tabId, 'explore-command', cursor.word, 'unknown');
    this._pushState();
    logger.info(
      `ViewProvider.openTabFromCursor: created tab ${tabId}, triggering unified analysis`
    );

    if (!this._orchestrator) {
      logger.warn('ViewProvider.openTabFromCursor: no orchestrator');
      return;
    }

    try {
      const { symbol: resolvedSymbol, result } = await this._orchestrator.analyzeFromCursor(
        cursor,
        (stage) => {
          const t = this._tabs.find((x) => x.id === tabId);
          if (t && t.status === 'loading') {
            t.loadingStage = stage;
            this._pushState();
          }
        }
      );

      // Update tab with the resolved symbol and analysis result
      const t = this._tabs.find((x) => x.id === tabId);
      if (t) {
        t.symbol = resolvedSymbol;
        t.status = 'ready';
        t.analysis = result;
        delete t.loadingStage;
        logger.info(
          `ViewProvider.openTabFromCursor: analysis ready for tab ${tabId} — ` +
            `resolved as ${resolvedSymbol.kind} "${resolvedSymbol.name}"`
        );
      } else {
        logger.warn(`ViewProvider.openTabFromCursor: tab ${tabId} was removed during analysis`);
      }
      this._pushState();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const t = this._tabs.find((x) => x.id === tabId);
      if (t) {
        t.status = 'error';
        t.error = message;
      }
      this._pushState();
      logger.error(
        `ViewProvider.openTabFromCursor: analysis failed for "${cursor.word}": ${message}`
      );
    }
  }

  /**
   * Push the full state to the webview. This is the ONLY way
   * state reaches the webview — no incremental messages.
   *
   * Also persists the current tab session to disk so it can
   * be restored on window reload.
   */
  private _pushState(): void {
    const msg = {
      type: 'setState' as const,
      tabs: this._tabs,
      activeTabId: this._activeTabId,
      navigationHistory: this._getNavigationHistoryState(),
    };

    // Persist tab session on every state change
    this._persistSession();

    if (!this._view || !this._webviewReady) {
      logger.debug(
        `ViewProvider._pushState: deferred (view=${!!this._view} ready=${this._webviewReady}) ` +
          `tabs=${this._tabs.length} active=${this._activeTabId}`
      );
      return;
    }

    logger.debug(
      `ViewProvider._pushState: sending ${this._tabs.length} tabs, active=${this._activeTabId}`
    );
    this._view.webview.postMessage(msg);
  }

  /**
   * Persist current tab state to disk for session restore.
   * Only persists "ready" tabs that have analysis results —
   * loading/error tabs are transient.
   */
  private _persistSession(): void {
    if (!this._sessionStore) {
      return;
    }

    const readyTabs: PersistedTab[] = this._tabs
      .filter((t) => t.status === 'ready' && t.analysis)
      .map((t) => ({
        id: t.id,
        symbol: t.symbol,
      }));

    if (readyTabs.length === 0) {
      this._sessionStore.clear();
      return;
    }

    // Ensure activeTabId points to a persisted tab; otherwise pick the last one
    const activeId =
      this._activeTabId && readyTabs.some((t) => t.id === this._activeTabId)
        ? this._activeTabId
        : readyTabs[readyTabs.length - 1].id;

    this._sessionStore.save(
      readyTabs,
      activeId,
      this._navigationHistory,
      this._navigationIndex,
      this._pinnedInvestigations
    );
  }

  /**
   * Restore tabs from a previously saved session file.
   * For each persisted tab, reads the cached analysis from the CacheStore.
   * Tabs whose cache has been cleared are silently skipped.
   */
  private _restoreSession(): void {
    if (!this._sessionStore || !this._cacheStore) {
      logger.debug('ViewProvider._restoreSession: no session store or cache store, skipping');
      return;
    }

    const session = this._sessionStore.load();
    if (!session || session.tabs.length === 0) {
      logger.debug('ViewProvider._restoreSession: no saved session or empty tabs');
      return;
    }

    logger.info(
      `ViewProvider._restoreSession: restoring ${session.tabs.length} tabs from session`
    );

    // Restore tabs asynchronously — read cache for each persisted tab
    this._restoreTabsAsync(session).catch((err) => {
      logger.warn(`ViewProvider._restoreSession: failed: ${err}`);
    });
  }

  /**
   * Asynchronously restore tabs by reading their cached analysis.
   * Tabs are restored in order. Tabs without cached data are skipped.
   */
  private async _restoreTabsAsync(
    session: import('./TabSessionStore').TabSession
  ): Promise<void> {
    if (!this._cacheStore) {
      return;
    }

    let restoredCount = 0;
    const idMap = new Map<string, string>(); // old ID → new ID

    for (const persistedTab of session.tabs) {
      try {
        const result = await this._cacheStore.read(persistedTab.symbol);
        if (!result) {
          logger.debug(
            `ViewProvider._restoreTabsAsync: cache miss for "${persistedTab.symbol.name}", skipping`
          );
          continue;
        }

        const newId = `tab-${++this._tabCounter}`;
        idMap.set(persistedTab.id, newId);

        const tab: TabState = {
          id: newId,
          symbol: persistedTab.symbol,
          status: 'ready',
          analysis: result,
        };

        this._tabs.push(tab);
        restoredCount++;
      } catch (err) {
        logger.warn(
          `ViewProvider._restoreTabsAsync: failed to restore tab for ` +
            `"${persistedTab.symbol.name}": ${err}`
        );
      }
    }

    if (restoredCount > 0) {
      // Restore active tab ID (mapped to new ID), or default to last tab
      const mappedActiveId = session.activeTabId
        ? idMap.get(session.activeTabId) ?? null
        : null;
      this._activeTabId =
        mappedActiveId ?? (this._tabs.length > 0 ? this._tabs[this._tabs.length - 1].id : null);

      // Restore navigation history with mapped tab IDs
      if (session.navigationHistory && session.navigationHistory.length > 0) {
        this._navigationHistory = session.navigationHistory
          .map((entry) => ({
            ...entry,
            fromTabId: entry.fromTabId ? idMap.get(entry.fromTabId) ?? entry.fromTabId : null,
            toTabId: idMap.get(entry.toTabId) ?? entry.toTabId,
          }))
          // Only keep entries where the toTabId maps to a restored tab
          .filter((entry) => this._tabs.some((t) => t.id === entry.toTabId));

        this._navigationIndex = Math.min(
          session.navigationIndex ?? this._navigationHistory.length - 1,
          this._navigationHistory.length - 1
        );
      }

      // Restore pinned investigations with mapped tab IDs
      if (session.pinnedInvestigations && session.pinnedInvestigations.length > 0) {
        this._pinnedInvestigations = session.pinnedInvestigations.map((inv) => ({
          ...inv,
          trail: inv.trail.map((tabId) => idMap.get(tabId) ?? tabId),
          trailSymbols: inv.trailSymbols.map((ts) => ({
            ...ts,
            tabId: idMap.get(ts.tabId) ?? ts.tabId,
          })),
        }));
        // Update investigation counter to avoid ID conflicts
        this._investigationCounter = this._pinnedInvestigations.length;
      }

      logger.info(
        `ViewProvider._restoreTabsAsync: restored ${restoredCount} tabs, ` +
          `active=${this._activeTabId}, ` +
          `history=${this._navigationHistory.length} entries, ` +
          `investigations=${this._pinnedInvestigations.length}`
      );
      this._pushState();
    } else {
      logger.info('ViewProvider._restoreTabsAsync: no tabs could be restored (all cache misses)');
      this._sessionStore?.clear();
    }
  }

  private _handleMessage(message: WebviewToExtensionMessage): void {
    switch (message.type) {
      case 'ready':
        logger.info('ViewProvider: webview ready');
        this._webviewReady = true;
        // Push current state so webview renders whatever we have
        this._pushState();
        break;

      case 'tabClicked': {
        logger.debug(`ViewProvider: tabClicked ${message.tabId}`);
        const clickedTab = this._tabs.find((t) => t.id === message.tabId);
        if (clickedTab && message.tabId !== this._activeTabId) {
          const prevTabId = this._activeTabId;
          this._activeTabId = message.tabId;
          this._recordNavigation(
            prevTabId,
            message.tabId,
            'tab-click',
            clickedTab.symbol.name,
            clickedTab.symbol.kind
          );
        } else {
          this._activeTabId = message.tabId;
        }
        this._pushState();
        break;
      }

      case 'tabClosed': {
        logger.debug(`ViewProvider: tabClosed ${message.tabId}`);
        this._tabs = this._tabs.filter((t) => t.id !== message.tabId);
        if (this._activeTabId === message.tabId) {
          this._activeTabId = this._tabs.length > 0 ? this._tabs[this._tabs.length - 1].id : null;
        }
        // Clean up navigation history references to the closed tab
        this._cleanupNavigationHistory(message.tabId);
        this._pushState();
        break;
      }

      case 'navigateToSource':
        logger.debug(
          `ViewProvider: navigateToSource ${message.filePath}:${message.line}:${message.character}`
        );
        this._navigateToSource(message.filePath, message.line, message.character);
        break;

      case 'refreshRequested': {
        const tab = this._tabs.find((t) => t.id === message.tabId);
        if (tab && this._orchestrator) {
          logger.info(`ViewProvider: refresh for ${tab.symbol.name}`);
          // Remove old tab and re-analyze
          this._tabs = this._tabs.filter((t) => t.id !== message.tabId);
          this.openTab(tab.symbol);
        }
        break;
      }

      case 'retryAnalysis': {
        const tab = this._tabs.find((t) => t.id === message.tabId);
        if (tab) {
          logger.info(`ViewProvider: retry for ${tab.symbol.name}`);
          this._tabs = this._tabs.filter((t) => t.id !== message.tabId);
          this.openTab(tab.symbol);
        }
        break;
      }

      case 'exploreSymbol': {
        logger.info(
          `ViewProvider: exploreSymbol "${message.symbolName}" in ${message.filePath || 'unknown'}`
        );
        this._exploreSymbolByName(message.symbolName, message.filePath, message.line, message.kind);
        break;
      }

      case 'navigateToSymbol': {
        logger.info(
          `ViewProvider: navigateToSymbol "${message.symbolName}"`
        );
        this._navigateToSymbolByName(message.symbolName);
        break;
      }

      case 'enhanceAnalysis': {
        logger.info(
          `ViewProvider: enhanceAnalysis for tab ${message.tabId} — prompt: "${message.userPrompt.substring(0, 80)}"`
        );
        this._handleEnhanceAnalysis(message.tabId, message.userPrompt);
        break;
      }

      case 'historyBack': {
        logger.debug('ViewProvider: historyBack');
        this._navigateHistoryBack();
        break;
      }

      case 'historyForward': {
        logger.debug('ViewProvider: historyForward');
        this._navigateHistoryForward();
        break;
      }

      case 'pinInvestigation': {
        logger.info(`ViewProvider: pinInvestigation "${message.name}"`);
        this._pinCurrentInvestigation(message.name);
        break;
      }

      case 'unpinInvestigation': {
        logger.info(`ViewProvider: unpinInvestigation ${message.investigationId}`);
        this._unpinInvestigation(message.investigationId);
        break;
      }

      case 'restoreInvestigation': {
        logger.info(`ViewProvider: restoreInvestigation ${message.investigationId}`);
        this._restoreInvestigation(message.investigationId);
        break;
      }

      case 'requestDependencyGraph': {
        logger.info('ViewProvider: requestDependencyGraph');
        this._handleRequestDependencyGraph();
        break;
      }

      case 'requestSymbolGraph': {
        logger.info(
          `ViewProvider: requestSymbolGraph "${message.symbolName}" in ${message.filePath}`
        );
        this._handleRequestSymbolGraph(message.symbolName, message.filePath);
        break;
      }

      case 'closeDependencyGraph': {
        logger.debug('ViewProvider: closeDependencyGraph');
        // The webview handles its own close — no action needed on extension side
        break;
      }
    }
  }

  private async _handleEnhanceAnalysis(tabId: string, userPrompt: string): Promise<void> {
    const tab = this._tabs.find((t) => t.id === tabId);
    if (!tab || !tab.analysis || !this._orchestrator) {
      logger.warn(`ViewProvider._handleEnhanceAnalysis: tab ${tabId} not found or no analysis`);
      return;
    }

    // Mark tab as enhancing — keeps status 'ready' so existing content stays visible,
    // and the webview shows a loading indicator only on the Enhance button.
    tab.enhancing = true;
    this._pushState();

    try {
      const updatedResult = await this._orchestrator.enhanceAnalysis(tab.analysis, userPrompt);
      tab.analysis = updatedResult;
      tab.enhancing = false;
      logger.info(`ViewProvider._handleEnhanceAnalysis: enhance complete for tab ${tabId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      tab.enhancing = false;
      logger.error(`ViewProvider._handleEnhanceAnalysis: failed: ${message}`);
    }

    this._pushState();
  }

  private async _exploreSymbolByName(
    symbolName: string,
    filePath?: string,
    line?: number,
    _kind?: string
  ): Promise<void> {
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        return;
      }

      // If we have a file path, build a CursorContext and use the cursor-based
      // flow. This ensures cache lookup goes through findByCursorWithLLMFallback()
      // (directory scan + name matching) instead of exact-path cache.read()
      // which misses when the SymbolInfo lacks scopeChain / has wrong kind.
      if (filePath) {
        const uri = vscode.Uri.file(`${workspaceRoot}/${filePath}`);
        try {
          const doc = await vscode.workspace.openTextDocument(uri);
          const targetLine = Math.max(0, (line || 1) - 1);
          const cursorContext = this._buildCursorContext(doc, symbolName, filePath, targetLine);
          this.openTabFromCursor(cursorContext);
        } catch (err) {
          logger.warn(`ViewProvider._exploreSymbolByName: failed to open ${filePath}: ${err}`);
        }
      } else {
        // No file path — use workspace symbol search to find the file first,
        // then use the cursor-based flow.
        const wsSymbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
          'vscode.executeWorkspaceSymbolProvider',
          symbolName
        );

        if (wsSymbols && wsSymbols.length > 0) {
          const match = wsSymbols.find((s) => s.name === symbolName) || wsSymbols[0];
          const relPath = vscode.workspace.asRelativePath(match.location.uri);
          try {
            const doc = await vscode.workspace.openTextDocument(match.location.uri);
            const targetLine = match.location.range.start.line;
            const cursorContext = this._buildCursorContext(doc, symbolName, relPath, targetLine);
            this.openTabFromCursor(cursorContext);
          } catch (err) {
            logger.warn(
              `ViewProvider._exploreSymbolByName: failed to open resolved file ${relPath}: ${err}`
            );
          }
        } else {
          logger.warn(
            `ViewProvider._exploreSymbolByName: symbol "${symbolName}" not found in workspace`
          );
        }
      }
    } catch (err) {
      logger.error(`ViewProvider._exploreSymbolByName: ${err}`);
    }
  }

  /**
   * Build a CursorContext from a document, symbol name, and target line.
   * Gathers ±50 lines of surrounding source for the LLM prompt context.
   */
  private _buildCursorContext(
    doc: vscode.TextDocument,
    word: string,
    relPath: string,
    targetLine: number
  ): CursorContext {
    const startLine = Math.max(0, targetLine - 50);
    const endLine = Math.min(doc.lineCount - 1, targetLine + 50);
    const surroundingRange = new vscode.Range(
      startLine,
      0,
      endLine,
      doc.lineAt(endLine).text.length
    );
    const surroundingSource = doc.getText(surroundingRange);
    const cursorLine =
      targetLine < doc.lineCount ? doc.lineAt(targetLine).text : '';

    return {
      word,
      filePath: relPath,
      position: { line: targetLine, character: 0 },
      surroundingSource,
      cursorLine,
    };
  }


  private async _navigateToSource(
    filePath: string,
    line: number,
    character: number
  ): Promise<void> {
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        return;
      }
      const uri = vscode.Uri.file(`${workspaceRoot}/${filePath}`);
      const position = new vscode.Position(Math.max(0, line - 1), character);
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc, {
        selection: new vscode.Range(position, position),
        preserveFocus: false,
      });
      editor.revealRange(
        new vscode.Range(position, position),
        vscode.TextEditorRevealType.InCenter
      );
      logger.debug(`ViewProvider: navigated to ${filePath}:${line}`);
    } catch (err) {
      logger.error(`ViewProvider: failed to navigate: ${err}`);
    }
  }

  /**
   * Navigate to a symbol by name when no file path is available.
   * Uses the workspace symbol provider to locate the symbol, then
   * opens the file at the exact line — does NOT trigger LLM analysis.
   */
  private async _navigateToSymbolByName(symbolName: string): Promise<void> {
    try {
      const wsSymbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
        'vscode.executeWorkspaceSymbolProvider',
        symbolName
      );

      if (wsSymbols && wsSymbols.length > 0) {
        const match = wsSymbols.find((s) => s.name === symbolName) || wsSymbols[0];
        const relPath = vscode.workspace.asRelativePath(match.location.uri);
        const line = match.location.range.start.line + 1; // convert to 1-based
        this._navigateToSource(relPath, line, match.location.range.start.character);
      } else {
        logger.warn(
          `ViewProvider._navigateToSymbolByName: symbol "${symbolName}" not found in workspace`
        );
      }
    } catch (err) {
      logger.error(`ViewProvider._navigateToSymbolByName: ${err}`);
    }
  }

  // =====================
  // Navigation History
  // =====================

  /**
   * Record a navigation event in the history stack.
   * If we're in the middle of history (after going back), truncate forward history.
   */
  private _recordNavigation(
    fromTabId: string | null,
    toTabId: string,
    trigger: NavigationTrigger,
    symbolName: string,
    symbolKind: string
  ): void {
    // Don't record history-back/forward navigations (would create loops)
    if (this._isHistoryNavigation) {
      return;
    }

    // Don't record navigating to the same tab
    if (fromTabId === toTabId) {
      return;
    }

    const entry: NavigationEntry = {
      fromTabId,
      toTabId,
      trigger,
      timestamp: new Date().toISOString(),
      symbolName,
      symbolKind,
    };

    // If we're in the middle of the history (went back then navigated forward to new tab),
    // truncate everything after the current position
    if (this._navigationIndex < this._navigationHistory.length - 1) {
      this._navigationHistory = this._navigationHistory.slice(0, this._navigationIndex + 1);
    }

    this._navigationHistory.push(entry);
    this._navigationIndex = this._navigationHistory.length - 1;

    // Cap history at 100 entries to prevent unbounded memory growth
    if (this._navigationHistory.length > 100) {
      this._navigationHistory = this._navigationHistory.slice(-100);
      this._navigationIndex = this._navigationHistory.length - 1;
    }

    logger.debug(
      `ViewProvider._recordNavigation: ${trigger} → "${symbolName}" ` +
        `(history: ${this._navigationHistory.length} entries, index: ${this._navigationIndex})`
    );
  }

  /**
   * Navigate back in history — activate the previous tab without re-analyzing.
   */
  private _navigateHistoryBack(): void {
    if (this._navigationIndex <= 0) {
      logger.debug('ViewProvider._navigateHistoryBack: already at beginning of history');
      return;
    }

    // The current entry's fromTabId is where we came from
    const currentEntry = this._navigationHistory[this._navigationIndex];
    const targetTabId = currentEntry.fromTabId;

    if (!targetTabId) {
      logger.debug('ViewProvider._navigateHistoryBack: no previous tab');
      return;
    }

    // Check the target tab still exists
    const targetTab = this._tabs.find((t) => t.id === targetTabId);
    if (!targetTab) {
      // Tab was closed — skip this entry and try the one before
      this._navigationIndex--;
      this._navigateHistoryBack();
      return;
    }

    this._isHistoryNavigation = true;
    this._navigationIndex--;
    this._activeTabId = targetTabId;
    this._isHistoryNavigation = false;

    logger.debug(
      `ViewProvider._navigateHistoryBack: activated tab ${targetTabId} ` +
        `"${targetTab.symbol.name}" (index: ${this._navigationIndex})`
    );
    this._pushState();
  }

  /**
   * Navigate forward in history — activate the next tab without re-analyzing.
   */
  private _navigateHistoryForward(): void {
    if (this._navigationIndex >= this._navigationHistory.length - 1) {
      logger.debug('ViewProvider._navigateHistoryForward: already at end of history');
      return;
    }

    const nextEntry = this._navigationHistory[this._navigationIndex + 1];
    const targetTabId = nextEntry.toTabId;

    // Check the target tab still exists
    const targetTab = this._tabs.find((t) => t.id === targetTabId);
    if (!targetTab) {
      // Tab was closed — skip this entry and try the one after
      this._navigationIndex++;
      this._navigateHistoryForward();
      return;
    }

    this._isHistoryNavigation = true;
    this._navigationIndex++;
    this._activeTabId = targetTabId;
    this._isHistoryNavigation = false;

    logger.debug(
      `ViewProvider._navigateHistoryForward: activated tab ${targetTabId} ` +
        `"${targetTab.symbol.name}" (index: ${this._navigationIndex})`
    );
    this._pushState();
  }

  /**
   * Clean up navigation history when a tab is closed.
   * Removes entries that reference the closed tab ID.
   */
  private _cleanupNavigationHistory(closedTabId: string): void {
    // We don't remove entries entirely (that would shift indices),
    // but we mark them so back/forward can skip them.
    // The actual skipping is done in _navigateHistoryBack/Forward
    // by checking if the target tab still exists.
    logger.debug(
      `ViewProvider._cleanupNavigationHistory: tab ${closedTabId} closed, ` +
        `history has ${this._navigationHistory.length} entries`
    );
  }

  /**
   * Pin the current breadcrumb trail as a named investigation.
   */
  private _pinCurrentInvestigation(name: string): void {
    // Build the trail from the start of the current exploration chain
    const trail: string[] = [];
    const trailSymbols: PinnedInvestigation['trailSymbols'] = [];
    const seen = new Set<string>();

    // Walk the history from the beginning up to the current position
    // to extract the unique tab trail
    for (let i = 0; i <= this._navigationIndex && i < this._navigationHistory.length; i++) {
      const entry = this._navigationHistory[i];
      if (!seen.has(entry.toTabId)) {
        seen.add(entry.toTabId);
        trail.push(entry.toTabId);
        trailSymbols.push({
          tabId: entry.toTabId,
          symbolName: entry.symbolName,
          symbolKind: entry.symbolKind,
        });
      }
    }

    if (trail.length === 0) {
      logger.warn('ViewProvider._pinCurrentInvestigation: no trail to pin');
      return;
    }

    const investigation: PinnedInvestigation = {
      id: `inv-${++this._investigationCounter}`,
      name,
      trail,
      trailSymbols,
      pinnedAt: new Date().toISOString(),
    };

    this._pinnedInvestigations.push(investigation);

    logger.info(
      `ViewProvider._pinCurrentInvestigation: pinned "${name}" with ${trail.length} symbols`
    );
    this._pushState();
  }

  /**
   * Remove a pinned investigation.
   */
  private _unpinInvestigation(investigationId: string): void {
    this._pinnedInvestigations = this._pinnedInvestigations.filter(
      (inv) => inv.id !== investigationId
    );
    logger.info(`ViewProvider._unpinInvestigation: removed ${investigationId}`);
    this._pushState();
  }

  /**
   * Restore a pinned investigation — activate the first tab in the trail
   * that is still open, and navigate through the rest.
   */
  private _restoreInvestigation(investigationId: string): void {
    const investigation = this._pinnedInvestigations.find((inv) => inv.id === investigationId);
    if (!investigation) {
      logger.warn(`ViewProvider._restoreInvestigation: investigation ${investigationId} not found`);
      return;
    }

    // Find the first tab in the trail that still exists
    for (const tabId of investigation.trail) {
      const tab = this._tabs.find((t) => t.id === tabId);
      if (tab) {
        this._activeTabId = tabId;
        logger.info(
          `ViewProvider._restoreInvestigation: activated tab ${tabId} ` +
            `"${tab.symbol.name}" from investigation "${investigation.name}"`
        );
        this._pushState();
        return;
      }
    }

    logger.warn(
      `ViewProvider._restoreInvestigation: no tabs from investigation ` +
        `"${investigation.name}" are still open`
    );
  }

  /**
   * Build the navigation history state to send to the webview.
   */
  private _getNavigationHistoryState(): NavigationHistoryState {
    return {
      entries: this._navigationHistory,
      currentIndex: this._navigationIndex,
      pinnedInvestigations: this._pinnedInvestigations,
    };
  }

  /**
   * Build the breadcrumb trail for the currently active tab.
   * Walks backward through navigation history to find the chain
   * of tabs that led to the current tab.
   */
  public getBreadcrumbTrail(): NavigationEntry[] {
    if (this._navigationHistory.length === 0 || this._navigationIndex < 0) {
      return [];
    }

    // Collect the trail from the current position backward
    const trail: NavigationEntry[] = [];
    const seen = new Set<string>();

    for (let i = this._navigationIndex; i >= 0; i--) {
      const entry = this._navigationHistory[i];
      if (!seen.has(entry.toTabId)) {
        seen.add(entry.toTabId);
        trail.unshift(entry);
      }
      // Stop when we reach an entry that has no fromTabId (start of exploration)
      if (!entry.fromTabId) {
        break;
      }
    }

    return trail;
  }

  private async _handleRequestDependencyGraph(): Promise<void> {
    if (!this._graphBuilder) {
      logger.warn('ViewProvider._handleRequestDependencyGraph: no graph builder');
      return;
    }
    try {
      const graph = await this._graphBuilder.buildGraph();
      const { GraphBuilder: GB } = await import('../graph/GraphBuilder');
      const mermaidSource = GB.toMermaid(graph);
      this.showDependencyGraph(mermaidSource, graph.nodes.length, graph.edges.length);
    } catch (err) {
      logger.error(`ViewProvider._handleRequestDependencyGraph: failed: ${err}`);
    }
  }

  private async _handleRequestSymbolGraph(
    symbolName: string,
    filePath: string
  ): Promise<void> {
    if (!this._graphBuilder) {
      logger.warn('ViewProvider._handleRequestSymbolGraph: no graph builder');
      return;
    }
    try {
      const graph = await this._graphBuilder.buildSubgraph(symbolName, filePath);
      const { GraphBuilder: GB } = await import('../graph/GraphBuilder');
      const centerId = graph.nodes.find(
        (n) => n.name === symbolName && n.filePath === filePath
      )?.id;
      const mermaidSource = GB.toMermaid(graph, centerId);
      this.showDependencyGraph(mermaidSource, graph.nodes.length, graph.edges.length);
    } catch (err) {
      logger.error(`ViewProvider._handleRequestSymbolGraph: failed: ${err}`);
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'webview', 'dist', 'main.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'webview', 'dist', 'main.css')
    );

    const nonce = getNonce();

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 style-src ${webview.cspSource} 'unsafe-inline';
                 script-src 'nonce-${nonce}';
                 img-src ${webview.cspSource};
                 font-src ${webview.cspSource};">
  <link rel="stylesheet" href="${styleUri}">
  <title>Code Explorer</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
