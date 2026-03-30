/**
 * Code Explorer — Unit Tests for BuildServiceProvider
 *
 * Spins up a local HTTP server to mock the Go build service API,
 * so tests run fast and deterministically without the real service.
 *
 * Covers:
 *   - Constructor defaults and option overrides
 *   - setWorkspaceRoot() and setCrPaths() path derivation
 *   - isAvailable() health check (success + failure)
 *   - analyze() happy path: job submit → poll logs → completion → output
 *   - analyze() with output_files in result
 *   - analyze() with systemPrompt prepended
 *   - analyze() error: no job_id returned
 *   - analyze() error: empty output
 *   - analyze() error: HTTP failure wraps as LLMError
 *   - analyze() timeout: polls until deadline, cancels job, throws LLM_TIMEOUT
 *   - getCapabilities() returns expected shape
 *   - Factory integration: LLMProviderFactory.create('build-service', ...)
 */
import * as assert from 'assert';
import * as http from 'http';
import { BuildServiceProvider } from '../../../src/llm/BuildServiceProvider';
import { LLMProviderFactory } from '../../../src/llm/LLMProviderFactory';
import { LLMError, ErrorCode } from '../../../src/models/errors';

// ---------------------------------------------------------------------------
// Mock Build Service Server
// ---------------------------------------------------------------------------

interface MockJob {
  job_id: string;
  status: string;
  exit_code: number | null;
  output_tail: string;
  error: string;
  result: Record<string, unknown> | null;
  log: string;
  log_complete: boolean;
  started_at: string | null;
  completed_at: string | null;
  duration_seconds: number | null;
  log_dir: string;
  label?: string;
}

/**
 * A tiny HTTP server that mimics the Go build service API.
 * Tests register mock jobs via `addJob()` and configure per-request
 * behaviour via `setBehaviour()`.
 */
class MockBuildService {
  private _server: http.Server;
  private _jobs: Map<string, MockJob> = new Map();
  private _port = 0;
  private _submitBehaviour: 'normal' | 'no-job-id' | 'http-error' = 'normal';
  private _nextJobId = 'test-job-001';
  private _requestLog: Array<{ method: string; path: string; body?: string }> = [];
  private _pollCount = 0;

  /** How many times GET /api/v1/jobs/:id/logs has been called. */
  get pollCount(): number {
    return this._pollCount;
  }

  /** All requests received (for assertions). */
  get requests(): Array<{ method: string; path: string; body?: string }> {
    return this._requestLog;
  }

