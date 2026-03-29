/**
 * Code Explorer — Cache Store
 *
 * Reads and writes analysis results as markdown files in the workspace
 * cache directory at .vscode/code-explorer/.
 *
 * Each analyzed symbol gets a markdown file with YAML frontmatter
 * (metadata) and a human-readable body.
 *
 * File path: .vscode/code-explorer/<source-path>/<kind>.<Name>.md
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  AnalysisResult,
  SymbolInfo,
  SymbolKindType,
  AnalysisMetadata,
  CursorContext,
  CallStackEntry,
  UsageEntry,
  DataFlowEntry,
  ClassMemberInfo,
} from '../models/types';
import { SYMBOL_KIND_PREFIX } from '../models/types';
import { CACHE, ANALYSIS_VERSION, CACHE_FALLBACK_LLM_TIMEOUT_MS } from '../models/constants';
import { logger } from '../utils/logger';
import { runCLI } from '../utils/cli';

/**
 * Summary of a cached symbol — lightweight metadata used for
 * the LLM-assisted cache fallback search.
 */
export interface CachedSymbolSummary {
  /** Cache file name (e.g. "fn.printBanner.md") */
  fileName: string;
  /** Symbol name from frontmatter */
  name: string;
  /** Symbol kind from frontmatter */
  kind: SymbolKindType;
  /** Line number from frontmatter */
  line: number;
  /** Scope chain from frontmatter (dot-separated) */
  scopeChain: string[];
  /** First ~150 chars of the overview section, if available */
  overviewSnippet: string;
}

export class CacheStore {
  private readonly _cacheRoot: string;

  constructor(workspaceRoot: string) {
    this._cacheRoot = path.join(workspaceRoot, '.vscode', CACHE.DIR_NAME);
  }

  /** Get the absolute path to the cache root directory. */
  get cacheRoot(): string {
    return this._cacheRoot;
  }

  // ── Clear ───────────────────────────────────────────────

  /**
   * Delete all cached analysis files.
   */
  async clear(): Promise<void> {
    logger.info(`CacheStore.clear: removing ${this._cacheRoot}`);
    await fs.rm(this._cacheRoot, { recursive: true, force: true });
  }

  // ── Read ────────────────────────────────────────────────

