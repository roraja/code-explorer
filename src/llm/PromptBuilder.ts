/**
 * Code Explorer — Prompt Builder
 *
 * Builds structured prompts for different symbol kinds using
 * the strategy pattern. Each symbol kind gets a tailored prompt
 * that asks the LLM for the most relevant analysis.
 *
 * Also provides a unified prompt that combines symbol resolution
 * and analysis in a single LLM call, avoiding the expensive
 * VS Code symbol resolution stage.
 */
import type { SymbolInfo, CursorContext } from '../models/types';
import type { PromptStrategy, PromptContext } from './prompts/PromptStrategy';
import { FunctionPromptStrategy } from './prompts/FunctionPromptStrategy';
import { VariablePromptStrategy } from './prompts/VariablePromptStrategy';
import { ClassPromptStrategy } from './prompts/ClassPromptStrategy';
import { PropertyPromptStrategy } from './prompts/PropertyPromptStrategy';
import { logger } from '../utils/logger';

/** Registry mapping symbol kinds to their prompt strategies. */
const STRATEGY_MAP: Record<string, PromptStrategy> = {
  function: new FunctionPromptStrategy(),
  method: new FunctionPromptStrategy(),
  variable: new VariablePromptStrategy(),
  class: new ClassPromptStrategy(),
  struct: new ClassPromptStrategy(),
  interface: new ClassPromptStrategy(),
  enum: new ClassPromptStrategy(),
  property: new PropertyPromptStrategy(),
};

/** Default strategy for unknown symbol kinds. */
const DEFAULT_STRATEGY = new FunctionPromptStrategy();

export class PromptBuilder {
  /** System prompt shared across all analysis types. */
  static readonly SYSTEM_PROMPT = `You are a code analysis assistant. Analyze the given code and provide a structured response using the exact markdown section headers requested. Be concise and specific. Use the exact heading names provided — do not rename or skip them. When outputting structured data blocks, follow the exact JSON format specified.`;

  /**
   * Build an analysis prompt for any symbol kind.
   * Delegates to the appropriate strategy based on symbol kind.
   *
   * @param symbol      The symbol to analyze
   * @param sourceCode  Source code of the symbol itself
   * @param containingScopeSource  Optional source of the containing scope (for variables/properties)
   */
  static build(symbol: SymbolInfo, sourceCode: string, containingScopeSource?: string): string {
    const lang = this._guessLanguage(symbol.filePath);
    const strategy = STRATEGY_MAP[symbol.kind] || DEFAULT_STRATEGY;

    logger.debug(
      `PromptBuilder.build: ${symbol.kind} "${symbol.name}" — ` +
        `strategy: ${strategy.constructor.name}, ` +
        `source: ${sourceCode.length} chars, ` +
        `containingScope: ${containingScopeSource ? containingScopeSource.length : 0} chars, ` +
        `lang: ${lang || 'unknown'}`
    );

    const context: PromptContext = {
      sourceCode,
      containingScopeSource,
      containingClassName:
        symbol.scopeChain && symbol.scopeChain.length > 0
          ? symbol.scopeChain[symbol.scopeChain.length - 1]
          : undefined,
    };

    return strategy.buildPrompt(symbol, context, lang);
  }

