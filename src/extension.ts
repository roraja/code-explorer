/**
 * Code Explorer — Extension Entry Point
 *
 * Activates/deactivates the extension, wiring up all services
 * and registering VS Code contributions.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { EXTENSION_DISPLAY_NAME, VIEW_ID, COMMANDS } from './models/constants';
import { CodeExplorerViewProvider } from './ui/CodeExplorerViewProvider';
import { StaticAnalyzer } from './analysis/StaticAnalyzer';
import { AnalysisOrchestrator } from './analysis/AnalysisOrchestrator';
import { CacheStore } from './cache/CacheStore';
import { LLMProviderFactory } from './llm/LLMProviderFactory';
import { logger, LogLevel } from './utils/logger';
import type { CursorContext } from './models/types';

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

  // Set workspace root so the CLI provider runs with full workspace context
  if (llmProvider.setWorkspaceRoot) {
    llmProvider.setWorkspaceRoot(workspaceRoot);
  }

  // --- Analysis Layer ---
  const staticAnalyzer = new StaticAnalyzer();
  const cacheStore = new CacheStore(workspaceRoot);
  const orchestrator = new AnalysisOrchestrator(staticAnalyzer, llmProvider, cacheStore);

  context.subscriptions.push({ dispose: () => orchestrator.dispose() });

  // --- UI Layer ---
  const viewProvider = new CodeExplorerViewProvider(context.extensionUri, orchestrator);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, viewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // --- Commands ---
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.EXPLORE_SYMBOL, async (symbolOrUndefined) => {
      logger.info('Command: exploreSymbol invoked');

      // The argument may be a SymbolInfo (from programmatic call),
      // a Uri (from context menu), or undefined (from keybinding/command palette).
      // Only use it if it looks like a SymbolInfo.
      const symbol =
        symbolOrUndefined &&
        typeof symbolOrUndefined === 'object' &&
        'name' in symbolOrUndefined &&
        'kind' in symbolOrUndefined &&
        'filePath' in symbolOrUndefined &&
        'position' in symbolOrUndefined
          ? symbolOrUndefined
          : undefined;

      if (symbol) {
        // Programmatic call with a pre-resolved SymbolInfo — use legacy flow
        logger.info(
          `exploreSymbol: focusing sidebar and opening tab for ${symbol.kind} ${symbol.name}`
        );
        await vscode.commands.executeCommand('codeExplorer.sidebar.focus');
        viewProvider.openTab(symbol);
        return;
      }

      // New flow: gather lightweight cursor context and let the LLM resolve + analyze
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        logger.warn('exploreSymbol: no active editor');
        vscode.window.showWarningMessage(
          'No active editor. Open a file and place cursor on a symbol.'
        );
        return;
      }

      const position = editor.selection.active;
      const wordRange = editor.document.getWordRangeAtPosition(position);
      if (!wordRange) {
        logger.warn('exploreSymbol: no word at cursor position');
        vscode.window.showWarningMessage('No symbol found at cursor position.');
        return;
      }

      const word = editor.document.getText(wordRange);
      const relPath = path.relative(workspaceRoot, editor.document.fileName);

      // Gather surrounding source code (±50 lines for context)
      const startLine = Math.max(0, position.line - 50);
      const endLine = Math.min(editor.document.lineCount - 1, position.line + 50);
      const surroundingRange = new vscode.Range(
        startLine, 0,
        endLine, editor.document.lineAt(endLine).text.length
      );
      const surroundingSource = editor.document.getText(surroundingRange);
      const cursorLine = editor.document.lineAt(position.line).text;

      const cursorContext: CursorContext = {
        word,
        filePath: relPath,
        position: { line: position.line, character: position.character },
        surroundingSource,
        cursorLine,
      };

      logger.debug(
        `exploreSymbol: cursor context — word="${word}" in ${relPath}:${position.line}:${position.character}`
      );

      // Ensure the sidebar is visible and open a tab via cursor-based flow
      await vscode.commands.executeCommand('codeExplorer.sidebar.focus');
      viewProvider.openTabFromCursor(cursorContext);
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
        try {
          await cacheStore.clear();
          logger.info('Cache cleared');
          vscode.window.showInformationMessage('Code Explorer cache cleared.');
        } catch (err) {
          logger.error(`Failed to clear cache: ${err}`);
          vscode.window.showErrorMessage('Failed to clear cache.');
        }
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
