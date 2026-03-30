/**
 * Tree-sitter POC for Code Explorer
 *
 * Goal: Validate that tree-sitter can:
 * 1. Parse C++ and TypeScript source files into ASTs
 * 2. Extract symbol definitions with their kind, name, scope chain, and location
 * 3. Build a "symbol address" that uniquely identifies any symbol
 * 4. Resolve a cursor position to a symbol address
 */

const Parser = require('tree-sitter');
const Cpp = require('tree-sitter-cpp');
const TypeScript = require('tree-sitter-typescript').typescript;
const fs = require('fs');
const path = require('path');

// ============================================================================
// 1. Parse C++ sample file
// ============================================================================
console.log('='.repeat(70));
console.log('TEST 1: Parse C++ source file');
console.log('='.repeat(70));

const cppParser = new Parser();
cppParser.setLanguage(Cpp);

const cppSource = fs.readFileSync(
  path.join(__dirname, '../../sample-workspace/src/main.cpp'),
  'utf8'
);

const cppTree = cppParser.parse(cppSource);
console.log('\nRoot node type:', cppTree.rootNode.type);
console.log('Child count:', cppTree.rootNode.childCount);

// ============================================================================
// 2. Walk AST and extract symbol definitions
// ============================================================================
console.log('\n' + '='.repeat(70));
console.log('TEST 2: Extract all symbol definitions from C++ AST');
console.log('='.repeat(70));

/**
 * Extract symbols from a tree-sitter node recursively.
 * Returns an array of { name, kind, startLine, endLine, scopeChain }
 */
function extractCppSymbols(node, scopeChain = []) {
  const symbols = [];

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);

    if (child.type === 'function_definition') {
      // Get the declarator
      const declarator = child.childForFieldName('declarator');
      const name = extractDeclaratorName(declarator);
      if (name) {
        symbols.push({
          name,
          kind: 'function',
          startLine: child.startPosition.row,
          endLine: child.endPosition.row,
          startCol: child.startPosition.column,
          scopeChain: [...scopeChain],
          address: buildAddress(scopeChain, 'function', name),
        });
        // Recurse into function body for local variables
        const body = child.childForFieldName('body');
        if (body) {
          symbols.push(...extractCppSymbols(body, [...scopeChain, name]));
        }
      }
    } else if (child.type === 'declaration') {
      // Could be variable declaration or function declaration
      const declarator = child.childForFieldName('declarator');
      if (declarator) {
        const name = extractDeclaratorName(declarator);
        if (name) {
          const isStatic = child.text.startsWith('static');
          symbols.push({
            name,
            kind: isStatic ? 'static_variable' : 'variable',
            startLine: child.startPosition.row,
            endLine: child.endPosition.row,
            startCol: child.startPosition.column,
            scopeChain: [...scopeChain],
            address: buildAddress(scopeChain, 'variable', name),
          });
        }
      }
    } else if (child.type === 'class_specifier' || child.type === 'struct_specifier') {
      const nameNode = child.childForFieldName('name');
      if (nameNode) {
        const name = nameNode.text;
        symbols.push({
          name,
          kind: child.type === 'class_specifier' ? 'class' : 'struct',
          startLine: child.startPosition.row,
          endLine: child.endPosition.row,
          startCol: child.startPosition.column,
          scopeChain: [...scopeChain],
          address: buildAddress(scopeChain, 'class', name),
        });
        // Recurse into class body
        const body = child.childForFieldName('body');
        if (body) {
          symbols.push(...extractCppSymbols(body, [...scopeChain, name]));
        }
      }
    } else if (child.type === 'namespace_definition') {
      const nameNode = child.childForFieldName('name');
      if (nameNode) {
        const nsName = nameNode.text;
        const body = child.childForFieldName('body');
        if (body) {
          symbols.push(...extractCppSymbols(body, [...scopeChain, nsName]));
        }
      }
    } else if (child.type === 'for_statement' || child.type === 'for_range_loop') {
      // Extract loop variable
      // Recurse into children without adding to scope chain
      symbols.push(...extractCppSymbols(child, scopeChain));
    } else {
      // Recurse into other nodes
      symbols.push(...extractCppSymbols(child, scopeChain));
    }
  }

  return symbols;
}

