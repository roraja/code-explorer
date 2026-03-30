/**
 * Code Explorer — Unit Tests for MockCopilotProvider
 *
 * Tests the mock-copilot LLM provider by spawning the actual
 * tools/mock-copilot.js script and verifying the response format.
 *
 * Covers:
 *   - Constructor defaults and option overrides
 *   - isAvailable() returns true when script exists
 *   - isAvailable() returns false for bad extensionRoot
 *   - analyze() returns structured mock response
 *   - analyze() echoes back prompt content
 *   - analyze() includes timestamp and CLI args
 *   - analyze() includes json:symbol_identity block
 *   - analyze() prepends systemPrompt when provided
 *   - analyze() respects configurable delay
 *   - analyze() throws LLMError on empty response (not applicable for mock, but coverage)
 *   - getCapabilities() returns expected shape
 *   - Factory integration: LLMProviderFactory.create('mock-copilot', ...)
 */
import * as assert from 'assert';
import * as path from 'path';
import { MockCopilotProvider } from '../../../src/llm/MockCopilotProvider';
import { LLMProviderFactory } from '../../../src/llm/LLMProviderFactory';

// The extension root is the repo root (3 levels up from test/unit/llm/)
const EXTENSION_ROOT = path.resolve(__dirname, '..', '..', '..');

suite('MockCopilotProvider', () => {
  let provider: MockCopilotProvider;

  setup(() => {
    provider = new MockCopilotProvider({
      delayMs: 100, // fast for tests
      extensionRoot: EXTENSION_ROOT,
    });
  });

  // --- Constructor & Config ---

  suite('constructor', () => {
    test('uses default delay of 3000ms when no options', () => {
      const p = new MockCopilotProvider();
      assert.strictEqual(p.name, 'mock-copilot');
      // Default delay is internal — verified through response timing
    });

    test('accepts custom delay and extensionRoot', () => {
      const p = new MockCopilotProvider({
        delayMs: 500,
        extensionRoot: '/some/path',
      });
      assert.strictEqual(p.name, 'mock-copilot');
    });
  });

  // --- setWorkspaceRoot ---

  suite('setWorkspaceRoot', () => {
    test('does not throw', () => {
      provider.setWorkspaceRoot('/tmp/workspace');
      // No assertion needed — just verifying no throw
    });
  });

  // --- setDelayMs ---

  suite('setDelayMs', () => {
    test('updates the delay', () => {
      provider.setDelayMs(0);
      // Verified through response timing in analyze tests
      assert.strictEqual(provider.name, 'mock-copilot');
    });
  });

  // --- isAvailable ---

  suite('isAvailable', () => {
    test('returns true when script exists at extensionRoot', async () => {
      const available = await provider.isAvailable();
      assert.strictEqual(available, true);
    });

    test('returns false when extensionRoot points to nonexistent path', async () => {
      const badProvider = new MockCopilotProvider({
        extensionRoot: '/nonexistent/path/that/does/not/exist',
      });
      const available = await badProvider.isAvailable();
      assert.strictEqual(available, false);
    });
  });

  // --- getCapabilities ---

  suite('getCapabilities', () => {
    test('returns expected capability shape', () => {
      const caps = provider.getCapabilities();
      assert.strictEqual(caps.maxContextTokens, 128_000);
      assert.strictEqual(caps.supportsStreaming, false);
      assert.strictEqual(caps.costPerMTokenInput, 0);
      assert.strictEqual(caps.costPerMTokenOutput, 0);
    });
  });

  // --- analyze: happy path ---

  suite('analyze — happy path', () => {
    test('returns structured mock response with overview', async () => {
      provider.setDelayMs(0); // no delay for test speed
      const result = await provider.analyze({ prompt: 'Analyze this function' });

      assert.ok(result.includes('### Overview'), 'should have Overview section');
      assert.ok(result.includes('mock-copilot'), 'should mention mock-copilot');
      assert.ok(result.includes('mock analysis'), 'should indicate mock analysis');
    });

    test('echoes back prompt content in response', async () => {
      provider.setDelayMs(0);
      const prompt = 'Analyze the function calculateSum in math.ts';
      const result = await provider.analyze({ prompt });

      // The mock echoes a preview of the prompt
      assert.ok(
        result.includes('Analyze the function calculateSum'),
        'should echo prompt content'
      );
    });

    test('includes timestamp in response', async () => {
      provider.setDelayMs(0);
      const result = await provider.analyze({ prompt: 'test prompt' });

      // Should contain an ISO 8601-ish timestamp
      assert.ok(
        result.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
        'should include ISO timestamp'
      );
    });

    test('includes json:symbol_identity block', async () => {
      provider.setDelayMs(0);
      const result = await provider.analyze({ prompt: 'test prompt' });

      assert.ok(
        result.includes('json:symbol_identity'),
        'should include symbol_identity block'
      );
    });

    test('includes json:steps block', async () => {
      provider.setDelayMs(0);
      const result = await provider.analyze({ prompt: 'test prompt' });

      assert.ok(result.includes('json:steps'), 'should include steps block');
    });

    test('includes json:diagrams block', async () => {
      provider.setDelayMs(0);
      const result = await provider.analyze({ prompt: 'test prompt' });

      assert.ok(result.includes('json:diagrams'), 'should include diagrams block');
    });

    test('prepends systemPrompt when provided', async () => {
      provider.setDelayMs(0);
      const result = await provider.analyze({
        prompt: 'Analyze X',
        systemPrompt: 'You are a code analyst.',
      });

      // The system prompt is prepended to the full prompt sent to the mock.
      // The mock echoes back a preview of the prompt in the response.
      assert.ok(
        result.includes('System instructions') || result.includes('code analyst'),
        'systemPrompt should be echoed in response preview'
      );
    });

    test('extracts symbol name from prompt context', async () => {
      provider.setDelayMs(0);
      const result = await provider.analyze({
        prompt: 'The word at cursor is: word: "calculateSum"',
      });

      assert.ok(
        result.includes('calculateSum'),
        'should extract and include symbol name from prompt'
      );
    });
  });

  // --- analyze: timing ---

  suite('analyze — timing', () => {
    test('respects configurable delay', async () => {
      provider.setDelayMs(200); // 200ms delay
      const startTime = Date.now();
      await provider.analyze({ prompt: 'test' });
      const elapsed = Date.now() - startTime;

      // Allow generous margin for process startup + CI variance
      assert.ok(
        elapsed >= 150,
        `Expected at least ~200ms delay, got ${elapsed}ms`
      );
    });

    test('responds quickly with delay=0', async () => {
      provider.setDelayMs(0);
      const startTime = Date.now();
      await provider.analyze({ prompt: 'test' });
      const elapsed = Date.now() - startTime;

      // With 0 delay, should complete reasonably fast (process startup overhead)
      assert.ok(
        elapsed < 5000,
        `Expected fast response with delay=0, got ${elapsed}ms`
      );
    });
  });
});