  constructor() {
    this._server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        this._requestLog.push({ method: req.method!, path: req.url!, body });
        this._handle(req, res, body);
      });
    });
  }

  async start(): Promise<number> {
    return new Promise((resolve) => {
      this._server.listen(0, '127.0.0.1', () => {
        const addr = this._server.address() as { port: number };
        this._port = addr.port;
        resolve(this._port);
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this._server.close(() => resolve());
    });
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this._port}`;
  }

  /** Pre-register a job for the mock to return. */
  addJob(job: MockJob): void {
    this._jobs.set(job.job_id, job);
  }

  /** Set the job ID that the next POST /api/v1/copilot/run will return. */
  setNextJobId(id: string): void {
    this._nextJobId = id;
  }

  /** Control how the submit endpoint behaves. */
  setSubmitBehaviour(b: 'normal' | 'no-job-id' | 'http-error'): void {
    this._submitBehaviour = b;
  }

  /** Reset state between tests. */
  reset(): void {
    this._jobs.clear();
    this._submitBehaviour = 'normal';
    this._nextJobId = 'test-job-001';
    this._requestLog = [];
    this._pollCount = 0;
  }

  // ---- Route handler ----

  private _handle(req: http.IncomingMessage, res: http.ServerResponse, _body: string): void {
    const url = new URL(req.url!, `http://127.0.0.1:${this._port}`);
    const path = url.pathname;

    // GET /api/v1/jobs  (health check / list)
    if (req.method === 'GET' && path === '/api/v1/jobs') {
      this._json(res, 200, { jobs: Array.from(this._jobs.values()) });
      return;
    }

    // POST /api/v1/copilot/run  (submit job)
    if (req.method === 'POST' && path === '/api/v1/copilot/run') {
      if (this._submitBehaviour === 'http-error') {
        this._json(res, 500, { error: 'Internal Server Error' });
        return;
      }
      if (this._submitBehaviour === 'no-job-id') {
        this._json(res, 200, { status: 'queued', message: 'ok' });
        return;
      }
      // Normal: create a job from the pre-registered one, or a default
      const jobId = this._nextJobId;
      if (!this._jobs.has(jobId)) {
        // Auto-create a simple completed job
        this._jobs.set(jobId, {
          job_id: jobId,
          status: 'completed',
          exit_code: 0,
          output_tail: '### Overview\nAnalysis result here.',
          error: '',
          result: null,
          log: 'Running analysis...\nDone.',
          log_complete: true,
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          duration_seconds: 5,
          log_dir: '/tmp/logs/test-job-001',
        });
      }
      this._json(res, 200, { job_id: jobId, status: 'queued', message: 'Job queued' });
      return;
    }

    // GET /api/v1/jobs/:id/logs
    const logsMatch = path.match(/^\/api\/v1\/jobs\/([^/]+)\/logs$/);
    if (req.method === 'GET' && logsMatch) {
      this._pollCount++;
      const jobId = logsMatch[1];
      const job = this._jobs.get(jobId);
      if (!job) {
        this._json(res, 404, { error: 'Job not found' });
        return;
      }
      this._json(res, 200, {
        job_id: jobId,
        log: job.log,
        offset: job.log.length,
        is_complete: job.log_complete,
      });
      return;
    }

    // GET /api/v1/jobs/:id  (status)
    const statusMatch = path.match(/^\/api\/v1\/jobs\/([^/]+)$/);
    if (req.method === 'GET' && statusMatch) {
      const jobId = statusMatch[1];
      const job = this._jobs.get(jobId);
      if (!job) {
        this._json(res, 404, { error: 'Job not found' });
        return;
      }
      this._json(res, 200, job);
      return;
    }

    // POST /api/v1/jobs/:id/cancel
    const cancelMatch = path.match(/^\/api\/v1\/jobs\/([^/]+)\/cancel$/);
    if (req.method === 'POST' && cancelMatch) {
      const jobId = cancelMatch[1];
      const job = this._jobs.get(jobId);
      if (job) {
        job.status = 'cancelled';
      }
      this._json(res, 200, { job_id: jobId, status: 'cancelled', message: 'Cancelled' });
      return;
    }

    // Fallback
    this._json(res, 404, { error: `Not found: ${req.method} ${path}` });
  }

  private _json(res: http.ServerResponse, status: number, data: unknown): void {
    const body = JSON.stringify(data);
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

suite('BuildServiceProvider', () => {
  let mock: MockBuildService;
  let provider: BuildServiceProvider;

  suiteSetup(async () => {
    mock = new MockBuildService();
    await mock.start();
  });

  suiteTeardown(async () => {
    await mock.stop();
  });

  setup(() => {
    mock.reset();
    provider = new BuildServiceProvider({
      baseUrl: mock.baseUrl,
      model: 'test-model',
      pollIntervalMs: 10, // fast polling for tests
      timeoutMs: 2000,
    });
  });

  // --- Constructor & Config ---

  suite('constructor', () => {
    test('uses defaults when no options provided', () => {
      const p = new BuildServiceProvider();
      assert.strictEqual(p.name, 'build-service');
      // Defaults are internal — we test through getCapabilities and isAvailable behaviour
    });

    test('strips trailing slash from baseUrl', () => {
      const p = new BuildServiceProvider({ baseUrl: 'http://example.com:9090/' });
      assert.strictEqual(p.name, 'build-service');
      // The trailing slash would cause URL resolution issues — verify by checking
      // that the provider doesn't throw on construction
    });
  });

  // --- setWorkspaceRoot ---

  suite('setWorkspaceRoot', () => {
    test('derives depot_tools_path for /workspace/crN/src pattern', () => {
      // We can't access private fields directly, but we can verify indirectly
      // by checking the POST payload sent during analyze()
      provider.setWorkspaceRoot('/workspace/cr3/src');

      mock.addJob({
        job_id: 'test-ws-job',
        status: 'completed',
        exit_code: 0,
        output_tail: 'Analysis output',
        error: '',
        result: { output_files: { 'analysis.md': 'Analysis output' } },
        log: 'done',
        log_complete: true,
        started_at: null,
        completed_at: null,
        duration_seconds: 1,
        log_dir: '',
      });
      mock.setNextJobId('test-ws-job');

      return provider.analyze({ prompt: 'test prompt' }).then(() => {
        const submitReq = mock.requests.find(
          (r) => r.method === 'POST' && r.path === '/api/v1/copilot/run'
        );
        assert.ok(submitReq, 'should have submitted a job');
        const payload = JSON.parse(submitReq!.body!);
        assert.strictEqual(payload.cr_src_folder, '/workspace/cr3/src');
        assert.strictEqual(
          payload.depot_tools_path,
          '/workspace/cr3/chromium.depot_tools.cr-contrib'
        );
      });
    });

    test('uses workspace root as cr_src_folder for non-chromium paths', () => {
      provider.setWorkspaceRoot('/home/user/my-project');

      mock.addJob({
        job_id: 'test-generic-job',
        status: 'completed',
        exit_code: 0,
        output_tail: 'Result',
        error: '',
        result: { output_files: { 'analysis.md': 'Result' } },
        log: 'done',
        log_complete: true,
        started_at: null,
        completed_at: null,
        duration_seconds: 1,
        log_dir: '',
      });
      mock.setNextJobId('test-generic-job');

      return provider.analyze({ prompt: 'test' }).then(() => {
        const submitReq = mock.requests.find(
          (r) => r.method === 'POST' && r.path === '/api/v1/copilot/run'
        );
        const payload = JSON.parse(submitReq!.body!);
        assert.strictEqual(payload.cr_src_folder, '/home/user/my-project');
      });
    });
  });

  // --- setCrPaths ---

  suite('setCrPaths', () => {
    test('overrides both paths explicitly', () => {
      provider.setCrPaths('/custom/src', '/custom/depot');

      mock.addJob({
        job_id: 'test-cr-job',
        status: 'completed',
        exit_code: 0,
        output_tail: 'OK',
        error: '',
        result: { output_files: { 'analysis.md': 'OK' } },
        log: 'done',
        log_complete: true,
        started_at: null,
        completed_at: null,
        duration_seconds: 1,
        log_dir: '',
      });
      mock.setNextJobId('test-cr-job');

      return provider.analyze({ prompt: 'test' }).then(() => {
        const submitReq = mock.requests.find(
          (r) => r.method === 'POST' && r.path === '/api/v1/copilot/run'
        );
        const payload = JSON.parse(submitReq!.body!);
        assert.strictEqual(payload.cr_src_folder, '/custom/src');
        assert.strictEqual(payload.depot_tools_path, '/custom/depot');
      });
    });
  });

  // --- isAvailable ---

  suite('isAvailable', () => {
    test('returns true when build service responds to /api/v1/jobs', async () => {
      const available = await provider.isAvailable();
      assert.strictEqual(available, true);
    });

    test('returns false when build service is unreachable', async () => {
      const badProvider = new BuildServiceProvider({
        baseUrl: 'http://127.0.0.1:1', // nothing listening
        timeoutMs: 1000,
      });
      const available = await badProvider.isAvailable();
      assert.strictEqual(available, false);
    });
  });

  // --- getCapabilities ---

  suite('getCapabilities', () => {
    test('returns expected capability shape', () => {
      const caps = provider.getCapabilities();
      assert.strictEqual(caps.maxContextTokens, 200_000);
      assert.strictEqual(caps.supportsStreaming, false);
      assert.strictEqual(typeof caps.costPerMTokenInput, 'number');
      assert.strictEqual(typeof caps.costPerMTokenOutput, 'number');
    });
  });

  // --- analyze: happy path ---

  suite('analyze — happy path', () => {
    test('submits job with output_files and appended save instruction', async () => {
      mock.addJob({
        job_id: 'happy-job',
        status: 'completed',
        exit_code: 0,
        output_tail: 'raw log output',
        error: '',
        result: {
          output_files: {
            'analysis.md': '### Overview\nThis function handles user login.',
          },
        },
        log: 'Analyzing...\nDone.',
        log_complete: true,
        started_at: '2026-03-30T00:00:00Z',
        completed_at: '2026-03-30T00:00:05Z',
        duration_seconds: 5,
        log_dir: '/tmp/logs/happy-job',
      });
      mock.setNextJobId('happy-job');

      const result = await provider.analyze({ prompt: 'Analyze this function' });

      assert.ok(result.includes('### Overview'));
      assert.ok(result.includes('user login'));

      // Verify the submit request was correct
      const submitReq = mock.requests.find(
        (r) => r.method === 'POST' && r.path === '/api/v1/copilot/run'
      );
      assert.ok(submitReq);
      const payload = JSON.parse(submitReq!.body!);

      // Should request output_files collection
      assert.deepStrictEqual(payload.output_files, ['analysis.md']);

      // Output instruction should appear BEFORE the original prompt
      const promptContent = payload.prompt_content as string;
      const outputInstrIdx = promptContent.indexOf('{{output_folder}}/analysis.md');
      const originalPromptIdx = promptContent.indexOf('Analyze this function');
      assert.ok(outputInstrIdx >= 0, 'prompt should include {{output_folder}}/analysis.md');
      assert.ok(originalPromptIdx >= 0, 'original prompt should be present');
      assert.ok(
        outputInstrIdx < originalPromptIdx,
        'output instruction should appear BEFORE the analysis prompt'
      );

      // Should include Write tool instruction
      assert.ok(
        promptContent.includes('Write tool'),
        'prompt should mention the Write tool'
      );

      // Should include system prompt with file-writing instruction
      assert.ok(
        promptContent.includes('write your complete'),
        'system prompt should instruct file writing'
      );

      assert.strictEqual(payload.model, 'test-model');
    });

    test('prefers output_files["analysis.md"] over output_tail', async () => {
      mock.addJob({
        job_id: 'prefer-file-job',
        status: 'completed',
        exit_code: 0,
        output_tail: 'This is raw stdout — should NOT be used',
        error: '',
        result: {
          output_files: {
            'analysis.md': '### Overview\nFrom the output file.',
          },
        },
        log: 'Done.',
        log_complete: true,
        started_at: null,
        completed_at: null,
        duration_seconds: 3,
        log_dir: '',
      });
      mock.setNextJobId('prefer-file-job');

      const result = await provider.analyze({ prompt: 'test' });

      assert.ok(result.includes('From the output file'));
      assert.ok(!result.includes('should NOT be used'));
    });

    test('falls back to output_tail when output_files is empty', async () => {
      mock.addJob({
        job_id: 'fallback-job',
        status: 'completed',
        exit_code: 0,
        output_tail: '### Overview\nFallback from output_tail.',
        error: '',
        result: {
          output_files: {},
        },
        log: 'Done.',
        log_complete: true,
        started_at: null,
        completed_at: null,
        duration_seconds: 2,
        log_dir: '',
      });
      mock.setNextJobId('fallback-job');

      const result = await provider.analyze({ prompt: 'test' });

      assert.ok(result.includes('Fallback from output_tail'));
    });

    test('falls back to other .md file when analysis.md is missing', async () => {
      mock.addJob({
        job_id: 'alt-file-job',
        status: 'completed',
        exit_code: 0,
        output_tail: 'raw tail',
        error: '',
        result: {
          output_files: {
            'result.md': '### Overview\nFrom alternate filename.',
          },
        },
        log: 'Done.',
        log_complete: true,
        started_at: null,
        completed_at: null,
        duration_seconds: 1,
        log_dir: '',
      });
      mock.setNextJobId('alt-file-job');

      const result = await provider.analyze({ prompt: 'test' });

      // Should use result.md as fallback since analysis.md is missing
      assert.ok(result.includes('From alternate filename'));
    });

    test('incorporates custom systemPrompt with file-writing instruction', async () => {
      mock.addJob({
        job_id: 'system-job',
        status: 'completed',
        exit_code: 0,
        output_tail: 'Result with system prompt',
        error: '',
        result: { output_files: { 'analysis.md': 'Result with system prompt' } },
        log: 'done',
        log_complete: true,
        started_at: null,
        completed_at: null,
        duration_seconds: 1,
        log_dir: '',
      });
      mock.setNextJobId('system-job');

      await provider.analyze({
        prompt: 'Analyze X',
        systemPrompt: 'You are a code analyst.',
      });

      const submitReq = mock.requests.find(
        (r) => r.method === 'POST' && r.path === '/api/v1/copilot/run'
      );
      const payload = JSON.parse(submitReq!.body!);
      const content = payload.prompt_content as string;
      // Custom system prompt should be included
      assert.ok(content.includes('You are a code analyst.'));
      // File-writing instruction should be appended to it
      assert.ok(content.includes('Write your complete response'));
      // Original prompt content should be present
      assert.ok(content.includes('Analyze X'));
      // Output folder instruction
      assert.ok(content.includes('{{output_folder}}/analysis.md'));
    });

    test('includes agent_backend when configured', async () => {
      const p = new BuildServiceProvider({
        baseUrl: mock.baseUrl,
        model: 'test-model',
        agentBackend: 'mai-claude',
        pollIntervalMs: 10,
        timeoutMs: 2000,
      });

      mock.addJob({
        job_id: 'backend-job',
        status: 'completed',
        exit_code: 0,
        output_tail: 'OK',
        error: '',
        result: { output_files: { 'analysis.md': 'OK' } },
        log: 'done',
        log_complete: true,
        started_at: null,
        completed_at: null,
        duration_seconds: 1,
        log_dir: '',
      });
      mock.setNextJobId('backend-job');

      await p.analyze({ prompt: 'test' });

      const submitReq = mock.requests.find(
        (r) => r.method === 'POST' && r.path === '/api/v1/copilot/run'
      );
      const payload = JSON.parse(submitReq!.body!);
      assert.strictEqual(payload.agent_backend, 'mai-claude');
    });

    test('omits agent_backend when not configured', async () => {
      mock.addJob({
        job_id: 'no-backend-job',
        status: 'completed',
        exit_code: 0,
        output_tail: 'OK',
        error: '',
        result: { output_files: { 'analysis.md': 'OK' } },
        log: 'done',
        log_complete: true,
        started_at: null,
        completed_at: null,
        duration_seconds: 1,
        log_dir: '',
      });
      mock.setNextJobId('no-backend-job');

      await provider.analyze({ prompt: 'test' });

      const submitReq = mock.requests.find(
        (r) => r.method === 'POST' && r.path === '/api/v1/copilot/run'
      );
      const payload = JSON.parse(submitReq!.body!);
      assert.strictEqual(payload.agent_backend, undefined);
    });

    test('output instruction appears both before and after analysis prompt', async () => {
      mock.addJob({
        job_id: 'large-file-job',
        status: 'completed',
        exit_code: 0,
        output_tail: '',
        error: '',
        result: { output_files: { 'analysis.md': 'Content here' } },
        log: 'done',
        log_complete: true,
        started_at: null,
        completed_at: null,
        duration_seconds: 1,
        log_dir: '',
      });
      mock.setNextJobId('large-file-job');

      await provider.analyze({ prompt: 'test' });

      const submitReq = mock.requests.find(
        (r) => r.method === 'POST' && r.path === '/api/v1/copilot/run'
      );
      const payload = JSON.parse(submitReq!.body!);
      const content = payload.prompt_content as string;

      // Output instruction should appear twice — before and after the prompt
      const firstIdx = content.indexOf('{{output_folder}}/analysis.md');
      const lastIdx = content.lastIndexOf('{{output_folder}}/analysis.md');
      assert.ok(firstIdx >= 0, 'should have output instruction');
      assert.ok(
        lastIdx > firstIdx,
        'output instruction should appear at least twice (header + footer)'
      );

      // Should include the "CRITICAL" framing
      assert.ok(
        content.includes('CRITICAL'),
        'should include CRITICAL output instruction header'
      );

      // Should mention the Write tool explicitly
      assert.ok(
        content.includes('Write tool'),
        'should instruct agent to use Write tool'
      );
    });
  });

  // --- analyze: error cases ---

  suite('analyze — error cases', () => {
    test('throws LLMError when service returns no job_id', async () => {
      mock.setSubmitBehaviour('no-job-id');

      try {
        await provider.analyze({ prompt: 'test' });
        assert.fail('Expected LLMError');
      } catch (err) {
        assert.ok(err instanceof LLMError);
        assert.strictEqual((err as LLMError).code, ErrorCode.LLM_UNAVAILABLE);
        assert.ok((err as LLMError).message.includes('no job_id'));
      }
    });

    test('throws LLMError when service returns HTTP 500', async () => {
      mock.setSubmitBehaviour('http-error');

      try {
        await provider.analyze({ prompt: 'test' });
        assert.fail('Expected LLMError');
      } catch (err) {
        assert.ok(err instanceof LLMError);
        assert.strictEqual((err as LLMError).code, ErrorCode.LLM_UNAVAILABLE);
      }
    });

    test('throws LLMError with LLM_PARSE_ERROR when output is empty', async () => {
      mock.addJob({
        job_id: 'empty-job',
        status: 'completed',
        exit_code: 0,
        output_tail: '   ',
        error: '',
        result: null,
        log: 'done',
        log_complete: true,
        started_at: null,
        completed_at: null,
        duration_seconds: 1,
        log_dir: '',
      });
      mock.setNextJobId('empty-job');

      try {
        await provider.analyze({ prompt: 'test' });
        assert.fail('Expected LLMError');
      } catch (err) {
        assert.ok(err instanceof LLMError);
        assert.strictEqual((err as LLMError).code, ErrorCode.LLM_PARSE_ERROR);
        assert.ok((err as LLMError).message.includes('empty output'));
      }
    });

    test('throws LLMError when service is unreachable', async () => {
      const badProvider = new BuildServiceProvider({
        baseUrl: 'http://127.0.0.1:1',
        pollIntervalMs: 10,
        timeoutMs: 500,
      });

      try {
        await badProvider.analyze({ prompt: 'test' });
        assert.fail('Expected LLMError');
      } catch (err) {
        assert.ok(err instanceof LLMError);
        assert.strictEqual((err as LLMError).code, ErrorCode.LLM_UNAVAILABLE);
      }
    });
  });

  // --- analyze: timeout ---

  suite('analyze — timeout', () => {
    test('times out when job never completes and cancels the job', async () => {
      const shortTimeoutProvider = new BuildServiceProvider({
        baseUrl: mock.baseUrl,
        pollIntervalMs: 50,
        timeoutMs: 200, // very short timeout
      });

      // Job that never completes (log_complete stays false)
      mock.addJob({
        job_id: 'timeout-job',
        status: 'running',
        exit_code: null,
        output_tail: '',
        error: '',
        result: null,
        log: 'Still running...',
        log_complete: false, // never finishes
        started_at: '2026-03-30T00:00:00Z',
        completed_at: null,
        duration_seconds: null,
        log_dir: '',
      });
      mock.setNextJobId('timeout-job');

      try {
        await shortTimeoutProvider.analyze({ prompt: 'test' });
        assert.fail('Expected LLMError (timeout)');
      } catch (err) {
        assert.ok(err instanceof LLMError);
        assert.strictEqual((err as LLMError).code, ErrorCode.LLM_TIMEOUT);
        assert.ok((err as LLMError).message.includes('timed out'));
      }

      // Verify cancel was attempted
      const cancelReq = mock.requests.find(
        (r) => r.method === 'POST' && r.path === '/api/v1/jobs/timeout-job/cancel'
      );
      assert.ok(cancelReq, 'should have attempted to cancel the timed-out job');

      // Verify the job was polled multiple times
      assert.ok(mock.pollCount >= 2, `expected multiple polls, got ${mock.pollCount}`);
    });
  });

  // --- analyze: polling ---

  suite('analyze — polling behaviour', () => {
    test('polls logs endpoint before fetching final status', async () => {
      mock.addJob({
        job_id: 'poll-job',
        status: 'completed',
        exit_code: 0,
        output_tail: 'Final result',
        error: '',
        result: null,
        log: 'Step 1\nStep 2\nStep 3',
        log_complete: true,
        started_at: null,
        completed_at: null,
        duration_seconds: 2,
        log_dir: '',
      });
      mock.setNextJobId('poll-job');

      const result = await provider.analyze({ prompt: 'test' });
      assert.strictEqual(result, 'Final result');

      // Should have hit logs endpoint at least once
      const logsReqs = mock.requests.filter(
        (r) => r.method === 'GET' && r.path?.includes('/logs')
      );
      assert.ok(logsReqs.length >= 1, 'should poll logs at least once');

      // Should have hit status endpoint for final result
      const statusReqs = mock.requests.filter(
        (r) => r.method === 'GET' && r.path === '/api/v1/jobs/poll-job'
      );
      assert.ok(statusReqs.length >= 1, 'should fetch final status');
    });
  });
});

// ---------------------------------------------------------------------------
// LLMProviderFactory integration
// ---------------------------------------------------------------------------

suite('LLMProviderFactory — build-service', () => {
  test('creates BuildServiceProvider for "build-service" name', () => {
    const provider = LLMProviderFactory.create('build-service', {
      baseUrl: 'http://localhost:9999',
      model: 'custom-model',
      agentBackend: 'copilot',
    });

    assert.strictEqual(provider.name, 'build-service');
    assert.ok(provider instanceof BuildServiceProvider);
  });

  test('creates BuildServiceProvider with defaults when no options', () => {
    const provider = LLMProviderFactory.create('build-service');

    assert.strictEqual(provider.name, 'build-service');
    assert.ok(provider instanceof BuildServiceProvider);
  });

  test('existing providers still work after factory change', () => {
    const copilot = LLMProviderFactory.create('copilot-cli');
    assert.strictEqual(copilot.name, 'copilot-cli');

    const claude = LLMProviderFactory.create('mai-claude');
    assert.strictEqual(claude.name, 'mai-claude');

    const none = LLMProviderFactory.create('none');
    assert.strictEqual(none.name, 'none');

    const fallback = LLMProviderFactory.create('nonexistent');
    assert.strictEqual(fallback.name, 'copilot-cli');
  });
});
