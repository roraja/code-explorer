/**
 * Code Explorer — Extension Entry Point
 *
 * Activates/deactivates the extension, wiring up all services
 * and registering VS Code contributions.
 *
 * Uses CodeExplorerAPI as the core engine — extension.ts is a thin
 * VS Code adapter that gathers editor context and delegates to the API.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { EXTENSION_DISPLAY_NAME, VIEW_ID, COMMANDS } from './models/constants';
import { CodeExplorerViewProvider } from './ui/CodeExplorerViewProvider';
import { CodeExplorerAPI } from './api/CodeExplorerAPI';
import { VscodeSourceReader } from './providers/VscodeSourceReader';
import { LLMProviderFactory } from './llm/LLMProviderFactory';
import { logger, LogLevel } from './utils/logger';
import { SkillInstaller } from './skills/SkillInstaller';
import { pullAdoContent, pushAdoContent, pullAdoUpstream, pushAdoUpstream } from './git/AdoSync';
import { CodeExplorerHoverProvider } from './providers/CodeExplorerHoverProvider';
import { CodeExplorerCodeLensProvider } from './providers/CodeExplorerCodeLensProvider';
import { GraphBuilder } from './graph/GraphBuilder';
import { showSymbolInfo } from './providers/ShowSymbolInfoCommand';
import type { CursorContext } from './models/types';

export function activate(context: vscode.ExtensionContext): void {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    vscode.window.showWarningMessage(`${EXTENSION_DISPLAY_NAME} requires an open workspace.`);
    return;
  }

  // --- Logger ---
  logger.setLevel(LogLevel.DEBUG);
  const extensionVersion = context.extension.packageJSON.version ?? 'unknown';
  logger.init(workspaceRoot, extensionVersion);
  context.subscriptions.push({ dispose: () => logger.dispose() });

  logger.info(`Code Explorer v${extensionVersion}`);
  logger.info(`Activating with workspace: ${workspaceRoot}`);

  // --- Config ---
  const config = vscode.workspace.getConfiguration('codeExplorer');
  const llmProviderName = config.get<string>('llmProvider', 'copilot-cli');

  // --- LLM Provider (created separately for mock-copilot factory options) ---
  const llmProvider = LLMProviderFactory.create(
    llmProviderName,
    {
      baseUrl: config.get<string>('buildServiceUrl', 'http://localhost:8090'),
      model: config.get<string>('buildServiceModel', 'claude-opus-4.5'),
      agentBackend: config.get<string>('buildServiceAgentBackend', ''),
    },
    {
      delayMs: config.get<number>('mockCopilotDelayMs', 3000),
      extensionRoot: context.extensionUri.fsPath,
    }
  );

  // --- Public API (core engine — no vscode dependency) ---
  const api = new CodeExplorerAPI({
    workspaceRoot,
    sourceReader: new VscodeSourceReader(),
    llmProviderInstance: llmProvider,
  });

  context.subscriptions.push({ dispose: () => api.dispose() });

  // --- UI Layer (uses orchestrator + cache from the API) ---
  const viewProvider = new CodeExplorerViewProvider(
    context.extensionUri,
    api.orchestrator,
    api.cacheStore,
    workspaceRoot
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, viewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // --- Hover Provider ---
  const hoverProvider = new CodeExplorerHoverProvider(api.cacheStore, workspaceRoot);
  const hoverLanguages = [
    'typescript',
    'javascript',
    'typescriptreact',
    'javascriptreact',
    'cpp',
    'c',
    'python',
    'java',
    'csharp',
  ];
  for (const lang of hoverLanguages) {
    context.subscriptions.push(
      vscode.languages.registerHoverProvider({ language: lang }, hoverProvider)
    );
  }
  logger.info(`Hover provider registered for ${hoverLanguages.length} languages`);

  // --- CodeLens Provider ---
  const codeLensProvider = new CodeExplorerCodeLensProvider(api.cacheStore, workspaceRoot);
  const codeLensLanguages = [
    'typescript',
    'javascript',
    'typescriptreact',
    'javascriptreact',
    'cpp',
    'c',
    'python',
    'java',
    'csharp',
  ];
  for (const lang of codeLensLanguages) {
    context.subscriptions.push(
      vscode.languages.registerCodeLensProvider({ language: lang }, codeLensProvider)
    );
  }
  context.subscriptions.push({ dispose: () => codeLensProvider.dispose() });
  logger.info(`CodeLens provider registered for ${codeLensLanguages.length} languages`);

  // --- Graph Builder (for webview dependency graph) ---
  const graphBuilder = new GraphBuilder(workspaceRoot);
  viewProvider.setGraphBuilder(graphBuilder);

  // --- Commands ---
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.EXPLORE_SYMBOL, async (symbolOrUndefined) => {
      logger.startCommandLog('explore-symbol');
      try {
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
          startLine,
          0,
          endLine,
          editor.document.lineAt(endLine).text.length
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
      } finally {
        logger.endCommandLog();
      }
    }),

    vscode.commands.registerCommand(COMMANDS.REFRESH_ANALYSIS, () => {
      logger.startCommandLog('refresh-analysis');
      try {
        logger.info('Refresh analysis requested');
        vscode.window.showInformationMessage('Use the refresh button on a tab to re-analyze.');
      } finally {
        logger.endCommandLog();
      }
    }),

    vscode.commands.registerCommand(COMMANDS.CLEAR_CACHE, async () => {
      logger.startCommandLog('clear-cache');
      try {
        logger.info('Command: clearCache invoked');
        const confirm = await vscode.window.showWarningMessage(
          'Clear all Code Explorer cached analysis?',
          { modal: true },
          'Clear'
        );
        if (confirm === 'Clear') {
          try {
            await api.clearCache();
            logger.info('Cache cleared');
            vscode.window.showInformationMessage('Code Explorer cache cleared.');
          } catch (err) {
            logger.error(`Failed to clear cache: ${err}`);
            vscode.window.showErrorMessage('Failed to clear cache.');
          }
        }
      } finally {
        logger.endCommandLog();
      }
    }),

    vscode.commands.registerCommand(COMMANDS.ANALYZE_WORKSPACE, () => {
      logger.startCommandLog('analyze-workspace');
      try {
        logger.info('Analyze workspace requested');
        vscode.window.showInformationMessage(
          'Workspace analysis will be available in a future release.'
        );
      } finally {
        logger.endCommandLog();
      }
    }),

    vscode.commands.registerCommand(COMMANDS.INSTALL_GLOBAL_SKILLS, async () => {
      logger.startCommandLog('install-global-skills');
      try {
        logger.info('Command: installGlobalSkills invoked');

        const installer = new SkillInstaller();
        const status = await installer.isInstalled();

        if (status.claude && status.copilot) {
          const action = await vscode.window.showInformationMessage(
            'Code Explorer skills are already installed for Claude and Copilot.',
            'Reinstall',
            'Uninstall'
          );

          if (action === 'Uninstall') {
            const uninstallResult = await installer.uninstall();
            if (uninstallResult.errors.length === 0) {
              vscode.window.showInformationMessage(
                'Code Explorer skills uninstalled from Claude and Copilot.'
              );
            } else {
              vscode.window.showWarningMessage(
                `Partial uninstall: ${uninstallResult.errors.join('; ')}`
              );
            }
            return;
          } else if (action !== 'Reinstall') {
            return;
          }
        }

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Code Explorer: Installing global skills...',
            cancellable: false,
          },
          async () => {
            const result = await installer.install();

            const installed: string[] = [];
            if (result.claudeInstalled) {
              installed.push(`Claude (${result.claudePath})`);
            }
            if (result.copilotInstalled) {
              installed.push(`Copilot (${result.copilotPath})`);
            }

            if (result.errors.length === 0) {
              vscode.window.showInformationMessage(
                `Code Explorer analysis skill installed for: ${installed.join(', ')}. ` +
                  `Use "analyze file <path>" or "code-explorer analyze <path>" in either agent.`
              );
            } else {
              vscode.window.showWarningMessage(
                `Partial install (${installed.join(', ')}). Errors: ${result.errors.join('; ')}`
              );
            }

            logger.info(
              `installGlobalSkills: claude=${result.claudeInstalled}, copilot=${result.copilotInstalled}`
            );
          }
        );
      } finally {
        logger.endCommandLog();
      }
    }),

    vscode.commands.registerCommand(COMMANDS.EXPLORE_FILE_SYMBOLS, async () => {
      logger.startCommandLog('explore-file-symbols');
      try {
        logger.info('Command: exploreFileSymbols invoked');

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          logger.warn('exploreFileSymbols: no active editor');
          vscode.window.showWarningMessage('No active editor. Open a file to explore its symbols.');
          return;
        }

        const filePath = path.relative(workspaceRoot, editor.document.fileName);
        const fileSource = editor.document.getText();

        if (!fileSource.trim()) {
          logger.warn('exploreFileSymbols: file is empty');
          vscode.window.showWarningMessage('The current file is empty.');
          return;
        }

        logger.info(`exploreFileSymbols: analyzing ${filePath} (${fileSource.length} chars)`);

        // Show progress notification while running — delegates to api.exploreFile()
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Code Explorer: Analyzing all symbols in ${path.basename(filePath)}`,
            cancellable: false,
          },
          async (progress) => {
            try {
              const cachedCount = await api.exploreFile(filePath, fileSource, (stage, detail) => {
                progress.report({ message: detail || stage });
              });

              if (cachedCount > 0) {
                vscode.window.showInformationMessage(
                  `Code Explorer: Cached ${cachedCount} symbol${cachedCount > 1 ? 's' : ''} from ${path.basename(filePath)}. ` +
                    `Use "Explore Symbol" (Ctrl+Shift+E) on any symbol for instant results.`
                );
              } else {
                vscode.window.showWarningMessage(
                  `Code Explorer: No symbols were cached for ${path.basename(filePath)}. ` +
                    `The LLM may not have been available or the file has no analyzable symbols.`
                );
              }
            } catch (err) {
              logger.error(`exploreFileSymbols: failed: ${err}`);
              vscode.window.showErrorMessage(
                `Code Explorer: Failed to analyze file. Check the Output panel for details.`
              );
            }
          }
        );
      } finally {
        logger.endCommandLog();
      }
    }),

    vscode.commands.registerCommand(COMMANDS.PULL_ADO_CONTENT, async () => {
      logger.startCommandLog('pull-ado-content');
      try {
        logger.info('Command: pullAdoContent invoked');

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Code Explorer: Pulling content from ADO...',
            cancellable: false,
          },
          async () => {
            const result = await pullAdoContent(workspaceRoot);

            if (result.success) {
              vscode.window.showInformationMessage(`Code Explorer: ${result.message}`);
            } else {
              vscode.window.showErrorMessage(`Code Explorer: ${result.message}`);
            }

            logger.info(`pullAdoContent: ${result.message}`);
            logger.debug(`pullAdoContent details:\n${result.details}`);
          }
        );
      } finally {
        logger.endCommandLog();
      }
    }),

    vscode.commands.registerCommand(COMMANDS.PUSH_ADO_CONTENT, async () => {
      logger.startCommandLog('push-ado-content');
      try {
        logger.info('Command: pushAdoContent invoked');

        const confirm = await vscode.window.showWarningMessage(
          'Push Code Explorer content to ADO? This will pull latest changes first, then push.',
          { modal: true },
          'Push'
        );
        if (confirm !== 'Push') {
          return;
        }

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Code Explorer: Pushing content to ADO...',
            cancellable: false,
          },
          async () => {
            const result = await pushAdoContent(workspaceRoot);

            if (result.success) {
              vscode.window.showInformationMessage(`Code Explorer: ${result.message}`);
            } else {
              vscode.window.showErrorMessage(`Code Explorer: ${result.message}`);
            }

            logger.info(`pushAdoContent: ${result.message}`);
            logger.debug(`pushAdoContent details:\n${result.details}`);
          }
        );
      } finally {
        logger.endCommandLog();
      }
    }),

    vscode.commands.registerCommand(COMMANDS.PULL_ADO_UPSTREAM, async () => {
      logger.startCommandLog('pull-ado-upstream');
      try {
        logger.info('Command: pullAdoUpstream invoked');

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Code Explorer: Pulling upstream content from ADO...',
            cancellable: false,
          },
          async () => {
            const result = await pullAdoUpstream(workspaceRoot);

            if (result.success) {
              vscode.window.showInformationMessage(`Code Explorer: ${result.message}`);
            } else {
              vscode.window.showErrorMessage(`Code Explorer: ${result.message}`);
            }

            logger.info(`pullAdoUpstream: ${result.message}`);
            logger.debug(`pullAdoUpstream details:\n${result.details}`);
          }
        );
      } finally {
        logger.endCommandLog();
      }
    }),

    vscode.commands.registerCommand(COMMANDS.PUSH_ADO_UPSTREAM, async () => {
      logger.startCommandLog('push-ado-upstream');
      try {
        logger.info('Command: pushAdoUpstream invoked');

        const confirm = await vscode.window.showWarningMessage(
          'Push upstream content to ADO? This will pull latest changes first, then push.',
          { modal: true },
          'Push'
        );
        if (confirm !== 'Push') {
          return;
        }

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Code Explorer: Pushing upstream content to ADO...',
            cancellable: false,
          },
          async () => {
            const result = await pushAdoUpstream(workspaceRoot);

            if (result.success) {
              vscode.window.showInformationMessage(`Code Explorer: ${result.message}`);
            } else {
              vscode.window.showErrorMessage(`Code Explorer: ${result.message}`);
            }

            logger.info(`pushAdoUpstream: ${result.message}`);
            logger.debug(`pushAdoUpstream details:\n${result.details}`);
          }
        );
      } finally {
        logger.endCommandLog();
      }
    }),

    vscode.commands.registerCommand(COMMANDS.SHOW_DEPENDENCY_GRAPH, async () => {
      logger.startCommandLog('show-dependency-graph');
      try {
        logger.info('Command: showDependencyGraph invoked');

        await vscode.commands.executeCommand('codeExplorer.sidebar.focus');

        // Get the current cursor symbol to center the graph on it
        const editor = vscode.window.activeTextEditor;
        let cursorWord: string | undefined;
        let cursorFilePath: string | undefined;

        if (editor) {
          const position = editor.selection.active;
          const wordRange = editor.document.getWordRangeAtPosition(position);
          if (wordRange) {
            cursorWord = editor.document.getText(wordRange);
            cursorFilePath = path.relative(workspaceRoot, editor.document.fileName);
          }
        }

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Code Explorer: Building dependency graph...',
            cancellable: false,
          },
          async () => {
            try {
              // Use API for graph building
              let graph;
              if (cursorWord && cursorFilePath) {
                graph = await api.buildSubgraph(cursorWord, cursorFilePath);
                // Fall back to full graph if subgraph is empty (symbol not cached)
                if (graph.nodes.length === 0) {
                  logger.info('showDependencyGraph: subgraph empty, falling back to full graph');
                  graph = await api.buildDependencyGraph();
                }
              } else {
                graph = await api.buildDependencyGraph();
              }

              const centerId =
                cursorWord && cursorFilePath
                  ? graph.nodes.find((n) => n.name === cursorWord && n.filePath === cursorFilePath)
                      ?.id
                  : undefined;
              const mermaidSource = api.toMermaid(graph, centerId);
              viewProvider.showDependencyGraph(
                mermaidSource,
                graph.nodes.length,
                graph.edges.length
              );
            } catch (err) {
              logger.error(`showDependencyGraph: failed: ${err}`);
              vscode.window.showErrorMessage(
                'Code Explorer: Failed to build dependency graph. Make sure you have cached analyses.'
              );
            }
          }
        );
      } finally {
        logger.endCommandLog();
      }
    }),

    vscode.commands.registerCommand(COMMANDS.SHOW_SYMBOL_INFO, async () => {
      logger.startCommandLog('show-symbol-info');
      try {
        await showSymbolInfo();
      } finally {
        logger.endCommandLog();
      }
    })
  );

  logger.info('Activated successfully');
  logger.info(`LLM provider: ${llmProviderName}`);
  logger.show();
}

export function deactivate(): void {
  logger.info('Deactivated');
}
