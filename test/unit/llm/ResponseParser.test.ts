/**
 * Code Explorer — Unit Tests for ResponseParser
 *
 * Tests parsing of LLM markdown responses, including
 * the related symbols pre-caching feature.
 */
import * as assert from 'assert';
import { ResponseParser } from '../../../src/llm/ResponseParser';
import type { SymbolInfo } from '../../../src/models/types';

const testSymbol: SymbolInfo = {
  name: 'UserService',
  kind: 'class',
  filePath: 'src/services/UserService.ts',
  position: { line: 10, character: 0 },
};

suite('ResponseParser', () => {
  suite('parse — related symbols', () => {
    test('extracts related symbols from json:related_symbols block', () => {
      const raw = `### Overview
UserService handles user CRUD operations.

### Key Points
- getUser() fetches a user by ID
- createUser() creates a new user

### Related Symbols

\`\`\`json:related_symbols
[
  {
    "name": "UserRepository",
    "kind": "class",
    "filePath": "src/repositories/UserRepository.ts",
    "line": 5,
    "overview": "Data access layer for user entities.",
    "keyPoints": ["findById()", "save()"],
    "dependencies": ["DatabaseConnection"],
    "potentialIssues": ["No connection pooling"]
  },
  {
    "name": "Logger",
    "kind": "class",
    "filePath": "src/utils/Logger.ts",
    "line": 1,
    "overview": "Singleton logger for the application."
  }
]
\`\`\`
`;

      const result = ResponseParser.parse(raw, testSymbol);

      assert.ok(result.relatedSymbols);
      assert.strictEqual(result.relatedSymbols!.length, 2);

      const repo = result.relatedSymbols![0];
      assert.strictEqual(repo.name, 'UserRepository');
      assert.strictEqual(repo.kind, 'class');
      assert.strictEqual(repo.filePath, 'src/repositories/UserRepository.ts');
      assert.strictEqual(repo.line, 5);
      assert.strictEqual(repo.overview, 'Data access layer for user entities.');
      assert.deepStrictEqual(repo.keyPoints, ['findById()', 'save()']);
      assert.deepStrictEqual(repo.dependencies, ['DatabaseConnection']);
      assert.deepStrictEqual(repo.potentialIssues, ['No connection pooling']);

      const logger = result.relatedSymbols![1];
      assert.strictEqual(logger.name, 'Logger');
      assert.strictEqual(logger.kind, 'class');
      assert.strictEqual(logger.overview, 'Singleton logger for the application.');
      assert.strictEqual(logger.keyPoints, undefined);
    });

    test('returns empty array when no json:related_symbols block exists', () => {
      const raw = `### Overview
Simple function.

### Key Points
- Does something
`;
      const result = ResponseParser.parse(raw, testSymbol);
      assert.ok(result.relatedSymbols);
      assert.strictEqual(result.relatedSymbols!.length, 0);
    });

    test('returns empty array for malformed JSON in related_symbols block', () => {
      const raw = `### Overview
A class.

\`\`\`json:related_symbols
{ not valid json !!!
\`\`\`
`;
      const result = ResponseParser.parse(raw, testSymbol);
      assert.ok(result.relatedSymbols);
      assert.strictEqual(result.relatedSymbols!.length, 0);
    });

    test('skips entries missing required fields', () => {
      const raw = `### Overview
A class.

\`\`\`json:related_symbols
[
  { "name": "ValidSymbol", "filePath": "src/valid.ts", "overview": "A valid symbol.", "kind": "function", "line": 1 },
  { "name": "MissingOverview", "filePath": "src/missing.ts", "kind": "function", "line": 1 },
  { "filePath": "src/noname.ts", "overview": "No name.", "kind": "class", "line": 1 },
  { "name": "NoFilePath", "overview": "No file path.", "kind": "class", "line": 1 }
]
\`\`\`
`;
      const result = ResponseParser.parse(raw, testSymbol);
      assert.ok(result.relatedSymbols);
      assert.strictEqual(result.relatedSymbols!.length, 1);
      assert.strictEqual(result.relatedSymbols![0].name, 'ValidSymbol');
    });

    test('defaults kind to unknown when not provided', () => {
      const raw = `### Overview
A class.

\`\`\`json:related_symbols
[
  { "name": "NoKind", "filePath": "src/nokind.ts", "line": 1, "overview": "Has no kind." }
]
\`\`\`
`;
      const result = ResponseParser.parse(raw, testSymbol);
      assert.ok(result.relatedSymbols);
      assert.strictEqual(result.relatedSymbols!.length, 1);
      assert.strictEqual(result.relatedSymbols![0].kind, 'unknown');
    });

    test('returns empty array when related_symbols is not an array', () => {
      const raw = `### Overview
A class.

\`\`\`json:related_symbols
{ "not": "an array" }
\`\`\`
`;
      const result = ResponseParser.parse(raw, testSymbol);
      assert.ok(result.relatedSymbols);
      assert.strictEqual(result.relatedSymbols!.length, 0);
    });
  });

  suite('parse — basic sections', () => {
    test('extracts overview section', () => {
      const raw = `### Overview
This is the overview.

### Key Points
- Point one
`;
      const result = ResponseParser.parse(raw, testSymbol);
      assert.strictEqual(result.overview, 'This is the overview.');
    });

    test('extracts callers from json:callers block', () => {
      const raw = `### Callers
Some text.

\`\`\`json:callers
[
  { "name": "main", "filePath": "src/main.ts", "line": 10, "kind": "function", "context": "Calls UserService" }
]
\`\`\`
`;
      const result = ResponseParser.parse(raw, testSymbol);
      assert.strictEqual(result.callStacks!.length, 1);
      assert.strictEqual(result.callStacks![0].caller.name, 'main');
      assert.strictEqual(result.usages!.length, 1);
    });
  });

  suite('parse — function inputs', () => {
    test('extracts function inputs with full details', () => {
      const raw = `### Overview
A function.

### Function Input

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
    "typeOverview": "Represents a code symbol with name, kind, filePath, and position"
  },
  {
    "name": "options",
    "typeName": "AnalysisOptions",
    "description": "Configuration for the analysis run",
    "mutated": true,
    "mutationDetail": "Sets options.timestamp to current time",
    "typeFilePath": "src/models/types.ts",
    "typeLine": 120,
    "typeKind": "interface",
    "typeOverview": "Options controlling analysis depth and caching behavior"
  }
]
\`\`\`
`;
      const result = ResponseParser.parse(raw, testSymbol);

      assert.ok(result.functionInputs);
      assert.strictEqual(result.functionInputs!.length, 2);

      const first = result.functionInputs![0];
      assert.strictEqual(first.name, 'symbol');
      assert.strictEqual(first.typeName, 'SymbolInfo');
      assert.strictEqual(first.mutated, false);
      assert.strictEqual(first.mutationDetail, undefined);
      assert.strictEqual(first.typeFilePath, 'src/models/types.ts');
      assert.strictEqual(first.typeLine, 61);
      assert.strictEqual(first.typeKind, 'interface');
      assert.ok(first.typeOverview);

      const second = result.functionInputs![1];
      assert.strictEqual(second.name, 'options');
      assert.strictEqual(second.mutated, true);
      assert.strictEqual(second.mutationDetail, 'Sets options.timestamp to current time');
    });

    test('returns undefined when no function_inputs block exists', () => {
      const raw = `### Overview\nA function.\n`;
      const result = ResponseParser.parse(raw, testSymbol);
      assert.strictEqual(result.functionInputs, undefined);
    });

    test('skips entries missing required fields', () => {
      const raw = `\`\`\`json:function_inputs
[
  { "name": "valid", "typeName": "string", "description": "ok", "mutated": false },
  { "typeName": "string", "description": "missing name", "mutated": false },
  { "name": "noType", "description": "missing typeName", "mutated": false }
]
\`\`\`
`;
      const result = ResponseParser.parse(raw, testSymbol);
      assert.ok(result.functionInputs);
      assert.strictEqual(result.functionInputs!.length, 1);
      assert.strictEqual(result.functionInputs![0].name, 'valid');
    });

    test('returns undefined for malformed JSON', () => {
      const raw = `\`\`\`json:function_inputs\n{ broken json }\n\`\`\`\n`;
      const result = ResponseParser.parse(raw, testSymbol);
      assert.strictEqual(result.functionInputs, undefined);
    });
  });

  suite('parse — function output', () => {
    test('extracts function output with full details', () => {
      const raw = `### Function Output

\`\`\`json:function_output
{
  "typeName": "Promise<AnalysisResult>",
  "description": "The complete analysis result",
  "typeFilePath": "src/models/types.ts",
  "typeLine": 97,
  "typeKind": "interface",
  "typeOverview": "Contains overview, call stacks, usages, and metadata"
}
\`\`\`
`;
      const result = ResponseParser.parse(raw, testSymbol);

      assert.ok(result.functionOutput);
      assert.strictEqual(result.functionOutput!.typeName, 'Promise<AnalysisResult>');
      assert.strictEqual(result.functionOutput!.description, 'The complete analysis result');
      assert.strictEqual(result.functionOutput!.typeFilePath, 'src/models/types.ts');
      assert.strictEqual(result.functionOutput!.typeLine, 97);
      assert.strictEqual(result.functionOutput!.typeKind, 'interface');
      assert.ok(result.functionOutput!.typeOverview);
    });

    test('handles void return type', () => {
      const raw = `\`\`\`json:function_output\n{ "typeName": "void", "description": "No return value" }\n\`\`\`\n`;
      const result = ResponseParser.parse(raw, testSymbol);
      assert.ok(result.functionOutput);
      assert.strictEqual(result.functionOutput!.typeName, 'void');
      assert.strictEqual(result.functionOutput!.typeFilePath, undefined);
    });

    test('returns undefined when no function_output block exists', () => {
      const raw = `### Overview\nA function.\n`;
      const result = ResponseParser.parse(raw, testSymbol);
      assert.strictEqual(result.functionOutput, undefined);
    });

    test('returns undefined for malformed JSON', () => {
      const raw = `\`\`\`json:function_output\n{ broken }\n\`\`\`\n`;
      const result = ResponseParser.parse(raw, testSymbol);
      assert.strictEqual(result.functionOutput, undefined);
    });

    test('returns undefined when typeName is missing', () => {
      const raw = `\`\`\`json:function_output\n{ "description": "something" }\n\`\`\`\n`;
      const result = ResponseParser.parse(raw, testSymbol);
      assert.strictEqual(result.functionOutput, undefined);
    });
  });

  suite('parse — data flow', () => {
    test('extracts data flow entries from json:data_flow block', () => {
      const raw = `### Overview
A variable.

\`\`\`json:data_flow
[
  { "type": "created", "filePath": "src/main.ts", "line": 10, "description": "Created from constructor" },
  { "type": "modified", "filePath": "src/main.ts", "line": 20, "description": "Property .status set" },
  { "type": "passed", "filePath": "src/main.ts", "line": 30, "description": "Passed to validate()" }
]
\`\`\`
`;
      const result = ResponseParser.parse(raw, testSymbol);
      assert.ok(result.dataFlow);
      assert.strictEqual(result.dataFlow!.length, 3);
      assert.strictEqual(result.dataFlow![0].type, 'created');
      assert.strictEqual(result.dataFlow![0].filePath, 'src/main.ts');
      assert.strictEqual(result.dataFlow![0].line, 10);
      assert.strictEqual(result.dataFlow![1].type, 'modified');
      assert.strictEqual(result.dataFlow![2].type, 'passed');
    });

    test('returns empty array when no json:data_flow block exists', () => {
      const raw = `### Overview\nA function.\n`;
      const result = ResponseParser.parse(raw, testSymbol);
      assert.ok(Array.isArray(result.dataFlow));
      assert.strictEqual(result.dataFlow!.length, 0);
    });

    test('handles malformed JSON gracefully', () => {
      const raw = `\`\`\`json:data_flow\n{ broken }\n\`\`\`\n`;
      const result = ResponseParser.parse(raw, testSymbol);
      assert.ok(Array.isArray(result.dataFlow));
      assert.strictEqual(result.dataFlow!.length, 0);
    });
  });

  suite('parse — variable lifecycle', () => {
    test('extracts variable lifecycle from json:variable_lifecycle block', () => {
      const raw = `### Overview
A variable.

\`\`\`json:variable_lifecycle
{
  "declaration": "Declared as const at line 15",
  "initialization": "Initialized from database query",
  "mutations": ["Line 20: status = active", "Line 25: lastLogin = new Date()"],
  "consumption": ["Line 30: passed to validate()"],
  "scopeAndLifetime": "Function-scoped"
}
\`\`\`
`;
      const result = ResponseParser.parse(raw, testSymbol);
      assert.ok(result.variableLifecycle);
      assert.strictEqual(result.variableLifecycle!.declaration, 'Declared as const at line 15');
      assert.strictEqual(result.variableLifecycle!.initialization, 'Initialized from database query');
      assert.strictEqual(result.variableLifecycle!.mutations.length, 2);
      assert.strictEqual(result.variableLifecycle!.consumption.length, 1);
      assert.strictEqual(result.variableLifecycle!.scopeAndLifetime, 'Function-scoped');
    });

    test('returns undefined when no lifecycle data exists', () => {
      const raw = `### Overview\nA function.\n`;
      const result = ResponseParser.parse(raw, testSymbol);
      assert.strictEqual(result.variableLifecycle, undefined);
    });
  });

  suite('parse — class members', () => {
    test('extracts class members from json:class_members block', () => {
      const raw = `### Overview
A class.

\`\`\`json:class_members
[
  {
    "name": "_cache",
    "memberKind": "field",
    "typeName": "Map<string, Result>",
    "visibility": "private",
    "isStatic": false,
    "description": "In-memory cache",
    "line": 15
  },
  {
    "name": "analyze",
    "memberKind": "method",
    "typeName": "() => Promise<void>",
    "visibility": "public",
    "isStatic": false,
    "description": "Main analysis method",
    "line": 42
  }
]
\`\`\`
`;
      const result = ResponseParser.parse(raw, testSymbol);
      assert.ok(result.classMembers);
      assert.strictEqual(result.classMembers!.length, 2);

      const field = result.classMembers![0];
      assert.strictEqual(field.name, '_cache');
      assert.strictEqual(field.memberKind, 'field');
      assert.strictEqual(field.visibility, 'private');
      assert.strictEqual(field.isStatic, false);
      assert.strictEqual(field.line, 15);

      const method = result.classMembers![1];
      assert.strictEqual(method.name, 'analyze');
      assert.strictEqual(method.memberKind, 'method');
      assert.strictEqual(method.visibility, 'public');
    });

    test('returns undefined when no json:class_members block exists', () => {
      const raw = `### Overview\nA function.\n`;
      const result = ResponseParser.parse(raw, testSymbol);
      assert.strictEqual(result.classMembers, undefined);
    });

    test('defaults memberKind and visibility for missing fields', () => {
      const raw = `\`\`\`json:class_members
[
  { "name": "foo", "typeName": "string", "description": "a field" }
]
\`\`\`
`;
      const result = ResponseParser.parse(raw, testSymbol);
      assert.ok(result.classMembers);
      assert.strictEqual(result.classMembers![0].memberKind, 'field');
      assert.strictEqual(result.classMembers![0].visibility, 'public');
      assert.strictEqual(result.classMembers![0].isStatic, false);
    });
  });

  suite('parse — member access', () => {
    test('extracts member access patterns from json:member_access block', () => {
      const raw = `### Overview
A class.

\`\`\`json:member_access
[
  {
    "memberName": "_cache",
    "readBy": ["analyze", "getCached"],
    "writtenBy": ["analyze", "clear"],
    "externalAccess": false
  },
  {
    "memberName": "status",
    "readBy": ["getStatus"],
    "writtenBy": ["setStatus"],
    "externalAccess": true
  }
]
\`\`\`
`;
      const result = ResponseParser.parse(raw, testSymbol);
      assert.ok(result.memberAccess);
      assert.strictEqual(result.memberAccess!.length, 2);

      const cache = result.memberAccess![0];
      assert.strictEqual(cache.memberName, '_cache');
      assert.deepStrictEqual(cache.readBy, ['analyze', 'getCached']);
      assert.deepStrictEqual(cache.writtenBy, ['analyze', 'clear']);
      assert.strictEqual(cache.externalAccess, false);

      const status = result.memberAccess![1];
      assert.strictEqual(status.externalAccess, true);
    });

    test('returns undefined when no json:member_access block exists', () => {
      const raw = `### Overview\nA function.\n`;
      const result = ResponseParser.parse(raw, testSymbol);
      assert.strictEqual(result.memberAccess, undefined);
    });
  });
});
