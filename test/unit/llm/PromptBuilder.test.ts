/**
 * Code Explorer — Unit Tests for PromptBuilder
 *
 * Tests that PromptBuilder routes to the correct strategy
 * based on symbol kind and includes appropriate context.
 */
import * as assert from 'assert';
import { PromptBuilder } from '../../../src/llm/PromptBuilder';
import { FunctionPromptStrategy } from '../../../src/llm/prompts/FunctionPromptStrategy';
import { VariablePromptStrategy } from '../../../src/llm/prompts/VariablePromptStrategy';
import { ClassPromptStrategy } from '../../../src/llm/prompts/ClassPromptStrategy';
import { PropertyPromptStrategy } from '../../../src/llm/prompts/PropertyPromptStrategy';
import type { SymbolInfo, CursorContext } from '../../../src/models/types';

suite('PromptBuilder', () => {
  suite('strategy routing', () => {
    test('uses FunctionPromptStrategy for function symbols', () => {
      const strategy = PromptBuilder.getStrategy('function');
      assert.ok(strategy instanceof FunctionPromptStrategy);
    });

    test('uses FunctionPromptStrategy for method symbols', () => {
      const strategy = PromptBuilder.getStrategy('method');
      assert.ok(strategy instanceof FunctionPromptStrategy);
    });

    test('uses VariablePromptStrategy for variable symbols', () => {
      const strategy = PromptBuilder.getStrategy('variable');
      assert.ok(strategy instanceof VariablePromptStrategy);
    });

    test('uses ClassPromptStrategy for class symbols', () => {
      const strategy = PromptBuilder.getStrategy('class');
      assert.ok(strategy instanceof ClassPromptStrategy);
    });

    test('uses ClassPromptStrategy for interface symbols', () => {
      const strategy = PromptBuilder.getStrategy('interface');
      assert.ok(strategy instanceof ClassPromptStrategy);
    });

    test('uses ClassPromptStrategy for struct symbols', () => {
      const strategy = PromptBuilder.getStrategy('struct');
      assert.ok(strategy instanceof ClassPromptStrategy);
    });

    test('uses ClassPromptStrategy for enum symbols', () => {
      const strategy = PromptBuilder.getStrategy('enum');
      assert.ok(strategy instanceof ClassPromptStrategy);
    });

    test('uses PropertyPromptStrategy for property symbols', () => {
      const strategy = PromptBuilder.getStrategy('property');
      assert.ok(strategy instanceof PropertyPromptStrategy);
    });

    test('falls back to FunctionPromptStrategy for unknown kinds', () => {
      const strategy = PromptBuilder.getStrategy('unknown');
      assert.ok(strategy instanceof FunctionPromptStrategy);
    });
  });

  suite('build — variable prompt', () => {
    test('includes variable lifecycle and data flow sections', () => {
      const symbol: SymbolInfo = {
        name: 'userCount',
        kind: 'variable',
        filePath: 'src/main.ts',
        position: { line: 10, character: 0 },
        scopeChain: ['processUsers'],
      };
      const prompt = PromptBuilder.build(symbol, 'const userCount = 0;');
      assert.ok(prompt.includes('Variable Lifecycle'));
      assert.ok(prompt.includes('Data Flow'));
      assert.ok(prompt.includes('variable/constant analysis'));
      assert.ok(prompt.includes('json:variable_lifecycle'));
      assert.ok(prompt.includes('json:data_flow'));
    });

    test('includes containing scope source when provided', () => {
      const symbol: SymbolInfo = {
        name: 'result',
        kind: 'variable',
        filePath: 'src/main.ts',
        position: { line: 5, character: 0 },
        scopeChain: ['calculate'],
      };
      const prompt = PromptBuilder.build(symbol, 'const result = 0;', 'function calculate() { const result = 0; return result; }');
      assert.ok(prompt.includes('Containing Scope'));
      assert.ok(prompt.includes('function calculate'));
    });
  });

  suite('build — class prompt', () => {
    test('includes class members and member access sections', () => {
      const symbol: SymbolInfo = {
        name: 'UserService',
        kind: 'class',
        filePath: 'src/services/UserService.ts',
        position: { line: 5, character: 0 },
      };
      const prompt = PromptBuilder.build(symbol, 'class UserService {}');
      assert.ok(prompt.includes('Class Members'));
      assert.ok(prompt.includes('Member Access Patterns'));
      assert.ok(prompt.includes('class/data structure analysis'));
      assert.ok(prompt.includes('json:class_members'));
      assert.ok(prompt.includes('json:member_access'));
    });
  });

  suite('build — property prompt', () => {
    test('includes member access and variable lifecycle sections', () => {
      const symbol: SymbolInfo = {
        name: '_cache',
        kind: 'property',
        filePath: 'src/cache/CacheStore.ts',
        position: { line: 15, character: 2 },
        scopeChain: ['CacheStore'],
        containerName: 'CacheStore',
      };
      const prompt = PromptBuilder.build(symbol, 'private _cache: Map<string, any>;');
      assert.ok(prompt.includes('Member Access Patterns'));
      assert.ok(prompt.includes('Variable Lifecycle'));
      assert.ok(prompt.includes('class member/property analysis'));
      assert.ok(prompt.includes('json:member_access'));
      assert.ok(prompt.includes('json:variable_lifecycle'));
    });

    test('includes containing class name', () => {
      const symbol: SymbolInfo = {
        name: '_data',
        kind: 'property',
        filePath: 'src/store.ts',
        position: { line: 10, character: 2 },
        scopeChain: ['DataStore'],
        containerName: 'DataStore',
      };
      const prompt = PromptBuilder.build(symbol, 'private _data: any[];');
      assert.ok(prompt.includes('Containing class: DataStore'));
    });
  });

  suite('build — function prompt', () => {
    test('includes step-by-step and sub-functions sections', () => {
      const symbol: SymbolInfo = {
        name: 'processUser',
        kind: 'function',
        filePath: 'src/main.ts',
        position: { line: 1, character: 0 },
      };
      const prompt = PromptBuilder.build(symbol, 'function processUser() {}');
      assert.ok(prompt.includes('Step-by-Step Breakdown'));
      assert.ok(prompt.includes('Sub-Functions'));
      assert.ok(prompt.includes('Function Input'));
      assert.ok(prompt.includes('Function Output'));
      assert.ok(prompt.includes('json:steps'));
      assert.ok(prompt.includes('json:subfunctions'));
    });
  });

  suite('buildUnified', () => {
    test('includes symbol identification section', () => {
      const cursor: CursorContext = {
        word: 'processUser',
        filePath: 'src/main.ts',
        position: { line: 10, character: 5 },
        surroundingSource: 'function processUser(user: User) { return user.name; }',
        cursorLine: 'function processUser(user: User) { return user.name; }',
      };
      const prompt = PromptBuilder.buildUnified(cursor);
      assert.ok(prompt.includes('json:symbol_identity'));
      assert.ok(prompt.includes('processUser'));
      assert.ok(prompt.includes('Symbol Identification'));
    });

    test('includes all analysis sections for any symbol kind', () => {
      const cursor: CursorContext = {
        word: 'myVar',
        filePath: 'src/store.ts',
        position: { line: 5, character: 0 },
        surroundingSource: 'const myVar = 42;',
        cursorLine: 'const myVar = 42;',
      };
      const prompt = PromptBuilder.buildUnified(cursor);
      assert.ok(prompt.includes('json:steps'));
      assert.ok(prompt.includes('json:subfunctions'));
      assert.ok(prompt.includes('json:function_inputs'));
      assert.ok(prompt.includes('json:function_output'));
      assert.ok(prompt.includes('json:class_members'));
      assert.ok(prompt.includes('json:member_access'));
      assert.ok(prompt.includes('json:variable_lifecycle'));
      assert.ok(prompt.includes('json:data_flow'));
      assert.ok(prompt.includes('json:callers'));
      assert.ok(prompt.includes('json:related_symbols'));
      assert.ok(prompt.includes('json:related_symbol_analyses'));
    });

    test('includes cache file naming convention instructions', () => {
      const cursor: CursorContext = {
        word: 'foo',
        filePath: 'src/foo.ts',
        position: { line: 0, character: 0 },
        surroundingSource: 'function foo() {}',
        cursorLine: 'function foo() {}',
      };
      const prompt = PromptBuilder.buildUnified(cursor, '/workspace/.vscode/code-explorer');
      assert.ok(prompt.includes('Cache File Naming Convention'));
      assert.ok(prompt.includes('kind_prefix'));
      assert.ok(prompt.includes('/workspace/.vscode/code-explorer'));
    });

    test('includes surrounding source code in the prompt', () => {
      const source = 'class MyClass {\n  getValue() { return 42; }\n}';
      const cursor: CursorContext = {
        word: 'getValue',
        filePath: 'src/myclass.ts',
        position: { line: 1, character: 2 },
        surroundingSource: source,
        cursorLine: '  getValue() { return 42; }',
      };
      const prompt = PromptBuilder.buildUnified(cursor);
      assert.ok(prompt.includes(source));
      assert.ok(prompt.includes('getValue() { return 42; }'));
    });
  });
});