  /**
   * Build a unified prompt that asks the LLM to:
   * 1. Identify the symbol kind (function, class, variable, struct, etc.)
   * 2. Perform the full analysis appropriate for that kind
   * 3. Generate analysis entries for related symbols it discovers
   *
   * This replaces the old two-stage flow (SymbolResolver → PromptBuilder)
   * with a single LLM call, avoiding the expensive VS Code document
   * symbol provider queries that are slow on large codebases.
   *
   * The LLM runs with full workspace context (copilot CLI in workspace dir)
   * so it can read any file it needs to determine symbol types and
   * analyze related symbols.
   *
   * @param cursor     Lightweight cursor context (word, file, surrounding source)
   * @param cacheRoot  Absolute path to the cache root (e.g. /workspace/.vscode/code-explorer)
   */
  static buildUnified(cursor: CursorContext, cacheRoot?: string): string {
    const lang = this._guessLanguage(cursor.filePath);

    logger.debug(
      `PromptBuilder.buildUnified: word="${cursor.word}" in ${cursor.filePath}:${cursor.position.line} — ` +
        `surrounding source: ${cursor.surroundingSource.length} chars, ` +
        `lang: ${lang || 'unknown'}`
    );

    return `You are analyzing code at the user's cursor position. The user has their cursor on the token "${cursor.word}" in the file "${cursor.filePath}" at line ${cursor.position.line + 1}.

## Cursor Line
\`\`\`${lang}
${cursor.cursorLine}
\`\`\`

## Surrounding Source Code
\`\`\`${lang}
${cursor.surroundingSource}
\`\`\`

## Step 1: Symbol Identification

First, identify exactly what "${cursor.word}" is in this code context. Determine:
- Its **kind**: one of: function, method, class, struct, variable, interface, type, enum, property, parameter
- Its **name**: the canonical symbol name (e.g. for a method call \`obj.foo()\`, the symbol name is "foo")
- Its **container**: the enclosing scope/class name, if any (e.g. for a method inside class Foo, container is "Foo")
- Its **scope_chain**: array of enclosing scope names from outermost to innermost (excluding the symbol itself)

Output a machine-readable JSON block in this exact format:
\`\`\`json:symbol_identity
{
  "name": "${cursor.word}",
  "kind": "function",
  "container": null,
  "scope_chain": []
}
\`\`\`

Rules for determining kind:
- **function**: a standalone function definition or a free function call
- **method**: a function that is a member of a class/struct/object
- **class**: a class definition (including abstract classes)
- **struct**: a struct definition (C/C++/Rust/Go/C#)
- **variable**: a local variable, constant, or module-level variable (const, let, var, auto, etc.)
- **interface**: an interface definition (TypeScript, Java, C#, Go)
- **type**: a type alias definition (TypeScript \`type\`, C/C++ \`typedef\`/\`using\`)
- **enum**: an enum definition
- **property**: a field/property/member variable of a class or struct
- **parameter**: a function/method parameter

## Step 2: Full Analysis

After identifying the symbol, provide the **complete analysis** appropriate for its kind.

### Overview
A 2-3 sentence description of what this symbol does, its purpose, and role.

### Key Points
Key characteristics — parameters, return values, mutability, visibility, design patterns, etc.

### Step-by-Step Breakdown
If this is a function/method/class: provide a numbered breakdown of what it does.

Output a machine-readable JSON block:
\`\`\`json:steps
[
  { "step": 1, "description": "Description of first action" }
]
\`\`\`

If not applicable, output an empty array: \`\`\`json:steps\n[]\n\`\`\`

### Sub-Functions
If this is a function/method: list every function/method it calls internally.

Output a machine-readable JSON block:
\`\`\`json:subfunctions
[
  {
    "name": "calledFunction",
    "description": "What it does",
    "input": "(param: type) — description",
    "output": "returnType — description",
    "filePath": "src/path/to/file.ts",
    "line": 15,
    "kind": "function"
  }
]
\`\`\`

If not applicable or none, output an empty array: \`\`\`json:subfunctions\n[]\n\`\`\`

### Function Input
If this is a function/method: list every input parameter with structural details.

Output a machine-readable JSON block:
\`\`\`json:function_inputs
[
  {
    "name": "paramName",
    "typeName": "ParamType",
    "description": "What it represents",
    "mutated": false,
    "mutationDetail": null,
    "typeFilePath": "src/path/to/file.ts",
    "typeLine": 10,
    "typeKind": "interface",
    "typeOverview": "Brief overview of the type"
  }
]
\`\`\`

If not applicable, output an empty array: \`\`\`json:function_inputs\n[]\n\`\`\`

### Function Output
If this is a function/method: describe the return type.

Output a machine-readable JSON block:
\`\`\`json:function_output
{
  "typeName": "ReturnType",
  "description": "What is returned",
  "typeFilePath": "src/path/to/file.ts",
  "typeLine": 10,
  "typeKind": "interface",
  "typeOverview": "Brief overview"
}
\`\`\`

If void or not applicable: \`\`\`json:function_output\n{ "typeName": "void", "description": "No return value" }\n\`\`\`

### Class Members
If this is a class/struct/interface: list ALL members.

Output a machine-readable JSON block:
\`\`\`json:class_members
[
  {
    "name": "memberName",
    "memberKind": "field",
    "typeName": "MemberType",
    "visibility": "private",
    "isStatic": false,
    "description": "Brief description",
    "line": 15
  }
]
\`\`\`

If not applicable, output an empty array: \`\`\`json:class_members\n[]\n\`\`\`

### Member Access Patterns
If this is a class/struct: for each field/property, which methods read/write it.

Output a machine-readable JSON block:
\`\`\`json:member_access
[
  {
    "memberName": "fieldName",
    "readBy": ["methodA"],
    "writtenBy": ["constructor"],
    "externalAccess": false
  }
]
\`\`\`

If not applicable, output an empty array: \`\`\`json:member_access\n[]\n\`\`\`

### Variable Lifecycle
If this is a variable/property/parameter: describe its lifecycle.

Output a machine-readable JSON block:
\`\`\`json:variable_lifecycle
{
  "declaration": "How and where declared",
  "initialization": "How initialized",
  "mutations": ["mutation point 1"],
  "consumption": ["where read/used"],
  "scopeAndLifetime": "Scope and lifetime description"
}
\`\`\`

If not applicable, omit this block entirely.

### Data Flow
If this is a variable/property: trace data flow.

Output a machine-readable JSON block:
\`\`\`json:data_flow
[
  { "type": "created", "filePath": "${cursor.filePath}", "line": 0, "description": "How created" }
]
\`\`\`

Valid types: "created", "assigned", "read", "modified", "consumed", "returned", "passed"
If not applicable, output an empty array: \`\`\`json:data_flow\n[]\n\`\`\`

### Callers
List every function/method/location that calls, references, or uses this symbol.

Output a machine-readable JSON block:
\`\`\`json:callers
[
  {
    "name": "callerName",
    "filePath": "src/path/to/file.ts",
    "line": 42,
    "kind": "function",
    "context": "How it uses this symbol"
  }
]
\`\`\`

If none, output an empty array: \`\`\`json:callers\n[]\n\`\`\`

### Dependencies
List symbols this depends on (imports, base classes, used services), one per line.

### Usage Pattern
Describe how this symbol is typically used in the codebase.

### Potential Issues
List up to 3 code smells, bugs, or improvement suggestions. If none, say "None detected."

### Diagrams
Generate 1-2 Mermaid diagrams that best visualize this symbol's behavior or structure. Choose the most appropriate diagram type:

- For **functions/methods**: a flowchart showing the execution path, or a sequence diagram showing interactions with sub-functions.
- For **classes/structs/interfaces**: a class diagram showing relationships (inheritance, composition, dependencies).
- For **variables**: a flowchart showing the data flow lifecycle (creation → mutations → consumption).

Use valid Mermaid syntax. Keep diagrams concise (under 20 nodes). Use short, readable labels. Do NOT use special characters or HTML in node labels.

Output a machine-readable JSON block:
\`\`\`json:diagrams
[
  {
    "title": "Call Flow",
    "type": "flowchart",
    "mermaidSource": "flowchart TD\\n  A[Start] --> B{Check input}\\n  B -->|valid| C[Process]\\n  B -->|invalid| D[Return error]"
  }
]
\`\`\`

If no diagrams are applicable (e.g., simple variables or trivial symbols), output an empty array: \`\`\`json:diagrams\n[]\n\`\`\`

### Related Symbols
For each related symbol, provide a brief analysis.

Output a machine-readable JSON block:
\`\`\`json:related_symbols
[
  {
    "name": "SymbolName",
    "kind": "class",
    "filePath": "src/path/to/file.ts",
    "line": 10,
    "overview": "A 1-2 sentence description.",
    "keyPoints": ["point 1"],
    "dependencies": ["dep1"],
    "potentialIssues": ["issue 1"]
  }
]
\`\`\`

If none, output an empty array: \`\`\`json:related_symbols\n[]\n\`\`\`

## Step 3: Related Symbol Analyses

During your analysis above, you will have read and understood other symbols in the codebase — sub-functions called by this symbol, types used as parameters or return values, parent classes, local variables, and other related code constructs. For each such related symbol, generate a **full analysis entry** so we can pre-cache it.

### Cache File Naming Convention

Each symbol's analysis is cached as a markdown file. The cache key pattern is:
- File path: \`<cache_root>/<source_file_path>/<cache_key>.md\`
- Cache key format: \`<scope_chain_dot_separated>.<kind_prefix>.<sanitized_name>\`
- If no scope chain: \`<kind_prefix>.<sanitized_name>\`
- If containerName but no scope chain: \`<containerName>.<kind_prefix>.<sanitized_name>\`

Kind prefixes: class→"class", function→"fn", method→"method", variable→"var", interface→"interface", type→"type", enum→"enum", property→"prop", parameter→"param", struct→"struct", unknown→"sym"

${cacheRoot ? 'Cache root: `' + cacheRoot + '`' : 'Cache root: `.vscode/code-explorer`'}

### Output Format for Related Symbols

For **each** related symbol you discovered while analyzing the primary symbol, output a separate analysis block. Include the cache file path so the extension can write these to disk directly.

Output a machine-readable JSON block listing ALL related symbol analyses:
\`\`\`json:related_symbol_analyses
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
\`\`\`

Include at minimum: sub-functions/methods called, custom types used as parameters/return values, parent/base classes, and interfaces implemented. Skip standard library types (string, number, Promise, Array, etc.).

If no related symbols are found, output an empty array: \`\`\`json:related_symbol_analyses\n[]\n\`\`\``;
  }

