/**
 * Code Explorer — CodeLens Provider
 *
 * Shows contextual "why?" annotations directly in the editor above
 * analyzed symbols. When a file has cached analyses, CodeLens items
 * appear at the start of each analyzed function/class showing:
 *
 * - **Overview**: A one-line summary above the symbol definition
 * - **Function Steps**: Numbered step annotations (approximate lines)
 * - **Data Flow**: Flow point annotations (for variables)
 * - **Potential Issues**: Warning annotations
 *
 * All CodeLens items are clickable — clicking opens the full analysis
 * in the sidebar via the exploreSymbol command.
 *
 * Controlled by the `codeExplorer.showCodeLens` setting (default: false).
 * Disabled by default since some users will find inline annotations distracting.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import type { CacheStore } from '../cache/CacheStore';
import type { AnalysisResult, FunctionStep, DataFlowEntry } from '../models/types';
import { COMMANDS } from '../models/constants';
import { logger } from '../utils/logger';

export class CodeExplorerCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

  constructor(
    private readonly _cacheStore: CacheStore,
    private readonly _workspaceRoot: string
  ) {}

  /**
   * Notify the editor that CodeLens data may have changed.
   * Call this after a cache write or clear so lenses update.
   */
  public refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  async provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    // Check if CodeLens is enabled
    const config = vscode.workspace.getConfiguration('codeExplorer');
    const showCodeLens = config.get<boolean>('showCodeLens', false);
    if (!showCodeLens) {
      return [];
    }

    const relPath = path.relative(this._workspaceRoot, document.fileName);

    // Skip files outside the workspace (on Windows, cross-drive paths are absolute)
    if (relPath.startsWith('..') || path.isAbsolute(relPath)) {
      return [];
    }

    // Read all cached analyses for this file
    let analyses: AnalysisResult[];
    try {
      analyses = await this._cacheStore.readAllForFile(relPath);
    } catch (err) {
      logger.debug(`CodeLensProvider: failed to read cache for ${relPath}: ${err}`);
      return [];
    }

    if (analyses.length === 0) {
      return [];
    }

    logger.debug(
      `CodeLensProvider: generating lenses for ${analyses.length} cached symbols in ${relPath}`
    );

    const lenses: vscode.CodeLens[] = [];
    const lineCount = document.lineCount;

    for (const analysis of analyses) {
      const symbolLine = analysis.symbol.position.line;

      // Skip if the symbol line is beyond the document
      if (symbolLine >= lineCount) {
        continue;
      }

      // 1. Overview CodeLens — shown at the symbol definition line
      if (analysis.overview) {
        const overview = this._truncateToOneLine(analysis.overview, 100);
        const label = `$(symbol-${this._kindToIcon(analysis.symbol.kind)}) Code Explorer: ${overview}`;
        lenses.push(this._createCodeLens(symbolLine, label, analysis.symbol.name, relPath));
      }

      // 2. Function Steps — approximate line annotations
      if (analysis.functionSteps && analysis.functionSteps.length > 0) {
        const stepsLenses = this._buildStepLenses(
          analysis.functionSteps,
          symbolLine,
          lineCount,
          document,
          analysis.symbol.name,
          relPath
        );
        lenses.push(...stepsLenses);
      }

      // 3. Data Flow annotations (for variables)
      if (analysis.dataFlow && analysis.dataFlow.length > 0) {
        const flowLenses = this._buildDataFlowLenses(
          analysis.dataFlow,
          relPath,
          lineCount,
          analysis.symbol.name
        );
        lenses.push(...flowLenses);
      }

      // 4. Potential Issues — warning annotation at the symbol line
      if (analysis.potentialIssues && analysis.potentialIssues.length > 0) {
        for (const issue of analysis.potentialIssues) {
          const truncated = this._truncateToOneLine(issue, 90);
          lenses.push(
            this._createCodeLens(
              symbolLine,
              `$(warning) Issue: ${truncated}`,
              analysis.symbol.name,
              relPath
            )
          );
        }
      }
    }

    logger.debug(`CodeLensProvider: returning ${lenses.length} lenses for ${relPath}`);
    return lenses;
  }

  /**
   * CodeLens resolve is a no-op since we provide the command in provideCodeLenses.
   */
  resolveCodeLens(codeLens: vscode.CodeLens, _token: vscode.CancellationToken): vscode.CodeLens {
    return codeLens;
  }

  /**
   * Build CodeLens items for function steps.
   * Steps don't have explicit line numbers, so we distribute them
   * approximately across the function body.
   */
  private _buildStepLenses(
    steps: FunctionStep[],
    symbolLine: number,
    lineCount: number,
    document: vscode.TextDocument,
    symbolName: string,
    filePath: string
  ): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];

    // Estimate the function body span by looking for the next function/class
    // declaration or end of file. Use a simple heuristic: scan up to 200 lines
    // for closing brace at column 0 (end of top-level function body)
    let endLine = Math.min(symbolLine + 200, lineCount - 1);
    for (let i = symbolLine + 1; i <= endLine; i++) {
      const lineText = document.lineAt(i).text;
      // Heuristic: a line starting with `}` at column 0 or 1 likely ends the function
      if (/^\s{0,1}\}/.test(lineText) && i > symbolLine + 2) {
        endLine = i;
        break;
      }
    }

    const bodySpan = endLine - symbolLine;
    if (bodySpan <= 0 || steps.length === 0) {
      return lenses;
    }

    // Distribute steps evenly across the function body
    // Skip if there are more steps than lines (very short function)
    if (steps.length > bodySpan) {
      // Just show all steps at the symbol line
      for (const step of steps) {
        const truncated = this._truncateToOneLine(step.description, 90);
        lenses.push(
          this._createCodeLens(symbolLine, `Step ${step.step}: ${truncated}`, symbolName, filePath)
        );
      }
      return lenses;
    }

    // Distribute steps
    const linesPerStep = Math.floor(bodySpan / steps.length);
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const approximateLine = Math.min(symbolLine + 1 + i * linesPerStep, lineCount - 1);
      const truncated = this._truncateToOneLine(step.description, 90);
      lenses.push(
        this._createCodeLens(
          approximateLine,
          `Step ${step.step}: ${truncated}`,
          symbolName,
          filePath
        )
      );
    }

    return lenses;
  }

  /**
   * Build CodeLens items for data flow points.
   * Data flow entries have explicit file paths and line numbers.
   */
  private _buildDataFlowLenses(
    dataFlow: DataFlowEntry[],
    currentFilePath: string,
    lineCount: number,
    symbolName: string
  ): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];

    for (const df of dataFlow) {
      // Only show data flow points that are in the current file
      if (df.filePath !== currentFilePath) {
        continue;
      }

      // Data flow lines are 1-based in the analysis, VS Code is 0-based
      const line = Math.max(0, (df.line || 1) - 1);
      if (line >= lineCount) {
        continue;
      }

      const typeIcon = this._dataFlowTypeIcon(df.type);
      const truncated = this._truncateToOneLine(df.description, 80);
      lenses.push(
        this._createCodeLens(line, `${typeIcon} Data: ${truncated}`, symbolName, currentFilePath)
      );
    }

    return lenses;
  }

  /**
   * Create a CodeLens with a command that opens the analysis in the sidebar.
   */
  private _createCodeLens(
    line: number,
    title: string,
    symbolName: string,
    filePath: string
  ): vscode.CodeLens {
    const range = new vscode.Range(line, 0, line, 0);
    return new vscode.CodeLens(range, {
      title,
      command: COMMANDS.EXPLORE_SYMBOL,
      arguments: [
        {
          name: symbolName,
          kind: 'unknown',
          filePath,
          position: { line, character: 0 },
        },
      ],
    });
  }

  /**
   * Map symbol kind to a VS Code icon name for the CodeLens title.
   */
  private _kindToIcon(kind: string): string {
    const map: Record<string, string> = {
      class: 'class',
      function: 'method',
      method: 'method',
      variable: 'variable',
      interface: 'interface',
      type: 'interface',
      enum: 'enum',
      property: 'property',
      struct: 'class',
    };
    return map[kind] || 'misc';
  }

  /**
   * Get a compact icon for a data flow type.
   */
  private _dataFlowTypeIcon(type: string): string {
    const icons: Record<string, string> = {
      created: '⊕',
      assigned: '←',
      read: '→',
      modified: '⚡',
      consumed: '✓',
      returned: '↩',
      passed: '→',
    };
    return icons[type] || '·';
  }

  /**
   * Truncate text to a single line with a max character count.
   */
  private _truncateToOneLine(text: string, maxLen: number): string {
    if (!text) {
      return '';
    }
    // Remove markdown formatting and newlines
    const clean = text
      .replace(/\*\*/g, '')
      .replace(/`/g, '')
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (clean.length <= maxLen) {
      return clean;
    }
    return clean.substring(0, maxLen - 1) + '…';
  }

  /**
   * Dispose of the event emitter.
   */
  dispose(): void {
    this._onDidChangeCodeLenses.dispose();
  }
}
