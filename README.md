# Code Explorer

AI-powered code intelligence sidebar for VS Code — deep symbol analysis, call stacks, usage tracking, and data flow visualization.

![VS Code](https://img.shields.io/badge/VS%20Code-1.85%2B-blue?logo=visual-studio-code)
![License](https://img.shields.io/github/license/roraja/code-explorer)
![Release](https://img.shields.io/github/v/release/roraja/code-explorer?include_prereleases)

## Quick Install

```bash
curl -fsSL "$(curl -s https://api.github.com/repos/roraja/code-explorer/releases/latest | grep browser_download_url | cut -d '"' -f 4)" -o /tmp/code-explorer.vsix && code --install-extension /tmp/code-explorer.vsix && rm /tmp/code-explorer.vsix
```

This downloads the latest `.vsix` from GitHub Releases and installs it into VS Code. Reload VS Code after installation.

### Alternative: Manual Install

1. Go to [Releases](https://github.com/roraja/code-explorer/releases/latest)
2. Download the `.vsix` file
3. Run: `code --install-extension code-explorer-*.vsix`

## What It Does

Place your cursor on any symbol (function, class, variable, property) and press **Ctrl+Shift+H** (or right-click → "Explore Symbol"). The Code Explorer sidebar shows LLM-generated analysis:

- **Overview** — what the symbol does, in plain English
- **Step-by-step breakdown** — line-by-line logic walkthrough
- **Sub-functions** — called functions with descriptions
- **Inputs & Outputs** — parameters, return values, side effects
- **Callers** — who calls this symbol and why
- **Data flow** — how data moves through the symbol
- **Class members** — properties and methods (for classes)
- **Variable lifecycle** — declaration, mutations, usage (for variables)

Results are cached as markdown files so repeated lookups are instant.

## Supported Languages

TypeScript · JavaScript · C/C++ · Python · Java · C#

## LLM Providers

| Provider | CLI Command | Config Value |
|----------|-------------|--------------|
| GitHub Copilot CLI (default) | `copilot` | `copilot-cli` |
| Claude CLI | `claude` | `mai-claude` |
| None (disable LLM) | — | `none` |

Set via `codeExplorer.llmProvider` in VS Code settings.

## Commands

| Command | Keybinding | Description |
|---------|------------|-------------|
| Explore Symbol | `Ctrl+Shift+H` | Analyze symbol at cursor |
| Explore All Symbols in File | `Ctrl+Shift+Alt+E` | Analyze all symbols in current file |
| Refresh Analysis | — | Re-analyze current symbol (ignore cache) |
| Clear Cache | — | Delete all cached analyses |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `codeExplorer.llmProvider` | `copilot-cli` | LLM provider to use |
| `codeExplorer.cacheTTLHours` | `168` (7 days) | Cache time-to-live |
| `codeExplorer.analysisDepth` | `standard` | Analysis depth: `shallow`, `standard`, `deep` |
| `codeExplorer.maxConcurrentAnalyses` | `3` | Max parallel LLM requests |
| `codeExplorer.excludePatterns` | `[node_modules, dist, ...]` | Glob patterns to exclude |
| `codeExplorer.autoAnalyzeOnSave` | `false` | Re-analyze on file save |
| `codeExplorer.openOnClick` | `false` | Auto-open sidebar on symbol click |

## Development

```bash
npm install
npm run build       # Build extension + webview
npm run watch       # Watch mode
npm run lint        # Lint
npm run test:unit   # Run unit tests
npm run package     # Build .vsix
```

### Releasing

1. Update `version` in `package.json`
2. Commit and push
3. Tag and push: `git tag v0.2.0 && git push origin v0.2.0`
4. GitHub Actions builds the VSIX and creates a release automatically

## License

[MIT](LICENSE)
