/**
 * Code Explorer — Webview Entry Point
 *
 * Initializes the sidebar webview application.
 * Handles message passing with the extension host.
 */

import './styles/main.css';

// Acquire the VS Code API handle (can only be called once)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vscode = (window as any).acquireVsCodeApi?.() ?? {
  postMessage: (_msg: unknown) => {
    console.warn('[Webview] VS Code API not available');
  },
  getState: () => null,
  setState: (_state: unknown) => {},
};

/**
 * Initialize the webview application.
 */
function init(): void {
  const root = document.getElementById('root');
  if (!root) {
    return;
  }

  // Render empty state
  root.innerHTML = `
    <div class="empty-state">
      <div class="empty-state__icon">$(search)</div>
      <h2 class="empty-state__title">Code Explorer</h2>
      <p class="empty-state__description">
        Click on a symbol in your code or use
        <kbd>Ctrl+Shift+E</kbd> to explore it here.
      </p>
    </div>
  `;

  // Listen for messages from the extension
  window.addEventListener('message', (event) => {
    const message = event.data;
    console.log('[Webview] Received message:', message.type);

    // TODO (Sprint 1): Handle messages (openTab, closeTab, analysisResult, etc.)
  });

  // Notify the extension that the webview is ready
  vscode.postMessage({ type: 'ready' });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