function extractDeclaratorName(node) {
  if (!node) return null;

  // Handle init_declarator (e.g., `int x = 5`)
  if (node.type === 'init_declarator') {
    return extractDeclaratorName(node.childForFieldName('declarator'));
  }

  // Handle function_declarator (e.g., `main(int argc, ...)`)
  if (node.type === 'function_declarator') {
    return extractDeclaratorName(node.childForFieldName('declarator'));
  }

  // Handle qualified_identifier (e.g., `app::Logger`)
  if (node.type === 'qualified_identifier') {
    return node.text;
  }

  // Handle pointer_declarator
  if (node.type === 'pointer_declarator') {
    return extractDeclaratorName(node.child(1));
  }

  // Handle reference_declarator
  if (node.type === 'reference_declarator') {
    return extractDeclaratorName(node.child(1));
  }

  // Base case: identifier
  if (node.type === 'identifier') {
    return node.text;
  }

  return null;
}

/**
 * Build a symbol address string.
 * Format: scopeChain::kind.name
 * Examples:
 *   "fn.printBanner"
 *   "fn.main::var.verbose"
 *   "app::class.UserService::method.createUser"
 */
function buildAddress(scopeChain, kind, name) {
  const kindPrefix = {
    function: 'fn',
    method: 'method',
    class: 'class',
    struct: 'struct',
    variable: 'var',
    static_variable: 'var',
    parameter: 'param',
    property: 'prop',
    enum: 'enum',
    namespace: 'ns',
  };
  const prefix = kindPrefix[kind] || 'sym';
  const scopePart = scopeChain.length > 0 ? scopeChain.join('::') + '::' : '';
  return `${scopePart}${prefix}.${name}`;
}

const cppSymbols = extractCppSymbols(cppTree.rootNode);
console.log(`\nFound ${cppSymbols.length} symbols in main.cpp:\n`);
for (const sym of cppSymbols) {
  console.log(`  ${sym.address}`);
  console.log(`    kind=${sym.kind}  line=${sym.startLine + 1}-${sym.endLine + 1}  scope=[${sym.scopeChain.join(', ')}]`);
}

// ============================================================================
// 3. Cursor-to-symbol resolution
// ============================================================================
console.log('\n' + '='.repeat(70));
console.log('TEST 3: Resolve cursor position to symbol address');
console.log('='.repeat(70));

/**
 * Given a cursor position (line, col), find the deepest symbol containing it.
 */
function resolveSymbolAtCursor(symbols, line, col) {
  // Find all symbols whose range contains this position
  const containing = symbols.filter(
    (s) => line >= s.startLine && line <= s.endLine
  );

  if (containing.length === 0) return null;

  // Sort by specificity (deepest scope first)
  containing.sort((a, b) => {
    // Prefer deeper scope chains
    if (b.scopeChain.length !== a.scopeChain.length) {
      return b.scopeChain.length - a.scopeChain.length;
    }
    // Prefer narrower range
    return (a.endLine - a.startLine) - (b.endLine - b.startLine);
  });

  return containing[0];
}

// Test: cursor on line 14 (printBanner function definition)
let resolved = resolveSymbolAtCursor(cppSymbols, 13, 5);
console.log('\nCursor at line 14, col 5 (printBanner):');
console.log(`  -> ${resolved ? resolved.address : 'null'} (${resolved?.kind})`);

// Test: cursor on line 28 (main function)
resolved = resolveSymbolAtCursor(cppSymbols, 27, 5);
console.log('\nCursor at line 28, col 5 (main):');
console.log(`  -> ${resolved ? resolved.address : 'null'} (${resolved?.kind})`);

// Test: cursor on line 31 (inside main, local variable arg)
resolved = resolveSymbolAtCursor(cppSymbols, 30, 10);
console.log('\nCursor at line 31, col 10 (inside main loop):');
console.log(`  -> ${resolved ? resolved.address : 'null'} (${resolved?.kind})`);

// Test: cursor on line 10 (global static variable)
resolved = resolveSymbolAtCursor(cppSymbols, 9, 5);
console.log('\nCursor at line 10, col 5 (MAX_USERS):');
console.log(`  -> ${resolved ? resolved.address : 'null'} (${resolved?.kind})`);

// ============================================================================
// 4. Parse TypeScript file (extension.ts or similar)
// ============================================================================
console.log('\n' + '='.repeat(70));
console.log('TEST 4: Parse TypeScript source (CacheStore.ts)');
console.log('='.repeat(70));

