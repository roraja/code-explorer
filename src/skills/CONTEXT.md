# Skills Module — CONTEXT.md

## Purpose

Installs Code Explorer analysis skills into Claude Code and GitHub Copilot's
global skill/instruction directories. This allows users to invoke file analysis
from either agent outside of VS Code, generating cache files that the extension
can read directly.

## Files

| File | Description |
|------|-------------|
| `SkillInstaller.ts` | Installs/uninstalls/checks skill files at global paths |

## How It Works

The `SkillInstaller` writes skill definition files to:

- **Claude Code**: `~/.claude/skills/code-explorer-analyze/SKILL.md`
  - Uses Claude's SKILL.md frontmatter format with `name` and `description`
- **GitHub Copilot**: `~/.github/instructions/code-explorer-analyze.instructions.md`
  - Uses Copilot's instruction format with `applyTo` and `description`

Both files share the same core content: a comprehensive instruction set that
teaches the agent how to:
1. Read a source file
2. Identify symbols (classes, functions, methods, variables, etc.)
3. Generate analysis for each symbol (overview, callers, data flow, etc.)
4. Write markdown cache files with YAML frontmatter to `.vscode/code-explorer/`
5. Follow the exact cache key naming convention (`<kind_prefix>.<name>.md`)

The skill accepts:
- `filePath` (required) — relative path to the source file
- `symbols` (optional) — comma-separated symbol names to analyze

## Cache Compatibility

The skill output matches `CacheStore._serialize()` format exactly:
- YAML frontmatter with `symbol`, `kind`, `file`, `line`, `scope_chain`, `analyzed_at`, etc.
- Tagged JSON fences (`json:callers`, `json:steps`, `json:subfunctions`, etc.)
- Section ordering matches `CacheStore._deserialize()` expectations

## VS Code Integration

Registered as `codeExplorer.installGlobalSkills` command in `extension.ts`.
Available via Command Palette: "Code Explorer: Install Global Analysis Skills (Claude + Copilot)".
