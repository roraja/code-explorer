/**
 * Code Explorer — Analysis Orchestrator
 *
 * Coordinates the full analysis pipeline:
 * 1. Check disk cache — return immediately on hit
 * 2. Run static analysis (references, call hierarchy, type hierarchy)
 * 3. Run LLM analysis (if available)
 * 4. Merge results
 * 5. Write to cache
 */
import * as vscode from 'vscode';
import type { AnalysisResult, SymbolInfo } from '../models/types';
import type { LLMProvider } from '../llm/LLMProvider';
import type { CacheStore } from '../cache/CacheStore';
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
    private readonly _cache: CacheStore
  ) {}

  /**
   * Analyze a symbol. Returns cached result if available,
   * otherwise runs the full static + LLM pipeline.
   *
   * @param force  Skip the cache and re-analyze from scratch.
   */
  async analyzeSymbol(symbol: SymbolInfo, force = false): Promise<AnalysisResult> {
    const startTime = Date.now();
    logger.info(
      `Orchestrator.analyzeSymbol: ${symbol.kind} "${symbol.name}" in ${symbol.filePath}` +
        (force ? ' (forced)' : '')
    );

    // 1. Check disk cache (unless forced)
    if (!force) {
      try {
        const cached = await this._cache.read(symbol);
        if (cached && !cached.metadata.stale) {
          const elapsed = Date.now() - startTime;
          logger.info(
            `Orchestrator: CACHE HIT for "${symbol.name}" in ${elapsed}ms ` +
              `(analyzed ${cached.metadata.analyzedAt}, provider: ${cached.metadata.llmProvider || 'static'})`
          );
          this._onAnalysisComplete.fire(cached);
          return cached;
        }
        if (cached) {
          logger.info(`Orchestrator: cache is stale for "${symbol.name}", re-analyzing`);
        }
      } catch (err) {
        logger.debug(`Orchestrator: cache read error: ${err}`);
      }
    }

    // 2. Static analysis (fast, always available)
    logger.info(`Orchestrator: running static analysis for "${symbol.name}"`);
    const [usages, callStacks, relationships, sourceCode] = await Promise.all([
      this._staticAnalyzer.findReferences(symbol),
      this._staticAnalyzer.buildCallHierarchy(symbol),
      this._staticAnalyzer.getTypeHierarchy(symbol),
      this._staticAnalyzer.readSymbolSource(symbol),
    ]);

    logger.info(
      `Orchestrator: static analysis done — ${usages.length} refs, ${callStacks.length} callers, ` +
        `${relationships.length} relationships, source: ${sourceCode.length} chars`
    );

    // 3. LLM analysis (slow, may be unavailable)
    let llmResult: Partial<AnalysisResult> = {};
    let llmProviderName: string | undefined;

    try {
      const available = await this._llmProvider.isAvailable();
      if (available && sourceCode) {
        logger.info(`Orchestrator: running LLM analysis with ${this._llmProvider.name}`);

        const prompt = PromptBuilder.build(symbol, sourceCode, usages);
        const rawResponse = await this._llmProvider.analyze({
          prompt,
          systemPrompt: PromptBuilder.SYSTEM_PROMPT,
          maxTokens: 4096,
        });

        logger.debug(
          `Orchestrator: LLM raw response (first 500 chars): ${rawResponse.substring(0, 500).replace(/\n/g, '\\n')}`
        );

        llmResult = ResponseParser.parse(rawResponse, symbol);
        llmProviderName = this._llmProvider.name;

        logger.info(
          `Orchestrator: LLM done — overview: ${(llmResult.overview || '').length} chars, ` +
            `keyMethods: ${llmResult.keyMethods?.length || 0}, ` +
            `dependencies: ${llmResult.dependencies?.length || 0}, ` +
            `issues: ${llmResult.potentialIssues?.length || 0}`
        );
      } else if (!available) {
        logger.warn(
          `Orchestrator: LLM provider "${this._llmProvider.name}" not available, static only`
        );
      } else {
        logger.warn('Orchestrator: no source code, skipping LLM');
      }
    } catch (err) {
      logger.error(`Orchestrator: LLM analysis failed: ${err}`);
    }

    // 4. Merge results
    const result: AnalysisResult = {
      symbol,
      overview:
        llmResult.overview || `${symbol.kind} **${symbol.name}** in \`${symbol.filePath}\``,
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

    // 5. Write to cache
    try {
      await this._cache.write(result);
    } catch (err) {
      logger.warn(`Orchestrator: cache write failed: ${err}`);
    }

    const elapsed = Date.now() - startTime;
    logger.info(
      `Orchestrator: analysis complete for "${symbol.name}" in ${elapsed}ms` +
        (llmProviderName ? ` (with ${llmProviderName})` : ' (static only)')
    );

    this._onAnalysisComplete.fire(result);
    return result;
  }

  dispose(): void {
    this._onAnalysisComplete.dispose();
  }
}
