/**
 * Code Explorer — Global Skill Installer
 *
 * Installs Code Explorer analysis skills into both Claude Code
 * and GitHub Copilot global directories so that `/code-explorer-analyze`
 * slash commands are available in both agents.
 *
 * Claude Code skill: ~/.claude/skills/code-explorer-analyze/SKILL.md
 * Copilot instruction: ~/.github/instructions/code-explorer-analyze.instructions.md
 *
 * The installed skill tells the agent how to:
 * 1. Read a given file path
 * 2. Identify symbols (optionally filtered by name)
 * 3. Generate analysis in the exact cache format Code Explorer expects
 * 4. Write cache files to the correct location (.vscode/code-explorer/)
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../utils/logger';

/** Result of an installation attempt. */
export interface SkillInstallResult {
  claudeInstalled: boolean;
  copilotInstalled: boolean;
  claudePath: string;
  copilotPath: string;
  errors: string[];
}

export class SkillInstaller {
  private readonly _homeDir: string;

  constructor() {
    this._homeDir = os.homedir();
  }

  /**
   * Install the Code Explorer analysis skill globally for both
   * Claude Code and GitHub Copilot.
   */
  async install(): Promise<SkillInstallResult> {
    const errors: string[] = [];

    const claudeDir = path.join(this._homeDir, '.claude', 'skills', 'code-explorer-analyze');
    const claudePath = path.join(claudeDir, 'SKILL.md');

    const copilotDir = path.join(this._homeDir, '.github', 'instructions');
    const copilotPath = path.join(copilotDir, 'code-explorer-analyze.instructions.md');

    let claudeInstalled = false;
    let copilotInstalled = false;

    // Install Claude Code skill
    try {
      await fs.mkdir(claudeDir, { recursive: true });
      await fs.writeFile(claudePath, this._buildClaudeSkill(), 'utf-8');
      claudeInstalled = true;
      logger.info(`SkillInstaller: Claude skill installed at ${claudePath}`);
    } catch (err) {
      const msg = `Failed to install Claude skill: ${err}`;
      errors.push(msg);
      logger.error(`SkillInstaller: ${msg}`);
    }

    // Install Copilot instruction
    try {
      await fs.mkdir(copilotDir, { recursive: true });
      await fs.writeFile(copilotPath, this._buildCopilotInstruction(), 'utf-8');
      copilotInstalled = true;
      logger.info(`SkillInstaller: Copilot instruction installed at ${copilotPath}`);
    } catch (err) {
      const msg = `Failed to install Copilot instruction: ${err}`;
      errors.push(msg);
      logger.error(`SkillInstaller: ${msg}`);
    }

    return {
      claudeInstalled,
      copilotInstalled,
      claudePath,
      copilotPath,
      errors,
    };
  }

  /**
   * Check if skills are already installed.
   */
  async isInstalled(): Promise<{ claude: boolean; copilot: boolean }> {
    const claudePath = path.join(
      this._homeDir,
      '.claude',
      'skills',
      'code-explorer-analyze',
      'SKILL.md'
    );
    const copilotPath = path.join(
      this._homeDir,
      '.github',
      'instructions',
      'code-explorer-analyze.instructions.md'
    );

    let claude = false;
    let copilot = false;

    try {
      await fs.access(claudePath);
      claude = true;
    } catch {
      // Not installed
    }

    try {
      await fs.access(copilotPath);
      copilot = true;
    } catch {
      // Not installed
    }

    return { claude, copilot };
  }

  /**
   * Uninstall skills from both locations.
   */
  async uninstall(): Promise<{ claude: boolean; copilot: boolean; errors: string[] }> {
    const errors: string[] = [];
    let claude = false;
    let copilot = false;

    const claudeDir = path.join(this._homeDir, '.claude', 'skills', 'code-explorer-analyze');
    const copilotPath = path.join(
      this._homeDir,
      '.github',
      'instructions',
      'code-explorer-analyze.instructions.md'
    );

    try {
      await fs.rm(claudeDir, { recursive: true, force: true });
      claude = true;
      logger.info('SkillInstaller: Claude skill uninstalled');
    } catch (err) {
      errors.push(`Failed to uninstall Claude skill: ${err}`);
    }

    try {
      await fs.rm(copilotPath, { force: true });
      copilot = true;
      logger.info('SkillInstaller: Copilot instruction uninstalled');
    } catch (err) {
      errors.push(`Failed to uninstall Copilot instruction: ${err}`);
    }

    return { claude, copilot, errors };
  }

