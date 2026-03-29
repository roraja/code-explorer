/**
 * Code Explorer — Dependency Graph Builder
 *
 * Scans all cached analyses in the workspace and builds an in-memory
 * graph of symbol relationships. Each analyzed symbol becomes a node,
 * and edges represent relationships like "calls", "calledBy",
 * "dependsOn", "subFunctionOf", etc.
 *
 * The graph is built entirely from cached data — no LLM calls.
 * The output is a serializable structure that the webview can render
 * as an interactive Mermaid diagram.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import type { AnalysisResult, SymbolKindType } from '../models/types';
import { CACHE } from '../models/constants';
import { logger } from '../utils/logger';

// ── Graph Types ──────────────────────────────────────────

/** A node in the dependency graph, representing one analyzed symbol. */
export interface GraphNode {
  /** Unique ID (e.g., "src/analysis/Orchestrator.ts::fn.analyzeSymbol") */
  id: string;
  /** Symbol name */
  name: string;
  /** Symbol kind */
  kind: SymbolKindType;
  /** Source file (relative path) */
  filePath: string;
  /** Line number */
  line: number;
  /** First sentence of overview, for tooltip */
  overview: string;
  /** Number of callers */
  callerCount: number;
  /** Number of sub-functions */
  subFunctionCount: number;
}

/** An edge connecting two nodes in the dependency graph. */
export interface GraphEdge {
  /** Source node ID */
  from: string;
  /** Target node ID */
  to: string;
  /** Relationship type */
  type: 'calls' | 'dependsOn' | 'extends' | 'implements' | 'uses';
  /** Optional label */
  label?: string;
}

/** The full dependency graph data. */
export interface DependencyGraph {
  /** All nodes */
  nodes: GraphNode[];
  /** All edges */
  edges: GraphEdge[];
  /** When the graph was built */
  builtAt: string;
}

// ── Builder ──────────────────────────────────────────────

export class GraphBuilder {
  private readonly _cacheRoot: string;

  constructor(workspaceRoot: string) {
    this._cacheRoot = path.join(workspaceRoot, '.vscode', CACHE.DIR_NAME);
  }

  /**
   * Build the full dependency graph from all cached analyses.
   *
   * Recursively scans the cache directory, deserializes each analysis
   * file's YAML frontmatter + key JSON blocks, and builds nodes/edges.
   */
  async buildGraph(): Promise<DependencyGraph> {
    const startTime = Date.now();
    logger.info('GraphBuilder.buildGraph: scanning cache directory...');

    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];

    // Scan all cache files
    const analyses = await this._scanAllCacheFiles();
    logger.info(`GraphBuilder.buildGraph: found ${analyses.length} cached analyses`);

    // Phase 1: Build all nodes
    for (const analysis of analyses) {
      const nodeId = this._makeNodeId(analysis);
      if (nodes.has(nodeId)) {
        continue; // deduplicate
      }

      const overview = analysis.overview
        ? this._firstSentence(analysis.overview)
        : '';

      nodes.set(nodeId, {
        id: nodeId,
        name: analysis.symbol.name,
        kind: analysis.symbol.kind,
        filePath: analysis.symbol.filePath,
        line: analysis.symbol.position.line,
        overview,
        callerCount: analysis.callStacks?.length ?? 0,
        subFunctionCount: analysis.subFunctions?.length ?? 0,
      });
    }

