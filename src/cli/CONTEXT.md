# src/cli/

Standalone command-line interface for core Code Explorer operations. Runs without VS Code — uses `FileSystemSourceReader` and the chosen LLM provider.

## Modules

| File | Role |
|------|------|
| `code-explorer-cli.ts` | CLI entry point. Parses arguments, creates `CodeExplorerAPI`, dispatches to command handlers. |

## Usage

```bash
npm run cli -- <command> [options]
```

Or directly:
```bash
TS_NODE_PROJECT=tsconfig.test.json node -r ts-node/register src/cli/code-explorer-cli.ts <command> [options]
```

## Commands

| Command | Description | Required Options |
|---------|-------------|-----------------|
| `explore-symbol` | Analyze a symbol at a cursor position | `--file`, `--word`, `--line` |
| `explore-file` | Analyze all symbols in a file | `--file` |
| `read-cache` | Read cached analysis for a symbol | `--file`, `--symbol`, `--kind` |
| `clear-cache` | Clear all cached analyses | (none) |
| `dependency-graph` | Build dependency graph from cache | `--format` (json\|mermaid) |
| `help` | Show usage info | (none) |

## Common Options

| Option | Description | Default |
|--------|-------------|---------|
| `--workspace <path>` | Workspace root directory | `process.cwd()` |
| `--llm <provider>` | LLM provider name | `none` |
| `--format <format>` | Output format (for dependency-graph) | `json` |

## Architecture

The CLI creates a `CodeExplorerAPI` instance with `FileSystemSourceReader` (default) and the specified LLM provider:

```
CLI args → parseArgs()
  → CodeExplorerAPI({ workspaceRoot, llmProvider })
    → FileSystemSourceReader (reads files via fs)
    → LLMProviderFactory.create(llmProvider)
    → CacheStore + AnalysisOrchestrator + GraphBuilder
  → command handler (exploreSymbol, readCache, etc.)
    → JSON output to stdout
    → Progress/logs to stderr
```

## Output Convention

- **Results**: JSON to stdout (parseable by other tools)
- **Progress/logs**: stderr (human-readable, includes stage labels)
- **Exit codes**: 0 = success, 1 = error

## Examples

```bash
# Read a cached analysis
npm run cli -- read-cache --workspace . --file src/extension.ts --symbol activate --kind function

# Explore a symbol (with LLM)
npm run cli -- explore-symbol --workspace . --file src/main.ts --line 10 --word processUser --llm copilot-cli

# Build dependency graph as Mermaid
npm run cli -- dependency-graph --workspace . --format mermaid
```