  /**
   * Build a prompt that instructs the LLM to analyze ALL crucial symbols
   * in a given file and output cache-compatible entries for each.
   *
   * The LLM reads the full file source, identifies every important symbol
   * (classes, functions, methods, interfaces, enums, type aliases, exported
   * variables, exported constants), and produces a structured JSON block
   * containing a full analysis entry for each — ready to be written as
   * individual cache files.
   *
   * @param filePath      Relative path from workspace root
   * @param fileSource    Full source code of the file
   * @param cacheRoot     Absolute path to the cache root directory
   */
  static buildFileAnalysis(filePath: string, fileSource: string, cacheRoot?: string): string {
    const lang = this._guessLanguage(filePath);

    logger.debug(
      `PromptBuilder.buildFileAnalysis: file="${filePath}" — ` +
        `source: ${fileSource.length} chars, lang: ${lang || 'unknown'}`
    );

    return `You are analyzing an entire source file to identify and document all important symbols. Your goal is to produce cache entries for every crucial symbol so that future lookups can hit the cache.

## File
**Path:** \`${filePath}\`
**Language:** ${lang || 'unknown'}

## Full Source Code
\`\`\`${lang}
${fileSource}
\`\`\`

## Task

Analyze the file above and identify **every crucial symbol** defined in it. Crucial symbols include:
- **Classes** (including abstract classes)
- **Functions** (exported or module-level)
- **Methods** (members of classes/structs)
- **Interfaces**
- **Type aliases** (\`type\` definitions)
- **Enums**
- **Exported variables and constants** (module-level \`export const\`, \`export let\`, etc.)
- **Structs** (C/C++/Rust/Go)

Skip trivial or internal-only symbols (e.g., unexported local variables, loop counters, import statements, single-use inline helpers that are obvious from context).

For **each** identified symbol, produce a full analysis entry.

### Cache File Naming Convention

Each symbol's analysis is cached as a markdown file. The cache key pattern is:
- File path: \`<cache_root>/<source_file_path>/<cache_key>.md\`
- Cache key format: \`<scope_chain_dot_separated>.<kind_prefix>.<sanitized_name>\`
- If no scope chain: \`<kind_prefix>.<sanitized_name>\`
- If containerName but no scope chain: \`<containerName>.<kind_prefix>.<sanitized_name>\`

Kind prefixes: class->"class", function->"fn", method->"method", variable->"var", interface->"interface", type->"type", enum->"enum", property->"prop", parameter->"param", struct->"struct", unknown->"sym"

${cacheRoot ? 'Cache root: `' + cacheRoot + '`' : 'Cache root: `.vscode/code-explorer`'}

### Output Format

Output a single machine-readable JSON block listing ALL symbol analyses for this file:

\`\`\`json:file_symbol_analyses
[
  {
    "cache_file_path": "${filePath}/<cache_key>.md",
    "name": "SymbolName",
    "kind": "function",
    "filePath": "${filePath}",
    "line": 10,
    "container": null,
    "scope_chain": [],
    "overview": "2-3 sentence description of what this symbol does, its purpose, and role in the codebase.",
    "key_points": ["Important characteristic 1", "Important characteristic 2"],
    "steps": [
      { "step": 1, "description": "First thing this function/method does" }
    ],
    "sub_functions": [
      {
        "name": "calledFunction",
        "description": "What it does",
        "input": "(param: type) — description",
        "output": "returnType — description",
        "filePath": "src/path/to/file.ts",
        "line": 15,
        "kind": "function"
      }
    ],
    "function_inputs": [
      {
        "name": "paramName",
        "typeName": "ParamType",
        "description": "What it represents",
        "mutated": false
      }
    ],
    "function_output": {
      "typeName": "ReturnType",
      "description": "What is returned"
    },
    "class_members": [
      {
        "name": "memberName",
        "memberKind": "field",
        "typeName": "MemberType",
        "visibility": "private",
        "isStatic": false,
        "description": "Brief description",
        "line": 15
      }
    ],
    "callers": [
      {
        "name": "callerName",
        "filePath": "src/path/to/file.ts",
        "line": 42,
        "kind": "function",
        "context": "How it uses this symbol"
      }
    ],
    "dependencies": ["dep1", "dep2"],
    "usage_pattern": "How this symbol is typically used",
    "potential_issues": ["Issue 1"]
  }
]
\`\`\`

### Rules

1. **Be thorough**: Include every class, function, method, interface, enum, type alias, and exported variable/constant.
2. **Methods inside classes**: For methods, set \`container\` to the class name and \`scope_chain\` to \`["ClassName"]\`. The cache key should be \`ClassName.method.methodName\`.
3. **Nested symbols**: For symbols inside other symbols, build the full scope chain.
4. **Steps and sub-functions**: Only include for functions/methods. Use empty arrays for classes, interfaces, enums, variables.
5. **Class members**: Only include for classes/structs/interfaces. Use empty array for functions/variables.
6. **Function inputs/output**: Only include for functions/methods. Use empty array / null for others.
7. **Callers**: List functions/methods in THIS file that call each symbol. For cross-file callers, include what you can determine from the visible code.
8. **Cache file path**: Must follow the naming convention exactly so the extension can look up these entries later.
9. **Line numbers**: Use 0-based line numbers matching the source code.
10. **Be accurate**: Only state facts you can determine from the source code. Don't hallucinate callers or dependencies.`;
  }

  /**
   * Get the strategy used for a given symbol kind (for testing).
   */
  static getStrategy(kind: string): PromptStrategy {
    return STRATEGY_MAP[kind] || DEFAULT_STRATEGY;
  }

  private static _guessLanguage(filePath: string): string {
    if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
      return 'typescript';
    }
    if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) {
      return 'javascript';
    }
    if (filePath.endsWith('.cpp') || filePath.endsWith('.cc') || filePath.endsWith('.cxx')) {
      return 'cpp';
    }
    if (filePath.endsWith('.c')) {
      return 'c';
    }
    if (filePath.endsWith('.h') || filePath.endsWith('.hpp')) {
      return 'cpp';
    }
    if (filePath.endsWith('.py')) {
      return 'python';
    }
    if (filePath.endsWith('.java')) {
      return 'java';
    }
    if (filePath.endsWith('.cs')) {
      return 'csharp';
    }
    return '';
  }
}
