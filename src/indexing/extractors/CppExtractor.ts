/**
 * Code Explorer — C++ Symbol Extractor
 *
 * Extracts symbol definitions from C++ AST nodes produced by tree-sitter-cpp.
 * Handles namespaces, classes, structs, functions, methods, variables,
 * enums, and local variables with full scope chain tracking.
 */
import type Parser from 'tree-sitter';
import type { SymbolKindType } from '../../models/types';
import { BaseExtractor, type RawExtractedSymbol } from './BaseExtractor';

/**
 * Extracts symbols from C++ source files parsed by tree-sitter-cpp.
 */
export class CppExtractor extends BaseExtractor {
  /**
   * Walk the C++ AST and extract all symbol definitions.
   */
  protected extractRaw(
    rootNode: Parser.SyntaxNode,
    _filePath: string
  ): RawExtractedSymbol[] {
    return this._walkNode(rootNode, [], false);
  }

  /**
   * Extract and normalize the parameter type list from a C++ function node.
   */
  protected extractParamSignature(node: Parser.SyntaxNode): string | null {
    // Find the parameter_list child
    const paramList = this._findParameterList(node);
    if (!paramList) {
      return '';
    }

    const types: string[] = [];
    for (let i = 0; i < paramList.childCount; i++) {
      const child = paramList.child(i);
      if (child && child.type === 'parameter_declaration') {
        const typeNode = child.childForFieldName('type');
        if (typeNode) {
          let typeText = typeNode.text;

          // Include qualifiers and declarator modifiers (const, &, *, etc.)
          const declarator = child.childForFieldName('declarator');
          if (declarator) {
            if (declarator.type === 'reference_declarator') {
              typeText += '&';
            } else if (declarator.type === 'pointer_declarator') {
              typeText += '*';
            } else if (declarator.type === 'abstract_reference_declarator') {
              typeText += '&';
            } else if (declarator.type === 'abstract_pointer_declarator') {
              typeText += '*';
            }
          }

          // Check for const qualifier
          for (let j = 0; j < child.childCount; j++) {
            const qualifier = child.child(j);
            if (qualifier && qualifier.type === 'type_qualifier' && qualifier.text === 'const') {
              if (!typeText.startsWith('const ')) {
                typeText = 'const ' + typeText;
              }
            }
          }

          types.push(this._normalizeType(typeText));
        }
      } else if (child && child.type === 'variadic_parameter') {
        types.push('...');
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
        case 'namespace_definition':
          symbols.push(...this._handleNamespace(child, scopeChain, isInsideFunction));
          break;

        case 'class_specifier':
        case 'struct_specifier':
          symbols.push(...this._handleClassOrStruct(child, scopeChain, isInsideFunction));
          break;

        case 'function_definition':
          symbols.push(...this._handleFunctionDefinition(child, scopeChain, isInsideFunction));
          break;

        case 'declaration':
          symbols.push(...this._handleDeclaration(child, scopeChain, isInsideFunction));
          break;

        case 'enum_specifier':
          symbols.push(...this._handleEnum(child, scopeChain, isInsideFunction));
          break;

        case 'field_declaration':
          symbols.push(...this._handleFieldDeclaration(child, scopeChain));
          break;

        case 'template_declaration':
          // Recurse into template declaration to get the actual class/function
          symbols.push(...this._walkNode(child, scopeChain, isInsideFunction));
          break;

        case 'linkage_specification':
          // extern "C" { ... } — recurse into the body
          symbols.push(...this._walkNode(child, scopeChain, isInsideFunction));
          break;

        default:
          // Recurse into other compound nodes (e.g., preproc_if, compound_statement)
          if (child.childCount > 0 && !this._isLeafType(child.type)) {
            symbols.push(...this._walkNode(child, scopeChain, isInsideFunction));
          }
          break;
      }
    }

    return symbols;
  }

  /**
   * Handle namespace definitions: extract children within the namespace scope.
   */
  private _handleNamespace(
    node: Parser.SyntaxNode,
    scopeChain: string[],
    isInsideFunction: boolean
  ): RawExtractedSymbol[] {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {
      // Anonymous namespace — recurse without changing scope
      const body = node.childForFieldName('body');
      if (body) {
        return this._walkNode(body, scopeChain, isInsideFunction);
      }
      return [];
    }

    const nsName = nameNode.text;
    const body = node.childForFieldName('body');
    if (body) {
      return this._walkNode(body, [...scopeChain, nsName], isInsideFunction);
    }
    return [];
  }

