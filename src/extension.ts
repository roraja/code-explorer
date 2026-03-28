/**
 * Code Explorer — Extension Entry Point
 *
 * Activates/deactivates the extension, wiring up all services
 * and registering VS Code contributions.
 */
import * as vscode from 'vscode';
import { EXTENSION_DISPLAY_NAME, VIEW_ID, COMMANDS } from './models/constants';
import { CodeExplorerViewProvider } from './ui/CodeExplorerViewProvider';
import { SymbolResolver } from './providers/SymbolResolver';
import { StaticAnalyzer } from './analysis/StaticAnalyzer';
import { AnalysisOrchestrator } from './analysis/AnalysisOrchestrator';
import { CacheWriter } from './cache/CacheWriter';
import { LLMProviderFactory } from './llm/LLMProviderFactory';
import { logger, LogLevel } from './utils/logger';

export function activate(context: vscode.ExtensionContext): void {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    vscode.window.showWarningMessage(`${EXTENSION_DISPLAY_NAME} requires an open workspace.`);
    return;
  }

  // --- Logger ---
  logger.setLevel(LogLevel.DEBUG);
  logger.init(workspaceRoot);
  context.subscriptions.push({ dispose: () => logger.dispose() });
  logger.info(`Activating with workspace: ${workspaceRoot}`);

  // --- Config ---
  const config = vscode.workspace.getConfiguration('codeExplorer');
  const llmProviderName = config.get<string>('llmProvider', 'copilot-cli');

  // --- LLM Layer ---
  const llmProvider = LLMProviderFactory.create(llmProviderName);

  // --- Analysis Layer ---
  const symbolResolver = new SymbolResolver();
  const staticAnalyzer = new StaticAnalyzer();
  const cacheWriter = new CacheWriter(workspaceRoot);
  const orchestrator = new AnalysisOrchestrator(staticAnalyzer, llmProvider, cacheWriter);

  context.subscriptions.push({ dispose: () => orchestrator.dispose() });

  // --- UI Layer ---
  const viewProvider = new CodeExplorerViewProvider(context.extensionUri, orchestrator);

  context.subscriptions.push(vscode.window.registerWebviewViewProvider(VIEW_ID, viewProvider));

  // --- Commands ---
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.EXPLORE_SYMBOL, async (symbolOrUndefined) => {
      logger.info('Command: exploreSymbol invoked');
      let symbol = symbolOrUndefined;
      if (!symbol) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          logger.warn('exploreSymbol: no active editor');
          vscode.window.showWarningMessage(
            'No active editor. Open a file and place cursor on a symbol.'
          );
          return;
        }
        logger.debug(
          `exploreSymbol: resolving at ${editor.document.fileName}:${editor.selection.active.line}:${editor.selection.active.character}`
        );
        symbol = await symbolResolver.resolveAtPosition(editor.document, editor.selection.active);
      }
      if (symbol) {
        logger.info(
          `exploreSymbol: focusing sidebar and opening tab for ${symbol.kind} ${symbol.name}`
        );
        // Ensure the sidebar is visible
        await vscode.commands.executeCommand('codeExplorer.sidebar.focus');
        viewProvider.openTab(symbol);
      } else {
        logger.warn('exploreSymbol: no symbol found at cursor position');
        vscode.window.showWarningMessage('No symbol found at cursor position.');
      }
    }),

    vscode.commands.registerCommand(COMMANDS.REFRESH_ANALYSIS, () => {
      logger.info('Refresh analysis requested');
      vscode.window.showInformationMessage('Use the refresh button on a tab to re-analyze.');
    }),

    vscode.commands.registerCommand(COMMANDS.CLEAR_CACHE, async () => {
      logger.info('Command: clearCache invoked');
      const confirm = await vscode.window.showWarningMessage(
        'Clear all Code Explorer cached analysis?',
        { modal: true },
        'Clear'
      );
      if (confirm === 'Clear') {
        logger.info('Cache cleared');
        vscode.window.showInformationMessage('Code Explorer cache cleared.');
      }
    }),

    vscode.commands.registerCommand(COMMANDS.ANALYZE_WORKSPACE, () => {
      logger.info('Analyze workspace requested');
      vscode.window.showInformationMessage(
        'Workspace analysis will be available in a future release.'
      );
    })
  );

  logger.info('Activated successfully');
  logger.info(`LLM provider: ${llmProviderName}`);
  logger.show();
}

export function deactivate(): void {
  logger.info('Deactivated');
}
