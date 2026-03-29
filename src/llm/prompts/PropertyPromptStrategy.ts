/**
 * Code Explorer — Property/Member Prompt Strategy
 *
 * Builds prompts for class property, field, and member symbols.
 * Focus: member mutation tracking, access patterns, encapsulation,
 * and data flow within the containing class.
 */
import type { SymbolInfo } from '../../models/types';
import type { PromptStrategy, PromptContext } from './PromptStrategy';

export class PropertyPromptStrategy implements PromptStrategy {
  buildPrompt(symbol: SymbolInfo, context: PromptContext, lang: string): string {
    const scopeCtx =
      symbol.scopeChain && symbol.scopeChain.length > 0
        ? `\nScope chain: ${symbol.scopeChain.join(' → ')} → ${symbol.name}`
        : '';

    const classCtx = context.containingClassName
      ? `\nContaining class: ${context.containingClassName}`
      : '';

    const containingScope = context.containingScopeSource
      ? `\n## Containing Class/Scope\n\`\`\`${lang}\n${context.containingScopeSource}\n\`\`\``
      : '';

    return `Analyze the following class member/property "${symbol.name}" from file "${symbol.filePath}".${scopeCtx}${classCtx}

## Source Code (Member Declaration)
\`\`\`${lang}
${context.sourceCode}
\`\`\`
${containingScope}

## Instructions
This is a **class member/property analysis**. Focus on access patterns, mutation tracking, and encapsulation.
Provide your analysis using these exact section headers:

### Overview
A 2-3 sentence description of what this member represents, its role in the containing class, and why it exists.

### Key Points
- Type and mutability (readonly, const, mutable)
- Visibility (public, private, protected)
- Whether it is static or instance-level
- Initial value and how it is set
- Key invariants or constraints

### Variable Lifecycle
Describe the lifecycle of this member within its containing class:
1. **Declaration**: Where it is declared and its access modifier
2. **Initialization**: How it gets its initial value (constructor, inline, lazy)
3. **Mutations**: Every method that modifies this member and how
4. **Reads/Consumption**: Every method that reads this member and why
5. **Scope & Lifetime**: Tied to instance lifetime vs. static/class lifetime

Output a machine-readable JSON block:
\`\`\`json:variable_lifecycle
{
  "declaration": "Private field declared at line 15",
  "initialization": "Set in constructor from injected parameter",
  "mutations": ["clearCache() resets to empty Map", "analyzeSymbol() adds entries"],
  "consumption": ["getCachedResult() reads entries", "getStats() counts entries"],
  "scopeAndLifetime": "Instance-scoped, lives for the lifetime of the containing object"
}
\`\`\`

### Data Flow
Trace how data flows through this member — where values come from, how they are transformed, and where they go.

Output a machine-readable JSON block:
\`\`\`json:data_flow
[
  { "type": "created", "filePath": "${symbol.filePath}", "line": 0, "description": "Initialized in constructor" },
  { "type": "modified", "filePath": "${symbol.filePath}", "line": 0, "description": "Updated by analyzeSymbol()" },
  { "type": "read", "filePath": "${symbol.filePath}", "line": 0, "description": "Read by getCachedResult()" }
]
\`\`\`

If there is no significant data flow, output an empty array: \`\`\`json:data_flow\n[]\n\`\`\`

### Member Access Patterns
Which methods of the containing class read this member? Which modify it? Is it accessed from outside the class?

Output a machine-readable JSON block:
\`\`\`json:member_access
[
  {
    "memberName": "${symbol.name}",
    "readBy": ["methodA", "methodB"],
    "writtenBy": ["constructor", "methodC"],
    "externalAccess": false
  }
]
\`\`\`

### Callers
List every function/method that accesses this member.

Output a machine-readable JSON block:
\`\`\`json:callers
[
  {
    "name": "methodName",
    "filePath": "src/path/to/file.ts",
    "line": 42,
    "kind": "method",
    "context": "Reads ${symbol.name} to check cache state"
  }
]
\`\`\`

If there are no callers, output an empty array: \`\`\`json:callers\n[]\n\`\`\`

### Dependencies
List types, interfaces, or modules that this member's type depends on.

### Usage Pattern
Describe the access pattern: is this a cache, configuration, state flag, injected dependency, computed property?

### Potential Issues
List up to 3 concerns: unnecessary exposure, thread safety, missing validation, encapsulation violations. If none, say "None detected."

### Diagrams
Generate a Mermaid **flowchart** showing how this member is accessed — which methods write to it and which methods read from it, showing the data flow through the containing class.

Use valid Mermaid syntax. Keep diagrams concise (under 15 nodes). Use short, readable labels. Do NOT use special characters or HTML in node labels.

Output a machine-readable JSON block:
\`\`\`json:diagrams
[
  {
    "title": "Member Access Flow",
    "type": "flowchart",
    "mermaidSource": "flowchart LR\\n  constructor --> |writes| ${symbol.name}\\n  ${symbol.name} --> |read by| methodA"
  }
]
\`\`\`

If not applicable, output an empty array: \`\`\`json:diagrams\n[]\n\`\`\`

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