const tsParser = new Parser();
tsParser.setLanguage(TypeScript);

const tsSource = fs.readFileSync(
  path.join(__dirname, '../../src/cache/CacheStore.ts'),
  'utf8'
);

const tsTree = tsParser.parse(tsSource);

/**
 * Extract symbols from TypeScript AST
 */
function extractTsSymbols(node, scopeChain = []) {
  const symbols = [];

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);

    if (child.type === 'function_declaration') {
      const nameNode = child.childForFieldName('name');
      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          kind: 'function',
          startLine: child.startPosition.row,
          endLine: child.endPosition.row,
          scopeChain: [...scopeChain],
          address: buildAddress(scopeChain, 'function', nameNode.text),
        });
        const body = child.childForFieldName('body');
        if (body) symbols.push(...extractTsSymbols(body, [...scopeChain, nameNode.text]));
      }
    } else if (child.type === 'class_declaration') {
      const nameNode = child.childForFieldName('name');
      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          kind: 'class',
          startLine: child.startPosition.row,
          endLine: child.endPosition.row,
          scopeChain: [...scopeChain],
          address: buildAddress(scopeChain, 'class', nameNode.text),
        });
        const body = child.childForFieldName('body');
        if (body) symbols.push(...extractTsSymbols(body, [...scopeChain, nameNode.text]));
      }
    } else if (child.type === 'method_definition' || child.type === 'public_field_definition') {
      const nameNode = child.childForFieldName('name');
      if (nameNode) {
        const kind = child.type === 'method_definition' ? 'method' : 'property';
        symbols.push({
          name: nameNode.text,
          kind,
          startLine: child.startPosition.row,
          endLine: child.endPosition.row,
          scopeChain: [...scopeChain],
          address: buildAddress(scopeChain, kind, nameNode.text),
        });
        if (kind === 'method') {
          const body = child.childForFieldName('body');
          if (body) symbols.push(...extractTsSymbols(body, [...scopeChain, nameNode.text]));
        }
      }
    } else if (child.type === 'interface_declaration') {
      const nameNode = child.childForFieldName('name');
      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          kind: 'interface',
          startLine: child.startPosition.row,
          endLine: child.endPosition.row,
          scopeChain: [...scopeChain],
          address: buildAddress(scopeChain, 'interface', nameNode.text),
        });
      }
    } else if (child.type === 'type_alias_declaration') {
      const nameNode = child.childForFieldName('name');
      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          kind: 'type',
          startLine: child.startPosition.row,
          endLine: child.endPosition.row,
          scopeChain: [...scopeChain],
          address: buildAddress(scopeChain, 'type', nameNode.text),
        });
      }
    } else if (child.type === 'lexical_declaration' || child.type === 'variable_declaration') {
      // const/let/var declarations
      for (let j = 0; j < child.childCount; j++) {
        const declarator = child.child(j);
        if (declarator && declarator.type === 'variable_declarator') {
          const nameNode = declarator.childForFieldName('name');
          if (nameNode) {
            symbols.push({
              name: nameNode.text,
              kind: 'variable',
              startLine: child.startPosition.row,
              endLine: child.endPosition.row,
              scopeChain: [...scopeChain],
              address: buildAddress(scopeChain, 'variable', nameNode.text),
            });
          }
        }
      }
    } else if (child.type === 'export_statement') {
      // Recurse into export statement to get the actual declaration
      symbols.push(...extractTsSymbols(child, scopeChain));
    } else {
      // Recurse into other compound nodes
      if (child.childCount > 0) {
        symbols.push(...extractTsSymbols(child, scopeChain));
      }
    }
  }

  return symbols;
}

const tsSymbols = extractTsSymbols(tsTree.rootNode);
console.log(`\nFound ${tsSymbols.length} symbols in CacheStore.ts:\n`);
for (const sym of tsSymbols) {
  console.log(`  ${sym.address}`);
  console.log(`    kind=${sym.kind}  line=${sym.startLine + 1}-${sym.endLine + 1}`);
}

// ============================================================================
// 5. Parse a C++ file with classes and namespaces (UserService.cpp)
// ============================================================================
console.log('\n' + '='.repeat(70));
console.log('TEST 5: Parse C++ class file (UserService.cpp)');
console.log('='.repeat(70));