  // ── Skill Content Builders ───────────────────────────────

  /**
   * Build the Claude Code SKILL.md content.
   * Uses the Claude skill frontmatter format with description triggers.
   */
  private _buildClaudeSkill(): string {
    return `---
name: code-explorer-analyze
description: "Use this skill when the user asks to 'analyze file', 'code-explorer analyze',
  'explore file symbols', 'parse file for code explorer', 'generate code analysis',
  'cache file analysis', 'analyze symbols in file', 'code explorer parse',
  or when they want to generate Code Explorer-compatible symbol analysis cache
  files for a given source file. Accepts a file path and optional symbol names.
  Generates structured markdown cache files with YAML frontmatter."
---

${this._buildSharedSkillContent()}`;
  }

  /**
   * Build the Copilot instruction file content.
   * Uses the Copilot instruction format (applyTo + description metadata).
   */
  private _buildCopilotInstruction(): string {
    return `---
applyTo: "*"
description: "Code Explorer file analysis skill — generates structured symbol analysis
  cache files for the Code Explorer VS Code extension. Invoke with /code-explorer-analyze
  or when asked to analyze, parse, or explore symbols in a file."
---

${this._buildSharedSkillContent()}`;
  }

  /**
   * Build the shared skill content used by both Claude and Copilot.
   * This is the core instruction set that teaches the agent how to
   * analyze files and generate cache-compatible output.
   *
   * IMPORTANT: The cache file format here MUST match CacheStore._serialize()
   * exactly — section names, JSON block tags, frontmatter fields, and
   * section ordering. If _serialize() changes, update this skill too.
   */
  private _buildSharedSkillContent(): string {
    return `# Code Explorer — File Analysis Skill

Analyze source code files and generate structured symbol analysis documentation
compatible with the **Code Explorer** VS Code extension's cache format.

## What is Code Explorer?

Code Explorer is a VS Code extension that provides AI-powered code intelligence.
When a user runs "Explore Symbol" on any symbol, it shows a rich sidebar panel
with an overview, step-by-step breakdown, sub-functions, callers, data flow,
class members, mermaid diagrams, and more.

All analysis results are **cached as markdown files** in \`.vscode/code-explorer/\`.
This skill teaches you to generate those cache files directly, so the extension
can load your analysis instantly without running its own LLM call.

## When to Use

Use when the user says:
- "analyze file \`<path>\`", "code-explorer analyze \`<path>\`"
- "parse \`<path>\` for code explorer"
- "explore symbols in \`<path>\`"
- "generate analysis for \`<path>\`"
- "cache analysis for \`<path>\`"
- "code-explorer analyze \`<path>\` --symbols=foo,bar"

## Input Parameters

- **\`filePath\`** (required): Relative path from workspace root to the source file
  - Example: \`src/utils/logger.ts\`, \`lib/parser.cpp\`
- **\`symbols\`** (optional): Comma-separated list of symbol names to analyze
  - If omitted: analyze ALL crucial symbols in the file
  - If provided: only analyze the named symbols
  - Example: \`--symbols=CacheStore,write,_resolvePath\`

## Procedure

Follow these steps in exact order:

### Step 1: Read the Source File

Read the entire source file at the given path. Determine the programming language
from the file extension (e.g., \`.ts\` → TypeScript, \`.cpp\` → C++, \`.py\` → Python).

### Step 2: Identify Symbols to Analyze

Scan the file and identify **every crucial symbol** defined in it:

| Symbol Kind | Examples | Cache Prefix |
|-------------|----------|-------------|
| **Classes** (including abstract) | \`class CacheStore\`, \`abstract class BaseProvider\` | \`class\` |
| **Functions** (exported or module-level) | \`function activate()\`, \`export function runCLI()\` | \`fn\` |
| **Methods** (class/struct members) | \`async write()\`, \`private _serialize()\` | \`method\` |
| **Interfaces** | \`interface SymbolInfo\`, \`interface LLMProvider\` | \`interface\` |
| **Type aliases** | \`type SymbolKindType = ...\` | \`type\` |
| **Enums** | \`enum ErrorCode\`, \`const enum LogLevel\` | \`enum\` |
| **Exported variables/constants** | \`export const COMMANDS = ...\`, \`export let config\` | \`var\` |
| **Structs** (C/C++/Rust/Go/C#) | \`struct Point\`, \`struct Config\` | \`struct\` |
| **Properties** (class fields) | \`private readonly _cache: CacheStore\` | \`prop\` |

**Skip**: unexported local variables, loop counters, import statements, trivial single-use helpers
that are obvious from context.

If the user provided specific symbol names via \`--symbols=...\`, filter to only those symbols.

### Step 3: Analyze Each Symbol

For each symbol, gather the analysis described below. Only include sections that
are **relevant** to the symbol kind — see the Section Inclusion Rules table later.
Omit any section that would be empty.

---

#### 3a. Symbol Identity

Identify these fields for the YAML frontmatter:

| Field | Description | Example |
|-------|-------------|---------|
| \`name\` | Canonical symbol name | \`CacheStore\` |
| \`kind\` | One of: \`function\`, \`method\`, \`class\`, \`struct\`, \`variable\`, \`interface\`, \`type\`, \`enum\`, \`property\`, \`parameter\` | \`class\` |
| \`line\` | **0-based** line number of the definition | \`50\` |
| \`container\` | Enclosing class/struct/namespace name, or null if top-level | \`CacheStore\` |
| \`scope_chain\` | Dot-separated ancestor scope names (outermost to innermost), excluding the symbol itself | \`"ClassName.innerScope"\` |

---

#### 3b. Overview
A clear 2-3 sentence description of what this symbol does, its purpose, and its
role in the codebase. This is the first thing users see, so make it informative
and specific — avoid generic statements like "this is a function that does stuff."

#### 3c. Key Points
Important characteristics as a bullet list. Think: parameters, return values,
side effects, mutability, visibility, thread safety, design patterns used,
performance considerations. One bullet per point. Aim for 3-6 points.

#### 3d. Callers (who uses this symbol?)
Every function, method, or location that calls, references, or uses this symbol.
For each caller include: name, file path, line number, kind, and a brief context
explaining *how* it uses the symbol (not just that it calls it).

This section has **two parts**: a human-readable numbered list, and a machine-readable
\`json:callers\` block. Both must contain the same data.

#### 3e. Data Flow (variables/properties only)
How data flows through this variable: where it's created, assigned, read, modified,
consumed, returned, or passed. Each entry is a flow step with type, file path, line, and description.

#### 3f. Variable Lifecycle (variables/properties/parameters only)
How the variable lives: declaration, initialization, mutations, consumption points,
and scope/lifetime information.

#### 3g. Data Kind (variables only)
Categorize what kind of data this variable holds — e.g., "Configuration Object",
"Cache Map", "Event Emitter", "File Path". Include a description, realistic example
values, and references to related types or documentation.

#### 3h. Class Members (classes/structs/interfaces only)
Every member with: name, memberKind (field/method/property/constructor/getter/setter),
typeName, visibility (public/private/protected/internal), isStatic, description, line number.

#### 3i. Member Access Patterns (classes/structs only)
For each field/property, which methods read it and which methods write it.
Also note if external code accesses the member.

#### 3j. Mermaid Diagrams
Generate 1-2 Mermaid diagrams that visualize the symbol's behavior or structure:
- **Functions/methods**: flowchart of execution path, or sequence diagram of interactions
- **Classes/structs/interfaces**: class diagram showing relationships (inheritance, composition)
- **Variables**: flowchart of data flow lifecycle (creation → mutations → consumption)

Use valid Mermaid syntax. Keep diagrams concise (under 20 nodes). Use short, readable
labels. Do NOT use special characters or HTML in node labels.

This section has **two parts**: human-readable \\\`\\\`\\\`mermaid\\\`\\\`\\\` blocks (one per diagram),
and a machine-readable \`json:diagrams\` block containing all diagrams.

Skip this section if no diagrams are applicable (e.g., simple constants).

#### 3k. Step-by-Step Breakdown (functions/methods only)
Numbered breakdown of what the function/method does internally. Each step should
be a clear, concise sentence. Aim for 3-8 steps.

#### 3l. Sub-Functions (functions/methods only)
Every function or method called internally, with: name, description, input signature,
output/return, filePath, line, kind.

#### 3m. Function Inputs (functions/methods only)
Every parameter with: name, typeName, description, mutated (bool), mutationDetail,
typeFilePath, typeLine, typeKind, typeOverview.

The \`typeFilePath\`, \`typeLine\`, \`typeKind\`, and \`typeOverview\` fields describe
the parameter's TYPE (not the parameter itself) — this lets users click through
to explore the type definition.

#### 3n. Function Output (functions/methods only)
Return type with: typeName, description, typeFilePath, typeLine, typeKind, typeOverview.
Same type-link fields as function inputs.

#### 3o. Dependencies
Symbols this depends on: imports, base classes, injected services, used utilities.

#### 3p. Usage Pattern
A brief description of how this symbol is typically used in the codebase.

#### 3q. Potential Issues
Up to 3 code smells, bugs, edge cases, or improvement suggestions. Be specific and actionable.

#### 3r. Related Symbol Analyses
During analysis, you will encounter other symbols — sub-functions called, types used
as parameters/return values, parent classes, interfaces implemented. For each such
related symbol, generate a **brief analysis entry** so it can be pre-cached.

Include: sub-functions/methods called, custom types used as parameters/return values,
parent/base classes, and interfaces implemented. Skip standard library types
(string, number, Promise, Array, etc.).

### Step 4: Generate Cache Files

For each analyzed symbol, write a markdown cache file with YAML frontmatter.

#### Cache File Location

\`\`\`
<workspace_root>/.vscode/code-explorer/<source_file_path>/<cache_key>.md
\`\`\`

For example, for a file at \`src/cache/CacheStore.ts\`, cache files go in:
\`\`\`
.vscode/code-explorer/src/cache/CacheStore.ts/
\`\`\`

#### Cache Key Construction

The cache key determines the file name. Build it as:

1. Look up the **kind prefix** from this table:

   | Kind | Prefix |
   |------|--------|
   | class | \`class\` |
   | function | \`fn\` |
   | method | \`method\` |
   | variable | \`var\` |
   | interface | \`interface\` |
   | type | \`type\` |
   | enum | \`enum\` |
   | property | \`prop\` |
   | parameter | \`param\` |
   | struct | \`struct\` |
   | unknown | \`sym\` |

2. Build the cache key based on scope:

   | Scenario | Pattern | Example |
   |----------|---------|---------|
   | No scope, no container | \`<prefix>.<name>\` | \`fn.activate\` |
   | Has scope chain | \`<scope1>.<scope2>.<prefix>.<name>\` | \`CacheStore.method.write\` |
   | No scope chain, has container | \`<container>.<prefix>.<name>\` | \`CacheStore.prop._cacheRoot\` |

3. Sanitize: replace characters invalid in file paths.

4. Add \`.md\` extension.

#### Complete Examples

| Symbol | Source File | Cache File Path |
|--------|-----------|----------------|
| Top-level function \`activate\` | \`src/extension.ts\` | \`.vscode/code-explorer/src/extension.ts/fn.activate.md\` |
| Method \`write\` in class \`CacheStore\` | \`src/cache/CacheStore.ts\` | \`.vscode/code-explorer/src/cache/CacheStore.ts/CacheStore.method.write.md\` |
| Class \`CacheStore\` | \`src/cache/CacheStore.ts\` | \`.vscode/code-explorer/src/cache/CacheStore.ts/class.CacheStore.md\` |
| Variable \`COMMANDS\` | \`src/models/constants.ts\` | \`.vscode/code-explorer/src/models/constants.ts/var.COMMANDS.md\` |
| Property \`_cacheRoot\` in \`CacheStore\` | \`src/cache/CacheStore.ts\` | \`.vscode/code-explorer/src/cache/CacheStore.ts/CacheStore.prop._cacheRoot.md\` |
| Interface \`SymbolInfo\` | \`src/models/types.ts\` | \`.vscode/code-explorer/src/models/types.ts/interface.SymbolInfo.md\` |
| Enum \`ErrorCode\` | \`src/models/errors.ts\` | \`.vscode/code-explorer/src/models/errors.ts/enum.ErrorCode.md\` |
| Nested method \`_helper\` in \`Outer.Inner\` | \`src/foo.ts\` | \`.vscode/code-explorer/src/foo.ts/Outer.Inner.method._helper.md\` |

### Step 5: Write Cache Files

Write each cache file with the exact format shown below. This format matches
what \`CacheStore._serialize()\` produces — the extension parses cache files using
\`CacheStore._deserialize()\`, so any deviation will cause parse failures.

**CRITICAL**: The sections below must appear in **exactly this order**. The
extension's parser looks for specific \`## Heading\` names and specific
\`json:<tag>\` block labels. Do not rename headings or reorder sections.

\`\`\`markdown
---
symbol: <name>
kind: <kind>
file: <relative_file_path>
line: <0_based_line_number>
scope_chain: "<scope1.scope2>"
analyzed_at: "<ISO_8601_timestamp>"
analysis_version: "1.0.0"
llm_provider: <claude_or_copilot-cli>
stale: false
---

# <kind> <name>

## Overview

<2-3 sentence description. Be specific and informative.>

## Key Points

- <point 1>
- <point 2>
- <point 3>

## Callers

1. **<callerName>** — \\\`<filePath>:<line>\\\` — <context describing how it uses the symbol>

\\\`\\\`\\\`json:callers
[
  {
    "name": "<callerName>",
    "filePath": "<filePath>",
    "line": <1_based_line>,
    "kind": "<kind>",
    "context": "<how it uses this symbol>"
  }
]
\\\`\\\`\\\`

## Usage (<N> references)

| File | Line | Context |
|------|------|---------|
| \\\`<filePath>\\\` | <line> | \\\`<context line of source>\\\` |

## Relationships

- **<type>:** <targetName> (\\\`<filePath>:<line>\\\`)

## Data Flow

- **<type>:** \\\`<filePath>:<line>\\\` — <description>

\\\`\\\`\\\`json:data_flow
[
  { "type": "<created|assigned|read|modified|consumed|returned|passed>", "filePath": "<filePath>", "line": <line>, "description": "<desc>" }
]
\\\`\\\`\\\`

## Variable Lifecycle

\\\`\\\`\\\`json:variable_lifecycle
{
  "declaration": "<how declared>",
  "initialization": "<how initialized>",
  "mutations": ["<mutation point>"],
  "consumption": ["<where used>"],
  "scopeAndLifetime": "<scope info>"
}
\\\`\\\`\\\`

## Data Kind

**<label>**

<description>

**Examples:**

- \\\`<example value>\\\`

**References:**

- <reference>

\\\`\\\`\\\`json:data_kind
{
  "label": "<label>",
  "description": "<description>",
  "examples": ["<example>"],
  "references": ["<reference>"]
}
\\\`\\\`\\\`

## Class Members

- **<visibility> <static?> <memberKind>** \\\`<name>: <type>\\\` — <description>

\\\`\\\`\\\`json:class_members
[
  {
    "name": "<name>",
    "memberKind": "<field|method|property|constructor|getter|setter>",
    "typeName": "<type>",
    "visibility": "<public|private|protected|internal>",
    "isStatic": false,
    "description": "<description>",
    "line": <0_based_line>
  }
]
\\\`\\\`\\\`

## Member Access Patterns

- **<memberName>**: read by [<methods>], written by [<methods>]

\\\`\\\`\\\`json:member_access
[
  {
    "memberName": "<name>",
    "readBy": ["<method>"],
    "writtenBy": ["<method>"],
    "externalAccess": false
  }
]
\\\`\\\`\\\`

## Diagrams

### <Diagram Title>

\\\`\\\`\\\`mermaid
<mermaid source>
\\\`\\\`\\\`

\\\`\\\`\\\`json:diagrams
[
  {
    "title": "<diagram title>",
    "type": "<flowchart|sequenceDiagram|classDiagram|stateDiagram>",
    "mermaidSource": "<mermaid markup>"
  }
]
\\\`\\\`\\\`

## Step-by-Step Breakdown

1. <step description>

\\\`\\\`\\\`json:steps
[
  { "step": 1, "description": "<description>" }
]
\\\`\\\`\\\`

## Sub-Functions

- **<name>** — <description>

\\\`\\\`\\\`json:subfunctions
[
  {
    "name": "<name>",
    "description": "<what it does>",
    "input": "(<params>) — <description>",
    "output": "<returnType> — <description>",
    "filePath": "<path>",
    "line": <0_based_line>,
    "kind": "<kind>"
  }
]
\\\`\\\`\\\`

## Function Input

- **<paramName>**: \\\`<typeName>\\\` — <description>

\\\`\\\`\\\`json:function_inputs
[
  {
    "name": "<paramName>",
    "typeName": "<type>",
    "description": "<what it represents>",
    "mutated": false,
    "mutationDetail": null,
    "typeFilePath": "<path or null>",
    "typeLine": <line_or_null>,
    "typeKind": "<kind or null>",
    "typeOverview": "<brief overview or null>"
  }
]
\\\`\\\`\\\`

## Function Output

Returns: \\\`<typeName>\\\` — <description>

\\\`\\\`\\\`json:function_output
{
  "typeName": "<type>",
  "description": "<what is returned>",
  "typeFilePath": "<path or null>",
  "typeLine": <line_or_null>,
  "typeKind": "<kind or null>",
  "typeOverview": "<brief overview or null>"
}
\\\`\\\`\\\`

## Dependencies

- <dependency 1>
- <dependency 2>

## Usage Pattern

<how this symbol is typically used>

## Potential Issues

- <issue 1>
- <issue 2>

## Related Symbol Analyses

\\\`\\\`\\\`json:related_symbol_analyses
[
  {
    "cache_file_path": "<source_file_path>/<cache_key>.md",
    "name": "relatedSymbolName",
    "kind": "function",
    "filePath": "src/path/to/source.ts",
    "line": 25,
    "container": null,
    "scope_chain": [],
    "overview": "2-3 sentence description of what this symbol does.",
    "key_points": ["point 1", "point 2"],
    "dependencies": ["dep1", "dep2"],
    "potential_issues": ["issue 1"]
  }
]
\\\`\\\`\\\`

## Q&A

### Q: <user question>
*<ISO timestamp>*

<answer text>

\\\`\\\`\\\`json:qa_history
[
  {
    "question": "<user question>",
    "answer": "<answer text>",
    "timestamp": "<ISO_8601_timestamp>"
  }
]
\\\`\\\`\\\`
\`\`\`

### Section Ordering — Why It Matters

The section order shown above matches \`CacheStore._serialize()\` exactly:

1. Overview
2. Key Points
3. Callers (human-readable list + \`json:callers\`)
4. Usage (references table)
5. Relationships
6. Data Flow (human-readable list + \`json:data_flow\`)
7. Variable Lifecycle (\`json:variable_lifecycle\`)
8. Data Kind (human-readable + \`json:data_kind\`)
9. Class Members (human-readable list + \`json:class_members\`)
10. Member Access Patterns (human-readable + \`json:member_access\`)
11. Diagrams (mermaid blocks + \`json:diagrams\`)
12. Step-by-Step Breakdown (numbered list + \`json:steps\`)
13. Sub-Functions (bullet list + \`json:subfunctions\`)
14. Function Input (bullet list + \`json:function_inputs\`)
15. Function Output (text + \`json:function_output\`)
16. Dependencies (bullet list)
17. Usage Pattern (prose)
18. Potential Issues (bullet list)
19. Related Symbol Analyses (\`json:related_symbol_analyses\`)
20. Q&A (markdown + \`json:qa_history\`)

The extension's \`_deserialize()\` method parses sections by \`## Heading\` name and
looks for specific \`json:<tag>\` fence labels. Reordering or renaming sections may
cause data to be lost on read-back.

### Section Inclusion Rules

**Only include sections that are relevant to the symbol kind.** Do NOT include
empty sections — omit them entirely.

| Section | function/method | class/struct/interface | variable/property | enum | parameter |
|---------|:-:|:-:|:-:|:-:|:-:|
| Overview | ✓ | ✓ | ✓ | ✓ | ✓ |
| Key Points | ✓ | ✓ | ✓ | ✓ | ✓ |
| Callers | ✓ | ✓ | ✓ | ✓ | — |
| Usage (references) | ✓ | ✓ | ✓ | ✓ | — |
| Relationships | — | ✓ | — | — | — |
| Data Flow | — | — | ✓ | — | ✓ |
| Variable Lifecycle | — | — | ✓ | — | ✓ |
| Data Kind | — | — | ✓ | — | — |
| Class Members | — | ✓ | — | ✓ | — |
| Member Access Patterns | — | ✓ | — | — | — |
| Diagrams | ✓ | ✓ | ✓ | — | — |
| Step-by-Step Breakdown | ✓ | — | — | — | — |
| Sub-Functions | ✓ | — | — | — | — |
| Function Input | ✓ | — | — | — | — |
| Function Output | ✓ | — | — | — | — |
| Dependencies | ✓ | ✓ | ✓ | ✓ | — |
| Usage Pattern | ✓ | ✓ | ✓ | ✓ | — |
| Potential Issues | ✓ | ✓ | ✓ | ✓ | — |
| Related Symbol Analyses | ✓ | ✓ | ✓ | ✓ | — |
| Q&A | — | — | — | — | — |

**Q&A**: This section is generated by the extension when users ask follow-up
questions via the ✨ Enhance button. You should NOT generate Q&A sections when
creating cache files — they will be added by the extension later.

### JSON Block Tags — Quick Reference

Every machine-readable block uses a **tagged fence**: \`\`\`\`json:<tag>\`\`\`\`. These
are NOT regular JSON blocks — the tag after the colon is how the parser finds them.

| Tag | Contains | Type |
|-----|----------|------|
| \`json:callers\` | Array of caller objects | Array |
| \`json:data_flow\` | Array of flow entries | Array |
| \`json:variable_lifecycle\` | Lifecycle object | Object |
| \`json:data_kind\` | Data kind object | Object |
| \`json:class_members\` | Array of member objects | Array |
| \`json:member_access\` | Array of access pattern objects | Array |
| \`json:diagrams\` | Array of diagram objects | Array |
| \`json:steps\` | Array of step objects | Array |
| \`json:subfunctions\` | Array of sub-function objects | Array |
| \`json:function_inputs\` | Array of input param objects | Array |
| \`json:function_output\` | Output object (single, not array) | Object |
| \`json:related_symbol_analyses\` | Array of related symbol entries | Array |
| \`json:qa_history\` | Array of Q&A entries | Array |

### Clickable File:Line References

Throughout the analysis text (callers, sub-functions, data flow, etc.), format
file references as \\\`filePath:line\\\` using backtick-wrapped inline code. The Code
Explorer webview auto-detects these patterns and makes them clickable — clicking
navigates the user to that exact source location.

Examples:
- \\\`src/cache/CacheStore.ts:78\\\`
- \\\`src/extension.ts:42\\\`

Always use **relative paths** from the workspace root. Use **1-based line numbers**
in human-readable text (what users see in VS Code). The JSON blocks use **0-based
line numbers** (what VS Code uses internally).

### Related Symbol Cache File Naming

When generating the \`json:related_symbol_analyses\` block, the \`cache_file_path\` field
must follow the same cache key convention described in Step 4. Examples:
- Sub-function \`runCLI\` in \`src/utils/cli.ts\` → \`"cache_file_path": "src/utils/cli.ts/fn.runCLI.md"\`
- Type \`SymbolInfo\` in \`src/models/types.ts\` → \`"cache_file_path": "src/models/types.ts/interface.SymbolInfo.md"\`
- Method \`parse\` in class \`ResponseParser\` → \`"cache_file_path": "src/llm/ResponseParser.ts/ResponseParser.method.parse.md"\`

### Mermaid Diagram Guidelines

- Use valid Mermaid syntax (flowchart TD, sequenceDiagram, classDiagram, stateDiagram, etc.)
- Keep diagrams concise — under 20 nodes
- Use short, readable labels — no special characters or HTML in node labels
- The Diagrams section must include **both** human-readable \\\`\\\`\\\`mermaid\\\`\\\`\\\` fenced blocks AND the machine-readable \\\`\\\`\\\`json:diagrams\\\`\\\`\\\` block
- The \`mermaidSource\` field in the JSON must contain the raw mermaid markup (same as inside the mermaid fence)
- The webview renders these as interactive SVG diagrams

### YAML Frontmatter Details

| Field | Required | Type | Notes |
|-------|----------|------|-------|
| \`symbol\` | Yes | string | Canonical symbol name |
| \`kind\` | Yes | string | One of the symbol kinds listed above |
| \`file\` | Yes | string | Relative path from workspace root |
| \`line\` | Yes | number | **0-based** line number |
| \`scope_chain\` | If scoped | quoted string | Dot-separated ancestor names, e.g., \`"ClassName.methodName"\` |
| \`analyzed_at\` | Yes | quoted ISO 8601 | e.g., \`"2024-03-29T12:00:00.000Z"\` |
| \`analysis_version\` | Yes | quoted string | Always \`"1.0.0"\` |
| \`llm_provider\` | Yes | string | \`claude\` when running in Claude Code, \`copilot-cli\` when in Copilot |
| \`source_hash\` | No | quoted string | SHA-256 of source code (leave empty if unknown) |
| \`stale\` | Yes | boolean | Always \`false\` for freshly generated files |

### Step 6: Verify and Report

After writing all cache files, report:
- Total symbols analyzed
- File paths of all cache files written
- Any symbols that were skipped and why

## Important Rules

1. **YAML frontmatter is mandatory** — every cache file must start with \`---\\n\` frontmatter block
2. **Use 0-based line numbers** in YAML frontmatter and JSON blocks — matching VS Code's internal line numbering
3. **Use 1-based line numbers** in human-readable markdown text (e.g., \\\`src/file.ts:42\\\`) — matching what users see in VS Code
4. **scope_chain must be quoted** — e.g., \`scope_chain: "ClassName.methodName"\`
5. **analyzed_at must be quoted ISO 8601** — e.g., \`analyzed_at: "2024-03-29T12:00:00.000Z"\`
6. **JSON blocks use tagged fences** — e.g., \`\\\`\\\`\\\`json:callers\` not plain \`\\\`\\\`\\\`json\`
7. **Mermaid blocks use \\\`\\\`\\\`mermaid fences** — the webview renders them as interactive SVG diagrams
8. **llm_provider value**: use \`claude\` when running in Claude Code, \`copilot-cli\` when in Copilot
9. **Be accurate** — only state facts derivable from the source code. Do not hallucinate callers or dependencies.
10. **Sanitize names** — replace characters invalid in file paths
11. **Create directories** — ensure the cache directory structure exists before writing
12. **Never overwrite existing non-stale cache files** — check if a cache file already exists and is not stale before writing. If it exists and is fresh, skip it.
13. **Format file references as clickable links** — use \\\`filePath:line\\\` format throughout the analysis text so the webview can make them clickable
14. **Follow section order** — sections must appear in the order specified above (matching \`_serialize()\`)
15. **Do not generate Q&A sections** — Q&A entries are added by the extension's Enhance feature, not by this skill

## Example Invocations

### Analyze entire file
\`\`\`
Analyze file src/cache/CacheStore.ts
\`\`\`

### Analyze specific symbols
\`\`\`
Analyze file src/cache/CacheStore.ts --symbols=CacheStore,write,_resolvePath
\`\`\`

### Analyze with explicit workspace root
\`\`\`
Analyze file src/models/types.ts in workspace /home/user/projects/code-explorer
\`\`\`

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| Extension shows "No cached analysis" after skill ran | Cache file path doesn't match expected pattern | Verify cache key follows \`<scope>.<prefix>.<name>.md\` pattern exactly |
| Sections appear empty in sidebar | JSON block tag is wrong (e.g., \`json:callers_list\` instead of \`json:callers\`) | Use exact tag names from the JSON Block Tags table |
| Frontmatter not parsed | Missing \`---\` delimiters or unquoted ISO dates | Ensure \`---\` on its own line, quote all string values that contain special chars |
| Diagrams don't render | Invalid Mermaid syntax or missing \`mermaid\` fence | Validate Mermaid syntax, ensure both mermaid fence and json:diagrams block exist |
| Scope chain mismatch | Different scope chain than extension expects | Match the scope chain from the document symbol tree (outermost → innermost ancestor names) |
`;
  }
}
