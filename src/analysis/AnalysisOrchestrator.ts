/**
 * Code Explorer — Analysis Orchestrator
 *
 * Coordinates the full analysis pipeline:
 * 1. Run static analysis (references, call hierarchy, type hierarchy)
 * 2. Run LLM analysis (if available)
 * 3. Merge results
 * 4. Write to cache
 */
import * as vscode from 'vscode';
import type { AnalysisResult, SymbolInfo } from '../models/types';
import type { LLMProvider } from '../llm/LLMProvider';
import type { CacheWriter } from '../cache/CacheWriter';
import { PromptBuilder } from '../llm/PromptBuilder';
import { ResponseParser } from '../llm/ResponseParser';
import { StaticAnalyzer } from './StaticAnalyzer';
import { ANALYSIS_VERSION } from '../models/constants';
import { logger } from '../utils/logger';

export class AnalysisOrchestrator {
  private readonly _onAnalysisComplete = new vscode.EventEmitter<AnalysisResult>();
  readonly onAnalysisComplete = this._onAnalysisComplete.event;

  constructor(
    private readonly _staticAnalyzer: StaticAnalyzer,
    private readonly _llmProvider: LLMProvider,
    private readonly _cacheWriter: CacheWriter
  ) {}

  /**
   * Full analysis pipeline for a symbol.
   */
  async analyzeSymbol(symbol: SymbolInfo): Promise<AnalysisResult> {
    const startTime = Date.now();
    logger.info(`Analyzing ${symbol.kind} "${symbol.name}" in ${symbol.filePath}...`);

    // 1. Static analysis (fast, always available)
    const [usages, callStacks, relationships, sourceCode] = await Promise.all([
      this._staticAnalyzer.findReferences(symbol),
      this._staticAnalyzer.buildCallHierarchy(symbol),
      this._staticAnalyzer.getTypeHierarchy(symbol),
      this._staticAnalyzer.readSymbolSource(symbol),
    ]);

    logger.info(
      `Static analysis: ${usages.length} refs, ${callStacks.length} callers, ` +
        `${relationships.length} relationships, source: ${sourceCode.length} chars`
    );

    // 2. LLM analysis (slow, may be unavailable)
    let llmResult: Partial<AnalysisResult> = {};
    let llmProviderName: string | undefined;

    try {
      const available = await this._llmProvider.isAvailable();
      if (available && sourceCode) {
        logger.info(`Running LLM analysis with provider: ${this._llmProvider.name}`);

        const prompt = PromptBuilder.build(symbol, sourceCode, usages);
        const rawResponse = await this._llmProvider.analyze({
          prompt,
          systemPrompt: PromptBuilder.SYSTEM_PROMPT,
          maxTokens: 4096,
        });

        logger.debug(
          `LLM raw response (first 500 chars): ${rawResponse.substring(0, 500).replace(/\n/g, '\\n')}`
        );

        llmResult = ResponseParser.parse(rawResponse, symbol);
        llmProviderName = this._llmProvider.name;

        logger.info(
          `LLM analysis complete — overview: ${(llmResult.overview || '').length} chars, ` +
            `keyMethods: ${llmResult.keyMethods?.length || 0}, ` +
            `dependencies: ${llmResult.dependencies?.length || 0}, ` +
            `issues: ${llmResult.potentialIssues?.length || 0}`
        );
      } else if (!available) {
        logger.warn(`LLM provider "${this._llmProvider.name}" is not available, using static only`);
      } else {
        logger.warn('No source code available for LLM analysis');
      }
    } catch (err) {
      logger.error(`LLM analysis failed: ${err}`);
      // Continue with static-only results
    }

    // 3. Merge results
    const result: AnalysisResult = {
      symbol,
      overview: llmResult.overview || `${symbol.kind} **${symbol.name}** in \`${symbol.filePath}\``,
      callStacks,
      usages,
      dataFlow: llmResult.dataFlow || [],
      relationships,
      keyMethods: llmResult.keyMethods,
      dependencies: llmResult.dependencies,
      usagePattern: llmResult.usagePattern,
      potentialIssues: llmResult.potentialIssues,
      variableLifecycle: llmResult.variableLifecycle,
      metadata: {
        analyzedAt: new Date().toISOString(),
        sourceHash: '',
        dependentFileHashes: {},
        llmProvider: llmProviderName,
        analysisVersion: ANALYSIS_VERSION,
        stale: false,
      },
    };

    // 4. Write to cache
    try {
      await this._cacheWriter.write(result);
    } catch (err) {
      logger.warn(`Failed to write cache: ${err}`);
      // Non-fatal — analysis still returned to UI
    }

    const elapsed = Date.now() - startTime;
    logger.info(
      `Analysis complete for ${symbol.kind} "${symbol.name}" in ${elapsed}ms` +
        (llmProviderName ? ` (with ${llmProviderName})` : ' (static only)')
    );

    this._onAnalysisComplete.fire(result);
    return result;
  }

  dispose(): void {
    this._onAnalysisComplete.dispose();
  }
}
