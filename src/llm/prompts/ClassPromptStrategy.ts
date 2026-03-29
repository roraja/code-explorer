/**
 * Code Explorer — Class/Struct Prompt Strategy
 *
 * Builds prompts for class, struct, and interface symbols.
 * Focus: class structure, member analysis, inheritance,
 * design patterns, and member access patterns.
 */
import type { SymbolInfo } from '../../models/types';
import type { PromptStrategy, PromptContext } from './PromptStrategy';

export class ClassPromptStrategy implements PromptStrategy {
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
This is a **class/data structure analysis**. Focus on structure, members, relationships, and design patterns.
Provide your analysis using these exact section headers:

### Overview
A 2-3 sentence description of this ${symbol.kind}'s responsibility, its role in the system, and the design pattern it follows (if any).

### Key Points
- Primary responsibility (single responsibility principle)
- Key design decisions
- Thread safety / immutability characteristics
- Public API surface summary

### Class Members
List ALL members of this ${symbol.kind} — fields, properties, methods, constructors. For each, provide:
- Name, kind (field/method/property/constructor/getter/setter), type, visibility (public/private/protected), whether static
- A one-line description

Output a machine-readable JSON block:
\`\`\`json:class_members
[
  {
    "name": "_cache",
    "memberKind": "field",
    "typeName": "Map<string, AnalysisResult>",
    "visibility": "private",
    "isStatic": false,
    "description": "In-memory cache for analysis results",
    "line": 15
  },
  {
    "name": "analyzeSymbol",
    "memberKind": "method",
    "typeName": "(symbol: SymbolInfo) => Promise<AnalysisResult>",
    "visibility": "public",
    "isStatic": false,
    "description": "Main entry point for symbol analysis",
    "line": 42
  }
]
\`\`\`

### Member Access Patterns
For each field/property, identify which methods read it and which methods write/mutate it. Also note if the member is accessed from outside the class.

Output a machine-readable JSON block:
\`\`\`json:member_access
[
  {
    "memberName": "_cache",
    "readBy": ["analyzeSymbol", "getCachedResult"],
    "writtenBy": ["analyzeSymbol", "clearCache"],
    "externalAccess": false
  }
]
\`\`\`

If there are no trackable members, output an empty array: \`\`\`json:member_access\n[]\n\`\`\`

### Step-by-Step Breakdown
Describe the ${symbol.kind}'s lifecycle: how it is constructed, initialized, used, and disposed.

Output a machine-readable JSON block:
\`\`\`json:steps
[
  { "step": 1, "description": "Constructor receives dependencies via injection" },
  { "step": 2, "description": "Client calls analyzeSymbol() to trigger analysis pipeline" }
]
\`\`\`

### Callers
List every location that instantiates, references, or uses this ${symbol.kind}.

Output a machine-readable JSON block:
\`\`\`json:callers
[
  {
    "name": "activate",
    "filePath": "src/extension.ts",
    "line": 30,
    "kind": "function",
    "context": "Creates new ${symbol.name}() during extension activation"
  }
]
\`\`\`

If there are no callers, output an empty array: \`\`\`json:callers\n[]\n\`\`\`

### Dependencies
List all dependencies: constructor-injected services, imported types, base classes, implemented interfaces.

### Usage Pattern
Describe how this ${symbol.kind} is typically instantiated and used. Is it a singleton? Created per-request? Shared across modules?

### Potential Issues
List up to 3 code smells, design issues, or improvement suggestions. If none, say "None detected."

### Diagrams
Generate 1-2 Mermaid diagrams that best visualize this ${symbol.kind}'s structure and relationships:
- A **class diagram** showing inheritance, composition, and dependency relationships with other classes/interfaces, OR
- A **flowchart** showing the ${symbol.kind}'s lifecycle (construction → usage → disposal).

Use valid Mermaid syntax. Keep diagrams concise (under 20 nodes). Use short, readable labels. Do NOT use special characters or HTML in node labels.

Output a machine-readable JSON block:
\`\`\`json:diagrams
[
  {
    "title": "Class Relationships",
    "type": "classDiagram",
    "mermaidSource": "classDiagram\\n  class ${symbol.name} {\\n    +method()\\n  }\\n  BaseClass <|-- ${symbol.name}"
  }
]
\`\`\`

If not applicable, output an empty array: \`\`\`json:diagrams\n[]\n\`\`\`

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
