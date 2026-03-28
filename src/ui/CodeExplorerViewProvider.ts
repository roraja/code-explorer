/**
 * Code Explorer — Sidebar Webview View Provider
 *
 * Manages the webview panel in the sidebar activity bar.
 * Serves the HTML/CSS/JS for the webview and handles
 * bidirectional message passing with the webview.
 */
import * as vscode from 'vscode';
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '../models/types';

export class CodeExplorerViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codeExplorer.sidebar';

  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  /**
   * Called by VS Code when the webview view is first made visible.
   */
  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => {
      this._handleMessage(message);
    });

    // Clean up on dispose
    webviewView.onDidDispose(() => {
      this._view = undefined;
    });
  }

  /**
   * Post a message to the webview.
   */
  public postMessage(message: ExtensionToWebviewMessage): void {
    this._view?.webview.postMessage(message);
  }

  /**
   * Handle messages received from the webview.
   */
  private _handleMessage(message: WebviewToExtensionMessage): void {
    switch (message.type) {
      case 'ready':
        console.log('[Code Explorer] Webview ready');
        break;
      case 'navigateToSource':
        this._navigateToSource(message.filePath, message.line, message.character);
        break;
      case 'tabClicked':
      case 'tabClosed':
      case 'refreshRequested':
      case 'retryAnalysis':
        // TODO (Sprint 1): Wire up to orchestrator
        console.log('[Code Explorer] Webview message:', message.type);
        break;
    }
  }

  /**
   * Navigate the editor to a specific file and position.
   */
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
      const position = new vscode.Position(line, character);
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
      console.error('[Code Explorer] Failed to navigate:', err);
    }
  }

  /**
   * Generate the HTML content for the webview, including CSP,
   * bundled JS and CSS references.
   */
  private _getHtmlForWebview(webview: vscode.Webview): string {
    // URIs for the bundled webview assets
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'webview', 'dist', 'main.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'webview', 'dist', 'main.css')
    );

    // Use a nonce for Content Security Policy
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

/**
 * Generate a random nonce string for CSP.
 */
function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
