# 07 - Add Global Commit-Active-Tree Skill for Claude and Copilot

**Date**: 2026-03-29 07:01 UTC
**Prompt**: "Add a global claude skill 'commit-active-tree' which will check current staged changes and prepares a detailed commit message and commits the change. Also add copilot skill for it"

## 1. Code Reading & Analysis
- Read `~/.claude/skills/` directory structure to understand global skill layout
- Read `~/.claude/skills/bugduster-api/SKILL.md` (lines 1-30) — existing global skill, uses markdown with YAML frontmatter, no plugin.json needed at global level
- Read `.claude/skills/update-context/.claude-plugin/plugin.json` — project-scoped skill structure (has plugin.json + skills/SKILL.md)
- Read `.claude/skills/update-context/skills/SKILL.md` — full example of SKILL.md format with `---` frontmatter (name, description), step-by-step procedure, guidelines
- Read `~/.vscode-server/data/User/` directory — found no existing prompts directory (needed to create it)
- Read `/home/roraja/src/chromium-docs/.vscode/prompts/01-analyze-bugs-in-folder.md` (lines 1-30) — example Copilot prompt file format
- Searched for `copilot-instructions.md` across repos to understand Copilot config patterns
- Checked `~/.vscode-server/data/User/prompts/` — did not exist, created it

## 2. Issues Identified
- No global Copilot prompts directory existed at `~/.vscode-server/data/User/prompts/` — needed to create it
- Global Claude skills use a simpler structure (just `SKILL.md` in a named folder) vs project-scoped skills that also need `.claude-plugin/plugin.json`
- Copilot user-level prompts use `.prompt.md` extension with YAML frontmatter specifying `mode`, `description`, and `tools`

## 3. Plan
- Create Claude global skill at `~/.claude/skills/commit-active-tree/SKILL.md` with comprehensive procedure for analyzing staged changes, drafting conventional commit messages, and executing the commit
- Create Copilot user-level prompt at `~/.vscode-server/data/User/prompts/commit-active-tree.prompt.md` with equivalent functionality
- Both skills follow the same logical flow: assess working tree → analyze changes → draft message → present → commit
- Include edge case handling (no changes, sensitive files, merge conflicts, large diffs)

## 4. Changes Made

### File: `~/.claude/skills/commit-active-tree/SKILL.md` (Created)
- New global Claude skill with YAML frontmatter containing name and description with trigger phrases
- 5-step procedure: Assess Working Tree → Analyze Changes → Draft Commit Message → Present and Confirm → Create Commit
- Conventional Commits format guidance with type categorization
- Edge case handling (clean tree, sensitive files, merge conflicts, large diffs, binary files, submodules)
- Three detailed commit message examples (feature, bug fix, multi-scope refactor)
- ~160 lines of detailed instruction

### File: `~/.vscode-server/data/User/prompts/commit-active-tree.prompt.md` (Created)
- Copilot agent-mode prompt with YAML frontmatter (`mode: agent`, `tools: ["terminal"]`)
- Same logical flow as the Claude skill, adapted to Copilot prompt format
- 6-step procedure including sensitive file warning as a dedicated step
- More concise than Claude version (~80 lines) following Copilot prompt conventions

## 5. Commands Run
| Command | Result |
|---------|--------|
| `ls -la ~/.claude/skills/` | Found existing skills: `bugduster-api`, `learned` |
| `ls -la ~/.claude/skills/bugduster-api/` | Found `SKILL.md` — confirmed global skill structure |
| `ls ~/.vscode-server/data/User/prompts/` | "Directory does not exist yet" |
| `mkdir -p ~/.claude/skills/commit-active-tree` | Success |
| `mkdir -p ~/.vscode-server/data/User/prompts` | Success |
| `ls -la ~/.claude/skills/commit-active-tree/` | Confirmed SKILL.md created (6191 bytes) |
| `ls -la ~/.vscode-server/data/User/prompts/` | Confirmed prompt file created (2754 bytes) |

## 6. Result
Both skills were successfully created:
- **Claude**: `~/.claude/skills/commit-active-tree/SKILL.md` — available globally across all projects as `/commit-active-tree` slash command
- **Copilot**: `~/.vscode-server/data/User/prompts/commit-active-tree.prompt.md` — available in VS Code Copilot Chat as `@workspace /commit-active-tree`

Both skills follow the same workflow:
1. Check `git status`, `git diff --cached`, and recent `git log`
2. Categorize changes by conventional commit type
3. Draft a structured commit message with type, scope, summary, body, and footer
4. Warn about sensitive files
5. Present for confirmation, then commit and verify

No follow-up needed. Skills are immediately available in new Claude Code and Copilot Chat sessions.

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `~/.claude/skills/commit-active-tree/SKILL.md` | Created | Global Claude Code skill for smart git commits with conventional commit format |
| `~/.vscode-server/data/User/prompts/commit-active-tree.prompt.md` | Created | Global Copilot Chat prompt for smart git commits with conventional commit format |