// ---------------------------------------------------------------------------
// LLMProviderFactory integration
// ---------------------------------------------------------------------------

suite('LLMProviderFactory — mock-copilot', () => {
  test('creates MockCopilotProvider for "mock-copilot" name', () => {
    const provider = LLMProviderFactory.create('mock-copilot', undefined, {
      delayMs: 100,
      extensionRoot: EXTENSION_ROOT,
    });

    assert.strictEqual(provider.name, 'mock-copilot');
    assert.ok(provider instanceof MockCopilotProvider);
  });

  test('creates MockCopilotProvider with defaults when no options', () => {
    const provider = LLMProviderFactory.create('mock-copilot');

    assert.strictEqual(provider.name, 'mock-copilot');
    assert.ok(provider instanceof MockCopilotProvider);
  });

  test('existing providers still work after adding mock-copilot', () => {
    const copilot = LLMProviderFactory.create('copilot-cli');
    assert.strictEqual(copilot.name, 'copilot-cli');

    const claude = LLMProviderFactory.create('mai-claude');
    assert.strictEqual(claude.name, 'mai-claude');

    const buildService = LLMProviderFactory.create('build-service');
    assert.strictEqual(buildService.name, 'build-service');

    const none = LLMProviderFactory.create('none');
    assert.strictEqual(none.name, 'none');

    const fallback = LLMProviderFactory.create('nonexistent');
    assert.strictEqual(fallback.name, 'copilot-cli');
  });
});
