/**
 * Code Explorer — Function/Method Prompt Strategy
 *
 * Builds prompts for function and method symbols.
 * This is the default analysis mode — step-by-step breakdown,
 * sub-functions, inputs/outputs, callers.
 */
import type { SymbolInfo } from '../../models/types';
import type { PromptStrategy, PromptContext } from './PromptStrategy';

export class FunctionPromptStrategy implements PromptStrategy {
  buildPrompt(symbol: SymbolInfo, context: PromptContext, lang: string): string {
    const scopeCtx =
      symbol.scopeChain && symbol.scopeChain.length > 0
        ? `\nScope chain: ${symbol.scopeChain.join(' → ')} → ${symbol.name}`
        : '';

    return `Analyze the following ${symbol.kind} "${symbol.name}" from file "${symbol.filePath}".${scopeCtx}

## Source Code
\`\`\`${lang}
${context.sourceCode}
\`\`\`

## Instructions
Provide your analysis using these exact section headers:

### Overview
A 2-3 sentence description of what this ${symbol.kind} does, its purpose, and role.

### Key Points
Describe parameters, return value, and side effects.

### Step-by-Step Breakdown
Provide a numbered list of each distinct action or responsibility this ${symbol.kind} performs, in execution order. Be specific and reference actual code logic.

Then, output a machine-readable JSON block with the steps in this exact format:
\`\`\`json:steps
[
  { "step": 1, "description": "Validates that the input email is non-empty" },
  { "step": 2, "description": "Checks email format against regex pattern" }
]
\`\`\`

### Sub-Functions
List every function, method, or utility that this ${symbol.kind} calls internally. For each, provide:
- The name
- A one-line description of what it does
- Its input parameters (types and purpose)
- Its return value (type and meaning)
- The file where it is defined (if known)

Then, output a machine-readable JSON block in this exact format:
\`\`\`json:subfunctions
[
  {
    "name": "validateEmail",
    "description": "Checks if an email string matches RFC 5322 format",
    "input": "(email: string) — the email address to validate",
    "output": "boolean — true if valid",
    "filePath": "src/utils/validators.ts",
    "line": 15,
    "kind": "function"
  }
]
\`\`\`

If there are no sub-functions, output an empty array: \`\`\`json:subfunctions\n[]\n\`\`\`

### Function Input
List every input parameter of this ${symbol.kind} with full structural details. For each parameter:
- The parameter name and type annotation
- A brief description of what it represents
- Whether this ${symbol.kind} **mutates** the parameter (modifies properties, calls non-const/destructive methods). If yes, describe specifically how.
- If the parameter type is a custom type/interface/class, provide: the file path where it is defined, a brief overview of its structure, and its key fields.

Output a machine-readable JSON block in this exact format:
\`\`\`json:function_inputs
[
  {
    "name": "symbol",
    "typeName": "SymbolInfo",
    "description": "The code symbol to analyze",
    "mutated": false,
    "mutationDetail": null,
    "typeFilePath": "src/models/types.ts",
    "typeLine": 61,
    "typeKind": "interface",
    "typeOverview": "Represents a code symbol with name, kind, filePath, position, and optional scope chain"
  }
]
\`\`\`

If there are no parameters, output an empty array: \`\`\`json:function_inputs\n[]\n\`\`\`

### Function Output
Describe the return type of this ${symbol.kind}:
- The return type annotation
- A brief description of what it returns and when
- If the return type is a custom type/interface/class, provide: the file path where it is defined, a brief overview of its structure.

Output a machine-readable JSON block in this exact format:
\`\`\`json:function_output
{
  "typeName": "Promise<AnalysisResult>",
  "description": "The complete analysis result including static and LLM data",
  "typeFilePath": "src/models/types.ts",
  "typeLine": 97,
  "typeKind": "interface",
  "typeOverview": "Contains overview, call stacks, usages, relationships, and metadata"
}
\`\`\`

If the return type is void or there is no return, output: \`\`\`json:function_output\n{ "typeName": "void", "description": "No return value" }\n\`\`\`

### Callers
List every function, method, or location that calls or references this ${symbol.kind}. For each caller, provide the name, file path, line number, and a one-line description.

Then, output a machine-readable JSON block in this exact format:
\`\`\`json:callers
[
  {
    "name": "callerFunctionName",
    "filePath": "src/path/to/file.ts",
    "line": 42,
    "kind": "function",
    "context": "Calls ${symbol.name}() to process user data"
  }
]
\`\`\`

If there are no callers, output an empty array: \`\`\`json:callers\n[]\n\`\`\`

### Dependencies
List other symbols this depends on (imports, base classes, used services), one per line.

### Usage Pattern
Describe how and where this ${symbol.kind} is typically used in the codebase.

### Potential Issues
List up to 3 code smells, bugs, or improvement suggestions. If none, say "None detected."

### Related Symbols
For each related symbol you identify in the source code, provide a brief analysis.

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

If no related symbols are found, output an empty array: \`\`\`json:related_symbols\n[]\n\`\`\``;
  }
}
