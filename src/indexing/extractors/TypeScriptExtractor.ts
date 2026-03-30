/**
 * Code Explorer — TypeScript Symbol Extractor
 *
 * Extracts symbol definitions from TypeScript/JavaScript AST nodes
 * produced by tree-sitter-typescript. Handles classes, interfaces,
 * functions, methods, properties, variables, types, enums, and
 * local variables with full scope chain tracking.
 */
import type Parser from 'tree-sitter';
import type { SymbolKindType } from '../../models/types';
import { BaseExtractor, type RawExtractedSymbol } from './BaseExtractor';

/**
 * Extracts symbols from TypeScript/JavaScript source files.
 */
export class TypeScriptExtractor extends BaseExtractor {
  /**
   * Walk the TypeScript AST and extract all symbol definitions.
   */
  protected extractRaw(rootNode: Parser.SyntaxNode, _filePath: string): RawExtractedSymbol[] {
    return this._walkNode(rootNode, [], false);
  }

  /**
   * Extract and normalize the parameter type list from a TS function/method node.
   */
  protected extractParamSignature(node: Parser.SyntaxNode): string | null {
    const params = node.childForFieldName('parameters');
    if (!params) {
      return '';
    }

    const types: string[] = [];
    for (let i = 0; i < params.childCount; i++) {
      const child = params.child(i);
      if (!child) {
        continue;
      }

      if (child.type === 'required_parameter' || child.type === 'optional_parameter') {
        const typeAnnotation = child.childForFieldName('type');
        if (typeAnnotation) {
          // type annotation is a type_annotation node whose child is the actual type
          types.push(this._normalizeType(this._extractTypeText(typeAnnotation)));
        } else {
          // No type annotation — use "any" as placeholder
          types.push('any');
        }
      } else if (child.type === 'rest_parameter') {
        const typeAnnotation = child.childForFieldName('type');
        if (typeAnnotation) {
          types.push('...' + this._normalizeType(this._extractTypeText(typeAnnotation)));
        } else {
          types.push('...any');
        }
      }
    }

    return types.join(',');
  }

  /**
   * Recursively walk AST nodes and extract symbols.
   */
  private _walkNode(
    node: Parser.SyntaxNode,
    scopeChain: string[],
    isInsideFunction: boolean
  ): RawExtractedSymbol[] {
    const symbols: RawExtractedSymbol[] = [];

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child) {
        continue;
      }

