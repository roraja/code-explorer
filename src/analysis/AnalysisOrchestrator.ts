/**
 * Code Explorer — Analysis Orchestrator
 *
 * Coordinates the analysis pipeline:
 * 1. Check disk cache — return immediately on hit
 * 2. Read symbol source code
 * 3. Run LLM analysis
 * 4. Write to cache
 *
 * Supports two flows:
 * - analyzeSymbol(symbol): Takes a pre-resolved SymbolInfo (legacy/programmatic)
 * - analyzeFromCursor(cursor): Takes raw CursorContext, asks the LLM to both
 *   identify the symbol kind and perform analysis in one call (fast path)
 */
import * as vscode from 'vscode';
import type { AnalysisResult, AnalysisProgressCallback, SymbolInfo, CursorContext, RelatedSymbolAnalysis } from '../models/types';
import type { LLMProvider } from '../llm/LLMProvider';
import type { CacheStore } from '../cache/CacheStore';
import { PromptBuilder } from '../llm/PromptBuilder';
import { ResponseParser, ResolvedSymbolIdentity, RelatedSymbolCacheEntry } from '../llm/ResponseParser';
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

    // 2b. For variables/properties, also read the containing scope source
    let containingScopeSource: string | undefined;
    if (symbol.kind === 'variable' || symbol.kind === 'property' || symbol.kind === 'parameter') {
      logger.logLLMStep('Reading containing scope source for variable/property analysis...');
      containingScopeSource = await withTimeout(
        this._staticAnalyzer.readContainingScopeSource(symbol),
        STATIC_ANALYSIS_TIMEOUT_MS,
        '',
        'readContainingScopeSource'
      );
      logger.logLLMStep(`Containing scope source: ${containingScopeSource ? containingScopeSource.length : 0} chars`);
    }

    // 3. LLM analysis
    onProgress?.('llm-analyzing');
    let llmResult: Partial<AnalysisResult> = {};
    let llmProviderName: string | undefined;

    try {
      logger.logLLMStep(`Checking if LLM provider "${this._llmProvider.name}" is available...`);
      const available = await this._llmProvider.isAvailable();
      if (available && sourceCode) {
        logger.logLLMStep(`LLM provider available — building prompt (${symbol.kind} strategy)...`);
        logger.info(`Orchestrator: running LLM analysis with ${this._llmProvider.name}`);

        const prompt = PromptBuilder.build(symbol, sourceCode, containingScopeSource);
        logger.logLLMStep(`Prompt built (${prompt.length} chars), sending to ${this._llmProvider.name}...`);

        // Log the prompt before sending
        logger.logLLMInput(prompt);

        // Start a real-time output section so streamed chunks appear under a heading
        logger.logLLMStep('Streaming real-time output below...');
        logger.logLLMChunk('\n---\n\n## Real-time Output\n\n```\n');

        const rawResponse = await this._llmProvider.analyze({
          prompt,
          systemPrompt: PromptBuilder.SYSTEM_PROMPT,
          maxTokens: 4096,
        });

        logger.logLLMStep(`Response received (${rawResponse.length} chars), parsing...`);

        // Close the real-time output code fence
        logger.logLLMChunk('\n```\n\n');

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
            `classMembers: ${llmResult.classMembers?.length || 0}, ` +
            `dataFlow: ${llmResult.dataFlow?.length || 0}, ` +
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
      classMembers: llmResult.classMembers,
      memberAccess: llmResult.memberAccess,
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

      // Pre-cache related symbols if any were discovered
      if (result.relatedSymbols && result.relatedSymbols.length > 0) {
        logger.logLLMStep(`Pre-caching ${result.relatedSymbols.length} related symbols...`);
        await this._cacheRelatedSymbols(result.relatedSymbols, llmProviderName);
      }
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
   * Analyze a symbol starting from raw cursor context.
   *
   * This is the fast path: instead of using VS Code's document symbol
   * provider (which is slow on large codebases), we send a single
   * unified prompt to the LLM that both identifies the symbol kind
   * and performs the full analysis.
   *
   * The copilot CLI is invoked with workspace context, so it has
   * access to the full codebase to accurately determine symbol types.
   *
   * @param cursor    Raw cursor context (word, file, surrounding source)
   * @param onProgress  Optional callback invoked when the analysis stage changes
   */
  async analyzeFromCursor(
    cursor: CursorContext,
    onProgress?: AnalysisProgressCallback
  ): Promise<{ symbol: SymbolInfo; result: AnalysisResult }> {
    const startTime = Date.now();
    const cursorKey = `"${cursor.word}" in ${cursor.filePath}:${cursor.position.line}`;
    logger.info(`Orchestrator.analyzeFromCursor: ${cursorKey}`);

    // Start LLM call log
    logger.startLLMCallLog(cursor.word, this._llmProvider.name);
    logger.logLLMStep(`Starting unified analysis (symbol resolution + analysis) for ${cursorKey}`);

    // 1. Check cache BEFORE the LLM call — scan the cache directory
    //    for a matching symbol name near the cursor line (±3 lines).
    //    This avoids an expensive LLM round-trip for previously-analyzed symbols.
    onProgress?.('cache-check');
    logger.logLLMStep(
      `CACHE CHECK: scanning cache directory for symbol="${cursor.word}" ` +
        `near line ${cursor.position.line} in ${cursor.filePath}...`
    );
    try {
      const cached = await this._cache.findByCursor(
        cursor.word,
        cursor.filePath,
        cursor.position.line
      );
      if (cached && !cached.result.metadata.stale && cached.result.metadata.llmProvider) {
        const elapsed = Date.now() - startTime;
        logger.logLLMStep(
          `CACHE HIT (cursor scan) — found cached ${cached.symbol.kind} "${cached.symbol.name}" ` +
            `at line ${cached.symbol.position.line}. ` +
            `Provider: ${cached.result.metadata.llmProvider}, ` +
            `analyzed at: ${cached.result.metadata.analyzedAt}. ` +
            `Resolved in ${elapsed}ms — skipping LLM call.`
        );
        logger.info(
          `Orchestrator: CACHE HIT (cursor scan) for "${cursor.word}" — ` +
            `matched ${cached.symbol.kind} "${cached.symbol.name}" ` +
            `(provider: ${cached.result.metadata.llmProvider}). No LLM call needed.`
        );
        this._onAnalysisComplete.fire(cached.result);
        return cached;
      } else if (cached && cached.result.metadata.stale) {
        logger.logLLMStep(
          `CACHE FOUND but STALE — found cached "${cached.symbol.name}" but metadata.stale=true. ` +
            `Will re-analyze with LLM.`
        );
      } else if (cached && !cached.result.metadata.llmProvider) {
        logger.logLLMStep(
          `CACHE FOUND but NO LLM DATA — found cached "${cached.symbol.name}" ` +
            `but no llmProvider (static-only). Will analyze with LLM.`
        );
      } else {
        logger.logLLMStep(
          `CACHE MISS (cursor scan) — no matching cache file found ` +
            `for symbol="${cursor.word}" near line ${cursor.position.line}. ` +
            `Will run LLM analysis.`
        );
      }
    } catch (err) {
      logger.logLLMStep(`CACHE ERROR during cursor scan: ${err}. Treating as cache miss.`);
      logger.debug(`Orchestrator: cache findByCursor error: ${err}`);
    }

    // 2. Build unified prompt (resolution + analysis in one call)
    onProgress?.('resolving-symbol');
    logger.logLLMStep('Building unified prompt (symbol identification + full analysis)...');

    const prompt = PromptBuilder.buildUnified(cursor, this._cache.cacheRoot);
    logger.logLLMStep(`Unified prompt built (${prompt.length} chars), sending to ${this._llmProvider.name}...`);
    logger.logLLMInput(prompt);

    // 3. Send to LLM
    onProgress?.('llm-analyzing');
    let rawResponse = '';
    let identity: ResolvedSymbolIdentity = {
      name: cursor.word,
      kind: 'unknown',
      container: null,
      scopeChain: [],
    };
    let llmResult: Partial<AnalysisResult> = {};
    let llmProviderName: string | undefined;

    try {
      logger.logLLMStep(`Checking if LLM provider "${this._llmProvider.name}" is available...`);
      const available = await this._llmProvider.isAvailable();

      if (available) {
        logger.logLLMStep(`LLM provider available — sending unified prompt to ${this._llmProvider.name}...`);
        logger.info(`Orchestrator: running unified LLM analysis with ${this._llmProvider.name}`);

        // Start real-time output section
        logger.logLLMStep('Streaming real-time output below...');
        logger.logLLMChunk('\n---\n\n## Real-time Output\n\n```\n');

        rawResponse = await this._llmProvider.analyze({
          prompt,
          systemPrompt: PromptBuilder.SYSTEM_PROMPT,
          maxTokens: 4096,
        });

        // Close the real-time output code fence
        logger.logLLMChunk('\n```\n\n');

        logger.logLLMStep(`Response received (${rawResponse.length} chars), parsing symbol identity...`);
        logger.logLLMOutput(rawResponse);

        // 3a. Parse symbol identity from the response
        identity = ResponseParser.parseSymbolIdentity(rawResponse, cursor.word);
        logger.logLLMStep(
          `Symbol identified: ${identity.kind} "${identity.name}"` +
            (identity.container ? ` in ${identity.container}` : '') +
            (identity.scopeChain.length > 0 ? ` scope=[${identity.scopeChain.join('.')}]` : '')
        );

        // 3b. Parse the full analysis from the same response
        logger.logLLMStep('Parsing full analysis from response...');
        const tempSymbol: SymbolInfo = {
          name: identity.name,
          kind: identity.kind,
          filePath: cursor.filePath,
          position: cursor.position,
          containerName: identity.container || undefined,
          scopeChain: identity.scopeChain,
        };
        llmResult = ResponseParser.parse(rawResponse, tempSymbol);
        llmProviderName = this._llmProvider.name;

        logger.logLLMStep(
          `Parsed LLM response — overview: ${(llmResult.overview || '').length} chars, ` +
            `keyMethods: ${llmResult.keyMethods?.length || 0}, ` +
            `steps: ${llmResult.functionSteps?.length || 0}, ` +
            `subFunctions: ${llmResult.subFunctions?.length || 0}, ` +
            `classMembers: ${llmResult.classMembers?.length || 0}, ` +
            `dataFlow: ${llmResult.dataFlow?.length || 0}, ` +
            `issues: ${llmResult.potentialIssues?.length || 0}`
        );
      } else {
        logger.logLLMStep(`LLM provider "${this._llmProvider.name}" not available — cannot resolve or analyze`);
        logger.warn(`Orchestrator: LLM provider "${this._llmProvider.name}" not available`);
      }
    } catch (err) {
      logger.logLLMStep(`Unified LLM analysis FAILED: ${err}`);
      logger.error(`Orchestrator: unified LLM analysis failed: ${err}`);
    }

    // 4. Build the resolved SymbolInfo
    const resolvedSymbol: SymbolInfo = {
      name: identity.name,
      kind: identity.kind,
      filePath: cursor.filePath,
      position: cursor.position,
      containerName: identity.container || undefined,
      scopeChain: identity.scopeChain,
    };

    // 5. Build result from the LLM response we already have
    logger.logLLMStep('Building analysis result...');
    const result: AnalysisResult = {
      symbol: resolvedSymbol,
      overview:
        llmResult.overview || `${resolvedSymbol.kind} **${resolvedSymbol.name}** in \`${resolvedSymbol.filePath}\``,
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
      classMembers: llmResult.classMembers,
      memberAccess: llmResult.memberAccess,
      metadata: {
        analyzedAt: new Date().toISOString(),
        sourceHash: '',
        dependentFileHashes: {},
        llmProvider: llmProviderName,
        analysisVersion: ANALYSIS_VERSION,
        stale: false,
      },
    };

    // 6. Write to cache
    onProgress?.('writing-cache');
    logger.logLLMStep('Writing results to disk cache...');
    try {
      await this._cache.write(result);
      logger.logLLMStep('Cache write successful');

      // Pre-cache related symbols from json:related_symbols (legacy format)
      if (result.relatedSymbols && result.relatedSymbols.length > 0) {
        logger.logLLMStep(`Pre-caching ${result.relatedSymbols.length} related symbols (legacy)...`);
        await this._cacheRelatedSymbols(result.relatedSymbols, llmProviderName);
      }

      // Pre-cache related symbol analyses from json:related_symbol_analyses
      // These come with cache file paths matching our naming convention
      if (rawResponse) {
        const relatedCacheEntries = ResponseParser.parseRelatedSymbolCacheEntries(rawResponse);
        if (relatedCacheEntries.length > 0) {
          logger.logLLMStep(`Pre-caching ${relatedCacheEntries.length} related symbol analyses (with cache paths)...`);
          await this._cacheRelatedSymbolAnalyses(relatedCacheEntries, llmProviderName);
        }
      }
    } catch (err) {
      logger.logLLMStep(`Cache write FAILED: ${err}`);
      logger.warn(`Orchestrator: cache write failed: ${err}`);
    }

    const elapsed = Date.now() - startTime;
    logger.logLLMStep(
      `Unified analysis complete in ${elapsed}ms` +
        (llmProviderName ? ` (with ${llmProviderName})` : ' (no LLM)') +
        ` — resolved as ${resolvedSymbol.kind} "${resolvedSymbol.name}"`
    );
    logger.info(
      `Orchestrator: unified analysis complete for "${resolvedSymbol.name}" (${resolvedSymbol.kind}) in ${elapsed}ms`
    );

    this._onAnalysisComplete.fire(result);
    return { symbol: resolvedSymbol, result };
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

  /**
   * Pre-cache related symbol analyses generated by the LLM during
   * unified analysis. These come with cache file paths matching our
   * naming convention, so they get stored at the right location for
   * future cache hits.
   *
   * Only writes cache entries for symbols that don't already have one,
   * so existing (potentially richer) analyses are never overwritten.
   */
  private async _cacheRelatedSymbolAnalyses(
    entries: RelatedSymbolCacheEntry[],
    llmProviderName: string | undefined
  ): Promise<void> {
    for (const entry of entries) {
      const symbolInfo: SymbolInfo = {
        name: entry.name,
        kind: entry.kind,
        filePath: entry.filePath,
        position: { line: entry.line, character: 0 },
        containerName: entry.container || undefined,
        scopeChain: entry.scopeChain,
      };

      // Skip if already cached — don't overwrite richer analyses
      try {
        const existing = await this._cache.read(symbolInfo);
        if (existing && !existing.metadata.stale) {
          logger.debug(
            `Orchestrator: skipping related symbol cache for "${entry.name}" — already cached`
          );
          continue;
        }
      } catch {
        // Cache read error — proceed to write
      }

      const result: AnalysisResult = {
        symbol: symbolInfo,
        overview: entry.overview,
        callStacks: [],
        usages: [],
        dataFlow: [],
        relationships: [],
        keyMethods: entry.keyPoints,
        dependencies: entry.dependencies,
        potentialIssues: entry.potentialIssues,
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
        await this._cache.write(result);
        logger.info(`Orchestrator: pre-cached related "${entry.name}" (${entry.kind}) in ${entry.filePath}`);
      } catch (err) {
        logger.debug(`Orchestrator: failed to pre-cache related "${entry.name}": ${err}`);
      }
    }
  }

  dispose(): void {
    this._onAnalysisComplete.dispose();
  }
}
