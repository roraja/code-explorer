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
import type { AnalysisResult, SymbolInfo, AnalysisMetadata, CallStackEntry, UsageEntry, DataFlowEntry, ClassMemberInfo } from '../models/types';
import { SYMBOL_KIND_PREFIX } from '../models/types';
import { CACHE, ANALYSIS_VERSION } from '../models/constants';
import { logger } from '../utils/logger';

export class CacheStore {
  private readonly _cacheRoot: string;

  constructor(workspaceRoot: string) {
    this._cacheRoot = path.join(workspaceRoot, '.vscode', CACHE.DIR_NAME);
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
    const chain = symbol.scopeChain && symbol.scopeChain.length > 0
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
        lines.push(`${i + 1}. **${cs.caller.name}** — \`${cs.caller.filePath}:${cs.caller.line}\` — ${chain}`);
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
    if (result.variableLifecycle && (result.variableLifecycle.declaration || result.variableLifecycle.initialization)) {
      lines.push('## Variable Lifecycle');
      lines.push('');
      lines.push('```json:variable_lifecycle');
      lines.push(JSON.stringify(result.variableLifecycle, null, 2));
      lines.push('```');
      lines.push('');
    }

    // Class Members
    if (result.classMembers && result.classMembers.length > 0) {
      lines.push('## Class Members');
      lines.push('');
      for (const m of result.classMembers) {
        const staticLabel = m.isStatic ? 'static ' : '';
        lines.push(`- **${m.visibility} ${staticLabel}${m.memberKind}** \`${m.name}: ${m.typeName}\` — ${m.description}`);
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
        lines.push(`- **${ma.memberName}**: read by [${ma.readBy.join(', ')}], written by [${ma.writtenBy.join(', ')}]${ma.externalAccess ? ' (external access)' : ''}`);
      }
      lines.push('');

      lines.push('```json:member_access');
      lines.push(JSON.stringify(result.memberAccess, null, 2));
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

      // Parse data flow from json:data_flow block
      const dataFlow = this._parseJsonBlock<{ type: string; filePath: string; line: number; description: string }>(body, 'data_flow');

      // Parse variable lifecycle from json:variable_lifecycle block
      const variableLifecycle = this._parseJsonObjectBlock<{
        declaration: string;
        initialization: string;
        mutations: string[];
        consumption: string[];
        scopeAndLifetime: string;
      }>(body, 'variable_lifecycle');

      // Parse class members from json:class_members block
      const classMembers = this._parseJsonBlock<{
        name: string; memberKind: string; typeName: string;
        visibility: string; isStatic: boolean; description: string; line?: number;
      }>(body, 'class_members');

      // Parse member access from json:member_access block
      const memberAccess = this._parseJsonBlock<{
        memberName: string; readBy: string[]; writtenBy: string[]; externalAccess: boolean;
      }>(body, 'member_access');

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
        dependencies: this._parseList(sections['dependencies']),
        usagePattern: sections['usage pattern'] || '',
        potentialIssues: this._parseList(sections['potential issues']),
        variableLifecycle: variableLifecycle ? {
          declaration: variableLifecycle.declaration || '',
          initialization: variableLifecycle.initialization || '',
          mutations: variableLifecycle.mutations || [],
          consumption: variableLifecycle.consumption || [],
          scopeAndLifetime: variableLifecycle.scopeAndLifetime || '',
        } : undefined,
        classMembers: classMembers.length > 0 ? classMembers.map((m) => ({
          name: m.name,
          memberKind: m.memberKind as ClassMemberInfo['memberKind'],
          typeName: m.typeName,
          visibility: m.visibility as ClassMemberInfo['visibility'],
          isStatic: m.isStatic,
          description: m.description,
          line: m.line,
        })) : undefined,
        memberAccess: memberAccess.length > 0 ? memberAccess.map((ma) => ({
          memberName: ma.memberName,
          readBy: ma.readBy,
          writtenBy: ma.writtenBy,
          externalAccess: ma.externalAccess,
        })) : undefined,
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
  private _parseCallersJson(
    body: string
  ): { callStacks: CallStackEntry[]; usages: UsageEntry[] } {
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
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : null;
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
