/**
 * Code Explorer — Analysis Orchestrator
 *
 * Coordinates the analysis pipeline:
 * 1. Check disk cache — return immediately on hit
 * 2. Read symbol source code
 * 3. Run LLM analysis
 * 4. Write to cache
 */
import * as vscode from 'vscode';
import type { AnalysisResult, AnalysisProgressCallback, SymbolInfo } from '../models/types';
import type { LLMProvider } from '../llm/LLMProvider';
import type { CacheStore } from '../cache/CacheStore';
import { PromptBuilder } from '../llm/PromptBuilder';
import { ResponseParser } from '../llm/ResponseParser';
import { StaticAnalyzer } from './StaticAnalyzer';
import { ANALYSIS_VERSION, STATIC_ANALYSIS_TIMEOUT_MS } from '../models/constants';
import { logger } from '../utils/logger';

/**
 * Race a promise against a timeout. Returns the fallback value on timeout.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T, label: string): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => {
      logger.warn(`${label} timed out after ${ms}ms, using fallback`);
      resolve(fallback);
    }, ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); logger.warn(`${label} failed: ${err}`); resolve(fallback); }
    );
  });
}

export class AnalysisOrchestrator {
  private readonly _onAnalysisComplete = new vscode.EventEmitter<AnalysisResult>();
  readonly onAnalysisComplete = this._onAnalysisComplete.event;

  constructor(
    private readonly _staticAnalyzer: StaticAnalyzer,
    private readonly _llmProvider: LLMProvider,
    private readonly _cache: CacheStore
  ) {}

  /**
   * Analyze a symbol. Returns cached result immediately if available,
   * otherwise runs LLM analysis only (no static analysis).
   *
   * @param force     Skip the cache and re-analyze from scratch.
   * @param onProgress  Optional callback invoked when the analysis stage changes.
   */
  async analyzeSymbol(
    symbol: SymbolInfo,
    force = false,
    onProgress?: AnalysisProgressCallback
  ): Promise<AnalysisResult> {
    const startTime = Date.now();
    const symbolKey = `${symbol.kind} "${symbol.name}" in ${symbol.filePath}`;
    logger.info(`Orchestrator.analyzeSymbol: ${symbolKey}${force ? ' (forced)' : ''}`);

    // Start LLM call log for this symbol
    logger.startLLMCallLog(symbol.name, this._llmProvider.name);
    logger.logLLMStep(`Starting analysis of ${symbolKey}${force ? ' (forced re-analysis)' : ''}`);

    // 1. Check disk cache — return full cached result immediately (unless forced)
    if (!force) {
      onProgress?.('cache-check');
      logger.logLLMStep('CACHE CHECK: Reading disk cache...');
      try {
        const cached = await this._cache.read(symbol);
        if (cached) {
          if (!cached.metadata.stale && cached.metadata.llmProvider) {
            const elapsed = Date.now() - startTime;
            logger.logLLMStep(
              `CACHE HIT — returning full cached result. ` +
                `Reason: found non-stale cache entry with LLM data. ` +
                `Provider: ${cached.metadata.llmProvider}, ` +
                `analyzed at: ${cached.metadata.analyzedAt}, ` +
                `version: ${cached.metadata.analysisVersion}. ` +
                `Resolved in ${elapsed}ms.`
            );
            logger.info(
              `Orchestrator: CACHE HIT for "${symbol.name}" — ` +
                `returning cached result (provider: ${cached.metadata.llmProvider}, ` +
                `analyzed: ${cached.metadata.analyzedAt}). No re-analysis needed.`
            );
            this._onAnalysisComplete.fire(cached);
            return cached;
          } else if (cached.metadata.stale) {
            logger.logLLMStep(
              `CACHE MISS — cache entry exists but is STALE. ` +
                `Reason: metadata.stale=true. ` +
                `Original provider: ${cached.metadata.llmProvider || 'none'}, ` +
                `analyzed at: ${cached.metadata.analyzedAt}. ` +
                `Will re-analyze with LLM.`
            );
            logger.info(`Orchestrator: CACHE MISS (stale) for "${symbol.name}", will re-analyze`);
          } else if (!cached.metadata.llmProvider) {
            logger.logLLMStep(
              `CACHE MISS — cache entry exists but has NO LLM data. ` +
                `Reason: metadata.llmProvider is empty (static-only result). ` +
                `Analyzed at: ${cached.metadata.analyzedAt}. ` +
                `Will analyze with LLM.`
            );
            logger.info(`Orchestrator: CACHE MISS (no LLM data) for "${symbol.name}", will analyze`);
          }
        } else {
          logger.logLLMStep(
            `CACHE MISS — no cache entry found for ${symbolKey}. ` +
              `Reason: cache.read() returned null. Will analyze with LLM.`
          );
          logger.info(`Orchestrator: CACHE MISS (no entry) for "${symbol.name}"`);
        }
      } catch (err) {
        logger.logLLMStep(
          `CACHE ERROR — failed to read cache: ${err}. ` +
            `Treating as cache miss, will analyze with LLM.`
        );
        logger.debug(`Orchestrator: cache read error: ${err}`);
      }
    } else {
      logger.logLLMStep(
        `CACHE SKIP — forced re-analysis requested. ` +
          `Reason: force=true parameter. Will analyze with LLM regardless of cache state.`
      );
    }

    // 2. Read source code (needed for the LLM prompt)
    onProgress?.('reading-source');
    logger.logLLMStep('Reading symbol source code...');
    const sourceCode = await withTimeout(
      this._staticAnalyzer.readSymbolSource(symbol),
      STATIC_ANALYSIS_TIMEOUT_MS,
      '',
      'readSymbolSource'
    );
    logger.logLLMStep(`Source code: ${sourceCode.length} chars`);

    // 3. LLM analysis
    onProgress?.('llm-analyzing');
    let llmResult: Partial<AnalysisResult> = {};
    let llmProviderName: string | undefined;

    try {
      logger.logLLMStep(`Checking if LLM provider "${this._llmProvider.name}" is available...`);
      const available = await this._llmProvider.isAvailable();
      if (available && sourceCode) {
        logger.logLLMStep(`LLM provider available — building prompt...`);
        logger.info(`Orchestrator: running LLM analysis with ${this._llmProvider.name}`);

        const prompt = PromptBuilder.build(symbol, sourceCode);
        logger.logLLMStep(`Prompt built (${prompt.length} chars), sending to ${this._llmProvider.name}...`);

        // Log the prompt before sending
        logger.logLLMInput(prompt);

        const rawResponse = await this._llmProvider.analyze({
          prompt,
          systemPrompt: PromptBuilder.SYSTEM_PROMPT,
          maxTokens: 4096,
        });

        logger.logLLMStep(`Response received (${rawResponse.length} chars), parsing...`);

        logger.debug(
          `Orchestrator: LLM raw response (first 500 chars): ${rawResponse.substring(0, 500).replace(/\n/g, '\\n')}`
        );

        llmResult = ResponseParser.parse(rawResponse, symbol);
        llmProviderName = this._llmProvider.name;

        logger.logLLMStep(
          `Parsed LLM response — overview: ${(llmResult.overview || '').length} chars, ` +
            `keyMethods: ${llmResult.keyMethods?.length || 0}, ` +
            `steps: ${llmResult.functionSteps?.length || 0}, ` +
            `subFunctions: ${llmResult.subFunctions?.length || 0}, ` +
            `issues: ${llmResult.potentialIssues?.length || 0}`
        );

        // Log the full response
        logger.logLLMOutput(rawResponse);
      } else if (!available) {
        logger.logLLMStep(`LLM provider "${this._llmProvider.name}" not available — no analysis possible`);
        logger.warn(`Orchestrator: LLM provider "${this._llmProvider.name}" not available`);
      } else {
        logger.logLLMStep('No source code available — cannot run LLM analysis');
        logger.warn('Orchestrator: no source code, skipping LLM');
      }
    } catch (err) {
      logger.logLLMStep(`LLM analysis FAILED: ${err}`);
      logger.error(`Orchestrator: LLM analysis failed: ${err}`);
    }

    // 4. Build result
    logger.logLLMStep('Building analysis result...');
    const result: AnalysisResult = {
      symbol,
      overview:
        llmResult.overview || `${symbol.kind} **${symbol.name}** in \`${symbol.filePath}\``,
      callStacks: llmResult.callStacks || [],
      usages: llmResult.usages || [],
      dataFlow: llmResult.dataFlow || [],
      relationships: [],
      keyMethods: llmResult.keyMethods,
      dependencies: llmResult.dependencies,
      usagePattern: llmResult.usagePattern,
      potentialIssues: llmResult.potentialIssues,
      variableLifecycle: llmResult.variableLifecycle,
      functionSteps: llmResult.functionSteps,
      subFunctions: llmResult.subFunctions,
      functionInputs: llmResult.functionInputs,
      functionOutput: llmResult.functionOutput,
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
    onProgress?.('writing-cache');
    logger.logLLMStep('Writing results to disk cache...');
    try {
      await this._cache.write(result);
      logger.logLLMStep('Cache write successful');
    } catch (err) {
      logger.logLLMStep(`Cache write FAILED: ${err}`);
      logger.warn(`Orchestrator: cache write failed: ${err}`);
    }

    const elapsed = Date.now() - startTime;
    logger.logLLMStep(
      `Analysis complete in ${elapsed}ms` +
        (llmProviderName ? ` (with ${llmProviderName})` : ' (no LLM)')
    );
    logger.info(
      `Orchestrator: analysis complete for "${symbol.name}" in ${elapsed}ms` +
        (llmProviderName ? ` (with ${llmProviderName})` : ' (no LLM)')
    );

    this._onAnalysisComplete.fire(result);
    return result;
  }

  /**
   * Pre-cache related symbols discovered by the LLM during analysis.
   * Only writes cache entries for symbols that don't already have one,
   * so existing (potentially richer) analyses are never overwritten.
   */
  private async _cacheRelatedSymbols(
    relatedSymbols: RelatedSymbolAnalysis[],
    llmProviderName: string | undefined
  ): Promise<void> {
    for (const related of relatedSymbols) {
      const relatedSymbolInfo: SymbolInfo = {
        name: related.name,
        kind: related.kind,
        filePath: related.filePath,
        position: { line: related.line, character: 0 },
      };

      // Skip if already cached — don't overwrite richer analyses
      try {
        const existing = await this._cache.read(relatedSymbolInfo);
        if (existing && !existing.metadata.stale) {
          logger.debug(
            `Orchestrator: skipping pre-cache for "${related.name}" — already cached`
          );
          continue;
        }
      } catch {
        // Cache read error — proceed to write
      }

      const relatedResult: AnalysisResult = {
        symbol: relatedSymbolInfo,
        overview: related.overview,
        callStacks: [],
        usages: [],
        dataFlow: [],
        relationships: [],
        keyMethods: related.keyPoints,
        dependencies: related.dependencies,
        potentialIssues: related.potentialIssues,
        metadata: {
          analyzedAt: new Date().toISOString(),
          sourceHash: '',
          dependentFileHashes: {},
          llmProvider: llmProviderName,
          analysisVersion: ANALYSIS_VERSION,
          stale: false,
        },
      };

      try {
        await this._cache.write(relatedResult);
        logger.info(`Orchestrator: pre-cached related symbol "${related.name}" in ${related.filePath}`);
      } catch (err) {
        logger.debug(`Orchestrator: failed to pre-cache "${related.name}": ${err}`);
      }
    }
  }

  dispose(): void {
    this._onAnalysisComplete.dispose();
  }
}
