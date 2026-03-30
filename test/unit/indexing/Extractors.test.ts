/**
 * Code Explorer — Unit Tests for CppExtractor and TypeScriptExtractor
 *
 * Tests symbol extraction from real C++ and TypeScript source using
 * tree-sitter parsing, verifying addresses, scope chains, overload
 * detection, and code-change resilience.
 */
import * as assert from 'assert';
import Parser from 'tree-sitter';
// eslint-disable-next-line @typescript-eslint/naming-convention
import Cpp from 'tree-sitter-cpp';
// eslint-disable-next-line @typescript-eslint/naming-convention
import TypeScriptGrammar from 'tree-sitter-typescript';
import { CppExtractor } from '../../../src/indexing/extractors/CppExtractor';
import { TypeScriptExtractor } from '../../../src/indexing/extractors/TypeScriptExtractor';
import type { SymbolIndexEntry } from '../../../src/indexing/SymbolIndex';

/** Parse C++ source into a tree-sitter tree. */
function parseCpp(source: string): Parser.Tree {
  const parser = new Parser();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parser.setLanguage(Cpp as any);
  return parser.parse(source);
}

/** Parse TypeScript source into a tree-sitter tree. */
function parseTs(source: string): Parser.Tree {
  const parser = new Parser();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parser.setLanguage(TypeScriptGrammar.typescript as any);
  return parser.parse(source);
}

/** Find entry by name from array. */
function findByName(entries: SymbolIndexEntry[], name: string): SymbolIndexEntry | undefined {
  return entries.find((e) => e.name === name);
}

/** Find all entries by name from array. */
function findAllByName(entries: SymbolIndexEntry[], name: string): SymbolIndexEntry[] {
  return entries.filter((e) => e.name === name);
}

