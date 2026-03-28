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

    // Start LLM call log for this symbol
    logger.startLLMCallLog(symbol.name, this._llmProvider.name);
    logger.logLLMStep(
      `Starting analysis of ${symbol.kind} "${symbol.name}" in ${symbol.filePath}` +
        (force ? ' (forced re-analysis)' : '')
    );

    // 1. Check disk cache (unless forced)
    let cachedLLMFields: Partial<AnalysisResult> | null = null;
    let cachedMeta: AnalysisResult['metadata'] | null = null;

    if (!force) {
      logger.logLLMStep('Checking disk cache...');
      try {
        const cached = await this._cache.read(symbol);
        if (cached && !cached.metadata.stale) {
          if (cached.metadata.llmProvider) {
            cachedLLMFields = {
              overview: cached.overview,
              keyMethods: cached.keyMethods,
              dependencies: cached.dependencies,
              usagePattern: cached.usagePattern,
              potentialIssues: cached.potentialIssues,
              variableLifecycle: cached.variableLifecycle,
              dataFlow: cached.dataFlow,
              functionSteps: cached.functionSteps,
              subFunctions: cached.subFunctions,
              functionInputs: cached.functionInputs,
              functionOutput: cached.functionOutput,
              relatedSymbols: cached.relatedSymbols,
            };
            cachedMeta = cached.metadata;
            logger.logLLMStep(
              `CACHE HIT — reusing LLM fields from ${cached.metadata.llmProvider} ` +
                `(analyzed ${cached.metadata.analyzedAt}), will refresh static data only`
            );
            logger.info(
              `Orchestrator: CACHE HIT (LLM fields) for "${symbol.name}" ` +
                `(analyzed ${cached.metadata.analyzedAt}, provider: ${cached.metadata.llmProvider}), ` +
                `refreshing static data`
            );
          } else {
            logger.logLLMStep('Cache has static-only data, will re-analyze fully');
            logger.info(`Orchestrator: static-only cache for "${symbol.name}", re-analyzing`);
          }
        } else if (cached?.metadata.stale) {
          logger.logLLMStep('Cache is stale, will re-analyze fully');
          logger.info(`Orchestrator: cache is stale for "${symbol.name}", re-analyzing`);
        } else {
          logger.logLLMStep('No cache entry found');
        }
      } catch (err) {
        logger.logLLMStep(`Cache read error: ${err}`);
        logger.debug(`Orchestrator: cache read error: ${err}`);
      }
    } else {
      logger.logLLMStep('Skipping cache (forced re-analysis)');
    }

    // 2. Static analysis (fast, always available)
    logger.logLLMStep('Running static analysis (references, call hierarchy, type hierarchy, source)...');
    logger.info(`Orchestrator: running static analysis for "${symbol.name}"`);
    const timeout = STATIC_ANALYSIS_TIMEOUT_MS;
    const [usages, callStacks, relationships, sourceCode] = await Promise.all([
      withTimeout(this._staticAnalyzer.findReferences(symbol), timeout, [], 'findReferences'),
      withTimeout(this._staticAnalyzer.buildCallHierarchy(symbol), timeout, [], 'buildCallHierarchy'),
      withTimeout(this._staticAnalyzer.getTypeHierarchy(symbol), timeout, [], 'getTypeHierarchy'),
      withTimeout(this._staticAnalyzer.readSymbolSource(symbol), timeout, '', 'readSymbolSource'),
    ]);

    logger.logLLMStep(
      `Static analysis complete — ${usages.length} refs, ${callStacks.length} callers, ` +
        `${relationships.length} relationships, source: ${sourceCode.length} chars`
    );
    logger.info(
      `Orchestrator: static analysis done — ${usages.length} refs, ${callStacks.length} callers, ` +
        `${relationships.length} relationships, source: ${sourceCode.length} chars`
    );

    // 3. LLM analysis (slow, may be unavailable) — skip if cached LLM data is available
    let llmResult: Partial<AnalysisResult> = {};
    let llmProviderName: string | undefined;

    if (cachedLLMFields) {
      // Re-use cached LLM fields
      llmResult = cachedLLMFields;
      llmProviderName = cachedMeta?.llmProvider;
      logger.logLLMStep(`Using cached LLM data from ${llmProviderName}, skipping LLM call`);
      logger.info(`Orchestrator: using cached LLM data from ${llmProviderName}`);
    } else {
      try {
        logger.logLLMStep(`Checking if LLM provider "${this._llmProvider.name}" is available...`);
        const available = await this._llmProvider.isAvailable();
        if (available && sourceCode) {
          logger.logLLMStep(`LLM provider available — building prompt...`);
          logger.info(`Orchestrator: running LLM analysis with ${this._llmProvider.name}`);

          const prompt = PromptBuilder.build(symbol, sourceCode, usages);
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
              `dependencies: ${llmResult.dependencies?.length || 0}, ` +
              `issues: ${llmResult.potentialIssues?.length || 0}`
          );

          // Log the full response
          logger.logLLMOutput(rawResponse);

          logger.info(
            `Orchestrator: LLM done — overview: ${(llmResult.overview || '').length} chars, ` +
              `keyMethods: ${llmResult.keyMethods?.length || 0}, ` +
              `dependencies: ${llmResult.dependencies?.length || 0}, ` +
              `issues: ${llmResult.potentialIssues?.length || 0}`
          );
        } else if (!available) {
          logger.logLLMStep(`LLM provider "${this._llmProvider.name}" not available — falling back to static only`);
          logger.warn(
            `Orchestrator: LLM provider "${this._llmProvider.name}" not available, static only`
          );
        } else {
          logger.logLLMStep('No source code available — skipping LLM analysis');
          logger.warn('Orchestrator: no source code, skipping LLM');
        }
      } catch (err) {
        logger.logLLMStep(`LLM analysis FAILED: ${err}`);
        logger.error(`Orchestrator: LLM analysis failed: ${err}`);
      }
    }

    // 4. Merge results
    logger.logLLMStep('Merging static + LLM results...');
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
    logger.logLLMStep('Writing results to disk cache...');
    try {
      await this._cache.write(result);
      logger.logLLMStep('Cache write successful');
    } catch (err) {
      logger.logLLMStep(`Cache write FAILED: ${err}`);
      logger.warn(`Orchestrator: cache write failed: ${err}`);
    }

    const elapsed = Date.now() - startTime;
    logger.logLLMStep(`Analysis complete in ${elapsed}ms` + (llmProviderName ? ` (with ${llmProviderName})` : ' (static only)'));
    logger.info(
      `Orchestrator: analysis complete for "${symbol.name}" in ${elapsed}ms` +
        (llmProviderName ? ` (with ${llmProviderName})` : ' (static only)')
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
