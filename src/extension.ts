/**
 * Code Explorer — Extension Entry Point
 *
 * Activates/deactivates the extension, wiring up all services
 * and registering VS Code contributions.
 */
import * as vscode from 'vscode';
import { EXTENSION_DISPLAY_NAME, VIEW_ID, COMMANDS } from './models/constants';
import { CodeExplorerViewProvider } from './ui/CodeExplorerViewProvider';

/**
 * Called when the extension is activated.
 * Activation triggers are defined in package.json activationEvents.
 */
export function activate(context: vscode.ExtensionContext): void {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    vscode.window.showWarningMessage(`${EXTENSION_DISPLAY_NAME} requires an open workspace.`);
    return;
  }

  console.log(`[${EXTENSION_DISPLAY_NAME}] Activating with workspace: ${workspaceRoot}`);

  // --- UI Layer ---
  const viewProvider = new CodeExplorerViewProvider(context.extensionUri);

  context.subscriptions.push(vscode.window.registerWebviewViewProvider(VIEW_ID, viewProvider));

  // --- Commands ---
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.EXPLORE_SYMBOL, () => {
      // TODO (Sprint 1): Resolve symbol at cursor and open tab
      vscode.window.showInformationMessage('Code Explorer: Explore Symbol (coming in Sprint 1)');
    }),

    vscode.commands.registerCommand(COMMANDS.REFRESH_ANALYSIS, () => {
      // TODO (Sprint 1): Re-trigger analysis for active tab
      vscode.window.showInformationMessage('Code Explorer: Refresh Analysis (coming in Sprint 1)');
    }),

    vscode.commands.registerCommand(COMMANDS.CLEAR_CACHE, async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Clear all Code Explorer cached analysis?',
        { modal: true },
        'Clear'
      );
      if (confirm === 'Clear') {
        // TODO (Sprint 3): Wire to CacheManager.clearAll()
        vscode.window.showInformationMessage('Code Explorer cache cleared.');
      }
    }),

    vscode.commands.registerCommand(COMMANDS.ANALYZE_WORKSPACE, () => {
      // TODO (Sprint 5): Wire to AnalysisOrchestrator.analyzeWorkspace()
      vscode.window.showInformationMessage('Code Explorer: Analyze Workspace (coming in Sprint 5)');
    })
  );

  console.log(`[${EXTENSION_DISPLAY_NAME}] Activated successfully.`);
}

/**
 * Called when the extension is deactivated.
 * Clean up resources, stop background tasks.
 */
export function deactivate(): void {
  console.log(`[${EXTENSION_DISPLAY_NAME}] Deactivated.`);
}
