/**
 * Code Explorer — Variable Prompt Strategy
 *
 * Builds prompts for variable and constant symbols.
 * Focus: data mutation tracking, lifecycle analysis, data flow,
 * and type information.
 */
import type { SymbolInfo } from '../../models/types';
import type { PromptStrategy, PromptContext } from './PromptStrategy';

export class VariablePromptStrategy implements PromptStrategy {
  buildPrompt(symbol: SymbolInfo, context: PromptContext, lang: string): string {
    const scopeCtx = symbol.scopeChain && symbol.scopeChain.length > 0
      ? `\nScope chain: ${symbol.scopeChain.join(' → ')} → ${symbol.name}`
      : '';

    const containingScope = context.containingScopeSource
      ? `\n## Containing Scope\n\`\`\`${lang}\n${context.containingScopeSource}\n\`\`\``
      : '';

    return `Analyze the following variable/constant "${symbol.name}" from file "${symbol.filePath}".${scopeCtx}

## Source Code (Variable Declaration Context)
\`\`\`${lang}
${context.sourceCode}
\`\`\`
${containingScope}

## Instructions
This is a **variable/constant analysis**. Focus on data mutation, lifecycle, and flow.
Provide your analysis using these exact section headers:

### Overview
A 2-3 sentence description of what this variable represents, its purpose, and its role in the surrounding code.

### Key Points
- Type and mutability (const, let, var, readonly, etc.)
- Initial value and how it is computed
- Whether it is exported or module-scoped
- Key constraints or invariants

### Variable Lifecycle
Describe the full lifecycle of this variable:
1. **Declaration**: How and where it is declared (const/let/var, scope level)
2. **Initialization**: How it gets its initial value
3. **Mutations**: Every point where this variable is reassigned or its contents are modified (e.g., property writes, array pushes, map sets)
4. **Reads/Consumption**: Where this variable's value is read or consumed
5. **Scope & Lifetime**: When this variable becomes unreachable or is garbage collected

Output a machine-readable JSON block:
\`\`\`json:variable_lifecycle
{
  "declaration": "Declared as const at line 15 in function processUser()",
  "initialization": "Initialized from database query result",
  "mutations": ["Line 20: user.status = 'active'", "Line 25: user.lastLogin = new Date()"],
  "consumption": ["Line 30: passed to validateUser()", "Line 35: returned from function"],
  "scopeAndLifetime": "Function-scoped, lives for the duration of processUser() call"
}
\`\`\`

### Data Flow
Trace how data flows through this variable — where it comes from, how it is transformed, and where it goes. Include assignments, function calls that use it, and any derived values.

Output a machine-readable JSON block:
\`\`\`json:data_flow
[
  { "type": "created", "filePath": "${symbol.filePath}", "line": 0, "description": "Created from constructor call" },
  { "type": "modified", "filePath": "${symbol.filePath}", "line": 0, "description": "Property .status set to 'active'" },
  { "type": "passed", "filePath": "${symbol.filePath}", "line": 0, "description": "Passed to validateUser() as first argument" },
  { "type": "returned", "filePath": "${symbol.filePath}", "line": 0, "description": "Returned from processUser()" }
]
\`\`\`

Valid types: "created", "assigned", "read", "modified", "consumed", "returned", "passed"

If there is no significant data flow, output an empty array: \`\`\`json:data_flow\n[]\n\`\`\`

### Callers
List every function/method that reads, writes, or references this variable.

Output a machine-readable JSON block:
\`\`\`json:callers
[
  {
    "name": "functionName",
    "filePath": "src/path/to/file.ts",
    "line": 42,
    "kind": "function",
    "context": "Reads ${symbol.name} to check user status"
  }
]
\`\`\`

If there are no callers, output an empty array: \`\`\`json:callers\n[]\n\`\`\`

### Dependencies
List types, functions, or modules this variable depends on (its type definition, initialization dependencies).

### Usage Pattern
Describe how this variable is typically used — is it a configuration value, intermediate computation, accumulator, loop variable, etc.?

### Potential Issues
List up to 3 potential concerns: unnecessary mutability, shadowing, potential null/undefined, thread safety, etc. If none, say "None detected."

### Related Symbols
For each related symbol you identify, provide a brief analysis.

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
