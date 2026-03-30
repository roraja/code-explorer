#!/usr/bin/env node
/**
 * Code Explorer — CLI Tool
 *
 * Standalone command-line interface for core Code Explorer operations.
 * Runs without VS Code — uses FileSystemSourceReader and the chosen
 * LLM provider (or 'none' for cache-only operations).
 *
 * Usage:
 *   npx ts-node src/cli/code-explorer-cli.ts <command> [options]
 *
 * Commands:
 *   explore-symbol   Analyze a symbol at a cursor position
 *   explore-file     Analyze all symbols in a file
 *   read-cache       Read cached analysis for a symbol
 *   clear-cache      Clear all cached analyses
 *   dependency-graph Build dependency graph from cached analyses
 */
import * as fs from 'fs';
import * as path from 'path';
import { CodeExplorerAPI } from '../api/CodeExplorerAPI';
import type { CursorContext, SymbolKindType } from '../models/types';

// ── Arg parsing ────────────────────────────────────────────

interface ParsedArgs {
  command: string;
  workspace: string;
  file?: string;
  line?: number;
  character?: number;
  word?: string;
  symbol?: string;
  kind?: string;
  llm: string;
  format?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2); // skip node and script path
  const command = args[0] || 'help';

  const opts: Record<string, string> = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length) {
      const key = args[i].slice(2);
      opts[key] = args[++i];
    }
  }

  return {
    command,
    workspace: opts['workspace'] || process.cwd(),
    file: opts['file'],
    line: opts['line'] ? parseInt(opts['line'], 10) : undefined,
    character: opts['character'] ? parseInt(opts['character'], 10) : undefined,
    word: opts['word'],
    symbol: opts['symbol'],
    kind: opts['kind'],
    llm: opts['llm'] || 'none',
    format: opts['format'],
  };
}

function printUsage(): void {
  process.stderr.write(`
Code Explorer CLI

Usage: code-explorer-cli <command> [options]

Commands:
  explore-symbol    Analyze a symbol at a cursor position
  explore-file      Analyze all symbols in a file
  read-cache        Read cached analysis for a symbol
  clear-cache       Clear all cached analyses
  dependency-graph  Build dependency graph from cached analyses

Common Options:
  --workspace <path>  Workspace root directory (default: cwd)
  --llm <provider>    LLM provider: copilot-cli | mai-claude | build-service | none (default: none)

explore-symbol Options:
  --file <path>       Relative file path from workspace root
  --line <number>     0-based line number
  --word <string>     The symbol name at the cursor

explore-file Options:
  --file <path>       Relative file path from workspace root

read-cache Options:
  --file <path>       Relative file path from workspace root
  --symbol <name>     Symbol name
  --kind <kind>       Symbol kind (function, class, method, variable, etc.)

dependency-graph Options:
  --format <format>   Output format: json | mermaid (default: json)

Output:
  Results are printed as JSON to stdout.
  Progress and logs go to stderr.
`);
}

// ── Commands ───────────────────────────────────────────────

async function exploreSymbol(api: CodeExplorerAPI, args: ParsedArgs): Promise<void> {
  if (!args.file || !args.word || args.line === undefined) {
    process.stderr.write('Error: --file, --word, and --line are required for explore-symbol\n');
    process.exit(1);
  }

  const absFile = path.join(args.workspace, args.file);
  if (!fs.existsSync(absFile)) {
    process.stderr.write(`Error: file not found: ${absFile}\n`);
    process.exit(1);
  }

  const content = fs.readFileSync(absFile, 'utf-8');
  const lines = content.split('\n');
  const startLine = Math.max(0, args.line - 50);
  const endLine = Math.min(lines.length - 1, args.line + 50);
  const surroundingSource = lines.slice(startLine, endLine + 1).join('\n');
  const cursorLine = lines[args.line] || '';

  const cursor: CursorContext = {
    word: args.word,
    filePath: args.file,
    position: { line: args.line, character: args.character || 0 },
    surroundingSource,
    cursorLine,
  };

  process.stderr.write(`Analyzing "${args.word}" in ${args.file}:${args.line}...\n`);

  const { symbol, result } = await api.exploreSymbol(cursor, (stage) => {
    process.stderr.write(`  [${stage}]\n`);
  });

  process.stderr.write(`Resolved: ${symbol.kind} "${symbol.name}"\n`);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

async function exploreFile(api: CodeExplorerAPI, args: ParsedArgs): Promise<void> {
  if (!args.file) {
    process.stderr.write('Error: --file is required for explore-file\n');
    process.exit(1);
  }

  const absFile = path.join(args.workspace, args.file);
  if (!fs.existsSync(absFile)) {
    process.stderr.write(`Error: file not found: ${absFile}\n`);
    process.exit(1);
  }

  const fileSource = fs.readFileSync(absFile, 'utf-8');
  process.stderr.write(`Analyzing all symbols in ${args.file}...\n`);

  const cachedCount = await api.exploreFile(args.file, fileSource, (stage, detail) => {
    process.stderr.write(`  [${stage}] ${detail || ''}\n`);
  });

  process.stdout.write(JSON.stringify({ cachedCount }, null, 2) + '\n');
  process.stderr.write(`Cached ${cachedCount} symbols.\n`);
}

async function readCache(api: CodeExplorerAPI, args: ParsedArgs): Promise<void> {
  if (!args.file || !args.symbol || !args.kind) {
    process.stderr.write('Error: --file, --symbol, and --kind are required for read-cache\n');
    process.exit(1);
  }

  const result = await api.readCache({
    name: args.symbol,
    kind: args.kind as SymbolKindType,
    filePath: args.file,
    position: { line: args.line || 0, character: 0 },
  });

  if (result) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    process.stdout.write('null\n');
    process.stderr.write('No cached analysis found.\n');
  }
}

async function clearCache(api: CodeExplorerAPI): Promise<void> {
  process.stderr.write('Clearing cache...\n');
  await api.clearCache();
  process.stderr.write('Cache cleared.\n');
  process.stdout.write(JSON.stringify({ cleared: true }) + '\n');
}

async function dependencyGraph(api: CodeExplorerAPI, args: ParsedArgs): Promise<void> {
  process.stderr.write('Building dependency graph...\n');
  const graph = await api.buildDependencyGraph();
  process.stderr.write(`Graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges\n`);

  if (args.format === 'mermaid') {
    const mermaid = api.toMermaid(graph);
    process.stdout.write(mermaid + '\n');
  } else {
    process.stdout.write(JSON.stringify(graph, null, 2) + '\n');
  }
}

// ── Main ───────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.command === 'help' || args.command === '--help' || args.command === '-h') {
    printUsage();
    process.exit(0);
  }

  // Validate workspace
  if (!fs.existsSync(args.workspace)) {
    process.stderr.write(`Error: workspace not found: ${args.workspace}\n`);
    process.exit(1);
  }

  const api = new CodeExplorerAPI({
    workspaceRoot: path.resolve(args.workspace),
    llmProvider: args.llm,
  });

  try {
    switch (args.command) {
      case 'explore-symbol':
        await exploreSymbol(api, args);
        break;
      case 'explore-file':
        await exploreFile(api, args);
        break;
      case 'read-cache':
        await readCache(api, args);
        break;
      case 'clear-cache':
        await clearCache(api);
        break;
      case 'dependency-graph':
        await dependencyGraph(api, args);
        break;
      default:
        process.stderr.write(`Unknown command: ${args.command}\n`);
        printUsage();
        process.exit(1);
    }
  } finally {
    api.dispose();
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
