# 08 - Add Install Global Analysis Skills Command

**Date**: 2026-03-29 07:10 UTC
**Prompt**: "Add a VS Code extension command. Install global clod slash copilot scale to parse files. This will install skills in both clod and copilot in the global home directory for both agents. So if I trigger the scale, it knows and in the skill I provide the file path and maybe variable names or symbol names optionally. Then it will parse the code for resolving LLM analysis documentation for either all the symbols or the mentioned symbols when the skill is run. Make sure the skill contains the details which the analysis should contain as per this extension and also the file path where the analysis should be stored so that the caching system works as per the extension. The skill should contain all these details."

## 1. Code Reading & Analysis

Files read to understand the extension's architecture, cache format, and skill conventions:

- `.context/FLOORPLAN.md` — Routing table for all modules, data flow, feature status
- `src/models/constants.ts` — Command identifiers (`COMMANDS`), cache constants (`CACHE`), kind prefixes
- `src/models/types.ts` — All type definitions: `SymbolInfo`, `AnalysisResult`, `SymbolKindType`, `SYMBOL_KIND_PREFIX`, `CursorContext`, `ClassMemberInfo`, `DataKindInfo`, `VariableLifecycle`, etc.
- `src/cache/CacheStore.ts` — Full cache file read/write, path resolution (`_resolvePath`, `_buildCacheKey`), serialization (`_serialize`), YAML frontmatter format, tag-based JSON fences (`json:callers`, `json:steps`, etc.), cache directory structure (`.vscode/code-explorer/<source_path>/<cache_key>.md`)
- `src/extension.ts` — Command registration pattern, dependency injection setup, existing commands
- `src/llm/PromptBuilder.ts` — `buildUnified()` and `buildFileAnalysis()` prompt templates — shows exactly what analysis sections the LLM is asked to generate and what JSON block tags are used
- `src/llm/ResponseParser.ts` — `ResolvedSymbolIdentity`, `RelatedSymbolCacheEntry`, `FileSymbolAnalysisEntry` interfaces — shows what the parser expects
- `src/analysis/AnalysisOrchestrator.ts` — `analyzeFile()` method showing the full file analysis pipeline
- `package.json` — Existing commands, activation events, keybindings
- `~/.claude/skills/commit-active-tree/SKILL.md` — Claude skill frontmatter format reference
- `~/.claude/skills/bugduster-api/SKILL.md` — Another skill format reference
- `~/.claude/settings.json` — Claude global settings
- `~/.github/` — Checked Copilot global instruction directories
- `.github/copilot-instructions.md` — Existing project-level Copilot instructions
- `.github/instructions/` — Existing Copilot instruction files

## 2. Issues Identified

No bugs or issues — this is a new feature. Key design considerations:

1. **Cache format compatibility**: The skill must teach agents to produce markdown files with YAML frontmatter that exactly matches `CacheStore._serialize()` and can be parsed by `CacheStore._deserialize()`. This includes:
   - Correct YAML fields: `symbol`, `kind`, `file`, `line`, `scope_chain` (quoted, dot-separated), `analyzed_at` (quoted ISO 8601), `analysis_version`, `llm_provider`, `stale`
   - Tagged JSON fences: `json:callers`, `json:steps`, `json:subfunctions`, `json:function_inputs`, `json:function_output`, `json:class_members`, `json:member_access`, `json:variable_lifecycle`, `json:data_flow`, `json:data_kind`

2. **Cache key construction**: Must match `_buildCacheKey()` — scope chain prefix + kind prefix + sanitized name. The SYMBOL_KIND_PREFIX mapping must be included in the skill.

3. **File path convention**: Cache files at `.vscode/code-explorer/<source_file_path>/<cache_key>.md`

4. **Claude skill format**: Uses `---` frontmatter with `name` and `description` fields, stored at `~/.claude/skills/<name>/SKILL.md`

5. **Copilot instruction format**: Uses `---` frontmatter with `applyTo` and `description` fields, stored at `~/.github/instructions/<name>.instructions.md`

## 3. Plan

1. Create `src/skills/SkillInstaller.ts` — module that generates and writes skill files
2. Add `INSTALL_GLOBAL_SKILLS` to `COMMANDS` in constants
3. Register command in `extension.ts` with install/uninstall/reinstall UX
4. Register command in `package.json` with activation event
5. Create `src/skills/CONTEXT.md` for module documentation
6. Update `FLOORPLAN.md` with new module
7. Build, lint, test

