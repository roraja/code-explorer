/**
 * Code Explorer — Unit Tests for SymbolAddress
 *
 * Tests buildAddress(), parseAddress(), computeDiscriminator(),
 * and addressToCachePath() with various symbol kinds, scope chains,
 * and overload scenarios.
 */
import * as assert from 'assert';
import {
  buildAddress,
  parseAddress,
  computeDiscriminator,
  addressToCachePath,
} from '../../../src/indexing/SymbolAddress';

suite('SymbolAddress', () => {
  suite('buildAddress', () => {
    test('builds address for top-level function', () => {
      const addr = buildAddress('src/main.cpp', [], 'function', 'printBanner');
      assert.strictEqual(addr, 'src/main.cpp#fn.printBanner');
    });

    test('builds address for function with scope chain', () => {
      const addr = buildAddress(
        'src/UserService.cpp',
        ['app', 'UserService'],
        'function',
        'createUser'
      );
      assert.strictEqual(addr, 'src/UserService.cpp#app::UserService::fn.createUser');
    });

    test('builds address for local variable inside function', () => {
      const addr = buildAddress('src/main.cpp', ['main'], 'variable', 'logger');
      assert.strictEqual(addr, 'src/main.cpp#main::var.logger');
    });

    test('builds address for class', () => {
      const addr = buildAddress('src/cache/CacheStore.ts', [], 'class', 'CacheStore');
      assert.strictEqual(addr, 'src/cache/CacheStore.ts#class.CacheStore');
    });

    test('builds address for method inside class', () => {
      const addr = buildAddress(
        'src/cache/CacheStore.ts',
        ['CacheStore'],
        'method',
        'write'
      );
      assert.strictEqual(addr, 'src/cache/CacheStore.ts#CacheStore::method.write');
    });

    test('builds address for property inside class', () => {
      const addr = buildAddress(
        'src/cache/CacheStore.ts',
        ['CacheStore'],
        'property',
        '_cacheRoot'
      );
      assert.strictEqual(addr, 'src/cache/CacheStore.ts#CacheStore::prop._cacheRoot');
    });

    test('builds address for interface', () => {
      const addr = buildAddress(
        'src/models/types.ts',
        [],
        'interface',
        'SymbolInfo'
      );
      assert.strictEqual(addr, 'src/models/types.ts#interface.SymbolInfo');
    });

    test('builds address for enum', () => {
      const addr = buildAddress(
        'src/models/errors.ts',
        [],
        'enum',
        'ErrorCode'
      );
      assert.strictEqual(addr, 'src/models/errors.ts#enum.ErrorCode');
    });

    test('builds address with overload discriminator', () => {
      const addr = buildAddress(
        'include/Logger.h',
        ['app', 'Logger'],
        'method',
        'log',
        'a3f2'
      );
      assert.strictEqual(
        addr,
        'include/Logger.h#app::Logger::method.log~a3f2'
      );
    });

    test('builds address for unknown kind', () => {
      const addr = buildAddress('src/main.cpp', [], 'unknown', 'something');
      assert.strictEqual(addr, 'src/main.cpp#sym.something');
    });

    test('builds address for deeply nested symbol', () => {
      const addr = buildAddress(
        'src/main.cpp',
        ['app', 'UserService', 'createUser'],
        'variable',
        'nextId'
      );
      assert.strictEqual(
        addr,
        'src/main.cpp#app::UserService::createUser::var.nextId'
      );
    });
  });

  suite('parseAddress', () => {
    test('parses top-level function address', () => {
      const parsed = parseAddress('src/main.cpp#fn.printBanner');
      assert.strictEqual(parsed.filePath, 'src/main.cpp');
      assert.deepStrictEqual(parsed.scopeChain, []);
      assert.strictEqual(parsed.kind, 'function');
      assert.strictEqual(parsed.name, 'printBanner');
      assert.strictEqual(parsed.overloadDiscriminator, null);
    });

    test('parses scoped function address', () => {
      const parsed = parseAddress(
        'src/UserService.cpp#app::UserService::fn.createUser'
      );
      assert.strictEqual(parsed.filePath, 'src/UserService.cpp');
      assert.deepStrictEqual(parsed.scopeChain, ['app', 'UserService']);
      assert.strictEqual(parsed.kind, 'function');
      assert.strictEqual(parsed.name, 'createUser');
    });

    test('parses address with overload discriminator', () => {
      const parsed = parseAddress(
        'include/Logger.h#app::Logger::method.log~a3f2'
      );
      assert.strictEqual(parsed.filePath, 'include/Logger.h');
      assert.deepStrictEqual(parsed.scopeChain, ['app', 'Logger']);
      assert.strictEqual(parsed.kind, 'method');
      assert.strictEqual(parsed.name, 'log');
      assert.strictEqual(parsed.overloadDiscriminator, 'a3f2');
    });

    test('parses local variable address', () => {
      const parsed = parseAddress('src/main.cpp#main::var.logger');
      assert.strictEqual(parsed.filePath, 'src/main.cpp');
      assert.deepStrictEqual(parsed.scopeChain, ['main']);
      assert.strictEqual(parsed.kind, 'variable');
      assert.strictEqual(parsed.name, 'logger');
    });

    test('parses class address', () => {
      const parsed = parseAddress('src/cache/CacheStore.ts#class.CacheStore');
      assert.strictEqual(parsed.filePath, 'src/cache/CacheStore.ts');
      assert.deepStrictEqual(parsed.scopeChain, []);
      assert.strictEqual(parsed.kind, 'class');
      assert.strictEqual(parsed.name, 'CacheStore');
    });

    test('throws on missing # separator', () => {
      assert.throws(() => parseAddress('src/main.cpp'), /missing #/);
    });

    test('throws on missing kind.name', () => {
      assert.throws(() => parseAddress('src/main.cpp#noKindDot'), /missing kind\.name/);
    });

    test('round-trips with buildAddress', () => {
      const original = buildAddress(
        'src/UserService.cpp',
        ['app', 'UserService'],
        'function',
        'createUser'
      );
      const parsed = parseAddress(original);
      const rebuilt = buildAddress(
        parsed.filePath,
        parsed.scopeChain,
        parsed.kind,
        parsed.name,
        parsed.overloadDiscriminator || undefined
      );
      assert.strictEqual(rebuilt, original);
    });

    test('round-trips with overload discriminator', () => {
      const original = buildAddress(
        'include/Logger.h',
        ['app', 'Logger'],
        'method',
        'log',
        'a3f2'
      );
      const parsed = parseAddress(original);
      const rebuilt = buildAddress(
        parsed.filePath,
        parsed.scopeChain,
        parsed.kind,
        parsed.name,
        parsed.overloadDiscriminator || undefined
      );
      assert.strictEqual(rebuilt, original);
    });
  });

  suite('computeDiscriminator', () => {
    test('returns a 4-character hex string', () => {
      const d = computeDiscriminator('const std::string&');
      assert.strictEqual(d.length, 4);
      assert.ok(/^[0-9a-f]{4}$/.test(d));
    });

    test('returns different discriminators for different signatures', () => {
      const d1 = computeDiscriminator('const std::string&');
      const d2 = computeDiscriminator('int,const std::string&');
      assert.notStrictEqual(d1, d2);
    });

    test('returns the same discriminator for the same signature', () => {
      const d1 = computeDiscriminator('string');
      const d2 = computeDiscriminator('string');
      assert.strictEqual(d1, d2);
    });

    test('handles empty signature', () => {
      const d = computeDiscriminator('');
      assert.strictEqual(d.length, 4);
      assert.ok(/^[0-9a-f]{4}$/.test(d));
    });

    test('is deterministic', () => {
      // Running many times should give the same result
      const results = Array.from({ length: 10 }, () =>
        computeDiscriminator('int,const char*,...')
      );
      assert.ok(results.every((r) => r === results[0]));
    });
  });

  suite('addressToCachePath', () => {
    test('derives cache path for top-level function', () => {
      const p = addressToCachePath('src/main.cpp#fn.printBanner');
      assert.ok(p.includes('.vscode'));
      assert.ok(p.includes('code-explorer'));
      assert.ok(p.includes('src/main.cpp'));
      assert.ok(p.endsWith('fn.printBanner.md'));
    });

    test('derives cache path for scoped function', () => {
      const p = addressToCachePath(
        'src/UserService.cpp#app::fn.UserService::createUser'
      );
      assert.ok(p.endsWith('app.fn.UserService.createUser.md'));
    });

    test('derives cache path for overloaded method', () => {
      const p = addressToCachePath(
        'include/Logger.h#app::Logger::method.log~a3f2'
      );
      assert.ok(p.endsWith('app.Logger.method.log~a3f2.md'));
    });

    test('derives cache path for class', () => {
      const p = addressToCachePath(
        'src/cache/CacheStore.ts#class.CacheStore'
      );
      assert.ok(p.endsWith('class.CacheStore.md'));
    });

    test('throws on invalid address', () => {
      assert.throws(
        () => addressToCachePath('nohash'),
        /missing #/
      );
    });
  });
});
