/**
 * Code Explorer — Hover Provider
 *
 * Shows a compact inline preview of cached analysis when the user
 * hovers over a symbol in the editor. No LLM calls are triggered —
 * only cached data is shown. If the symbol has not been analyzed,
 * a "Click to analyze" hint is displayed instead.
 *
 * Controlled by the `codeExplorer.showHoverCards` setting (default: true).
 */
import * as vscode from 'vscode';
import * as path from 'path';
import type { CacheStore } from '../cache/CacheStore';
import type { AnalysisResult } from '../models/types';
import { logger } from '../utils/logger';

export class CodeExplorerHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly _cacheStore: CacheStore,
    private readonly _workspaceRoot: string
  ) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): Promise<vscode.Hover | null> {
    // Check if hover cards are enabled
    const config = vscode.workspace.getConfiguration('codeExplorer');
    const showHoverCards = config.get<boolean>('showHoverCards', true);
    if (!showHoverCards) {
      return null;
    }

    // Get the word at the cursor
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) {
      return null;
    }

    const word = document.getText(wordRange);
    if (!word || word.length < 2) {
      return null;
    }

    const relPath = path.relative(this._workspaceRoot, document.fileName);

    // Skip files outside the workspace (on Windows, cross-drive paths are absolute)
    if (relPath.startsWith('..') || path.isAbsolute(relPath)) {
      return null;
    }

    // Try to find a cached analysis for this symbol (fast — no LLM call)
    let cached: { result: AnalysisResult } | null = null;
    try {
      const match = await this._cacheStore.findByCursor(word, relPath, position.line);
      if (match) {
        cached = { result: match.result };
      }
    } catch (err) {
      logger.debug(`HoverProvider: cache lookup failed for "${word}": ${err}`);
      return null;
    }

    if (!cached || !cached.result.metadata.llmProvider) {
      // No cached analysis — show a subtle hint
      return this._buildUncachedHover(word);
    }

    return this._buildCachedHover(cached.result, word);
  }

  /**
   * Build a rich hover card from cached analysis data.
   */
  private _buildCachedHover(result: AnalysisResult, _word: string): vscode.Hover {
    const s = result.symbol;
    const md = new vscode.MarkdownString('', true);
    md.isTrusted = true;
    md.supportHtml = true;

    // Header line: kind icon + name
    const kindLabel = s.kind !== 'unknown' ? s.kind : '';
    md.appendMarkdown(`**Code Explorer** — \`${kindLabel}\` **${s.name}**\n\n`);

    // Overview (first 2 sentences max)
    if (result.overview) {
      const overview = this._truncateToSentences(result.overview, 2);
      md.appendMarkdown(`${overview}\n\n`);
    }

    // Quick stats line
    const stats: string[] = [];
    if (result.functionInputs && result.functionInputs.length > 0) {
      md.appendMarkdown('---\n\n');
      const returnType = result.functionOutput?.typeName;
      const params = result.functionInputs.map((p) => `\`${p.name}: ${p.typeName}\``).join(', ');
      md.appendMarkdown(
        `**Signature:** (${params})${returnType ? ` → \`${returnType}\`` : ''}\n\n`
      );
    }
    if (result.callStacks && result.callStacks.length > 0) {
      stats.push(`${result.callStacks.length} caller${result.callStacks.length !== 1 ? 's' : ''}`);
    }
    if (result.subFunctions && result.subFunctions.length > 0) {
      stats.push(
        `${result.subFunctions.length} sub-function${result.subFunctions.length !== 1 ? 's' : ''}`
      );
    }
    if (result.classMembers && result.classMembers.length > 0) {
      stats.push(
        `${result.classMembers.length} member${result.classMembers.length !== 1 ? 's' : ''}`
      );
    }
    if (result.potentialIssues && result.potentialIssues.length > 0) {
      stats.push(
        `${result.potentialIssues.length} issue${result.potentialIssues.length !== 1 ? 's' : ''}`
      );
    }

    if (stats.length > 0) {
      md.appendMarkdown(`${stats.join(' · ')}\n\n`);
    }

    // Potential issues (first one only, as a warning)
    if (result.potentialIssues && result.potentialIssues.length > 0) {
      md.appendMarkdown(`⚠ ${this._truncate(result.potentialIssues[0], 120)}\n\n`);
    }

    // Analyzed timestamp
    if (result.metadata.analyzedAt) {
      const ago = this._timeAgo(result.metadata.analyzedAt);
      const provider = result.metadata.llmProvider || 'static';
      md.appendMarkdown(`---\n\n`);
      md.appendMarkdown(
        `*✨ Analyzed ${ago} with ${provider}* — [Open in Code Explorer](command:codeExplorer.exploreSymbol)\n`
      );
    }

    return new vscode.Hover(md);
  }

  /**
   * Build a minimal hover hint for symbols without cached analysis.
   */
  private _buildUncachedHover(_word: string): vscode.Hover | null {
    // Return null to avoid cluttering the hover with hints on every word.
    // Only show hover cards when we have actual cached data.
    return null;
  }

  /**
   * Truncate a string to the first N sentences.
   */
  private _truncateToSentences(text: string, maxSentences: number): string {
    // Remove markdown bold/italic for cleaner display
    const clean = text.replace(/\*\*/g, '').replace(/`/g, '');
    const sentences = clean.match(/[^.!?]+[.!?]+/g);
    if (!sentences || sentences.length <= maxSentences) {
      return clean.trim();
    }
    return sentences.slice(0, maxSentences).join('').trim();
  }

  /**
   * Truncate text to a max length with ellipsis.
   */
  private _truncate(text: string, maxLen: number): string {
    if (text.length <= maxLen) {
      return text;
    }
    return text.substring(0, maxLen - 1) + '…';
  }

  /**
   * Convert an ISO timestamp to a human-readable "X ago" string.
   */
  private _timeAgo(isoTimestamp: string): string {
    const now = Date.now();
    const then = new Date(isoTimestamp).getTime();
    const diffMs = now - then;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMin < 1) {
      return 'just now';
    }
    if (diffMin < 60) {
      return `${diffMin}m ago`;
    }
    if (diffHours < 24) {
      return `${diffHours}h ago`;
    }
    return `${diffDays}d ago`;
  }
}