  /**
   * Try to read a cached analysis for a symbol.
   * Returns the AnalysisResult if the cache file exists and is parseable,
   * or null on cache miss.
   */
  async read(symbol: SymbolInfo): Promise<AnalysisResult | null> {
    const filePath = this._resolvePath(symbol);
    logger.debug(`CacheStore.read: looking for ${filePath}`);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const result = this._deserialize(content, symbol);
      if (result) {
        const age = Date.now() - new Date(result.metadata.analyzedAt).getTime();
        const ageHours = Math.round(age / 3600000);
        logger.info(
          `CacheStore.read: HIT for ${symbol.kind} "${symbol.name}" ` +
            `(${ageHours}h old, provider: ${result.metadata.llmProvider || 'static'})`
        );
      }
      return result;
    } catch {
      logger.debug(`CacheStore.read: MISS for ${symbol.kind} "${symbol.name}"`);
      return null;
    }
  }

  // ── Fuzzy Cursor Lookup ────────────────────────────────

  /** Tolerance for line-number matching when looking up by cursor (±3 lines). */
  private static readonly _lineTolerance = 3;

  /**
   * Search for a cached analysis matching a cursor position.
   *
   * Because the cursor-based flow doesn't know the symbol kind or scope
   * chain up-front, we can't compute the exact cache file path. Instead
   * we scan the cache directory for the given source file and inspect
   * every cached `.md` file's YAML frontmatter:
   *
   *   1. `symbol` field must match `word` (case-sensitive).
   *   2. `line` field must be within ±3 lines of `cursorLine`.
   *
   * Returns the first matching `{ symbol, result }` or null on miss.
   */
  async findByCursor(
    word: string,
    filePath: string,
    cursorLine: number
  ): Promise<{ symbol: SymbolInfo; result: AnalysisResult } | null> {
    const cacheDir = path.join(this._cacheRoot, filePath);
    logger.info(
      `CacheStore.findByCursor: searching for symbol="${word}" ` +
        `near line ${cursorLine} in ${cacheDir}`
    );

    // 1. List all .md files in the source file's cache directory
    let entries: string[];
    try {
      entries = await fs.readdir(cacheDir);
    } catch {
      logger.debug(`CacheStore.findByCursor: cache directory does not exist: ${cacheDir}`);
      return null;
    }

    const mdFiles = entries.filter((e) => e.endsWith('.md'));
    logger.debug(
      `CacheStore.findByCursor: found ${mdFiles.length} cache files in ${cacheDir}: ` +
        `[${mdFiles.join(', ')}]`
    );

    if (mdFiles.length === 0) {
      logger.info('CacheStore.findByCursor: no cache files — MISS');
      return null;
    }

    // 2. Scan each file's frontmatter for a matching symbol + line
    for (const mdFile of mdFiles) {
      const fullPath = path.join(cacheDir, mdFile);
      let content: string;
      try {
        content = await fs.readFile(fullPath, 'utf-8');
      } catch (err) {
        logger.debug(`CacheStore.findByCursor: cannot read ${mdFile}: ${err}`);
        continue;
      }

      // Quick-parse just the frontmatter (no full deserialization yet)
      const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!fmMatch) {
        logger.debug(`CacheStore.findByCursor: ${mdFile} has no frontmatter — skipping`);
        continue;
      }

      const fm = this._parseFrontmatter(fmMatch[1]);
      const cachedSymbolName = fm['symbol'] || '';
      const cachedLine = parseInt(fm['line'] || '', 10);
      const cachedKind = (fm['kind'] || 'unknown') as SymbolKindType;
      const cachedScopeChain = fm['scope_chain'] ? fm['scope_chain'].split('.') : [];

      logger.debug(
        `CacheStore.findByCursor: checking ${mdFile} — ` +
          `symbol="${cachedSymbolName}", kind=${cachedKind}, line=${cachedLine}`
      );

      // Match criteria:
      //   a) symbol name matches (case-sensitive)
      //   b) line is within ±LINE_TOLERANCE
      if (cachedSymbolName !== word) {
        logger.debug(
          `CacheStore.findByCursor: ${mdFile} — name mismatch ` +
            `("${cachedSymbolName}" !== "${word}") — skipping`
        );
        continue;
      }

      if (isNaN(cachedLine)) {
        logger.debug(`CacheStore.findByCursor: ${mdFile} — line is NaN — skipping`);
        continue;
      }

      const lineDelta = Math.abs(cachedLine - cursorLine);
      if (lineDelta > CacheStore._lineTolerance) {
        logger.debug(
          `CacheStore.findByCursor: ${mdFile} — line too far ` +
            `(cached=${cachedLine}, cursor=${cursorLine}, delta=${lineDelta}, ` +
            `tolerance=±${CacheStore._lineTolerance}) — skipping`
        );
        continue;
      }

      // 3. Full deserialization — build a SymbolInfo from the frontmatter
      const symbolInfo: SymbolInfo = {
        name: cachedSymbolName,
        kind: cachedKind,
        filePath,
        position: { line: cachedLine, character: 0 },
        containerName:
          cachedScopeChain.length > 0 ? cachedScopeChain[cachedScopeChain.length - 1] : undefined,
        scopeChain: cachedScopeChain,
      };

      const result = this._deserialize(content, symbolInfo);
      if (!result) {
        logger.debug(`CacheStore.findByCursor: ${mdFile} — deserialization failed — skipping`);
        continue;
      }

      const age = Date.now() - new Date(result.metadata.analyzedAt).getTime();
      const ageHours = Math.round(age / 3600000);

      logger.info(
        `CacheStore.findByCursor: HIT — matched "${cachedSymbolName}" ` +
          `(${cachedKind}) at line ${cachedLine} in ${mdFile} ` +
          `(delta=${lineDelta} lines, ${ageHours}h old, ` +
          `provider: ${result.metadata.llmProvider || 'static'}, ` +
          `stale: ${result.metadata.stale})`
      );

      return { symbol: symbolInfo, result };
    }

    logger.info(
      `CacheStore.findByCursor: MISS — scanned ${mdFiles.length} files, ` +
        `no match for symbol="${word}" near line ${cursorLine}`
    );
    return null;
  }

  // ── LLM-Assisted Cache Fallback ──────────────────────────

  /**
   * List all cached symbols for a given source file.
   *
   * Reads the YAML frontmatter and a snippet of the overview from each
   * `.md` cache file. This is intentionally lightweight — no full
   * deserialization — because the result is sent to a fast LLM call
   * for matching.
   *
   * @param filePath  Relative path to the source file from workspace root
   * @returns Array of CachedSymbolSummary for all cached symbols in that file
   */
  async listCachedSymbols(filePath: string): Promise<CachedSymbolSummary[]> {
    const cacheDir = path.join(this._cacheRoot, filePath);
    logger.debug(`CacheStore.listCachedSymbols: scanning ${cacheDir}`);

    let entries: string[];
    try {
      entries = await fs.readdir(cacheDir);
    } catch {
      logger.debug(`CacheStore.listCachedSymbols: directory does not exist: ${cacheDir}`);
      return [];
    }

    const mdFiles = entries.filter((e) => e.endsWith('.md'));
    if (mdFiles.length === 0) {
      return [];
    }

    const summaries: CachedSymbolSummary[] = [];

    for (const mdFile of mdFiles) {
      const fullPath = path.join(cacheDir, mdFile);
      let content: string;
      try {
        content = await fs.readFile(fullPath, 'utf-8');
      } catch {
        continue;
      }

      const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!fmMatch) {
        continue;
      }

      const fm = this._parseFrontmatter(fmMatch[1]);
      const name = fm['symbol'] || '';
      const kind = (fm['kind'] || 'unknown') as SymbolKindType;
      const line = parseInt(fm['line'] || '', 10);
      const scopeChain = fm['scope_chain'] ? fm['scope_chain'].split('.') : [];

      if (!name || isNaN(line)) {
        continue;
      }

      // Extract a short overview snippet (first ~150 chars of the ## Overview section)
      let overviewSnippet = '';
      const overviewMatch = content.match(/## Overview\s*\n+([\s\S]*?)(?=\n##|\n```|$)/);
      if (overviewMatch) {
        overviewSnippet = overviewMatch[1].trim().substring(0, 150);
      }

      summaries.push({ fileName: mdFile, name, kind, line, scopeChain, overviewSnippet });
    }

    logger.debug(
      `CacheStore.listCachedSymbols: found ${summaries.length} cached symbols in ${filePath}`
    );
    return summaries;
  }

  /**
   * Attempt to find a cached analysis for a cursor position by using
   * a lightweight LLM call as a fallback when `findByCursor` misses.
   *
   * Flow:
   * 1. Try `findByCursor(word, filePath, cursorLine)` — exact name + ±3 lines.
   * 2. On miss, collect all cached symbol summaries for this source file.
   * 3. If there are cached symbols, send a lightweight Copilot Agent call
   *    (fast, cheap — 30s timeout) asking the LLM to pick the best match
   *    from the cache given the cursor's code context.
   * 4. If the LLM identifies a match, deserialize and return that cached result.
   * 5. If no match, return null — caller should proceed with full analysis.
   *
   * @param cursor       CursorContext with word, filePath, position, surrounding source
   * @param workspaceRoot  Workspace root path for spawning the CLI process
   * @returns Matched cached result, or null if no match found
   */
  async findByCursorWithLLMFallback(
    cursor: CursorContext,
    workspaceRoot: string
  ): Promise<{ symbol: SymbolInfo; result: AnalysisResult } | null> {
    // Step 1: Try the fast exact-match first
    const exactMatch = await this.findByCursor(cursor.word, cursor.filePath, cursor.position.line);
    if (exactMatch) {
      return exactMatch;
    }

    // Step 2: Collect cached symbols for this file
    const cachedSymbols = await this.listCachedSymbols(cursor.filePath);
    if (cachedSymbols.length === 0) {
      logger.info(
        `CacheStore.findByCursorWithLLMFallback: no cached symbols for ${cursor.filePath} — skipping LLM fallback`
      );
      return null;
    }

    logger.info(
      `CacheStore.findByCursorWithLLMFallback: findByCursor missed, ` +
        `trying LLM fallback with ${cachedSymbols.length} cached symbols ` +
        `for "${cursor.word}" at ${cursor.filePath}:${cursor.position.line}`
    );

    // Step 3: Build the lightweight prompt for the LLM
    const symbolListText = cachedSymbols
      .map((s, i) => {
        const scope = s.scopeChain.length > 0 ? ` (scope: ${s.scopeChain.join('.')})` : '';
        const overview = s.overviewSnippet ? ` — ${s.overviewSnippet}` : '';
        return `  ${i + 1}. [${s.kind}] "${s.name}" at line ${s.line}${scope}${overview}`;
      })
      .join('\n');

    const prompt = `You are helping match a code symbol at the user's cursor to an existing cached analysis.

## Cursor Context
- **Word at cursor**: "${cursor.word}"
- **File**: ${cursor.filePath}
- **Line**: ${cursor.position.line + 1}
- **Cursor line**: \`${cursor.cursorLine}\`

## Surrounding Code (±50 lines)
\`\`\`
${cursor.surroundingSource}
\`\`\`

## Cached Symbols in This File
${symbolListText}

## Task
Look at the cursor context and determine which cached symbol (if any) the user is pointing at. The cursor may be on a usage, call, reference, or the definition itself of one of these cached symbols.

Rules:
- If the word at the cursor exactly matches a cached symbol name, prefer that match even if the line is different.
- If the word is a method call (e.g., \`obj.foo()\`) and "foo" is in the cache as a method, match it.
- If the word is a type annotation, constructor call, or class reference and a matching class/interface/type is cached, match it.
- If the cursor is on a variable that was analyzed before (same name), match it even if the line shifted.
- If none of the cached symbols are relevant, output "NONE".
- Only output a match if you are confident — do not guess.

Output ONLY a JSON block in this exact format:
\`\`\`json:cache_match
{
  "matched_index": 1,
  "confidence": "high",
  "reason": "Brief explanation"
}
\`\`\`

If no match, output:
\`\`\`json:cache_match
{
  "matched_index": null,
  "confidence": "none",
  "reason": "No cached symbol matches the cursor context"
}
\`\`\``;

    // Step 4: Send lightweight LLM call
    let llmResponse = '';
    try {
      logger.logLLMStep(
        `Cache fallback: sending lightweight LLM query ` +
          `(${cachedSymbols.length} cached symbols, ${prompt.length} char prompt)`
      );

      llmResponse = await runCLI({
        command: 'copilot',
        args: ['--yolo', '-s', '--output-format', 'text'],
        stdinData: `[System instructions: You are a code symbol matcher. Be concise. Output ONLY the requested JSON block, nothing else.]\n\n${prompt}`,
        cwd: workspaceRoot,
        timeoutMs: CACHE_FALLBACK_LLM_TIMEOUT_MS,
        label: 'cache-fallback-llm',
      });

      logger.logLLMStep(`Cache fallback: LLM response received (${llmResponse.length} chars)`);
    } catch (err) {
      logger.info(
        `CacheStore.findByCursorWithLLMFallback: lightweight LLM call failed: ${err}. ` +
          `Falling through to full analysis.`
      );
      return null;
    }

    // Step 5: Parse the LLM's response
    const matchBlock = llmResponse.match(/```json:cache_match\s*\n([\s\S]*?)\n\s*```/);
    if (!matchBlock) {
      logger.info(
        'CacheStore.findByCursorWithLLMFallback: no json:cache_match block in LLM response — no match'
      );
      return null;
    }

    try {
      const matchResult = JSON.parse(matchBlock[1]);
      const matchedIndex = matchResult?.matched_index;
      const confidence = matchResult?.confidence;
      const reason = matchResult?.reason || '';

      if (matchedIndex === null || matchedIndex === undefined || confidence === 'none') {
        logger.info(`CacheStore.findByCursorWithLLMFallback: LLM says no match. Reason: ${reason}`);
        return null;
      }

      // Validate the index (1-based from the prompt)
      const idx = typeof matchedIndex === 'number' ? matchedIndex - 1 : -1;
      if (idx < 0 || idx >= cachedSymbols.length) {
        logger.warn(
          `CacheStore.findByCursorWithLLMFallback: LLM returned invalid index ${matchedIndex} ` +
            `(valid range: 1-${cachedSymbols.length})`
        );
        return null;
      }

      const matched = cachedSymbols[idx];
      logger.info(
        `CacheStore.findByCursorWithLLMFallback: LLM matched "${matched.name}" (${matched.kind}) ` +
          `at line ${matched.line} — confidence: ${confidence}, reason: ${reason}`
      );

      // Step 6: Deserialize the matched cache file
      const cacheDir = path.join(this._cacheRoot, cursor.filePath);
      const fullPath = path.join(cacheDir, matched.fileName);
      let content: string;
      try {
        content = await fs.readFile(fullPath, 'utf-8');
      } catch (err) {
        logger.warn(
          `CacheStore.findByCursorWithLLMFallback: failed to read matched cache file ${fullPath}: ${err}`
        );
        return null;
      }

      const symbolInfo: SymbolInfo = {
        name: matched.name,
        kind: matched.kind,
        filePath: cursor.filePath,
        position: { line: matched.line, character: 0 },
        containerName:
          matched.scopeChain.length > 0
            ? matched.scopeChain[matched.scopeChain.length - 1]
            : undefined,
        scopeChain: matched.scopeChain,
      };

      const result = this._deserialize(content, symbolInfo);
      if (!result) {
        logger.warn(
          `CacheStore.findByCursorWithLLMFallback: deserialization failed for ${matched.fileName}`
        );
        return null;
      }

      const age = Date.now() - new Date(result.metadata.analyzedAt).getTime();
      const ageHours = Math.round(age / 3600000);

      logger.info(
        `CacheStore.findByCursorWithLLMFallback: HIT (LLM fallback) — ` +
          `matched "${matched.name}" (${matched.kind}) at line ${matched.line} ` +
          `in ${matched.fileName} (${ageHours}h old, ` +
          `provider: ${result.metadata.llmProvider || 'static'})`
      );

      return { symbol: symbolInfo, result };
    } catch (err) {
      logger.warn(
        `CacheStore.findByCursorWithLLMFallback: failed to parse LLM match response: ${err}`
      );
      return null;
    }
  }

  // ── Write ───────────────────────────────────────────────

  /**
   * Write an AnalysisResult to a markdown cache file.
   */
  async write(result: AnalysisResult): Promise<string> {
    const filePath = this._resolvePath(result.symbol);

    logger.debug(`CacheStore.write: ${result.symbol.kind} "${result.symbol.name}" → ${filePath}`);

    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const content = this._serialize(result);
    await fs.writeFile(filePath, content, 'utf-8');

    const relativePath = path.relative(this._cacheRoot, filePath);
    logger.info(`CacheStore.write: wrote ${content.length} bytes → ${relativePath}`);
    return filePath;
  }

  // ── Path Resolution ─────────────────────────────────────

  /**
   * Resolve the cache file path for a symbol.
   */
  /**
   * Build a stable, unique cache key string for a symbol.
   * Format: "scopeA.scopeB.kind:name"
   * The scope chain ensures local variables in different functions get distinct keys.
   */
  private _buildCacheKey(symbol: SymbolInfo): string {
    const prefix = SYMBOL_KIND_PREFIX[symbol.kind] || 'sym';
    const chain =
      symbol.scopeChain && symbol.scopeChain.length > 0
        ? symbol.scopeChain.map((s) => this._sanitizeName(s)).join('.')
        : null;

    // Fallback: use containerName for symbols resolved without a scope chain
    // (e.g., programmatic calls from other extensions)
    if (!chain && symbol.containerName) {
      return `${this._sanitizeName(symbol.containerName)}.${prefix}.${this._sanitizeName(symbol.name)}`;
    }
    if (chain) {
      return `${chain}.${prefix}.${this._sanitizeName(symbol.name)}`;
    }
    return `${prefix}.${this._sanitizeName(symbol.name)}`;
  }

  private _resolvePath(symbol: SymbolInfo): string {
    const cacheKey = this._buildCacheKey(symbol);
    const fileName = `${cacheKey}.md`;
    return path.join(this._cacheRoot, symbol.filePath, fileName);
  }

  // ── Serialization ───────────────────────────────────────

  private _serialize(result: AnalysisResult): string {
    const s = result.symbol;
    const m = result.metadata;
    const lines: string[] = [];

    // YAML Frontmatter
    lines.push('---');
    lines.push(`symbol: ${s.name}`);
    lines.push(`kind: ${s.kind}`);
    lines.push(`file: ${s.filePath}`);
    lines.push(`line: ${s.position.line}`);
    if (s.scopeChain && s.scopeChain.length > 0) {
      lines.push(`scope_chain: "${s.scopeChain.join('.')}"`);
    }
    lines.push(`analyzed_at: "${m.analyzedAt}"`);
    lines.push(`analysis_version: "${m.analysisVersion}"`);
    if (m.llmProvider) {
      lines.push(`llm_provider: ${m.llmProvider}`);
    }
    if (m.sourceHash) {
      lines.push(`source_hash: "${m.sourceHash}"`);
    }
    if (Object.keys(m.dependentFileHashes).length > 0) {
      lines.push('dependent_files:');
      for (const [fp, hash] of Object.entries(m.dependentFileHashes)) {
        lines.push(`  "${fp}": "${hash}"`);
      }
    }
    lines.push(`stale: ${m.stale}`);
    lines.push('---');
    lines.push('');

    // Title
    lines.push(`# ${s.kind} ${s.name}`);
    lines.push('');

    // Overview
    if (result.overview) {
      lines.push('## Overview');
      lines.push('');
      lines.push(result.overview);
      lines.push('');
    }

    // Key Points
    if (result.keyMethods && result.keyMethods.length > 0) {
      lines.push('## Key Points');
      lines.push('');
      for (const item of result.keyMethods) {
        lines.push(`- ${item}`);
      }
      lines.push('');
    }

    // Callers — human-readable list + machine-parseable JSON block
    if (result.callStacks.length > 0) {
      lines.push('## Callers');
      lines.push('');
      for (let i = 0; i < result.callStacks.length; i++) {
        const cs = result.callStacks[i];
        const chain = cs.chain || `${cs.caller.name} → ${s.name}`;
        lines.push(
          `${i + 1}. **${cs.caller.name}** — \`${cs.caller.filePath}:${cs.caller.line}\` — ${chain}`
        );
      }
      lines.push('');

      // Structured JSON block for machine consumption
      const callersJson = result.callStacks.map((cs) => ({
        name: cs.caller.name,
        filePath: cs.caller.filePath,
        line: cs.caller.line,
        kind: cs.caller.kind,
        context: cs.chain || `${cs.caller.name} → ${s.name}`,
      }));
      lines.push('```json:callers');
      lines.push(JSON.stringify(callersJson, null, 2));
      lines.push('```');
      lines.push('');
    }

    // Usages
    if (result.usages.length > 0) {
      lines.push(`## Usage (${result.usages.length} references)`);
      lines.push('');
      lines.push('| File | Line | Context |');
      lines.push('|------|------|---------|');
      for (const u of result.usages) {
        const ctx = u.contextLine.trim().replace(/\|/g, '\\|');
        const def = u.isDefinition ? ' (def)' : '';
        lines.push(`| \`${u.filePath}\` | ${u.line}${def} | \`${ctx}\` |`);
      }
      lines.push('');
    }

    // Relationships
    if (result.relationships.length > 0) {
      lines.push('## Relationships');
      lines.push('');
      for (const r of result.relationships) {
        lines.push(`- **${r.type}:** ${r.targetName} (\`${r.targetFilePath}:${r.targetLine}\`)`);
      }
      lines.push('');
    }

    // Data Flow
    if (result.dataFlow.length > 0) {
      lines.push('## Data Flow');
      lines.push('');
      for (const df of result.dataFlow) {
        lines.push(`- **${df.type}:** \`${df.filePath}:${df.line}\` — ${df.description}`);
      }
      lines.push('');

      // Machine-readable JSON block
      lines.push('```json:data_flow');
      lines.push(JSON.stringify(result.dataFlow, null, 2));
      lines.push('```');
      lines.push('');
    }

    // Variable Lifecycle
    if (
      result.variableLifecycle &&
      (result.variableLifecycle.declaration || result.variableLifecycle.initialization)
    ) {
      lines.push('## Variable Lifecycle');
      lines.push('');
      lines.push('```json:variable_lifecycle');
      lines.push(JSON.stringify(result.variableLifecycle, null, 2));
      lines.push('```');
      lines.push('');
    }

    // Data Kind
    if (result.dataKind && result.dataKind.label) {
      lines.push('## Data Kind');
      lines.push('');
      lines.push(`**${result.dataKind.label}**`);
      lines.push('');
      if (result.dataKind.description) {
        lines.push(result.dataKind.description);
        lines.push('');
      }
      if (result.dataKind.examples.length > 0) {
        lines.push('**Examples:**');
        lines.push('');
        for (const example of result.dataKind.examples) {
          lines.push(`- \`${example}\``);
        }
        lines.push('');
      }
      if (result.dataKind.references.length > 0) {
        lines.push('**References:**');
        lines.push('');
        for (const ref of result.dataKind.references) {
          lines.push(`- ${ref}`);
        }
        lines.push('');
      }
      lines.push('```json:data_kind');
      lines.push(JSON.stringify(result.dataKind, null, 2));
      lines.push('```');
      lines.push('');
    }

    // Class Members
    if (result.classMembers && result.classMembers.length > 0) {
      lines.push('## Class Members');
      lines.push('');
      for (const m of result.classMembers) {
        const staticLabel = m.isStatic ? 'static ' : '';
        lines.push(
          `- **${m.visibility} ${staticLabel}${m.memberKind}** \`${m.name}: ${m.typeName}\` — ${m.description}`
        );
      }
      lines.push('');

      lines.push('```json:class_members');
      lines.push(JSON.stringify(result.classMembers, null, 2));
      lines.push('```');
      lines.push('');
    }

    // Member Access Patterns
    if (result.memberAccess && result.memberAccess.length > 0) {
      lines.push('## Member Access Patterns');
      lines.push('');
      for (const ma of result.memberAccess) {
        lines.push(
          `- **${ma.memberName}**: read by [${ma.readBy.join(', ')}], written by [${ma.writtenBy.join(', ')}]${ma.externalAccess ? ' (external access)' : ''}`
        );
      }
      lines.push('');

      lines.push('```json:member_access');
      lines.push(JSON.stringify(result.memberAccess, null, 2));
      lines.push('```');
      lines.push('');
    }

    // Diagrams
    if (result.diagrams && result.diagrams.length > 0) {
      lines.push('## Diagrams');
      lines.push('');
      for (const d of result.diagrams) {
        lines.push(`### ${d.title}`);
        lines.push('');
        lines.push('```mermaid');
        lines.push(d.mermaidSource);
        lines.push('```');
        lines.push('');
      }
      lines.push('```json:diagrams');
      lines.push(JSON.stringify(result.diagrams, null, 2));
      lines.push('```');
      lines.push('');
    }

    // Function Steps
    if (result.functionSteps && result.functionSteps.length > 0) {
      lines.push('## Step-by-Step Breakdown');
      lines.push('');
      for (const step of result.functionSteps) {
        lines.push(`${step.step}. ${step.description}`);
      }
      lines.push('');
      lines.push('```json:steps');
      lines.push(JSON.stringify(result.functionSteps, null, 2));
      lines.push('```');
      lines.push('');
    }

    // Sub-Functions
    if (result.subFunctions && result.subFunctions.length > 0) {
      lines.push('## Sub-Functions');
      lines.push('');
      for (const sf of result.subFunctions) {
        lines.push(`- **${sf.name}** — ${sf.description}`);
      }
      lines.push('');
      lines.push('```json:subfunctions');
      lines.push(JSON.stringify(result.subFunctions, null, 2));
      lines.push('```');
      lines.push('');
    }

    // Function Inputs
    if (result.functionInputs && result.functionInputs.length > 0) {
      lines.push('## Function Input');
      lines.push('');
      for (const fi of result.functionInputs) {
        const mutLabel = fi.mutated ? ' (mutated)' : '';
        lines.push(`- **${fi.name}**: \`${fi.typeName}\` — ${fi.description}${mutLabel}`);
      }
      lines.push('');
      lines.push('```json:function_inputs');
      lines.push(JSON.stringify(result.functionInputs, null, 2));
      lines.push('```');
      lines.push('');
    }

    // Function Output
    if (result.functionOutput && result.functionOutput.typeName) {
      lines.push('## Function Output');
      lines.push('');
      lines.push(
        `Returns: \`${result.functionOutput.typeName}\` — ${result.functionOutput.description}`
      );
      lines.push('');
      lines.push('```json:function_output');
      lines.push(JSON.stringify(result.functionOutput, null, 2));
      lines.push('```');
      lines.push('');
    }

    // Dependencies
    if (result.dependencies && result.dependencies.length > 0) {
      lines.push('## Dependencies');
      lines.push('');
      for (const d of result.dependencies) {
        lines.push(`- ${d}`);
      }
      lines.push('');
    }

    // Usage Pattern
    if (result.usagePattern) {
      lines.push('## Usage Pattern');
      lines.push('');
      lines.push(result.usagePattern);
      lines.push('');
    }

    // Potential Issues
    if (result.potentialIssues && result.potentialIssues.length > 0) {
      lines.push('## Potential Issues');
      lines.push('');
      for (const issue of result.potentialIssues) {
        lines.push(`- ${issue}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  // ── Deserialization ─────────────────────────────────────

  /**
   * Parse a cached markdown file back into an AnalysisResult.
   * Uses YAML frontmatter for metadata and markdown body for content.
   */
  private _deserialize(content: string, symbol: SymbolInfo): AnalysisResult | null {
    try {
      // Split frontmatter from body (handle both \n and \r\n)
      const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
      if (!fmMatch) {
        logger.warn('CacheStore._deserialize: no frontmatter found');
        return null;
      }

      const frontmatter = fmMatch[1];
      const body = fmMatch[2];

      // Parse frontmatter fields
      const fm = this._parseFrontmatter(frontmatter);

      // Parse body sections
      const sections = this._extractSections(body);

      const metadata: AnalysisMetadata = {
        analyzedAt: fm['analyzed_at'] || new Date().toISOString(),
        sourceHash: fm['source_hash'] || '',
        dependentFileHashes: {},
        llmProvider: fm['llm_provider'] || undefined,
        analysisVersion: fm['analysis_version'] || ANALYSIS_VERSION,
        stale: fm['stale'] === 'true',
      };

      // Parse callers from json:callers block
      const { callStacks, usages } = this._parseCallersJson(body);

      // Parse function steps from json:steps block
      const stepsRaw = this._parseJsonBlock<{ step: number; description: string }>(body, 'steps');
      const functionSteps =
        stepsRaw.length > 0
          ? stepsRaw.filter((s) => typeof s.step === 'number' && typeof s.description === 'string')
          : undefined;

      // Parse sub-functions from json:subfunctions block
      const subFunctionsRaw = this._parseJsonBlock<{
        name: string;
        description: string;
        input: string;
        output: string;
        filePath?: string;
        line?: number;
        kind?: string;
      }>(body, 'subfunctions');
      const subFunctions =
        subFunctionsRaw.length > 0
          ? subFunctionsRaw.filter((s) => typeof s.name === 'string')
          : undefined;

      // Parse function inputs from json:function_inputs block
      const fnInputsRaw = this._parseJsonBlock<{
        name: string;
        typeName: string;
        description: string;
        mutated: boolean;
        mutationDetail?: string;
        typeFilePath?: string;
        typeLine?: number;
        typeKind?: string;
        typeOverview?: string;
      }>(body, 'function_inputs');
      const functionInputs =
        fnInputsRaw.length > 0
          ? fnInputsRaw.filter((f) => typeof f.name === 'string' && typeof f.typeName === 'string')
          : undefined;

      // Parse function output from json:function_output block
      const fnOutputRaw = this._parseJsonObjectBlock<{
        typeName: string;
        description: string;
        typeFilePath?: string;
        typeLine?: number;
        typeKind?: string;
        typeOverview?: string;
      }>(body, 'function_output');
      const functionOutput =
        fnOutputRaw && typeof fnOutputRaw.typeName === 'string' ? fnOutputRaw : undefined;

      // Parse data flow from json:data_flow block
      const dataFlow = this._parseJsonBlock<{
        type: string;
        filePath: string;
        line: number;
        description: string;
      }>(body, 'data_flow');

      // Parse variable lifecycle from json:variable_lifecycle block
      const variableLifecycle = this._parseJsonObjectBlock<{
        declaration: string;
        initialization: string;
        mutations: string[];
        consumption: string[];
        scopeAndLifetime: string;
      }>(body, 'variable_lifecycle');

      // Parse data kind from json:data_kind block
      const dataKind = this._parseJsonObjectBlock<{
        label: string;
        description: string;
        examples: string[];
        references: string[];
      }>(body, 'data_kind');

      // Parse class members from json:class_members block
      const classMembers = this._parseJsonBlock<{
        name: string;
        memberKind: string;
        typeName: string;
        visibility: string;
        isStatic: boolean;
        description: string;
        line?: number;
      }>(body, 'class_members');

      // Parse member access from json:member_access block
      const memberAccess = this._parseJsonBlock<{
        memberName: string;
        readBy: string[];
        writtenBy: string[];
        externalAccess: boolean;
      }>(body, 'member_access');

      // Parse diagrams from json:diagrams block
      const diagrams = this._parseJsonBlock<{
        title: string;
        type: string;
        mermaidSource: string;
      }>(body, 'diagrams');

      return {
        symbol,
        overview: sections['overview'] || '',
        callStacks,
        usages,
        dataFlow: dataFlow.map((d) => ({
          type: d.type as DataFlowEntry['type'],
          filePath: d.filePath,
          line: d.line,
          description: d.description,
        })),
        relationships: [],
        keyMethods: this._parseList(sections['key points']),
        functionSteps,
        subFunctions: subFunctions
          ? subFunctions.map((s) => ({
              name: s.name,
              description: s.description || '',
              input: s.input || '',
              output: s.output || '',
              filePath: s.filePath,
              line: s.line,
              kind: s.kind,
            }))
          : undefined,
        functionInputs: functionInputs
          ? functionInputs.map((f) => ({
              name: f.name,
              typeName: f.typeName,
              description: f.description || '',
              mutated: f.mutated === true,
              mutationDetail: f.mutationDetail,
              typeFilePath: f.typeFilePath,
              typeLine: f.typeLine,
              typeKind: f.typeKind,
              typeOverview: f.typeOverview,
            }))
          : undefined,
        functionOutput: functionOutput
          ? {
              typeName: functionOutput.typeName,
              description: functionOutput.description || '',
              typeFilePath: functionOutput.typeFilePath,
              typeLine: functionOutput.typeLine,
              typeKind: functionOutput.typeKind,
              typeOverview: functionOutput.typeOverview,
            }
          : undefined,
        dependencies: this._parseList(sections['dependencies']),
        usagePattern: sections['usage pattern'] || '',
        potentialIssues: this._parseList(sections['potential issues']),
        variableLifecycle: variableLifecycle
          ? {
              declaration: variableLifecycle.declaration || '',
              initialization: variableLifecycle.initialization || '',
              mutations: variableLifecycle.mutations || [],
              consumption: variableLifecycle.consumption || [],
              scopeAndLifetime: variableLifecycle.scopeAndLifetime || '',
            }
          : undefined,
        dataKind:
          dataKind && dataKind.label
            ? {
                label: dataKind.label,
                description: dataKind.description || '',
                examples: Array.isArray(dataKind.examples) ? dataKind.examples : [],
                references: Array.isArray(dataKind.references) ? dataKind.references : [],
              }
            : undefined,
        classMembers:
          classMembers.length > 0
            ? classMembers.map((m) => ({
                name: m.name,
                memberKind: m.memberKind as ClassMemberInfo['memberKind'],
                typeName: m.typeName,
                visibility: m.visibility as ClassMemberInfo['visibility'],
                isStatic: m.isStatic,
                description: m.description,
                line: m.line,
              }))
            : undefined,
        memberAccess:
          memberAccess.length > 0
            ? memberAccess.map((ma) => ({
                memberName: ma.memberName,
                readBy: ma.readBy,
                writtenBy: ma.writtenBy,
                externalAccess: ma.externalAccess,
              }))
            : undefined,
        diagrams:
          diagrams.length > 0
            ? diagrams
                .filter((d) => typeof d.title === 'string' && typeof d.mermaidSource === 'string')
                .map((d) => ({
                  title: d.title,
                  type: typeof d.type === 'string' ? d.type : 'flowchart',
                  mermaidSource: d.mermaidSource,
                }))
            : undefined,
        metadata,
      };
    } catch (err) {
      logger.warn(`CacheStore._deserialize: parse error: ${err}`);
      return null;
    }
  }

  /**
   * Parse YAML-like frontmatter into key-value pairs.
   */
  private _parseFrontmatter(text: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const match = line.match(/^(\w[\w_]*)\s*:\s*"?(.+?)"?\s*$/);
      if (match) {
        result[match[1]] = match[2];
      }
    }
    return result;
  }

  /**
   * Extract markdown sections keyed by heading text (lowercased).
   */
  private _extractSections(markdown: string): Record<string, string> {
    const sections: Record<string, string> = {};
    const regex = /^#{1,3}\s+(.+)$/gm;
    let lastKey: string | null = null;
    let lastIndex = 0;

    let match;
    while ((match = regex.exec(markdown)) !== null) {
      if (lastKey !== null) {
        sections[lastKey] = markdown.substring(lastIndex, match.index).trim();
      }
      lastKey = match[1].toLowerCase().trim();
      // Strip numbering like "1. callerName" from call stack headings
      lastKey = lastKey.replace(/^\d+\.\s*/, '');
      lastIndex = match.index + match[0].length;
    }
    if (lastKey !== null) {
      sections[lastKey] = markdown.substring(lastIndex).trim();
    }
    return sections;
  }

  /**
   * Parse the ```json:callers ... ``` block from cached markdown
   * into CallStackEntry[] and UsageEntry[].
   */
  private _parseCallersJson(body: string): { callStacks: CallStackEntry[]; usages: UsageEntry[] } {
    const callStacks: CallStackEntry[] = [];
    const usages: UsageEntry[] = [];

    const match = body.match(/```json:callers\s*\n([\s\S]*?)\n\s*```/);
    if (!match) {
      return { callStacks, usages };
    }

    try {
      const entries = JSON.parse(match[1]);
      if (!Array.isArray(entries)) {
        return { callStacks, usages };
      }

      for (const entry of entries) {
        if (!entry.name || !entry.filePath) {
          continue;
        }
        callStacks.push({
          caller: {
            name: entry.name,
            filePath: entry.filePath,
            line: entry.line || 0,
            kind: entry.kind || 'function',
          },
          callSites: [{ line: entry.line || 0, character: 0 }],
          depth: 0,
          chain: entry.context || `${entry.name} → calls this symbol`,
        });
        usages.push({
          filePath: entry.filePath,
          line: entry.line || 0,
          character: 0,
          contextLine: entry.context || '',
          isDefinition: false,
        });
      }
    } catch (err) {
      logger.warn(`CacheStore._parseCallersJson: parse error: ${err}`);
    }

    return { callStacks, usages };
  }

  /**
   * Parse a markdown list into a string array.
   */
  private _parseList(text: string | undefined): string[] {
    if (!text) {
      return [];
    }
    return text
      .split('\n')
      .map((line) =>
        line
          .replace(/^[-*•]\s*/, '')
          .replace(/^\d+\.\s*/, '')
          .trim()
      )
      .filter((line) => line.length > 0 && !line.startsWith('#') && !line.startsWith('|'));
  }

  /**
   * Parse a ```json:<tag> ... ``` fenced block from cached markdown into an array.
   */
  private _parseJsonBlock<T>(body: string, tag: string): T[] {
    const regex = new RegExp('```json:' + tag + '\\s*\\n([\\s\\S]*?)\\n\\s*```');
    const match = body.match(regex);
    if (!match) {
      return [];
    }
    try {
      const parsed = JSON.parse(match[1]);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /**
   * Parse a ```json:<tag> ... ``` fenced block from cached markdown into an object.
   */
  private _parseJsonObjectBlock<T>(body: string, tag: string): T | null {
    const regex = new RegExp('```json:' + tag + '\\s*\\n([\\s\\S]*?)\\n\\s*```');
    const match = body.match(regex);
    if (!match) {
      return null;
    }
    try {
      const parsed = JSON.parse(match[1]);
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? parsed
        : null;
    } catch {
      return null;
    }
  }

  private _sanitizeName(name: string): string {
    return name
      .replace(/[<>]/g, '_')
      .replace(/[/\\:*?"]/g, '_')
      .replace(/\s+/g, '_')
      .substring(0, 200);
  }
}