suite('CppExtractor', () => {
  const extractor = new CppExtractor();

  test('extracts top-level functions', () => {
    const tree = parseCpp(`
void printBanner() {
  // body
}

int main(int argc, char* argv[]) {
  return 0;
}
`);
    const entries = extractor.extract(tree.rootNode, 'src/main.cpp', 'sha256:abc');

    const printBanner = findByName(entries, 'printBanner');
    assert.ok(printBanner);
    assert.strictEqual(printBanner.kind, 'function');
    assert.strictEqual(printBanner.address, 'src/main.cpp#fn.printBanner');
    assert.deepStrictEqual(printBanner.scopeChain, []);
    assert.strictEqual(printBanner.isLocal, false);

    const main = findByName(entries, 'main');
    assert.ok(main);
    assert.strictEqual(main.kind, 'function');
    assert.strictEqual(main.address, 'src/main.cpp#fn.main');
  });

  test('extracts variables', () => {
    const tree = parseCpp(`
static const int MAX_USERS = 1000;
static bool verbose = false;
`);
    const entries = extractor.extract(tree.rootNode, 'src/main.cpp', 'sha256:abc');

    const maxUsers = findByName(entries, 'MAX_USERS');
    assert.ok(maxUsers);
    assert.strictEqual(maxUsers.kind, 'variable');
    assert.strictEqual(maxUsers.address, 'src/main.cpp#var.MAX_USERS');
  });

  test('extracts local variables with scope chain', () => {
    const tree = parseCpp(`
int main() {
  int x = 5;
  auto logger = getLogger();
  return 0;
}
`);
    const entries = extractor.extract(tree.rootNode, 'src/main.cpp', 'sha256:abc');

    const x = findByName(entries, 'x');
    assert.ok(x);
    assert.strictEqual(x.kind, 'variable');
    assert.deepStrictEqual(x.scopeChain, ['main']);
    assert.strictEqual(x.isLocal, true);
    assert.strictEqual(x.address, 'src/main.cpp#main::var.x');
  });

  test('extracts namespaced functions', () => {
    const tree = parseCpp(`
namespace app {
  void doStuff() {}
}
`);
    const entries = extractor.extract(tree.rootNode, 'src/app.cpp', 'sha256:abc');

    const doStuff = findByName(entries, 'doStuff');
    assert.ok(doStuff);
    assert.strictEqual(doStuff.address, 'src/app.cpp#app::fn.doStuff');
    assert.deepStrictEqual(doStuff.scopeChain, ['app']);
  });

  test('extracts class definitions', () => {
    const tree = parseCpp(`
namespace app {
  class UserService {
    int m_count;
  };
}
`);
    const entries = extractor.extract(tree.rootNode, 'src/us.h', 'sha256:abc');

    const userService = findByName(entries, 'UserService');
    assert.ok(userService);
    assert.strictEqual(userService.kind, 'class');
    assert.strictEqual(userService.address, 'src/us.h#app::class.UserService');
  });

  test('extracts enum', () => {
    const tree = parseCpp(`
enum Color { RED, GREEN, BLUE };
`);
    const entries = extractor.extract(tree.rootNode, 'colors.h', 'sha256:abc');

    const color = findByName(entries, 'Color');
    assert.ok(color);
    assert.strictEqual(color.kind, 'enum');
    assert.strictEqual(color.address, 'colors.h#enum.Color');
  });

  test('detects overloads and assigns discriminators', () => {
    const tree = parseCpp(`
namespace app {
  class Logger {
  public:
    void log(const std::string& msg) {}
    void log(int level, const std::string& msg) {}
  };
}
`);
    const entries = extractor.extract(tree.rootNode, 'logger.h', 'sha256:abc');

    const logEntries = findAllByName(entries, 'log');
    assert.strictEqual(logEntries.length, 2, 'Should find 2 overloads of log');

    // Both should have discriminators
    assert.ok(logEntries[0].overloadDiscriminator);
    assert.ok(logEntries[1].overloadDiscriminator);
    assert.notStrictEqual(
      logEntries[0].overloadDiscriminator,
      logEntries[1].overloadDiscriminator,
      'Different overloads should have different discriminators'
    );

    // Both addresses should contain ~
    assert.ok(logEntries[0].address.includes('~'));
    assert.ok(logEntries[1].address.includes('~'));
  });

  test('no discriminator for non-overloaded functions', () => {
    const tree = parseCpp(`
void foo() {}
void bar() {}
`);
    const entries = extractor.extract(tree.rootNode, 'main.cpp', 'sha256:abc');

    const foo = findByName(entries, 'foo');
    assert.ok(foo);
    assert.strictEqual(foo.overloadDiscriminator, null);
    assert.ok(!foo.address.includes('~'));
  });

  test('addresses are stable when comments are added', () => {
    const source1 = `
void foo() { int x = 1; }
void bar() { int y = 2; }
`;
    const source2 = `
// Added a comment here
void foo() {
  // Another comment
  int x = 1;
}

/* Multi-line
   comment */
void bar() { int y = 2; }
`;

    const entries1 = extractor.extract(parseCpp(source1).rootNode, 'main.cpp', 'sha256:1');
    const entries2 = extractor.extract(parseCpp(source2).rootNode, 'main.cpp', 'sha256:2');

    const addr1 = entries1.map((e) => e.address).sort();
    const addr2 = entries2.map((e) => e.address).sort();

    assert.deepStrictEqual(addr1, addr2, 'Addresses should be identical despite comments');
  });

  test('addresses are stable when functions are reordered', () => {
    const source1 = `
void foo() {}
void bar() {}
`;
    const source2 = `
void bar() {}
void foo() {}
`;

    const entries1 = extractor.extract(parseCpp(source1).rootNode, 'main.cpp', 'sha256:1');
    const entries2 = extractor.extract(parseCpp(source2).rootNode, 'main.cpp', 'sha256:2');

    const addr1 = entries1.map((e) => e.address).sort();
    const addr2 = entries2.map((e) => e.address).sort();

    assert.deepStrictEqual(addr1, addr2, 'Addresses should be identical despite reordering');
  });

  test('address changes when function is renamed', () => {
    const source1 = `void foo() {}`;
    const source2 = `void bar() {}`;

    const entries1 = extractor.extract(parseCpp(source1).rootNode, 'main.cpp', 'sha256:1');
    const entries2 = extractor.extract(parseCpp(source2).rootNode, 'main.cpp', 'sha256:2');

    assert.strictEqual(entries1[0].address, 'main.cpp#fn.foo');
    assert.strictEqual(entries2[0].address, 'main.cpp#fn.bar');
  });
});