The skill content itself is extensive — it teaches agents the full cache format including:
- All section types (Overview, Key Points, Callers, Steps, Sub-Functions, Function I/O, Class Members, Member Access, Variable Lifecycle, Data Flow, Data Kind, Dependencies, Usage Pattern, Potential Issues)
- Section inclusion rules per symbol kind (table showing which sections apply to functions vs classes vs variables etc.)
- Cache key construction with kind prefix mapping
- YAML frontmatter field names and formats
- Tagged JSON fence syntax

## 4. Changes Made

### New file: `src/skills/SkillInstaller.ts`
- `SkillInstaller` class with `install()`, `uninstall()`, `isInstalled()` methods
- `_buildClaudeSkill()` — generates Claude SKILL.md with frontmatter
- `_buildCopilotInstruction()` — generates Copilot instruction file
- `_buildSharedSkillContent()` — 400+ lines of comprehensive analysis instructions
- Writes to `~/.claude/skills/code-explorer-analyze/SKILL.md` and `~/.github/instructions/code-explorer-analyze.instructions.md`

### Modified: `src/models/constants.ts` (line 23)
- Added `INSTALL_GLOBAL_SKILLS: 'codeExplorer.installGlobalSkills'` to COMMANDS

### Modified: `src/extension.ts`
- Added import: `import { SkillInstaller } from './skills/SkillInstaller';`
- Added command registration for `COMMANDS.INSTALL_GLOBAL_SKILLS` (lines 176-233)
- Command checks if already installed, offers reinstall/uninstall, shows progress notification

### Modified: `package.json`
- Added activation event: `"onCommand:codeExplorer.installGlobalSkills"`
- Added command definition: `"codeExplorer.installGlobalSkills"` with title "Install Global Analysis Skills (Claude + Copilot)"

### New file: `src/skills/CONTEXT.md`
- Module documentation explaining purpose, files, cache compatibility, and VS Code integration

### Modified: `.context/FLOORPLAN.md`
- Added skills module to folder routing table
- Added "Install Global Skills command" to feature status table

## 5. Commands Run

| Command | Result |
|---------|--------|
| `npm run build` | ✅ Pass — dist/extension.js 128.1kb |
| `npm run lint` | ✅ Pass — no errors |
| `npm run test:unit` | ✅ Pass — 127 tests passing |

## 6. Result

Successfully implemented the "Install Global Analysis Skills" VS Code command that:

1. **Installs a Claude Code skill** at `~/.claude/skills/code-explorer-analyze/SKILL.md` — triggered by phrases like "analyze file", "code-explorer analyze", "parse file for code explorer"
2. **Installs a Copilot instruction** at `~/.github/instructions/code-explorer-analyze.instructions.md` — available as a Copilot context instruction
3. **Both skills share identical content** teaching the agent to:
   - Read a source file and identify all crucial symbols (or filter by user-specified names)
   - Generate comprehensive analysis per symbol kind (functions get steps/sub-functions/inputs/output, classes get members/access patterns, variables get lifecycle/data flow/data kind)
   - Write cache files at the correct path with exact YAML frontmatter format
   - Use tagged JSON fences matching the extension's parser expectations
   - Follow the cache key naming convention (scope chain + kind prefix + sanitized name)
4. **The VS Code command** provides install/uninstall/reinstall UX with progress notifications

Users can now open any workspace, run "Code Explorer: Install Global Analysis Skills", and then use Claude or Copilot to pre-analyze files — the results are written directly to the cache and picked up instantly by "Explore Symbol" (Ctrl+Shift+E).

## 7. Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| `src/skills/SkillInstaller.ts` | Created | Core skill installer with shared skill content for Claude + Copilot |
| `src/skills/CONTEXT.md` | Created | Module documentation |
| `src/models/constants.ts` | Modified | Added `INSTALL_GLOBAL_SKILLS` command constant |
| `src/extension.ts` | Modified | Added SkillInstaller import and command registration |
| `package.json` | Modified | Added command definition and activation event |
| `.context/FLOORPLAN.md` | Modified | Added skills module to routing table and feature list |
