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
   */
  private _buildSharedSkillContent(): string {
    return `# Code Explorer — File Analysis Skill

Analyze source code files and generate structured symbol analysis documentation
compatible with the **Code Explorer** VS Code extension's cache format.

## When to Use

Use when the user says:
- "analyze file \`<path>\`", "code-explorer analyze \`<path>\`"
- "parse \`<path>\` for code explorer"
- "explore symbols in \`<path>\`"
- "generate analysis for \`<path>\`"
- "cache analysis for \`<path>\`"
- "code-explorer analyze \`<path>\` --symbols=foo,bar"

## Input Parameters

- **\`filePath\`** (required): Relative path from workspace root to the source file to analyze
  - Example: \`src/utils/logger.ts\`, \`lib/parser.cpp\`
- **\`symbols\`** (optional): Comma-separated list of symbol names to analyze
  - If omitted: analyze ALL crucial symbols in the file
  - If provided: only analyze the specified symbols
  - Example: \`--symbols=CacheStore,write,_resolvePath\`

## Procedure

Follow these steps in exact order:

### Step 1: Read the Source File

Read the entire source file at the given path. Determine the programming language from the file extension.

### Step 2: Identify Symbols to Analyze

Scan the file and identify **every crucial symbol** defined in it. Crucial symbols include:
- **Classes** (including abstract classes)
- **Functions** (exported or module-level)
- **Methods** (members of classes/structs)
- **Interfaces** (TypeScript, Java, C#, Go)
- **Type aliases** (\`type\` definitions)
- **Enums**
- **Exported variables and constants** (module-level \`export const\`, \`export let\`, etc.)
- **Structs** (C/C++/Rust/Go/C#)
- **Properties** (class fields, object properties)

**Skip**: unexported local variables, loop counters, import statements, single-use inline helpers.

If the user provided specific symbol names via \`--symbols=...\`, filter to only those symbols.

### Step 3: Analyze Each Symbol

For each symbol, gather the following analysis:

#### 3a. Symbol Identity
- **name**: The canonical symbol name
- **kind**: One of: \`function\`, \`method\`, \`class\`, \`struct\`, \`variable\`, \`interface\`, \`type\`, \`enum\`, \`property\`, \`parameter\`
- **line**: 0-based line number of the symbol definition
- **container**: Enclosing class/struct/namespace name (null if top-level)
- **scope_chain**: Array of enclosing scope names from outermost to innermost, excluding the symbol itself

#### 3b. Overview
A 2-3 sentence description of what this symbol does, its purpose, and its role in the codebase.

#### 3c. Key Points
Key characteristics — parameters, return values, mutability, visibility, design patterns, etc. One bullet per point.

#### 3d. Step-by-Step Breakdown (functions/methods only)
Numbered breakdown of what the function/method does internally.

#### 3e. Sub-Functions (functions/methods only)
Every function/method called internally, with:
- name, description, input signature, output/return, filePath, line, kind

#### 3f. Function Inputs (functions/methods only)
Every input parameter with:
- name, typeName, description, mutated (bool), mutationDetail, typeFilePath, typeLine, typeKind, typeOverview

#### 3g. Function Output (functions/methods only)
Return type with:
- typeName, description, typeFilePath, typeLine, typeKind, typeOverview

#### 3h. Class Members (classes/structs/interfaces only)
All members with:
- name, memberKind (field/method/property/constructor/getter/setter), typeName, visibility (public/private/protected/internal), isStatic, description, line

#### 3i. Member Access Patterns (classes/structs only)
For each field/property, which methods read/write it:
- memberName, readBy (method names), writtenBy (method names), externalAccess (bool)

#### 3j. Variable Lifecycle (variables/properties/parameters only)
- declaration, initialization, mutations, consumption, scopeAndLifetime

#### 3k. Data Flow (variables/properties only)
Array of flow entries with:
- type (created/assigned/read/modified/consumed/returned/passed), filePath, line, description

#### 3l. Data Kind (variables only)
- label (e.g., "Configuration Object", "Cache Map"), description, examples (array of realistic values), references (related types/docs)

#### 3m. Callers
Every function/method/location that calls, references, or uses this symbol:
- name, filePath, line, kind, context (how it uses the symbol)

#### 3n. Dependencies
Symbols this depends on (imports, base classes, used services).

#### 3o. Usage Pattern
How this symbol is typically used in the codebase.

#### 3p. Potential Issues
Up to 3 code smells, bugs, or improvement suggestions.

#### 3q. Mermaid Diagrams
Generate 1-2 Mermaid diagrams that best visualize this symbol's behavior or structure. Choose the most appropriate diagram type:

- For **functions/methods**: a flowchart showing the execution path, or a sequence diagram showing interactions with sub-functions.
- For **classes/structs/interfaces**: a class diagram showing relationships (inheritance, composition, dependencies).
- For **variables**: a flowchart showing the data flow lifecycle (creation → mutations → consumption).

Use valid Mermaid syntax. Keep diagrams concise (under 20 nodes). Use short, readable labels. Do NOT use special characters or HTML in node labels.

If no diagrams are applicable (e.g., simple variables or trivial symbols), skip this section.

#### 3r. Related Symbol Analyses
During analysis, you will read and understand other symbols — sub-functions called by the primary symbol, types used as parameters or return values, parent classes, interfaces implemented, etc. For each such related symbol, generate a **brief analysis entry** so it can be pre-cached.

Include at minimum: sub-functions/methods called, custom types used as parameters/return values, parent/base classes, and interfaces implemented. Skip standard library types (string, number, Promise, Array, etc.).

### Step 4: Generate Cache Files

For each analyzed symbol, write a markdown cache file with YAML frontmatter.

#### Cache File Location

\`\`\`
<workspace_root>/.vscode/code-explorer/<source_file_path>/<cache_key>.md
\`\`\`

#### Cache Key Construction

The cache key determines the filename. Build it as follows:

1. **Kind prefix mapping**:
   - class → \`class\`
   - function → \`fn\`
   - method → \`method\`
   - variable → \`var\`
   - interface → \`interface\`
   - type → \`type\`
   - enum → \`enum\`
   - property → \`prop\`
   - parameter → \`param\`
   - struct → \`struct\`
   - unknown → \`sym\`

2. **Cache key format**:
   - No scope chain: \`<kind_prefix>.<sanitized_name>.md\`
   - With scope chain: \`<scope1>.<scope2>.<kind_prefix>.<sanitized_name>.md\`
   - With container only: \`<container>.<kind_prefix>.<sanitized_name>.md\`

3. **Name sanitization**: Replace any characters that are invalid in file names.

#### Examples

| Symbol | File | Cache File Path |
|--------|------|----------------|
| Top-level function \`activate\` | \`src/extension.ts\` | \`.vscode/code-explorer/src/extension.ts/fn.activate.md\` |
| Method \`write\` in class \`CacheStore\` | \`src/cache/CacheStore.ts\` | \`.vscode/code-explorer/src/cache/CacheStore.ts/CacheStore.method.write.md\` |
| Class \`CacheStore\` | \`src/cache/CacheStore.ts\` | \`.vscode/code-explorer/src/cache/CacheStore.ts/class.CacheStore.md\` |
| Variable \`COMMANDS\` | \`src/models/constants.ts\` | \`.vscode/code-explorer/src/models/constants.ts/var.COMMANDS.md\` |
| Property \`_cacheRoot\` in \`CacheStore\` | \`src/cache/CacheStore.ts\` | \`.vscode/code-explorer/src/cache/CacheStore.ts/CacheStore.prop._cacheRoot.md\` |
| Interface \`SymbolInfo\` | \`src/models/types.ts\` | \`.vscode/code-explorer/src/models/types.ts/interface.SymbolInfo.md\` |
| Enum member in enum \`ErrorCode\` | \`src/models/errors.ts\` | \`.vscode/code-explorer/src/models/errors.ts/enum.ErrorCode.md\` |

### Step 5: Write Cache Files

Write each cache file with this exact format:

\`\`\`markdown
---
symbol: <name>
kind: <kind>
file: <relative_file_path>
line: <0_based_line_number>
scope_chain: "<scope1.scope2>"
analyzed_at: "<ISO_8601_timestamp>"
analysis_version: "1.0.0"
llm_provider: <claude_or_copilot>
stale: false
---

# <kind> <name>

## Overview

<2-3 sentence description>

## Key Points

- <point 1>
- <point 2>

## Callers

1. **<callerName>** — \\\`<filePath>:<line>\\\` — <context>

\\\`\\\`\\\`json:callers
[
  {
    "name": "<callerName>",
    "filePath": "<filePath>",
    "line": <line>,
    "kind": "<kind>",
    "context": "<how it uses this symbol>"
  }
]
\\\`\\\`\\\`

## Data Flow

- **<type>:** \\\`<filePath>:<line>\\\` — <description>

\\\`\\\`\\\`json:data_flow
[
  { "type": "<type>", "filePath": "<filePath>", "line": <line>, "description": "<desc>" }
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
    "visibility": "<public|private|protected>",
    "isStatic": false,
    "description": "<description>",
    "line": <line>
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
    "line": <line>,
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
    "typeFilePath": "<path>",
    "typeLine": <line>,
    "typeKind": "<kind>",
    "typeOverview": "<brief overview>"
  }
]
\\\`\\\`\\\`

## Function Output

Returns: \\\`<typeName>\\\` — <description>

\\\`\\\`\\\`json:function_output
{
  "typeName": "<type>",
  "description": "<what is returned>",
  "typeFilePath": "<path>",
  "typeLine": <line>,
  "typeKind": "<kind>",
  "typeOverview": "<brief overview>"
}
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
\`\`\`

### Section Inclusion Rules

**Only include sections that are relevant to the symbol kind:**

| Section | function/method | class/struct/interface | variable/property | enum | parameter |
|---------|:-:|:-:|:-:|:-:|:-:|
| Overview | ✓ | ✓ | ✓ | ✓ | ✓ |
| Key Points | ✓ | ✓ | ✓ | ✓ | ✓ |
| Callers | ✓ | ✓ | ✓ | ✓ | — |
| Step-by-Step Breakdown | ✓ | — | — | — | — |
| Sub-Functions | ✓ | — | — | — | — |
| Function Input | ✓ | — | — | — | — |
| Function Output | ✓ | — | — | — | — |
| Class Members | — | ✓ | — | ✓ | — |
| Member Access Patterns | — | ✓ | — | — | — |
| Variable Lifecycle | — | — | ✓ | — | ✓ |
| Data Flow | — | — | ✓ | — | ✓ |
| Data Kind | — | — | ✓ | — | — |
| Diagrams | ✓ | ✓ | ✓ | — | — |
| Related Symbol Analyses | ✓ | ✓ | ✓ | ✓ | — |
| Dependencies | ✓ | ✓ | ✓ | ✓ | — |
| Usage Pattern | ✓ | ✓ | ✓ | ✓ | — |
| Potential Issues | ✓ | ✓ | ✓ | ✓ | — |

**Do NOT include empty sections.** If a section has no data, omit it entirely.

### Clickable File:Line References

Throughout the analysis (in callers, sub-functions, data flow, etc.), format file references as \\\`filePath:line\\\` using backtick-wrapped inline code. The Code Explorer webview auto-detects these patterns and makes them clickable — clicking navigates the user to that exact source location. Examples:
- \\\`src/cache/CacheStore.ts:78\\\`
- \\\`src/extension.ts:42\\\`

Always use **relative paths** from the workspace root, and use **1-based line numbers** for the human-readable display (the JSON blocks use 0-based).

### Related Symbol Cache File Naming

When generating the \`json:related_symbol_analyses\` block, the \`cache_file_path\` field must follow the same cache key convention described in Step 4. Examples:
- Sub-function \`runCLI\` in \`src/utils/cli.ts\` → \`"cache_file_path": "src/utils/cli.ts/fn.runCLI.md"\`
- Type \`SymbolInfo\` in \`src/models/types.ts\` → \`"cache_file_path": "src/models/types.ts/interface.SymbolInfo.md"\`
- Method \`parse\` in class \`ResponseParser\` → \`"cache_file_path": "src/llm/ResponseParser.ts/ResponseParser.method.parse.md"\`

### Mermaid Diagram Guidelines

- Use valid Mermaid syntax (flowchart TD, sequenceDiagram, classDiagram, stateDiagram, etc.)
- Keep diagrams concise — under 20 nodes
- Use short, readable labels — no special characters or HTML in node labels
- The Diagrams section must include **both** a human-readable \`\\\`\\\`\\\`mermaid\` fenced block AND the machine-readable \`\\\`\\\`\\\`json:diagrams\` block
- The \`mermaidSource\` field in the JSON must contain the raw mermaid markup (same as inside the mermaid fence)
- The webview renders these as interactive SVG diagrams

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
7. **Mermaid blocks use \`\\\`\\\`\\\`mermaid\` fences** — the webview renders them as interactive SVG diagrams
8. **llm_provider value**: use \`claude\` when running in Claude Code, \`copilot-cli\` when in Copilot
9. **Be accurate** — only state facts derivable from the source code. Do not hallucinate callers or dependencies.
10. **Sanitize names** — replace characters invalid in file paths
11. **Create directories** — ensure the cache directory structure exists before writing
12. **Never overwrite existing non-stale cache files** — check if a cache file already exists and is not stale before writing. If it exists and is fresh, skip it.
13. **Format file references as clickable links** — use \\\`filePath:line\\\` format throughout the analysis text so the webview can make them clickable

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
`;
  }
}