const usSource = fs.readFileSync(
  path.join(__dirname, '../../sample-workspace/src/UserService.cpp'),
  'utf8'
);

const usTree = cppParser.parse(usSource);
const usSymbols = extractCppSymbols(usTree.rootNode);
console.log(`\nFound ${usSymbols.length} symbols in UserService.cpp:\n`);
for (const sym of usSymbols) {
  console.log(`  ${sym.address}`);
  console.log(`    kind=${sym.kind}  line=${sym.startLine + 1}-${sym.endLine + 1}`);
}

// ============================================================================
// 6. Build a mock symbol index
// ============================================================================
console.log('\n' + '='.repeat(70));
console.log('TEST 6: Build symbol index (name -> address -> cache path mapping)');
console.log('='.repeat(70));

function buildSymbolIndex(filePath, symbols) {
  const index = {};
  for (const sym of symbols) {
    const cacheFileName = `${buildAddress(sym.scopeChain, sym.kind, sym.name).replace(/::/g, '.')}.md`;
    const cachePath = `.vscode/code-explorer/${filePath}/${cacheFileName}`;

    // Index by name for quick lookup
    if (!index[sym.name]) {
      index[sym.name] = [];
    }
    index[sym.name].push({
      address: sym.address,
      filePath,
      line: sym.startLine + 1,
      kind: sym.kind,
      cachePath,
    });
  }
  return index;
}

const mainIndex = buildSymbolIndex('src/main.cpp', cppSymbols);
const usIndex = buildSymbolIndex('src/UserService.cpp', usSymbols);

// Merge indexes
const fullIndex = {};
for (const idx of [mainIndex, usIndex]) {
  for (const [name, entries] of Object.entries(idx)) {
    if (!fullIndex[name]) fullIndex[name] = [];
    fullIndex[name].push(...entries);
  }
}

console.log('\nFull symbol index:');
for (const [name, entries] of Object.entries(fullIndex)) {
  for (const entry of entries) {
    console.log(`  "${name}" -> ${entry.address}`);
    console.log(`    file=${entry.filePath}:${entry.line}  cache=${entry.cachePath}`);
  }
}

// ============================================================================
// 7. Test: Symbol link resolution
// ============================================================================
console.log('\n' + '='.repeat(70));
console.log('TEST 7: Resolve symbol links (e.g., clicking "printBanner" in analysis text)');
console.log('='.repeat(70));

function resolveSymbolLink(index, symbolName, contextFilePath) {
  const entries = index[symbolName];
  if (!entries || entries.length === 0) {
    return { found: false, symbolName };
  }

  if (entries.length === 1) {
    return { found: true, entry: entries[0] };
  }

  // Disambiguate: prefer same file
  const sameFile = entries.find((e) => e.filePath === contextFilePath);
  if (sameFile) {
    return { found: true, entry: sameFile, disambiguated: 'same-file' };
  }

  // Return all candidates for user selection
  return { found: true, entries, ambiguous: true };
}

console.log('\nResolve "printBanner" from context "src/main.cpp":');
let result = resolveSymbolLink(fullIndex, 'printBanner', 'src/main.cpp');
console.log(`  Found: ${result.found}, Cache: ${result.entry?.cachePath}`);

console.log('\nResolve "createUser" from any context:');
result = resolveSymbolLink(fullIndex, 'createUser', 'src/UserService.cpp');
console.log(`  Found: ${result.found}, Cache: ${result.entry?.cachePath}`);

// ============================================================================
// 8. Node type enumeration
// ============================================================================
console.log('\n' + '='.repeat(70));
console.log('TEST 8: AST node types encountered (for reference)');
console.log('='.repeat(70));

function collectNodeTypes(node, types = new Set()) {
  types.add(node.type);
  for (let i = 0; i < node.childCount; i++) {
    collectNodeTypes(node.child(i), types);
  }
  return types;
}

const cppNodeTypes = collectNodeTypes(cppTree.rootNode);
console.log('\nC++ node types found:', [...cppNodeTypes].sort().join(', '));

const tsNodeTypes = collectNodeTypes(tsTree.rootNode);
console.log('\nTypeScript node types found:', [...tsNodeTypes].sort().slice(0, 40).join(', '), '...');

console.log('\n' + '='.repeat(70));
console.log('POC COMPLETE - tree-sitter works for C++ and TypeScript AST parsing');
console.log('='.repeat(70));
