/**
 * Code Explorer — Unit Tests for Data Models (types.ts)
 *
 * Validates that all type interfaces are properly defined
 * and can be instantiated correctly.
 */
import * as assert from 'assert';
import {
  SYMBOL_KIND_PREFIX,
  type SymbolKindType,
  type SymbolInfo,
  type CursorContext,
  type AnalysisResult,
  type CallStackEntry,
  type UsageEntry,
  type DataFlowEntry,
  type RelationshipEntry,
  type MasterIndex,
  type IndexEntry,
  type FileIndexEntry,
  type TabState,
  type ExplorerState,
  type LLMAnalysisRequest,
  type ProviderCapabilities,
  type CodeContext,
  type QueuedAnalysis,
  type ClassMemberInfo,
  type MemberAccessInfo,
  type VariableLifecycle,
} from '../../../src/models/types';

suite('Data Models', () => {
  suite('SYMBOL_KIND_PREFIX', () => {
    test('maps all SymbolKindType values to prefixes', () => {
      const expectedKinds: SymbolKindType[] = [
        'class',
        'function',
        'method',
        'variable',
        'interface',
        'type',
        'enum',
        'property',
        'parameter',
        'struct',
        'unknown',
      ];
      for (const kind of expectedKinds) {
        assert.ok(SYMBOL_KIND_PREFIX[kind] !== undefined, `Missing prefix for kind: ${kind}`);
        assert.strictEqual(typeof SYMBOL_KIND_PREFIX[kind], 'string');
      }
    });

    test('has expected prefix values', () => {
      assert.strictEqual(SYMBOL_KIND_PREFIX.class, 'class');
      assert.strictEqual(SYMBOL_KIND_PREFIX.function, 'fn');
      assert.strictEqual(SYMBOL_KIND_PREFIX.method, 'method');
      assert.strictEqual(SYMBOL_KIND_PREFIX.variable, 'var');
      assert.strictEqual(SYMBOL_KIND_PREFIX.interface, 'interface');
      assert.strictEqual(SYMBOL_KIND_PREFIX.type, 'type');
      assert.strictEqual(SYMBOL_KIND_PREFIX.enum, 'enum');
      assert.strictEqual(SYMBOL_KIND_PREFIX.property, 'prop');
      assert.strictEqual(SYMBOL_KIND_PREFIX.parameter, 'param');
      assert.strictEqual(SYMBOL_KIND_PREFIX.struct, 'struct');
      assert.strictEqual(SYMBOL_KIND_PREFIX.unknown, 'sym');
    });
  });

  suite('SymbolInfo', () => {
    test('can be created with required fields', () => {
      const symbol: SymbolInfo = {
        name: 'UserController',
        kind: 'class',
        filePath: 'src/controllers/UserController.ts',
        position: { line: 15, character: 0 },
      };
      assert.strictEqual(symbol.name, 'UserController');
      assert.strictEqual(symbol.kind, 'class');
      assert.strictEqual(symbol.filePath, 'src/controllers/UserController.ts');
      assert.strictEqual(symbol.position.line, 15);
    });

    test('can be created with optional fields', () => {
      const symbol: SymbolInfo = {
        name: 'getUser',
        kind: 'method',
        filePath: 'src/controllers/UserController.ts',
        position: { line: 42, character: 2 },
        range: {
          start: { line: 42, character: 2 },
          end: { line: 55, character: 3 },
        },
        containerName: 'UserController',
      };
      assert.strictEqual(symbol.containerName, 'UserController');
      assert.ok(symbol.range);
      assert.strictEqual(symbol.range.start.line, 42);
    });
  });

  suite('AnalysisResult', () => {
    test('can be created with all required fields', () => {
      const result: AnalysisResult = {
        symbol: {
          name: 'UserController',
          kind: 'class',
          filePath: 'src/controllers/UserController.ts',
          position: { line: 15, character: 0 },
        },
        overview: 'Handles user-related HTTP endpoints.',
        callStacks: [],
        usages: [],
        dataFlow: [],
        relationships: [],
        metadata: {
          analyzedAt: '2026-03-28T10:30:00Z',
          sourceHash: 'sha256:abc123',
          dependentFileHashes: {},
          analysisVersion: '1.0.0',
          stale: false,
        },
      };
      assert.strictEqual(result.overview, 'Handles user-related HTTP endpoints.');
      assert.strictEqual(result.callStacks.length, 0);
      assert.strictEqual(result.metadata.stale, false);
    });
  });

  suite('CallStackEntry', () => {
    test('can represent a call hierarchy entry', () => {
      const entry: CallStackEntry = {
        caller: {
          name: 'handleRequest',
          filePath: 'src/routes/user.ts',
          line: 15,
          kind: 'function',
        },
        callSites: [{ line: 15, character: 10 }],
        depth: 0,
        chain: 'routes/user.ts:15 → UserController.getUser()',
      };
      assert.strictEqual(entry.caller.name, 'handleRequest');
      assert.strictEqual(entry.depth, 0);
    });
  });

  suite('UsageEntry', () => {
    test('can represent a reference', () => {
      const usage: UsageEntry = {
        filePath: 'src/routes/user.ts',
        line: 8,
        character: 20,
        contextLine: 'const controller = new UserController(service)',
        isDefinition: false,
      };
      assert.strictEqual(usage.isDefinition, false);
      assert.ok(usage.contextLine.includes('UserController'));
    });
  });

  suite('DataFlowEntry', () => {
    test('supports all data flow types', () => {
      const types: DataFlowEntry['type'][] = [
        'created',
        'assigned',
        'read',
        'modified',
        'consumed',
        'returned',
        'passed',
      ];
      for (const t of types) {
        const entry: DataFlowEntry = {
          type: t,
          filePath: 'src/test.ts',
          line: 1,
          description: `Data is ${t}`,
        };
        assert.strictEqual(entry.type, t);
      }
    });
  });

  suite('RelationshipEntry', () => {
    test('supports all relationship types', () => {
      const types: RelationshipEntry['type'][] = [
        'extends',
        'implements',
        'uses',
        'used-by',
        'extended-by',
        'implemented-by',
        'imports',
        'imported-by',
      ];
      for (const t of types) {
        const entry: RelationshipEntry = {
          type: t,
          targetName: 'BaseClass',
          targetFilePath: 'src/base.ts',
          targetLine: 1,
        };
        assert.strictEqual(entry.type, t);
      }
    });
  });

  suite('MasterIndex', () => {
    test('can represent an empty index', () => {
      const index: MasterIndex = {
        version: '1.0.0',
        lastUpdated: '2026-03-28T10:00:00Z',
        symbolCount: 0,
        entries: {},
        fileIndex: {},
      };
      assert.strictEqual(index.symbolCount, 0);
      assert.strictEqual(Object.keys(index.entries).length, 0);
    });

    test('can represent an index with entries', () => {
      const entry: IndexEntry = {
        name: 'UserController',
        kind: 'class',
        file: 'src/controllers/UserController.ts',
        cachePath: 'src/controllers/UserController.ts/class.UserController.md',
        analyzedAt: '2026-03-28T10:30:00Z',
        sourceHash: 'sha256:abc123',
        stale: false,
      };
      const fileEntry: FileIndexEntry = {
        hash: 'sha256:abc123',
        symbols: ['class.UserController'],
        lastAnalyzed: '2026-03-28T10:30:00Z',
      };
      const index: MasterIndex = {
        version: '1.0.0',
        lastUpdated: '2026-03-28T10:30:00Z',
        symbolCount: 1,
        entries: {
          'src/controllers/UserController.ts::class.UserController': entry,
        },
        fileIndex: {
          'src/controllers/UserController.ts': fileEntry,
        },
      };
      assert.strictEqual(index.symbolCount, 1);
      assert.strictEqual(
        index.entries['src/controllers/UserController.ts::class.UserController'].name,
        'UserController'
      );
    });
  });

  suite('TabState', () => {
    test('supports all status values', () => {
      const statuses: TabState['status'][] = ['loading', 'ready', 'error', 'stale'];
      for (const status of statuses) {
        const tab: TabState = {
          id: 'tab-1',
          symbol: {
            name: 'Test',
            kind: 'class',
            filePath: 'test.ts',
            position: { line: 0, character: 0 },
          },
          status,
          analysis: null,
        };
        assert.strictEqual(tab.status, status);
      }
    });
  });

  suite('ExplorerState', () => {
    test('can represent empty state', () => {
      const state: ExplorerState = {
        tabs: [],
        activeTabId: null,
      };
      assert.strictEqual(state.tabs.length, 0);
      assert.strictEqual(state.activeTabId, null);
    });
  });

  suite('LLM Types', () => {
    test('LLMAnalysisRequest can be created', () => {
      const request: LLMAnalysisRequest = {
        prompt: 'Analyze this class',
        systemPrompt: 'You are a code analyst',
        maxTokens: 4096,
        temperature: 0.3,
      };
      assert.strictEqual(request.prompt, 'Analyze this class');
    });

    test('ProviderCapabilities can be created', () => {
      const caps: ProviderCapabilities = {
        maxContextTokens: 100000,
        supportsStreaming: false,
        costPerMTokenInput: 3.0,
        costPerMTokenOutput: 15.0,
      };
      assert.strictEqual(caps.maxContextTokens, 100000);
    });

    test('CodeContext can be created', () => {
      const ctx: CodeContext = {
        sourceCode: 'class Foo {}',
        relatedFiles: [{ path: 'bar.ts', content: 'export class Bar {}' }],
        references: [],
        callHierarchy: [],
      };
      assert.strictEqual(ctx.relatedFiles.length, 1);
    });
  });

  suite('QueuedAnalysis', () => {
    test('can be created with executor', () => {
      const analysis: QueuedAnalysis = {
        symbolKey: 'src/test.ts::class.Foo',
        priority: 10,
        executor: async () => ({
          symbol: {
            name: 'Foo',
            kind: 'class',
            filePath: 'src/test.ts',
            position: { line: 0, character: 0 },
          },
          overview: '',
          callStacks: [],
          usages: [],
          dataFlow: [],
          relationships: [],
          metadata: {
            analyzedAt: '',
            sourceHash: '',
            dependentFileHashes: {},
            analysisVersion: '1.0.0',
            stale: false,
          },
        }),
        retryCount: 0,
        maxRetries: 2,
      };
      assert.strictEqual(analysis.priority, 10);
      assert.strictEqual(analysis.retryCount, 0);
    });
  });

  suite('ClassMemberInfo', () => {
    test('can represent a class field', () => {
      const member: ClassMemberInfo = {
        name: '_cache',
        memberKind: 'field',
        typeName: 'Map<string, any>',
        visibility: 'private',
        isStatic: false,
        description: 'In-memory cache',
        line: 15,
      };
      assert.strictEqual(member.name, '_cache');
      assert.strictEqual(member.memberKind, 'field');
      assert.strictEqual(member.visibility, 'private');
      assert.strictEqual(member.isStatic, false);
    });

    test('can represent a static method', () => {
      const member: ClassMemberInfo = {
        name: 'getInstance',
        memberKind: 'method',
        typeName: '() => Singleton',
        visibility: 'public',
        isStatic: true,
        description: 'Returns the singleton instance',
      };
      assert.strictEqual(member.isStatic, true);
      assert.strictEqual(member.memberKind, 'method');
    });

    test('supports all member kinds', () => {
      const kinds: ClassMemberInfo['memberKind'][] = [
        'field', 'method', 'property', 'constructor', 'getter', 'setter',
      ];
      for (const kind of kinds) {
        const member: ClassMemberInfo = {
          name: 'test',
          memberKind: kind,
          typeName: 'any',
          visibility: 'public',
          isStatic: false,
          description: `A ${kind}`,
        };
        assert.strictEqual(member.memberKind, kind);
      }
    });
  });

  suite('MemberAccessInfo', () => {
    test('can track read and write access', () => {
      const access: MemberAccessInfo = {
        memberName: '_data',
        readBy: ['getData', 'toString'],
        writtenBy: ['setData', 'constructor'],
        externalAccess: false,
      };
      assert.strictEqual(access.memberName, '_data');
      assert.strictEqual(access.readBy.length, 2);
      assert.strictEqual(access.writtenBy.length, 2);
      assert.strictEqual(access.externalAccess, false);
    });

    test('can indicate external access', () => {
      const access: MemberAccessInfo = {
        memberName: 'status',
        readBy: ['getStatus'],
        writtenBy: [],
        externalAccess: true,
      };
      assert.strictEqual(access.externalAccess, true);
    });
  });

  suite('VariableLifecycle', () => {
    test('can represent a complete lifecycle', () => {
      const lifecycle: VariableLifecycle = {
        declaration: 'const at line 10',
        initialization: 'From constructor',
        mutations: ['Line 20: push()', 'Line 30: splice()'],
        consumption: ['Line 40: passed to validate()'],
        scopeAndLifetime: 'Function-scoped',
      };
      assert.strictEqual(lifecycle.declaration, 'const at line 10');
      assert.strictEqual(lifecycle.mutations.length, 2);
      assert.strictEqual(lifecycle.consumption.length, 1);
    });
  });

  suite('CursorContext', () => {
    test('can be created with all fields', () => {
      const cursor: CursorContext = {
        word: 'processUser',
        filePath: 'src/main.ts',
        position: { line: 10, character: 5 },
        surroundingSource: 'function processUser(user: User) { return user.name; }',
        cursorLine: 'function processUser(user: User) { return user.name; }',
      };
      assert.strictEqual(cursor.word, 'processUser');
      assert.strictEqual(cursor.filePath, 'src/main.ts');
      assert.strictEqual(cursor.position.line, 10);
      assert.strictEqual(cursor.position.character, 5);
      assert.ok(cursor.surroundingSource.length > 0);
      assert.ok(cursor.cursorLine.length > 0);
    });
  });
});
