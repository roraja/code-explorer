# 33 - Fix Installation: .vscodeignore and Build-Service Config

**Date**: 2026-03-30 UTC
**Prompt**: "There is some issue with installation, check and fix. Make sure by default, it uses copilot cli for AI. Update, commit trigger release once done."

## 1. Code Reading & Analysis

- **`.context/FLOORPLAN.md`** — Read for project overview and architecture understanding
- **`package.json`** — Read to check extension configuration, settings, dependencies, scripts. Found:
  - Default `llmProvider` is `"copilot-cli"` ✅
  - But `enum` only listed `["copilot-cli", "mai-claude", "none"]` — missing `"build-service"` which the factory supports
  - `extension.ts` reads `buildServiceUrl`, `buildServiceModel`, `buildServiceAgentBackend` config keys but these were NOT declared in `package.json` `contributes.configuration`
- **`src/extension.ts`** — Read to verify activation, DI wiring, and config reading (lines 42-48). Confirmed default is `'copilot-cli'` and build-service config keys are read
- **`src/models/constants.ts`** — Read for command/config constants
- **`src/llm/CopilotCLIProvider.ts`** — Read to verify copilot CLI invocation
- **`src/llm/LLMProviderFactory.ts`** — Read to verify factory supports `"build-service"` case (line 37-49) but `package.json` enum didn't include it
- **`src/llm/LLMProvider.ts`** — Read for interface definition
- **`src/llm/BuildServiceProvider.ts`** — Read full file to understand build service config requirements
- **`esbuild.config.mjs`** — Read to check build configuration
- **`webview/esbuild.config.mjs`** — Read for webview build config
- **`.vscodeignore`** — Read and found it was missing critical exclusions

Ran commands:
- `npm install` — no issues (562 packages, up to date)
- `npm run build` — succeeded (extension.js 226.9kb, webview main.js 2.8mb)
- `npm run lint` — clean, no issues
- `npm run test:unit` — all 248 tests pass
- `npm run package` — **BEFORE fix**: 10.65 MB, 263 files. Included `poc/tree-sitter/node_modules/` (97.68 MB source!), `tools/process-monitor/`, `.claude/`, `.context/`, `CLAUDE.md`

## 2. Issues Identified

### Issue 1: Bloated .vsix package (`.vscodeignore`)
- **File**: `.vscodeignore`
- **Problem**: Missing exclusion patterns for `poc/**`, `tools/**`, `.claude/**`, `.context/**`, `CLAUDE.md`, and `**/CONTEXT.md`
- **Impact**: The `poc/tree-sitter/node_modules/` directory alone contained 241 files / 97.68 MB, bloating the .vsix from ~885 KB to 10.65 MB. This would cause slow installation and unnecessary disk usage.

### Issue 2: Missing `build-service` enum in settings (`package.json`)
- **File**: `package.json` (line 173-183)
- **Problem**: `LLMProviderFactory` supports `"build-service"` provider (added in commit 8749481), but the VS Code settings schema (`contributes.configuration.codeExplorer.llmProvider.enum`) did not include it. Users couldn't select it from Settings UI and wouldn't know it existed.
- **Related**: `extension.ts` reads `buildServiceUrl`, `buildServiceModel`, `buildServiceAgentBackend` config keys (lines 46-48) but these properties were NOT declared in `package.json`, so VS Code wouldn't show them in settings and wouldn't provide defaults.

### Non-issue confirmed
- Default LLM provider is correctly `"copilot-cli"` in both `package.json` (`"default": "copilot-cli"`) and `extension.ts` (`config.get<string>('llmProvider', 'copilot-cli')`) ✅

## 3. Plan

1. Update `.vscodeignore` to exclude `poc/**`, `tools/**`, `.claude/**`, `.context/**`, `CLAUDE.md`, `**/CONTEXT.md`
2. Update `package.json` to add `"build-service"` to the `llmProvider` enum with description
3. Add the three build-service configuration properties (`buildServiceUrl`, `buildServiceModel`, `buildServiceAgentBackend`) to `package.json` `contributes.configuration`
4. Verify build, lint, tests, and package size
5. Commit and push

## 4. Changes Made

### `.vscodeignore`
Added 6 new exclusion lines after `sample-workspace/**`:
```diff
 sample-workspace/**
+poc/**
+tools/**
+.claude/**
+.context/**
+CLAUDE.md
+**/CONTEXT.md
 .gitignore
```

### `package.json`
1. Added `"build-service"` to `codeExplorer.llmProvider.enum` array (after `"mai-claude"`)
2. Added `"Use remote build service for AI analysis (HTTP API)"` to `enumDescriptions`
3. Added three new configuration properties:
   - `codeExplorer.buildServiceUrl` (string, default `"http://localhost:8090"`)
   - `codeExplorer.buildServiceModel` (string, default `"claude-opus-4.5"`)
   - `codeExplorer.buildServiceAgentBackend` (string, default `""`)

## 5. Commands Run

| Command | Result |
|---------|--------|
| `npm install` | ✅ up to date, 562 packages |
| `npm run build` | ✅ extension.js 226.9kb, webview 2.8mb |
| `npm run lint` | ✅ clean |
| `npm run test:unit` | ✅ 248 passing |
| `npm run package` (before fix) | ⚠️ 10.65 MB, 263 files — included poc/node_modules |
| `npm run package` (after fix) | ✅ 882.78 KB, 10 files |
| `git push origin master` | ✅ pushed to trigger release |

## 6. Result

- **.vsix size reduced from 10.65 MB → 882.78 KB** (92% reduction)
- **File count reduced from 263 → 10** (96% reduction)
- Build-service provider is now properly exposed in VS Code settings UI
- Default LLM provider confirmed as `copilot-cli` ✅
- All 248 tests pass, lint clean
- Pushed to `origin/master` to trigger release

## 7. Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| `.vscodeignore` | Modified | Added exclusions for poc/, tools/, .claude/, .context/, CLAUDE.md, CONTEXT.md |
| `package.json` | Modified | Added build-service to llmProvider enum; added buildServiceUrl, buildServiceModel, buildServiceAgentBackend config properties |
