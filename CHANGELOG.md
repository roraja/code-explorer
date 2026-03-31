# Changelog

All notable changes to the "Code Explorer" extension will be documented in this file.

## [Unreleased]

## [0.3.4] - 2026-03-31

### Added
- **Tab search filter**: Search box in the left sidebar below the investigation name that filters tabs in real-time (case-insensitive) by symbol name, kind, file path, or scope chain
- **Updated context documentation**: All CONTEXT.md files and FLOORPLAN.md updated to reflect current codebase state, including new CONTEXT.md files for `src/graph/` and `src/cli/`

## [0.3.3] - 2026-03-30

### Changed
- **ADO upstream uses same directory**: Content and upstream commands now share `.vscode/code-explorer/` with automatic branch switching instead of separate directories
- Pull/push commands detect the current branch and switch to the target branch (`content` or `content-upstream`) before operating
- Removed `--single-branch` from clone so both branches are available locally

## [0.3.2] - 2026-03-30

### Added
- **ADO Upstream sync commands**: "Pull ADO Upstream" and "Push ADO Upstream" for the `content-upstream` branch, syncing to `.vscode/code-explorer-upstream/`
- Refactored ADO sync into a generic engine supporting multiple sync targets (content + upstream)

## [0.3.1] - 2026-03-30

### Fixed
- **Windows compatibility**: `isAvailable()` in CopilotCLIProvider and MaiClaudeProvider used Unix-only `which` command; now uses `where` on Windows
- **Windows compatibility**: `spawn()` calls in CLI runner and ADO sync now use `shell: true` on Windows to resolve `.cmd`/`.bat` shims (copilot, claude, git)
- **Windows compatibility**: HoverProvider and CodeLensProvider cross-drive path detection now checks `path.isAbsolute()` in addition to `startsWith('..')`
- **Bloated .vsix package**: Added `poc/`, `tools/`, `.claude/`, `.context/`, `CLAUDE.md`, `**/CONTEXT.md` to `.vscodeignore` — reduced package from 10.65 MB to 882 KB
- **Missing build-service config**: Added `build-service` to `llmProvider` enum in `package.json` and declared `buildServiceUrl`, `buildServiceModel`, `buildServiceAgentBackend` configuration properties

### Changed
- **ADO sync rewrite**: Pull now clones the ADO repo into `.vscode/code-explorer/` as a standalone git repo with `origin` set to ADO; push uses standard `pull → add → commit → push` workflow instead of git plumbing commands

## [0.3.0] - 2026-03-30

### Added
- **Tree-sitter symbol indexing** — AST-based deterministic symbol identification with C++ and TypeScript extractors, overload discrimination via parameter signature hashing, in-memory index with 4 lookup strategies (byAddress, byName, byFile, resolveAtCursor), and JSON persistence
- **Build service LLM provider** — HTTP-based provider that submits analysis jobs to a remote Go build service, polls with incremental log streaming, and collects file-based output
- **Show Symbol Info command** — Diagnostic command that queries 11 VS Code intellisense providers (document symbols, definitions, type definitions, hover, references, call hierarchy, type hierarchy, implementations, signature help, highlights, completions) with symbol address derivation
- **Shared symbol helpers** (`src/utils/symbolHelpers.ts`) — Extracted `findDeepestSymbol`, `mapVscodeSymbolKind`, `buildScopeChainForPosition` from duplicated code
- **Dependency graph, hover cards, CodeLens, and navigation history**
- **Interactive Q&A** for analyzed symbols
- **Mermaid diagram generation and rendering** in analysis pipeline and webview
- **Clickable file:line references** in webview to navigate to source
- **ADO pull/push content sync** commands
- **Auto-link symbols** in analysis text
- **Tab session persistence** across window reloads
- **Skills installer** for global Claude/Copilot analysis skills
- **Process monitor tool** (`tools/process-monitor/`)
- **POC tree-sitter scripts** (`poc/tree-sitter/`)
- Unit tests for indexing module (SymbolAddress, SymbolIndex, Extractors) and BuildServiceProvider

### Changed
- StaticAnalyzer: added `listFileSymbols()` for static symbol discovery
- AnalysisOrchestrator: integrated static symbol list into file analysis, added cache-on-cursor-hit promotion
- PromptBuilder: added `buildFileAnalysisFromSymbolList()` for targeted file analysis
- CacheStore: added address-based cache operations and cache file path display
- SymbolResolver: refactored to use shared symbolHelpers
- CLI utility: added stdout/stderr separation and streaming log support
- Logger: added sequential LLM log numbering and streaming chunk capture
- LLMProviderFactory: registered build-service provider
- Logger: moved logs to `code-explorer-logs/` and added per-command log files
- esbuild: marked tree-sitter native modules as external

### Fixed
- Stripped JSON blocks from overview text to prevent raw JSON in rendered output
- Hardened ResponseParser and ADO sync error handling

## [0.2.0] - 2026-03-15

### Added
- Project scaffolding and directory structure
- TypeScript configuration for extension and webview
- esbuild bundling for extension and webview
- ESLint + Prettier configuration
- VS Code debug and task configurations
- Core data model interfaces (`src/models/types.ts`)
- Error type hierarchy (`src/models/errors.ts`)
- Constants module (`src/models/constants.ts`)
- Extension entry point with activate/deactivate
- Webview entry point with empty state
- Webview CSS with VS Code theme variables
- Test infrastructure (Mocha + VS Code Test Runner)
- Unit tests for data models and error types
- `.vscodeignore` for VSIX packaging
- Activity bar icon (SVG)
