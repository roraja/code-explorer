/**
 * Code Explorer — Sidebar Webview View Provider
 *
 * Manages the webview panel in the sidebar activity bar.
 * Serves the HTML/CSS/JS for the webview, handles bidirectional
 * message passing, and triggers analysis via the orchestrator.
 */
import * as vscode from 'vscode';
import type {
  SymbolInfo,
  TabState,
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage,
} from '../models/types';
import type { AnalysisOrchestrator } from '../analysis/AnalysisOrchestrator';
import { logger } from '../utils/logger';

export class CodeExplorerViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codeExplorer.sidebar';

  private _view?: vscode.WebviewView;
  private _tabs: Map<string, TabState> = new Map();
  private _activeTabId: string | null = null;
  private _tabCounter = 0;
  private _webviewReady = false;
  private _pendingMessages: ExtensionToWebviewMessage[] = [];

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _orchestrator: AnalysisOrchestrator | null
  ) {}

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

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => {
      this._handleMessage(message);
    });

    webviewView.onDidDispose(() => {
      logger.info('ViewProvider: webview disposed');
      this._view = undefined;
      this._webviewReady = false;
    });
  }

  /**
   * Open a tab for a symbol and trigger analysis.
   */
  public async openTab(symbol: SymbolInfo): Promise<void> {
    // Check if a tab already exists for this symbol
    for (const [id, tab] of this._tabs) {
      if (tab.symbol.name === symbol.name && tab.symbol.filePath === symbol.filePath) {
        this._activeTabId = id;
        this._postMessage({ type: 'focusTab', tabId: id });
        logger.info(`Focused existing tab for ${symbol.kind} ${symbol.name}`);
        return;
      }
    }

    // Create new tab
    const tabId = `tab-${++this._tabCounter}`;
    const tab: TabState = {
      id: tabId,
      symbol,
      status: 'loading',
      analysis: null,
    };

    this._tabs.set(tabId, tab);
    this._activeTabId = tabId;

    this._postMessage({ type: 'openTab', tab });
    logger.info(`Opened tab ${tabId} for ${symbol.kind} ${symbol.name}`);

    // Trigger analysis
    if (this._orchestrator) {
      try {
        const result = await this._orchestrator.analyzeSymbol(symbol);
        tab.status = 'ready';
        tab.analysis = result;
        this._postMessage({ type: 'analysisResult', tabId, result });
        logger.info(`Posted analysisResult to webview for ${symbol.name}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        tab.status = 'error';
        tab.error = message;
        this._postMessage({ type: 'analysisError', tabId, error: message });
        logger.error(`Analysis failed for ${symbol.name}: ${message}`);
      }
    }
  }

  public postMessage(message: ExtensionToWebviewMessage): void {
    this._postMessage(message);
  }

  /**
   * Post a message to the webview.
   * If the webview is not yet ready, queue the message and flush
   * once the 'ready' signal arrives.
   */
  private _postMessage(message: ExtensionToWebviewMessage): void {
    if (!this._view) {
      logger.debug(`No webview view — queueing message: ${message.type}`);
      this._pendingMessages.push(message);
      return;
    }

    if (!this._webviewReady) {
      logger.debug(`Webview not ready — queueing message: ${message.type}`);
      this._pendingMessages.push(message);
      return;
    }

    this._view.webview.postMessage(message);
  }

  /**
   * Flush all pending messages to the webview.
   */
  private _flushPendingMessages(): void {
    if (!this._view || this._pendingMessages.length === 0) {
      return;
    }

    logger.debug(`Flushing ${this._pendingMessages.length} pending messages to webview`);
    for (const msg of this._pendingMessages) {
      this._view.webview.postMessage(msg);
    }
    this._pendingMessages = [];
  }

  private _handleMessage(message: WebviewToExtensionMessage): void {
    switch (message.type) {
      case 'ready':
        logger.info('Webview ready — flushing pending messages');
        this._webviewReady = true;
        this._flushPendingMessages();
        break;
      case 'tabClicked':
        logger.debug(`ViewProvider: tabClicked ${message.tabId}`);
        this._activeTabId = message.tabId;
        this._postMessage({ type: 'focusTab', tabId: message.tabId });
        break;
      case 'tabClosed':
        logger.debug(`ViewProvider: tabClosed ${message.tabId}`);
        this._tabs.delete(message.tabId);
        if (this._activeTabId === message.tabId) {
          const remaining = [...this._tabs.keys()];
          this._activeTabId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
        }
        this._postMessage({ type: 'closeTab', tabId: message.tabId });
        break;
      case 'navigateToSource':
        logger.debug(
          `ViewProvider: navigateToSource ${message.filePath}:${message.line}:${message.character}`
        );
        this._navigateToSource(message.filePath, message.line, message.character);
        break;
      case 'refreshRequested': {
        const tab = this._tabs.get(message.tabId);
        if (tab && this._orchestrator) {
          logger.info(`Refreshing analysis for ${tab.symbol.name}`);
          // Delete the old tab so openTab creates a fresh one
          this._tabs.delete(message.tabId);
          this.openTab(tab.symbol);
        }
        break;
      }
      case 'retryAnalysis': {
        const retryTab = this._tabs.get(message.tabId);
        if (retryTab) {
          this._tabs.delete(message.tabId);
          this.openTab(retryTab.symbol);
        }
        break;
      }
    }
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
      // line from webview is 1-based, VS Code is 0-based
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
    } catch (err) {
      logger.error(`Failed to navigate: ${err}`);
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
                 style-src ${webview.cspSource} 'nonce-${nonce}';
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
