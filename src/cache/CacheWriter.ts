/**
 * Code Explorer — Cache Writer
 *
 * Writes analysis results as markdown files to the workspace cache
 * directory at .vscode/code-explorer/.  Each analyzed symbol gets
 * a markdown file with YAML frontmatter (metadata) and a human-readable
 * body following the format specified in docs/06-data_model_and_cache.md.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import type { AnalysisResult } from '../models/types';
import { SYMBOL_KIND_PREFIX } from '../models/types';
import { CACHE } from '../models/constants';
import { logger } from '../utils/logger';

export class CacheWriter {
  private readonly _cacheRoot: string;

  constructor(workspaceRoot: string) {
    this._cacheRoot = path.join(workspaceRoot, '.vscode', CACHE.DIR_NAME);
  }

  /**
   * Write an AnalysisResult to a markdown cache file.
   * Creates the directory structure as needed.
   *
   * File path: .vscode/code-explorer/<source-path>/<kind>.<Name>.md
   */
  async write(result: AnalysisResult): Promise<string> {
    const symbol = result.symbol;
    const prefix = SYMBOL_KIND_PREFIX[symbol.kind] || 'sym';
    const safeName = this._sanitizeName(symbol.name);
    const fileName = symbol.containerName
      ? `${prefix}.${this._sanitizeName(symbol.containerName)}.${safeName}.md`
      : `${prefix}.${safeName}.md`;

    const dirPath = path.join(this._cacheRoot, symbol.filePath);
    const filePath = path.join(dirPath, fileName);

    logger.debug(`CacheWriter.write: ${symbol.kind} "${symbol.name}" → ${filePath}`);

    await fs.mkdir(dirPath, { recursive: true });

    const content = this._serialize(result);
    await fs.writeFile(filePath, content, 'utf-8');

    const relativePath = path.relative(this._cacheRoot, filePath);
    logger.info(`CacheWriter: wrote ${content.length} bytes → ${relativePath}`);
    return filePath;
  }

  /**
   * Serialize an AnalysisResult into markdown with YAML frontmatter.
   */
  private _serialize(result: AnalysisResult): string {
    const s = result.symbol;
    const m = result.metadata;
    const lines: string[] = [];

    // --- YAML Frontmatter ---
    lines.push('---');
    lines.push(`symbol: ${s.name}`);
    lines.push(`kind: ${s.kind}`);
    lines.push(`file: ${s.filePath}`);
    lines.push(`line: ${s.position.line}`);
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

    // --- Title ---
    lines.push(`# ${s.kind} ${s.name}`);
    lines.push('');

    // --- Overview ---
    if (result.overview) {
      lines.push('## Overview');
      lines.push('');
      lines.push(result.overview);
      lines.push('');
    }

    // --- Key Points ---
    if (result.keyMethods && result.keyMethods.length > 0) {
      lines.push('## Key Points');
      lines.push('');
      for (const item of result.keyMethods) {
        lines.push(`- ${item}`);
      }
      lines.push('');
    }

    // --- Call Stacks ---
    if (result.callStacks.length > 0) {
      lines.push(`## Call Stacks`);
      lines.push('');
      for (let i = 0; i < result.callStacks.length; i++) {
        const cs = result.callStacks[i];
        const chain = cs.chain || `${cs.caller.name} → ${s.name}`;
        lines.push(`### ${i + 1}. ${cs.caller.name}`);
        lines.push('```');
        lines.push(chain);
        lines.push('```');
        lines.push('');
      }
    }

    // --- Usages ---
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

    // --- Data Flow ---
    if (result.dataFlow.length > 0) {
      lines.push('## Data Flow');
      lines.push('');
      for (const df of result.dataFlow) {
        lines.push(`- **${df.type}:** \`${df.filePath}:${df.line}\` — ${df.description}`);
      }
      lines.push('');
    }

    // --- Relationships ---
    if (result.relationships.length > 0) {
      lines.push('## Relationships');
      lines.push('');
      for (const r of result.relationships) {
        lines.push(`- **${r.type}:** ${r.targetName} (\`${r.targetFilePath}:${r.targetLine}\`)`);
      }
      lines.push('');
    }

    // --- Dependencies ---
    if (result.dependencies && result.dependencies.length > 0) {
      lines.push('## Dependencies');
      lines.push('');
      for (const d of result.dependencies) {
        lines.push(`- ${d}`);
      }
      lines.push('');
    }

    // --- Usage Pattern ---
    if (result.usagePattern) {
      lines.push('## Usage Pattern');
      lines.push('');
      lines.push(result.usagePattern);
      lines.push('');
    }

    // --- Potential Issues ---
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

  /**
   * Sanitize a symbol name for use in file names.
   */
  private _sanitizeName(name: string): string {
    return name
      .replace(/[<>]/g, '_')
      .replace(/[/\\:*?"]/g, '_')
      .replace(/\s+/g, '_')
      .substring(0, 200);
  }
}