  /**
   * Handle class/struct definitions.
   */
  private _handleClassOrStruct(
    node: Parser.SyntaxNode,
    scopeChain: string[],
    isInsideFunction: boolean
  ): RawExtractedSymbol[] {
    const symbols: RawExtractedSymbol[] = [];
    const nameNode = node.childForFieldName('name');

    if (!nameNode) {
      // Anonymous class/struct
      return symbols;
    }

    const name = nameNode.text;
    const kind: SymbolKindType = node.type === 'class_specifier' ? 'class' : 'struct';

    symbols.push({
      name,
      kind,
      startLine: node.startPosition.row,
      endLine: node.endPosition.row,
      startColumn: node.startPosition.column,
      scopeChain: [...scopeChain],
      paramSignature: null,
      isLocal: isInsideFunction,
    });

    // Recurse into class body for members
    const body = node.childForFieldName('body');
    if (body) {
      symbols.push(...this._walkNode(body, [...scopeChain, name], isInsideFunction));
    }

    return symbols;
  }

  /**
   * Handle function definitions (including class method implementations).
   */
  private _handleFunctionDefinition(
    node: Parser.SyntaxNode,
    scopeChain: string[],
    isInsideFunction: boolean
  ): RawExtractedSymbol[] {
    const symbols: RawExtractedSymbol[] = [];
    const declarator = node.childForFieldName('declarator');
    const name = this._extractDeclaratorName(declarator);

    if (!name) {
      return symbols;
    }

    // Determine kind: if inside a class scope, it's a method
    // Also check for qualified names like ClassName::methodName
    const kind: SymbolKindType = isInsideFunction ? 'function' : this._inferFunctionKind(name, scopeChain);
    const paramSig = this.extractParamSignature(node);

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

    // Recurse into function body for local variables
    const body = node.childForFieldName('body');
    if (body) {
      symbols.push(...this._walkNode(body, [...scopeChain, name], true));
    }

    return symbols;
  }

  /**
   * Handle variable/constant declarations.
   */
  private _handleDeclaration(
    node: Parser.SyntaxNode,
    scopeChain: string[],
    isInsideFunction: boolean
  ): RawExtractedSymbol[] {
    const symbols: RawExtractedSymbol[] = [];
    const declarator = node.childForFieldName('declarator');

    if (!declarator) {
      return symbols;
    }

    const name = this._extractDeclaratorName(declarator);
    if (!name) {
      return symbols;
    }

    // Skip function declarations (forward declarations) — they have a parameter_list
    if (this._isFunctionDeclaration(declarator)) {
      return symbols;
    }

    symbols.push({
      name,
      kind: 'variable',
      startLine: node.startPosition.row,
      endLine: node.endPosition.row,
      startColumn: node.startPosition.column,
      scopeChain: [...scopeChain],
      paramSignature: null,
      isLocal: isInsideFunction,
    });

    return symbols;
  }

  /**
   * Handle enum definitions.
   */
  private _handleEnum(
    node: Parser.SyntaxNode,
    scopeChain: string[],
    isInsideFunction: boolean
  ): RawExtractedSymbol[] {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {
      return [];
    }

    return [{
      name: nameNode.text,
      kind: 'enum',
      startLine: node.startPosition.row,
      endLine: node.endPosition.row,
      startColumn: node.startPosition.column,
      scopeChain: [...scopeChain],
      paramSignature: null,
      isLocal: isInsideFunction,
    }];
  }

  /**
   * Handle field declarations inside class/struct bodies.
   */
  private _handleFieldDeclaration(
    node: Parser.SyntaxNode,
    scopeChain: string[]
  ): RawExtractedSymbol[] {
    const symbols: RawExtractedSymbol[] = [];
    const declarator = node.childForFieldName('declarator');

    if (!declarator) {
      return symbols;
    }

    const name = this._extractDeclaratorName(declarator);
    if (!name) {
      return symbols;
    }

    // Check if this is a method declaration (has parameter_list)
    if (this._isFunctionDeclaration(declarator)) {
      const paramSig = this._extractParamSigFromDeclarator(declarator);
      symbols.push({
        name,
        kind: 'method',
        startLine: node.startPosition.row,
        endLine: node.endPosition.row,
        startColumn: node.startPosition.column,
        scopeChain: [...scopeChain],
        paramSignature: paramSig,
        isLocal: false,
      });
    } else {
      symbols.push({
        name,
        kind: 'property',
        startLine: node.startPosition.row,
        endLine: node.endPosition.row,
        startColumn: node.startPosition.column,
        scopeChain: [...scopeChain],
        paramSignature: null,
        isLocal: false,
      });
    }

    return symbols;
  }

