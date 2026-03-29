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
} from '../models/types';
import type { AnalysisOrchestrator } from '../analysis/AnalysisOrchestrator';
import type { CacheStore } from '../cache/CacheStore';
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

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _orchestrator: AnalysisOrchestrator | null,
    cacheStore?: CacheStore | null,
    workspaceRoot?: string
  ) {
    this._cacheStore = cacheStore ?? null;
    this._sessionStore = workspaceRoot ? new TabSessionStore(workspaceRoot) : null;
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
   */
  public async openTab(symbol: SymbolInfo): Promise<void> {
    logger.info(`ViewProvider.openTab: ${symbol.kind} "${symbol.name}" in ${symbol.filePath}`);

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
        logger.info(`ViewProvider.openTab: focusing existing ready tab ${existing.id}`);
        this._pushState();
        return;
      }

      // If loading, just focus
      if (existing.status === 'loading') {
        this._activeTabId = existing.id;
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

    this._sessionStore.save(readyTabs, activeId);
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

      logger.info(
        `ViewProvider._restoreTabsAsync: restored ${restoredCount} tabs, ` +
          `active=${this._activeTabId}`
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

      case 'tabClicked':
        logger.debug(`ViewProvider: tabClicked ${message.tabId}`);
        this._activeTabId = message.tabId;
        this._pushState();
        break;

      case 'tabClosed': {
        logger.debug(`ViewProvider: tabClosed ${message.tabId}`);
        this._tabs = this._tabs.filter((t) => t.id !== message.tabId);
        if (this._activeTabId === message.tabId) {
          this._activeTabId = this._tabs.length > 0 ? this._tabs[this._tabs.length - 1].id : null;
        }
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

      case 'enhanceAnalysis': {
        logger.info(
          `ViewProvider: enhanceAnalysis for tab ${message.tabId} — prompt: "${message.userPrompt.substring(0, 80)}"`
        );
        this._handleEnhanceAnalysis(message.tabId, message.userPrompt);
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

    // Set tab to loading state (keep existing analysis visible, just show enhancing indicator)
    tab.status = 'loading';
    tab.loadingStage = 'llm-analyzing';
    this._pushState();

    try {
      const updatedResult = await this._orchestrator.enhanceAnalysis(tab.analysis, userPrompt);
      tab.analysis = updatedResult;
      tab.status = 'ready';
      delete tab.loadingStage;
      logger.info(`ViewProvider._handleEnhanceAnalysis: enhance complete for tab ${tabId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      tab.status = 'ready'; // Keep showing the existing analysis even on error
      delete tab.loadingStage;
      logger.error(`ViewProvider._handleEnhanceAnalysis: failed: ${message}`);
    }

    this._pushState();
  }

  private async _exploreSymbolByName(
    symbolName: string,
    filePath?: string,
    line?: number,
    kind?: string
  ): Promise<void> {
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        return;
      }

      // If we have a file path and line, resolve the symbol at that location
      if (filePath && line) {
        const uri = vscode.Uri.file(`${workspaceRoot}/${filePath}`);
        try {
          const doc = await vscode.workspace.openTextDocument(uri);
          const position = new vscode.Position(Math.max(0, line - 1), 0);

          // Try to find the symbol in the document's symbols
          const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            'vscode.executeDocumentSymbolProvider',
            doc.uri
          );

          const found = this._findSymbolInTree(symbols || [], symbolName);
          if (found) {
            const symbolInfo: SymbolInfo = {
              name: found.name,
              kind: (kind as SymbolInfo['kind']) || this._vscodeKindToString(found.kind),
              filePath,
              position: { line: found.range.start.line, character: found.range.start.character },
              range: {
                start: { line: found.range.start.line, character: found.range.start.character },
                end: { line: found.range.end.line, character: found.range.end.character },
              },
            };
            this.openTab(symbolInfo);
            return;
          }

          // Fallback: use the line position
          const symbolInfo: SymbolInfo = {
            name: symbolName,
            kind: (kind as SymbolInfo['kind']) || 'function',
            filePath,
            position: { line: position.line, character: 0 },
          };
          this.openTab(symbolInfo);
        } catch (err) {
          logger.warn(`ViewProvider._exploreSymbolByName: failed to open ${filePath}: ${err}`);
        }
      } else {
        // No file path — use workspace symbol search
        const wsSymbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
          'vscode.executeWorkspaceSymbolProvider',
          symbolName
        );

        if (wsSymbols && wsSymbols.length > 0) {
          const match = wsSymbols.find((s) => s.name === symbolName) || wsSymbols[0];
          const relPath = vscode.workspace.asRelativePath(match.location.uri);
          const symbolInfo: SymbolInfo = {
            name: match.name,
            kind: this._vscodeKindToString(match.kind),
            filePath: relPath,
            position: {
              line: match.location.range.start.line,
              character: match.location.range.start.character,
            },
          };
          this.openTab(symbolInfo);
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

  private _findSymbolInTree(
    symbols: vscode.DocumentSymbol[],
    name: string
  ): vscode.DocumentSymbol | undefined {
    for (const sym of symbols) {
      if (sym.name === name) {
        return sym;
      }
      const child = this._findSymbolInTree(sym.children || [], name);
      if (child) {
        return child;
      }
    }
    return undefined;
  }

  private _vscodeKindToString(kind: vscode.SymbolKind): SymbolInfo['kind'] {
    const map: Record<number, SymbolInfo['kind']> = {
      [vscode.SymbolKind.Class]: 'class',
      [vscode.SymbolKind.Function]: 'function',
      [vscode.SymbolKind.Method]: 'method',
      [vscode.SymbolKind.Variable]: 'variable',
      [vscode.SymbolKind.Interface]: 'interface',
      [vscode.SymbolKind.Enum]: 'enum',
      [vscode.SymbolKind.Property]: 'property',
    };
    return map[kind] || 'unknown';
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