    // Phase 2: Build edges from relationships in each analysis
    for (const analysis of analyses) {
      const sourceId = this._makeNodeId(analysis);

      // Sub-functions: this symbol CALLS each sub-function
      if (analysis.subFunctions) {
        for (const sf of analysis.subFunctions) {
          if (!sf.filePath || !sf.name) {
            continue;
          }
          const targetId = this._findNodeByNameAndFile(nodes, sf.name, sf.filePath);
          if (targetId && targetId !== sourceId) {
            edges.push({ from: sourceId, to: targetId, type: 'calls' });
          }
        }
      }

      // Callers: each caller CALLS this symbol
      if (analysis.callStacks) {
        for (const cs of analysis.callStacks) {
          if (!cs.caller.filePath || !cs.caller.name) {
            continue;
          }
          const callerId = this._findNodeByNameAndFile(
            nodes,
            cs.caller.name,
            cs.caller.filePath
          );
          if (callerId && callerId !== sourceId) {
            edges.push({ from: callerId, to: sourceId, type: 'calls' });
          }
        }
      }

      // Dependencies: this symbol DEPENDS ON each dependency
      if (analysis.dependencies) {
        for (const dep of analysis.dependencies) {
          // Dependencies are often just names, try to match by name
          const targetId = this._findNodeByName(nodes, dep);
          if (targetId && targetId !== sourceId) {
            edges.push({ from: sourceId, to: targetId, type: 'dependsOn' });
          }
        }
      }

      // Relationships: extends, implements, uses
      if (analysis.relationships) {
        for (const rel of analysis.relationships) {
          const targetId = this._findNodeByNameAndFile(
            nodes,
            rel.targetName,
            rel.targetFilePath
          );
          if (targetId && targetId !== sourceId) {
            const edgeType =
              rel.type === 'extends' || rel.type === 'extended-by'
                ? 'extends'
                : rel.type === 'implements' || rel.type === 'implemented-by'
                  ? 'implements'
                  : 'uses';
            // For "extended-by" and "implemented-by", reverse the edge direction
            if (rel.type === 'extended-by' || rel.type === 'implemented-by') {
              edges.push({ from: targetId, to: sourceId, type: edgeType });
            } else {
              edges.push({ from: sourceId, to: targetId, type: edgeType });
            }
          }
        }
      }
    }