suite('TypeScriptExtractor', () => {
  const extractor = new TypeScriptExtractor();

  test('extracts function declarations', () => {
    const tree = parseTs(`
function greet(name: string): void {
  console.log(name);
}
`);
    const entries = extractor.extract(tree.rootNode, 'src/greet.ts', 'sha256:abc');

    const greet = findByName(entries, 'greet');
    assert.ok(greet);
    assert.strictEqual(greet.kind, 'function');
    assert.strictEqual(greet.address, 'src/greet.ts#fn.greet');
    assert.strictEqual(greet.paramSignature, 'string');
  });

  test('extracts class with methods and properties', () => {
    const tree = parseTs(`
class CacheStore {
  private _cacheRoot: string;

  constructor(root: string) {
    this._cacheRoot = root;
  }

  write(data: string): void {
    // body
  }

  read(): string {
    return '';
  }
}
`);
    const entries = extractor.extract(tree.rootNode, 'src/cache.ts', 'sha256:abc');

    const cls = findByName(entries, 'CacheStore');
    assert.ok(cls);
    assert.strictEqual(cls.kind, 'class');
    assert.strictEqual(cls.address, 'src/cache.ts#class.CacheStore');

    const write = findByName(entries, 'write');
    assert.ok(write);
    assert.strictEqual(write.kind, 'method');
    assert.strictEqual(write.address, 'src/cache.ts#CacheStore::method.write');
    assert.deepStrictEqual(write.scopeChain, ['CacheStore']);

    const read = findByName(entries, 'read');
    assert.ok(read);
    assert.strictEqual(read.address, 'src/cache.ts#CacheStore::method.read');
  });

  test('extracts interface declarations', () => {
    const tree = parseTs(`
interface SymbolInfo {
  name: string;
  kind: string;
}
`);
    const entries = extractor.extract(tree.rootNode, 'src/types.ts', 'sha256:abc');

    const iface = findByName(entries, 'SymbolInfo');
    assert.ok(iface);
    assert.strictEqual(iface.kind, 'interface');
    assert.strictEqual(iface.address, 'src/types.ts#interface.SymbolInfo');
  });

  test('extracts type alias declarations', () => {
    const tree = parseTs(`
type SymbolKindType = 'class' | 'function' | 'variable';
`);
    const entries = extractor.extract(tree.rootNode, 'src/types.ts', 'sha256:abc');

    const typeAlias = findByName(entries, 'SymbolKindType');
    assert.ok(typeAlias);
    assert.strictEqual(typeAlias.kind, 'type');
  });

  test('extracts enum declarations', () => {
    const tree = parseTs(`
enum ErrorCode {
  NOT_FOUND = 'NOT_FOUND',
  TIMEOUT = 'TIMEOUT',
}
`);
    const entries = extractor.extract(tree.rootNode, 'src/errors.ts', 'sha256:abc');

    const enumDecl = findByName(entries, 'ErrorCode');
    assert.ok(enumDecl);
    assert.strictEqual(enumDecl.kind, 'enum');
  });

  test('extracts const variable declarations', () => {
    const tree = parseTs(`
const MAX_RETRIES = 3;
let counter = 0;
`);
    const entries = extractor.extract(tree.rootNode, 'src/config.ts', 'sha256:abc');

    const maxRetries = findByName(entries, 'MAX_RETRIES');
    assert.ok(maxRetries);
    assert.strictEqual(maxRetries.kind, 'variable');
    assert.strictEqual(maxRetries.isLocal, false);
  });

  test('extracts arrow functions assigned to variables', () => {
    const tree = parseTs(`
const greet = (name: string): void => {
  console.log(name);
};
`);
    const entries = extractor.extract(tree.rootNode, 'src/greet.ts', 'sha256:abc');

    const greet = findByName(entries, 'greet');
    assert.ok(greet);
    assert.strictEqual(greet.kind, 'function');
    assert.strictEqual(greet.paramSignature, 'string');
  });

  test('extracts local variables with scope chain', () => {
    const tree = parseTs(`
function process() {
  const result = doWork();
  return result;
}
`);
    const entries = extractor.extract(tree.rootNode, 'src/proc.ts', 'sha256:abc');

    const result = findByName(entries, 'result');
    assert.ok(result);
    assert.strictEqual(result.kind, 'variable');
    assert.strictEqual(result.isLocal, true);
    assert.deepStrictEqual(result.scopeChain, ['process']);
    assert.strictEqual(result.address, 'src/proc.ts#process::var.result');
  });

  test('extracts exported declarations', () => {
    const tree = parseTs(`
export function helper(): void {}
export class Service {}
export const VALUE = 42;
`);
    const entries = extractor.extract(tree.rootNode, 'src/lib.ts', 'sha256:abc');

    assert.ok(findByName(entries, 'helper'));
    assert.ok(findByName(entries, 'Service'));
    assert.ok(findByName(entries, 'VALUE'));
  });

  test('detects TypeScript overloads', () => {
    const tree = parseTs(`
function parse(input: string): Result {
  return {} as Result;
}
function parse(input: Buffer): Result {
  return {} as Result;
}
`);
    const entries = extractor.extract(tree.rootNode, 'src/parser.ts', 'sha256:abc');

    const parseEntries = findAllByName(entries, 'parse');
    // Tree-sitter sees two function_declarations with the same name
    assert.strictEqual(parseEntries.length, 2);
    assert.ok(parseEntries[0].overloadDiscriminator);
    assert.ok(parseEntries[1].overloadDiscriminator);
    assert.notStrictEqual(
      parseEntries[0].overloadDiscriminator,
      parseEntries[1].overloadDiscriminator
    );
  });

  test('addresses are stable when comments/whitespace change', () => {
    const source1 = `
class Foo { bar(): void {} }
`;
    const source2 = `
// Comment added
class Foo {
  // Method comment
  bar(): void {
    // body
  }
}
`;

    const entries1 = extractor.extract(parseTs(source1).rootNode, 'src/foo.ts', 'sha256:1');
    const entries2 = extractor.extract(parseTs(source2).rootNode, 'src/foo.ts', 'sha256:2');

    const addr1 = entries1.map((e) => e.address).sort();
    const addr2 = entries2.map((e) => e.address).sort();

    assert.deepStrictEqual(
      addr1,
      addr2,
      'Addresses should be identical despite whitespace changes'
    );
  });

  test('addresses are stable when methods are reordered', () => {
    const source1 = `
class Svc {
  foo(): void {}
  bar(): void {}
}
`;
    const source2 = `
class Svc {
  bar(): void {}
  foo(): void {}
}
`;

    const entries1 = extractor.extract(parseTs(source1).rootNode, 'svc.ts', 'sha256:1');
    const entries2 = extractor.extract(parseTs(source2).rootNode, 'svc.ts', 'sha256:2');

    const addr1 = entries1.map((e) => e.address).sort();
    const addr2 = entries2.map((e) => e.address).sort();

    assert.deepStrictEqual(addr1, addr2, 'Addresses should be identical despite reordering');
  });
});
