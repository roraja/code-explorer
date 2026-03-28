/**
 * Code Explorer — Extension Entry Point
 *
 * Activates/deactivates the extension, wiring up all services
 * and registering VS Code contributions.
 */
import * as vscode from 'vscode';
import { EXTENSION_DISPLAY_NAME } from './models/constants';

/**
 * Called when the extension is activated.
 * Activation triggers are defined in package.json activationEvents.
 */
export function activate(_context: vscode.ExtensionContext): void {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    vscode.window.showWarningMessage(`${EXTENSION_DISPLAY_NAME} requires an open workspace.`);
    return;
  }

  console.log(`[${EXTENSION_DISPLAY_NAME}] Activating with workspace: ${workspaceRoot}`);

  // TODO (Sprint 1): Initialize services and register providers
  // - CacheManager, IndexManager, HashService, MarkdownSerializer, CacheKeyResolver
  // - LLMProviderFactory, StaticAnalyzer, LLMAnalyzer, AnalysisQueue, AnalysisOrchestrator
  // - SymbolResolver, CodeExplorerHoverProvider, CodeExplorerViewProvider
  // - Commands, file watcher, background scheduler

  console.log(`[${EXTENSION_DISPLAY_NAME}] Activated successfully.`);
}

/**
 * Called when the extension is deactivated.
 * Clean up resources, stop background tasks.
 */
export function deactivate(): void {
  console.log(`[${EXTENSION_DISPLAY_NAME}] Deactivated.`);
}