    // Deduplicate edges
    const edgeSet = new Set<string>();
    const uniqueEdges: GraphEdge[] = [];
    for (const edge of edges) {
      const key = `${edge.from}->${edge.to}:${edge.type}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        uniqueEdges.push(edge);
      }
    }

    const elapsed = Date.now() - startTime;
    logger.info(
      `GraphBuilder.buildGraph: built graph with ${nodes.size} nodes and ${uniqueEdges.length} edges in ${elapsed}ms`
    );

    return {
      nodes: Array.from(nodes.values()),
      edges: uniqueEdges,
      builtAt: new Date().toISOString(),
    };
  }

  /**
   * Build a focused subgraph centered on a specific symbol.
   * Includes the symbol itself, its direct callers, sub-functions,
   * and dependencies (1 hop out).
   */
  async buildSubgraph(
    symbolName: string,
    filePath: string
  ): Promise<DependencyGraph> {
    const fullGraph = await this.buildGraph();
    const centerNode = fullGraph.nodes.find(
      (n) => n.name === symbolName && n.filePath === filePath
    );

    if (!centerNode) {
      logger.info(
        `GraphBuilder.buildSubgraph: symbol "${symbolName}" not found in graph`
      );
      return { nodes: [], edges: [], builtAt: new Date().toISOString() };
    }

    // Collect all nodes within 1 hop
    const includedIds = new Set<string>([centerNode.id]);
    const includedEdges: GraphEdge[] = [];

    for (const edge of fullGraph.edges) {
      if (edge.from === centerNode.id || edge.to === centerNode.id) {
        includedIds.add(edge.from);
        includedIds.add(edge.to);
        includedEdges.push(edge);
      }
    }

    // Also include edges between the 1-hop neighbors themselves
    for (const edge of fullGraph.edges) {
      if (includedIds.has(edge.from) && includedIds.has(edge.to)) {
        if (!includedEdges.includes(edge)) {
          includedEdges.push(edge);
        }
      }
    }

    const includedNodes = fullGraph.nodes.filter((n) => includedIds.has(n.id));

    return {
      nodes: includedNodes,
      edges: includedEdges,
      builtAt: new Date().toISOString(),
    };
  }

  /**
   * Convert a dependency graph to a Mermaid flowchart string.
   * This is the primary rendering path — the webview uses mermaid
   * to render this as an interactive SVG.
   */
  static toMermaid(graph: DependencyGraph, centerId?: string): string {
    if (graph.nodes.length === 0) {
      return 'flowchart TD\n  empty[No cached analyses found]';
    }

    const lines: string[] = ['flowchart TD'];

    // Style definitions for different node kinds
    lines.push('  classDef classNode fill:#264f78,stroke:#3c3c3c,color:#ccc');
    lines.push('  classDef fnNode fill:#1e4620,stroke:#3c3c3c,color:#ccc');
    lines.push('  classDef methodNode fill:#1e4620,stroke:#3c3c3c,color:#ccc');
    lines.push('  classDef varNode fill:#4a3520,stroke:#3c3c3c,color:#ccc');
    lines.push('  classDef ifaceNode fill:#3b2e5a,stroke:#3c3c3c,color:#ccc');
    lines.push('  classDef centerNode fill:#c24f00,stroke:#fff,color:#fff,stroke-width:3px');

    // Map node IDs to short mermaid-safe labels
    const idMap = new Map<string, string>();
    let counter = 0;
    for (const node of graph.nodes) {
      const mermaidId = `n${counter++}`;
      idMap.set(node.id, mermaidId);

      // Use the appropriate bracket shape per kind
      const kindPrefix = this._kindEmoji(node.kind);
      const label = `${kindPrefix} ${node.name}`;
      const safeLabel = label.replace(/"/g, "'");

      if (node.kind === 'class' || node.kind === 'struct' || node.kind === 'interface') {
        lines.push(`  ${mermaidId}["${safeLabel}"]`);
      } else {
        lines.push(`  ${mermaidId}("${safeLabel}")`);
      }

      // Apply style class
      if (centerId && node.id === centerId) {
        lines.push(`  class ${mermaidId} centerNode`);
      } else {
        const styleClass = this._kindToStyleClass(node.kind);
        lines.push(`  class ${mermaidId} ${styleClass}`);
      }
    }

    // Edges
    const edgeStyles: Record<string, string> = {
      calls: '-->',
      dependsOn: '-.->',
      extends: '===>',
      implements: '-..->',
      uses: '-->',
    };

    for (const edge of graph.edges) {
      const fromId = idMap.get(edge.from);
      const toId = idMap.get(edge.to);
      if (!fromId || !toId) {
        continue;
      }
      const arrow = edgeStyles[edge.type] || '-->';
      const edgeLabel = edge.type !== 'calls' ? `|${edge.type}|` : '';
      lines.push(`  ${fromId} ${arrow}${edgeLabel} ${toId}`);
    }

    return lines.join('\n');
  }

  // ── Private Helpers ────────────────────────────────────

  /**
   * Recursively scan the cache directory for all .md analysis files
   * and deserialize them into lightweight AnalysisResult objects
   * (only the fields needed for graph building).
   */
  private async _scanAllCacheFiles(): Promise<AnalysisResult[]> {
    const results: AnalysisResult[] = [];

    try {
      await fs.access(this._cacheRoot);
    } catch {
      logger.debug('GraphBuilder: cache root does not exist');
      return results;
    }

    await this._scanDirectory(this._cacheRoot, results);
    return results;
  }

  private async _scanDirectory(
    dirPath: string,
    results: AnalysisResult[]
  ): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(dirPath);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry);
      let stat;
      try {
        stat = await fs.stat(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        await this._scanDirectory(fullPath, results);
      } else if (entry.endsWith('.md') && !entry.startsWith('_')) {
        const analysis = await this._parseAnalysisFile(fullPath);
        if (analysis) {
          results.push(analysis);
        }
      }
    }
  }

  /**
   * Parse a cache markdown file into a lightweight AnalysisResult.
   * Only extracts the fields needed for graph building (symbol identity,
   * callers, sub-functions, dependencies, relationships).
   */
  private async _parseAnalysisFile(filePath: string): Promise<AnalysisResult | null> {
    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch {
      return null;
    }

    // Parse YAML frontmatter
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fmMatch) {
      return null;
    }

    const fm = this._parseFrontmatter(fmMatch[1]);
    const name = fm['symbol'];
    const kind = (fm['kind'] || 'unknown') as SymbolKindType;
    const file = fm['file'] || '';
    const line = parseInt(fm['line'] || '0', 10);
    const scopeChain = fm['scope_chain'] ? fm['scope_chain'].split('.') : [];

    if (!name || !file) {
      return null;
    }

    // Extract overview (first paragraph after ## Overview)
    const overviewMatch = content.match(/## Overview\s*\n+([\s\S]*?)(?=\n##|\n```|$)/);
    const overview = overviewMatch ? overviewMatch[1].trim() : '';

    // Parse json:callers block
    const callStacks = this._parseJsonBlock(content, 'callers') || [];

    // Parse json:subfunctions block
    const subFunctions = this._parseJsonBlock(content, 'subfunctions') || [];

    // Parse dependencies (from ## Dependencies section)
    const depsMatch = content.match(/## Dependencies\s*\n+([\s\S]*?)(?=\n##|$)/);
    const dependencies: string[] = [];
    if (depsMatch) {
      const lines = depsMatch[1].split('\n');
      for (const depLine of lines) {
        const match = depLine.match(/^-\s+(.+)/);
        if (match) {
          dependencies.push(match[1].trim().replace(/`/g, '').replace(/\*\*/g, ''));
        }
      }
    }

    return {
      symbol: {
        name,
        kind,
        filePath: file,
        position: { line, character: 0 },
        scopeChain,
      },
      overview,
      callStacks: callStacks.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c: any) => ({
          caller: {
            name: c.name || '',
            filePath: c.filePath || '',
            line: c.line || 0,
            kind: (c.kind || 'function') as SymbolKindType,
          },
          callSites: [],
          chain: c.context || '',
        })
      ),
      usages: [],
      dataFlow: [],
      relationships: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      subFunctions: subFunctions.map((sf: any) => ({
        name: sf.name || '',
        description: sf.description || '',
        input: sf.input || '',
        output: sf.output || '',
        filePath: sf.filePath,
        line: sf.line,
        kind: sf.kind,
      })),
      dependencies,
      metadata: {
        analyzedAt: fm['analyzed_at'] || '',
        sourceHash: '',
        dependentFileHashes: {},
        llmProvider: fm['llm_provider'],
        analysisVersion: fm['analysis_version'] || '1.0.0',
        stale: fm['stale'] === 'true',
      },
    };
  }

  /**
   * Parse a ```json:name block from cache file content.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _parseJsonBlock(content: string, blockName: string): any[] | null {
    const regex = new RegExp(
      '```json:' + blockName + '\\s*\\n([\\s\\S]*?)\\n\\s*```',
      'm'
    );
    const match = content.match(regex);
    if (!match) {
      return null;
    }
    try {
      const parsed = JSON.parse(match[1]);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  /**
   * Parse YAML frontmatter into a key-value map.
   */
  private _parseFrontmatter(yaml: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const line of yaml.split('\n')) {
      const match = line.match(/^(\w[\w_]*):\s*"?([^"]*)"?\s*$/);
      if (match) {
        result[match[1]] = match[2];
      }
    }
    return result;
  }

  /**
   * Build a unique node ID from an analysis result.
   */
  private _makeNodeId(analysis: AnalysisResult): string {
    const s = analysis.symbol;
    const scope = s.scopeChain?.join('.') || '';
    const prefix = scope ? `${scope}.` : '';
    return `${s.filePath}::${prefix}${s.kind}.${s.name}`;
  }

  /**
   * Find a node by name + filePath match.
   */
  private _findNodeByNameAndFile(
    nodes: Map<string, GraphNode>,
    name: string,
    filePath: string
  ): string | null {
    for (const [id, node] of nodes) {
      if (node.name === name && node.filePath === filePath) {
        return id;
      }
    }
    // Fallback: try matching just by name (cross-file references
    // may have slightly different paths)
    for (const [id, node] of nodes) {
      if (node.name === name) {
        return id;
      }
    }
    return null;
  }

  /**
   * Find a node by name only (for loose dependency matching).
   */
  private _findNodeByName(
    nodes: Map<string, GraphNode>,
    name: string
  ): string | null {
    // Clean up the dependency name (may contain paths, backticks, etc.)
    const cleanName = name.replace(/`/g, '').replace(/\*\*/g, '').trim();
    // Try exact match first
    for (const [id, node] of nodes) {
      if (node.name === cleanName) {
        return id;
      }
    }
    // Try matching the last part after a dot (e.g., "CacheStore.read" -> "read")
    const parts = cleanName.split('.');
    const lastName = parts[parts.length - 1];
    if (lastName && lastName !== cleanName) {
      for (const [id, node] of nodes) {
        if (node.name === lastName) {
          return id;
        }
      }
    }
    return null;
  }

  private _firstSentence(text: string): string {
    const match = text.match(/[^.!?]+[.!?]/);
    return match ? match[0].trim() : text.substring(0, 120);
  }

  private static _kindEmoji(kind: SymbolKindType): string {
    const map: Record<string, string> = {
      class: 'C',
      function: 'fn',
      method: 'm',
      variable: 'x',
      interface: 'I',
      type: 'T',
      enum: 'E',
      property: 'p',
      struct: 'S',
    };
    return map[kind] || '';
  }

  private static _kindToStyleClass(kind: SymbolKindType): string {
    const map: Record<string, string> = {
      class: 'classNode',
      struct: 'classNode',
      interface: 'ifaceNode',
      function: 'fnNode',
      method: 'methodNode',
      variable: 'varNode',
    };
    return map[kind] || 'fnNode';
  }
}