      switch (child.type) {
        case 'function_declaration':
          symbols.push(...this._handleFunctionDeclaration(child, scopeChain, isInsideFunction));
          break;

        case 'class_declaration':
          symbols.push(...this._handleClassDeclaration(child, scopeChain, isInsideFunction));
          break;

        case 'abstract_class_declaration':
          symbols.push(...this._handleClassDeclaration(child, scopeChain, isInsideFunction));
          break;

        case 'interface_declaration':
          symbols.push(...this._handleInterfaceDeclaration(child, scopeChain, isInsideFunction));
          break;

        case 'type_alias_declaration':
          symbols.push(...this._handleTypeAlias(child, scopeChain, isInsideFunction));
          break;

        case 'enum_declaration':
          symbols.push(...this._handleEnumDeclaration(child, scopeChain, isInsideFunction));
          break;

        case 'method_definition':
          symbols.push(...this._handleMethodDefinition(child, scopeChain, isInsideFunction));
          break;

        case 'public_field_definition':
          symbols.push(...this._handleFieldDefinition(child, scopeChain));
          break;

        case 'lexical_declaration':
        case 'variable_declaration':
          symbols.push(...this._handleVariableDeclaration(child, scopeChain, isInsideFunction));
          break;

        case 'export_statement':
          // Recurse into export to get the actual declaration
          symbols.push(...this._walkNode(child, scopeChain, isInsideFunction));
          break;

        case 'ambient_declaration':
          // declare module / declare function / etc.
          symbols.push(...this._walkNode(child, scopeChain, isInsideFunction));
          break;

        case 'module':
          // TypeScript namespace/module declaration
          symbols.push(...this._handleModule(child, scopeChain, isInsideFunction));
          break;

        default:
          // Recurse into compound nodes that may contain declarations
          if (child.childCount > 0 && this._isCompoundNode(child.type)) {
            symbols.push(...this._walkNode(child, scopeChain, isInsideFunction));
          }
          break;
      }
    }

    return symbols;
  }

  /**
   * Handle function declarations.
   */
  private _handleFunctionDeclaration(
    node: Parser.SyntaxNode,
    scopeChain: string[],
    isInsideFunction: boolean
  ): RawExtractedSymbol[] {
    const symbols: RawExtractedSymbol[] = [];
    const nameNode = node.childForFieldName('name');

    if (!nameNode) {
      return symbols;
    }

    const name = nameNode.text;
    const paramSig = this.extractParamSignature(node);

    symbols.push({
      name,
      kind: 'function',
      startLine: node.startPosition.row,
      endLine: node.endPosition.row,
      startColumn: node.startPosition.column,
      scopeChain: [...scopeChain],
      paramSignature: paramSig,
      isLocal: isInsideFunction,
    });

    // Recurse into function body
    const body = node.childForFieldName('body');
    if (body) {
      symbols.push(...this._walkNode(body, [...scopeChain, name], true));
    }

    return symbols;
  }

  /**
   * Handle class declarations (including abstract classes).
   */
  private _handleClassDeclaration(
    node: Parser.SyntaxNode,
    scopeChain: string[],
    isInsideFunction: boolean
  ): RawExtractedSymbol[] {
    const symbols: RawExtractedSymbol[] = [];
    const nameNode = node.childForFieldName('name');

    if (!nameNode) {
      return symbols;
    }

    const name = nameNode.text;

    symbols.push({
      name,
      kind: 'class',
      startLine: node.startPosition.row,
      endLine: node.endPosition.row,
      startColumn: node.startPosition.column,
      scopeChain: [...scopeChain],
      paramSignature: null,
      isLocal: isInsideFunction,
    });

    // Recurse into class body
    const body = node.childForFieldName('body');
    if (body) {
      symbols.push(...this._walkNode(body, [...scopeChain, name], isInsideFunction));
    }

    return symbols;
  }

  /**
   * Handle interface declarations.
   */
  private _handleInterfaceDeclaration(
    node: Parser.SyntaxNode,
    scopeChain: string[],
    isInsideFunction: boolean
  ): RawExtractedSymbol[] {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {
      return [];
    }

    return [
      {
        name: nameNode.text,
        kind: 'interface',
        startLine: node.startPosition.row,
        endLine: node.endPosition.row,
        startColumn: node.startPosition.column,
        scopeChain: [...scopeChain],
        paramSignature: null,
        isLocal: isInsideFunction,
      },
    ];
  }

  /**
   * Handle type alias declarations.
   */
  private _handleTypeAlias(
    node: Parser.SyntaxNode,
    scopeChain: string[],
    isInsideFunction: boolean
  ): RawExtractedSymbol[] {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {
      return [];
    }

    return [
      {
        name: nameNode.text,
        kind: 'type',
        startLine: node.startPosition.row,
        endLine: node.endPosition.row,
        startColumn: node.startPosition.column,
        scopeChain: [...scopeChain],
        paramSignature: null,
        isLocal: isInsideFunction,
      },
    ];
  }

  /**
   * Handle enum declarations.
   */
  private _handleEnumDeclaration(
    node: Parser.SyntaxNode,
    scopeChain: string[],
    isInsideFunction: boolean
  ): RawExtractedSymbol[] {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {
      return [];
    }

    return [
      {
        name: nameNode.text,
        kind: 'enum',
        startLine: node.startPosition.row,
        endLine: node.endPosition.row,
        startColumn: node.startPosition.column,
        scopeChain: [...scopeChain],
        paramSignature: null,
        isLocal: isInsideFunction,
      },
    ];
  }

  /**
   * Handle method definitions inside class bodies.
   */
  private _handleMethodDefinition(
    node: Parser.SyntaxNode,
    scopeChain: string[],
    isInsideFunction: boolean
  ): RawExtractedSymbol[] {
    const symbols: RawExtractedSymbol[] = [];
    const nameNode = node.childForFieldName('name');

    if (!nameNode) {
      return symbols;
    }

    const name = nameNode.text;
    const paramSig = this.extractParamSignature(node);

    // Determine if this is a constructor, getter, setter, or regular method
    let kind: SymbolKindType = 'method';
    if (name === 'constructor') {
      kind = 'method'; // Keep as method for simplicity
    }

    // Check for getter/setter
    for (let j = 0; j < node.childCount; j++) {
      const modifier = node.child(j);
      if (modifier && modifier.type === 'get') {
        kind = 'property'; // Treat getters as properties
        break;
      }
      if (modifier && modifier.type === 'set') {
        kind = 'property'; // Treat setters as properties
        break;
      }
    }

    symbols.push({
      name,
      kind,
      startLine: node.startPosition.row,
      endLine: node.endPosition.row,
      startColumn: node.startPosition.column,
      scopeChain: [...scopeChain],
      paramSignature: paramSig,
      isLocal: isInsideFunction,
    });

    // Recurse into method body
    const body = node.childForFieldName('body');
    if (body) {
      symbols.push(...this._walkNode(body, [...scopeChain, name], true));
    }

    return symbols;
  }

  /**
   * Handle field (property) definitions inside class bodies.
   */
  private _handleFieldDefinition(
    node: Parser.SyntaxNode,
    scopeChain: string[]
  ): RawExtractedSymbol[] {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {
      return [];
    }

    return [
      {
        name: nameNode.text,
        kind: 'property',
        startLine: node.startPosition.row,
        endLine: node.endPosition.row,
        startColumn: node.startPosition.column,
        scopeChain: [...scopeChain],
        paramSignature: null,
        isLocal: false,
      },
    ];
  }

  /**
   * Handle variable declarations (const, let, var).
   */
  private _handleVariableDeclaration(
    node: Parser.SyntaxNode,
    scopeChain: string[],
    isInsideFunction: boolean
  ): RawExtractedSymbol[] {
    const symbols: RawExtractedSymbol[] = [];

    for (let j = 0; j < node.childCount; j++) {
      const declarator = node.child(j);
      if (declarator && declarator.type === 'variable_declarator') {
        const nameNode = declarator.childForFieldName('name');
        if (nameNode) {
          // Check if the value is an arrow function or function expression
          const value = declarator.childForFieldName('value');
          if (value && (value.type === 'arrow_function' || value.type === 'function')) {
            // It's a function assigned to a variable — treat as function
            const paramSig = this.extractParamSignature(value);
            symbols.push({
              name: nameNode.text,
              kind: 'function',
              startLine: node.startPosition.row,
              endLine: node.endPosition.row,
              startColumn: node.startPosition.column,
              scopeChain: [...scopeChain],
              paramSignature: paramSig,
              isLocal: isInsideFunction,
            });

            // Recurse into function body
            const body = value.childForFieldName('body');
            if (body) {
              symbols.push(...this._walkNode(body, [...scopeChain, nameNode.text], true));
            }
          } else {
            symbols.push({
              name: nameNode.text,
              kind: 'variable',
              startLine: node.startPosition.row,
              endLine: node.endPosition.row,
              startColumn: node.startPosition.column,
              scopeChain: [...scopeChain],
              paramSignature: null,
              isLocal: isInsideFunction,
            });
          }
        }
      }
    }

    return symbols;
  }

  /**
   * Handle TypeScript module/namespace declarations.
   */
  private _handleModule(
    node: Parser.SyntaxNode,
    scopeChain: string[],
    isInsideFunction: boolean
  ): RawExtractedSymbol[] {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {
      return [];
    }

    const name = nameNode.text;
    const body = node.childForFieldName('body');
    if (body) {
      return this._walkNode(body, [...scopeChain, name], isInsideFunction);
    }
    return [];
  }

  // ────────────── Helpers ──────────────

  /**
   * Extract type text from a type_annotation node.
   */
  private _extractTypeText(node: Parser.SyntaxNode): string {
    // type_annotation has format ": Type"
    // We want just the type part
    if (node.type === 'type_annotation') {
      // Skip the ":" child and get the type
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child && child.type !== ':') {
          return child.text;
        }
      }
      return node.text;
    }
    return node.text;
  }

  /**
   * Normalize a TypeScript type string.
   */
  private _normalizeType(typeText: string): string {
    return typeText.replace(/\s+/g, ' ').trim();
  }

  /**
   * Check if a node type is a compound node that may contain declarations.
   */
  private _isCompoundNode(nodeType: string): boolean {
    const compound = new Set([
      'program',
      'statement_block',
      'class_body',
      'object',
      'switch_body',
      'if_statement',
      'else_clause',
      'for_statement',
      'for_in_statement',
      'while_statement',
      'do_statement',
      'try_statement',
      'catch_clause',
      'finally_clause',
      'switch_case',
      'switch_default',
      'export_statement',
      'ambient_declaration',
      'internal_module',
      'module',
    ]);
    return compound.has(nodeType);
  }
}