  // ────────────── Helper Methods ──────────────

  /**
   * Extract the identifier name from a declarator node,
   * handling various declarator types (init, function, pointer, reference, qualified).
   */
  private _extractDeclaratorName(node: Parser.SyntaxNode | null): string | null {
    if (!node) {
      return null;
    }

    switch (node.type) {
      case 'identifier':
      case 'field_identifier':
        return node.text;

      case 'qualified_identifier':
      case 'destructor_name':
        return node.text;

      case 'init_declarator':
        return this._extractDeclaratorName(node.childForFieldName('declarator'));

      case 'function_declarator':
        return this._extractDeclaratorName(node.childForFieldName('declarator'));

      case 'pointer_declarator':
      case 'reference_declarator':
        // Skip the * or & and get the actual name
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child && child.type !== '*' && child.type !== '&') {
            return this._extractDeclaratorName(child);
          }
        }
        return null;

      case 'parenthesized_declarator':
        // e.g., (*funcPtr)
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child && child.type !== '(' && child.type !== ')') {
            return this._extractDeclaratorName(child);
          }
        }
        return null;

      case 'array_declarator':
        return this._extractDeclaratorName(node.childForFieldName('declarator'));

      case 'structured_binding_declarator':
        // auto [a, b] = ... — skip these for now
        return null;

      default:
        return null;
    }
  }

  /**
   * Check if a declarator is a function declaration (has a parameter list).
   */
  private _isFunctionDeclaration(node: Parser.SyntaxNode | null): boolean {
    if (!node) {
      return false;
    }
    if (node.type === 'function_declarator') {
      return true;
    }
    // Recurse into init_declarator
    if (node.type === 'init_declarator') {
      return this._isFunctionDeclaration(node.childForFieldName('declarator'));
    }
    return false;
  }

  /**
   * Find the parameter_list node within a function definition or declarator.
   */
  private _findParameterList(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
    // For function_definition: find the declarator, then find parameter_list inside it
    const declarator = node.childForFieldName('declarator');
    if (declarator) {
      return this._findParameterListInDeclarator(declarator);
    }
    return null;
  }

  /**
   * Recursively search a declarator for a parameter_list node.
   */
  private _findParameterListInDeclarator(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
    if (node.type === 'parameter_list') {
      return node;
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        const found = this._findParameterListInDeclarator(child);
        if (found) {
          return found;
        }
      }
    }
    return null;
  }

  /**
   * Extract param signature from a function declarator (for field declarations / forward declarations).
   */
  private _extractParamSigFromDeclarator(declarator: Parser.SyntaxNode): string {
    const paramList = this._findParameterListInDeclarator(declarator);
    if (!paramList) {
      return '';
    }

    const types: string[] = [];
    for (let i = 0; i < paramList.childCount; i++) {
      const child = paramList.child(i);
      if (child && child.type === 'parameter_declaration') {
        const typeNode = child.childForFieldName('type');
        if (typeNode) {
          types.push(this._normalizeType(typeNode.text));
        }
      } else if (child && child.type === 'variadic_parameter') {
        types.push('...');
      }
    }

    return types.join(',');
  }

  /**
   * Infer whether a function is a method based on scope or qualified name.
   */
  private _inferFunctionKind(name: string, _scopeChain: string[]): SymbolKindType {
    // Qualified names like ClassName::methodName are methods
    if (name.includes('::')) {
      return 'function'; // Use 'function' for out-of-class method implementations
    }
    return 'function';
  }

  /**
   * Normalize a C++ type string: trim whitespace, collapse multiple spaces.
   */
  private _normalizeType(typeText: string): string {
    return typeText.replace(/\s+/g, ' ').trim();
  }

  /**
   * Check if a node type is a leaf (no useful children to recurse into).
   */
  private _isLeafType(nodeType: string): boolean {
    const leafTypes = new Set([
      'identifier',
      'field_identifier',
      'type_identifier',
      'namespace_identifier',
      'number_literal',
      'string_literal',
      'char_literal',
      'true',
      'false',
      'null',
      'nullptr',
      'comment',
      'preproc_include',
      'preproc_define',
      'preproc_ifdef',
      'preproc_ifndef',
      'preproc_else',
      'preproc_endif',
      'preproc_arg',
      'system_lib_string',
      'string_content',
      'escape_sequence',
    ]);
    return leafTypes.has(nodeType);
  }
}
