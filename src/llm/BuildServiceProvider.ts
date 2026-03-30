/**
 * Code Explorer — Build Service LLM Provider
 *
 * Uses the Go-based bd-build-service HTTP API (POST /api/v1/copilot/run)
 * to run copilot agent analysis instead of spawning a local CLI process.
 *
 * The build service manages copilot lifecycle, context upload, and output
 * collection. This provider submits the prompt as an async job, polls for
 * completion with incremental log streaming, and returns the collected
 * output.
 *
 * ## Output Collection Mechanism
 *
 * The Go build service uses a **file-based output** model:
 *
 * 1. The provider appends an output-save instruction to the prompt:
 *    "Save your complete response to: `{{output_folder}}/analysis.md`"
 *
 * 2. The Go service replaces `{{output_folder}}` with an actual temp
 *    directory path on the machine where the agent runs.
 *
 * 3. The `output_files: ["analysis.md"]` field in the API request tells
 *    the Go service which filenames to read back from that directory
 *    after the agent finishes.
 *
 * 4. The collected file content is returned in
 *    `result.output_files["analysis.md"]`.
 *
 * Without this instruction the agent writes to stdout, and the output
 * may not be captured reliably (the `output_tail` fallback truncates).
 *
 * Configuration:
 *   - codeExplorer.llmProvider: "build-service"
 *   - codeExplorer.buildServiceUrl: "http://localhost:8090" (default)
 *   - codeExplorer.buildServiceModel: "claude-opus-4.5" (default)
 *   - codeExplorer.buildServiceAgentBackend: "copilot" | "mai-claude" | "claude" (optional)
 *
 * API reference: bd-build-service-go/docs/01-API-Signatures.md
 */
import * as http from 'http';
import * as https from 'https';
import type { LLMAnalysisRequest, ProviderCapabilities } from '../models/types';
import type { LLMProvider } from './LLMProvider';
import { LLMError, ErrorCode } from '../models/errors';
import { logger } from '../utils/logger';

/** Response from POST /api/v1/copilot/run */
interface JobResponse {
  job_id: string;
  status: string;
  message: string;
}

/** Response from GET /api/v1/jobs/{job_id} */
interface JobStatus {
  job_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  exit_code: number | null;
  started_at: string | null;
  completed_at: string | null;
  duration_seconds: number | null;
  output_tail: string;
  error: string;
  log_dir: string;
  result: Record<string, unknown> | null;
}

/** Response from GET /api/v1/jobs/{job_id}/logs */
interface JobLogs {
  job_id: string;
  log: string;
  offset: number;
  is_complete: boolean;
}

export interface BuildServiceOptions {
  /** Base URL of the build service (default: http://localhost:8090) */
  baseUrl?: string;
  /** LLM model to use (default: claude-opus-4.5) */
  model?: string;
  /** Agent backend: "copilot", "mai-claude", or "claude" */
  agentBackend?: string;
  /** Poll interval in ms (default: 3000) */
  pollIntervalMs?: number;
  /** Max timeout in ms (default: 900000 = 15 min) */
  timeoutMs?: number;
}

export class BuildServiceProvider implements LLMProvider {
  readonly name = 'build-service';

  private _baseUrl: string;
  private _model: string;
  private _agentBackend?: string;
  private _pollIntervalMs: number;
  private _timeoutMs: number;
  private _workspaceRoot?: string;
  private _crSrcFolder?: string;
  private _depotToolsPath?: string;

  constructor(options?: BuildServiceOptions) {
    this._baseUrl = (options?.baseUrl || 'http://localhost:8090').replace(/\/$/, '');
    this._model = options?.model || 'claude-opus-4.5';
    this._agentBackend = options?.agentBackend;
    this._pollIntervalMs = options?.pollIntervalMs || 3000;
    this._timeoutMs = options?.timeoutMs || 900_000;
  }

  /** Set the workspace root so the build service has context. */
  setWorkspaceRoot(root: string): void {
    this._workspaceRoot = root;
    // Derive cr_src_folder and depot_tools_path from workspace root
    this._crSrcFolder = root;
    // Try to derive depot_tools path (mirrors Python client logic)
    const match = root.match(/^\/workspace\/(cr\d*)\/src\/?$/);
    if (match) {
      this._depotToolsPath = `/workspace/${match[1]}/chromium.depot_tools.cr-contrib`;
    }
  }

  /** Set chromium-specific paths explicitly. */
  setCrPaths(crSrcFolder: string, depotToolsPath: string): void {
    this._crSrcFolder = crSrcFolder;
    this._depotToolsPath = depotToolsPath;
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Health check: try to list jobs (lightweight GET)
      await this._httpGet('/api/v1/jobs');
      logger.debug('build-service: health check passed');
      return true;
    } catch (err) {
      const error = err as Error;
      logger.warn(`build-service: not available at ${this._baseUrl}: ${error.message}`);
      return false;
    }
  }

  /**
   * The filename the agent is instructed to write its analysis output to.
   * The Go build service replaces `{{output_folder}}` in the prompt with
   * an actual temp directory, and collects this file after the agent exits.
   */
  private static readonly _outputFilename = 'analysis.md';

  async analyze(request: LLMAnalysisRequest): Promise<string> {
    const outputFile = BuildServiceProvider._outputFilename;

    // --- Build the prompt for the build service ---
    //
    // When running through the Go build service the agent executes in
    // **agentic mode** (with `-p` flag, tools enabled).  It must use the
    // Write tool to save its output to `{{output_folder}}/analysis.md`.
    // The Go service replaces `{{output_folder}}` with a real temp dir
    // and reads the file back after the agent exits.
    //
    // The output instruction is placed at the TOP of the prompt (before
    // the analysis task) so the agent knows from the start that it must
    // write to a file — not just print text to stdout.
    //
    // Phrasing mirrors the production CL-review pipeline prompts that
    // have proven reliable (see prompts/cl_review/*.md).

    const outputInstruction =
      `## CRITICAL: Output Instructions\n\n` +
      `You MUST write your complete analysis to a file. Do NOT just print it to stdout.\n\n` +
      `Write the analysis document to: \`{{output_folder}}/${outputFile}\`\n\n` +
      `Use the Write tool to create this file. If the document exceeds ~15,000 characters,\n` +
      `write it incrementally: Write the first portion, then Edit to append the rest.\n\n` +
      `---\n\n`;

    // System prompt: reframe for agentic/file-writing mode
    const systemPrompt = request.systemPrompt
      ? request.systemPrompt +
        ` Write your complete response to the file path specified in the prompt using the Write tool.`
      : `You are a code analysis assistant. Analyze the given code and write your complete structured response to the file path specified in the prompt using the Write tool. Be concise and specific.`;

    const fullPrompt =
      `[System instructions: ${systemPrompt}]\n\n` +
      outputInstruction +
      request.prompt +
      `\n\n---\n\n## Output Format\n\n` +
      `Write the complete analysis document to: \`{{output_folder}}/${outputFile}\`\n`;

    logger.info(
      `build-service: submitting copilot agent job ` +
        `(prompt=${fullPrompt.length} chars, model=${this._model}, ` +
        `output_file=${outputFile})`
    );
    const startTime = Date.now();

    try {
      // Step 1: Submit the copilot run job
      const payload: Record<string, unknown> = {
        cr_src_folder: this._crSrcFolder || this._workspaceRoot || '/workspace/cr1/src',
        depot_tools_path: this._depotToolsPath || '/workspace/cr1/chromium.depot_tools.cr-contrib',
        prompt_content: fullPrompt,
        model: this._model,
        output_files: [outputFile],
        timeout_seconds: Math.floor(this._timeoutMs / 1000),
      };

      if (this._agentBackend) {
        payload.agent_backend = this._agentBackend;
      }

      const jobResp = await this._httpPost<JobResponse>('/api/v1/copilot/run', payload);
      const jobId = jobResp.job_id;

      if (!jobId) {
        throw new LLMError(
          'build-service: no job_id in response',
          ErrorCode.LLM_UNAVAILABLE,
          'Build service returned no job ID. Is the service running?'
        );
      }

      logger.info(
        `build-service: job submitted — job_id=${jobId} ` +
          `(backend=${this._agentBackend || 'default'}, model=${this._model})`
      );

      // Step 2: Poll for completion with incremental log streaming
      const result = await this._pollForCompletion(jobId, startTime);
      const elapsed = Date.now() - startTime;

      logger.info(
        `build-service: job ${jobId} completed in ${elapsed}ms ` +
          `(exit_code=${result.exit_code}, output=${result.output_tail?.length || 0} chars)`
      );

      // Step 3: Extract output — prefer output_files (file-based collection)
      let output = '';

      if (result.result && typeof result.result === 'object') {
        const outputFiles = result.result.output_files as Record<string, string> | undefined;
        if (outputFiles) {
          // Prefer the exact requested filename
          if (outputFiles[outputFile]) {
            output = outputFiles[outputFile];
            logger.info(
              `build-service: collected ${outputFile} from output_files ` +
                `(${output.length} chars)`
            );
          } else if (Object.keys(outputFiles).length > 0) {
            // Fallback: agent may have used a different filename but same
            // extension. Take the first .md file, or any file.
            const mdKey = Object.keys(outputFiles).find((k) => k.endsWith('.md'));
            const fallbackKey = mdKey || Object.keys(outputFiles)[0];
            output = outputFiles[fallbackKey];
            logger.warn(
              `build-service: ${outputFile} not found in output_files, ` +
                `using fallback "${fallbackKey}" (${output.length} chars)`
            );
          }
        }
      }

      // Fallback: use output_tail (raw stdout/stderr from the agent)
      if (!output && result.output_tail) {
        output = result.output_tail;
        logger.warn(
          `build-service: no output_files collected for job ${jobId}, ` +
            `falling back to output_tail (${output.length} chars)`
        );
      }

      if (!output.trim()) {
        throw new LLMError(
          `build-service: job ${jobId} returned empty output`,
          ErrorCode.LLM_PARSE_ERROR,
          'AI analysis returned empty. Try again.'
        );
      }

      return output;
    } catch (err: unknown) {
      if (err instanceof LLMError) {
        throw err;
      }

      const elapsed = Date.now() - startTime;
      const error = err as Error;

      logger.error(`build-service: failed after ${elapsed}ms: ${error.message}`);
      throw new LLMError(
        `build-service failed: ${error.message}`,
        ErrorCode.LLM_UNAVAILABLE,
        'AI analysis via build service failed. Check if the service is running.'
      );
    }
  }

  getCapabilities(): ProviderCapabilities {
    return {
      maxContextTokens: 200_000,
      supportsStreaming: false,
      costPerMTokenInput: 3.0,
      costPerMTokenOutput: 15.0,
    };
  }

  // ---------------------------------------------------------------------------
  // Internal HTTP helpers
  // ---------------------------------------------------------------------------

  /**
   * Poll a job until it reaches a terminal state or times out.
   * Streams incremental logs to the logger during polling.
   */
  private async _pollForCompletion(jobId: string, startTime: number): Promise<JobStatus> {
    const deadline = startTime + this._timeoutMs;
    let logOffset = 0;

    while (Date.now() < deadline) {
      // Poll incremental logs
      try {
        const logsResp = await this._httpGet<JobLogs>(
          `/api/v1/jobs/${jobId}/logs`,
          { since_offset: String(logOffset) }
        );

        if (logsResp.log) {
          logOffset = logsResp.offset;
          // Stream log lines to our logger
          const lines = logsResp.log.split('\n');
          for (const line of lines) {
            if (line.trim()) {
              logger.debug(`build-service [${jobId}]: ${line}`);
              logger.logLLMChunk(line + '\n');
            }
          }
        }

        if (logsResp.is_complete) {
          // Job finished — fetch final status
          const statusResp = await this._httpGet<JobStatus>(`/api/v1/jobs/${jobId}`);
          return statusResp;
        }
      } catch (err) {
        const error = err as Error;
        logger.warn(`build-service: error polling job ${jobId}: ${error.message}`);
      }

      // Wait before next poll
      await this._sleep(this._pollIntervalMs);
    }

    // Timeout — attempt to cancel the job
    logger.error(`build-service: job ${jobId} timed out after ${this._timeoutMs}ms`);
    try {
      await this._httpPost(`/api/v1/jobs/${jobId}/cancel`, {});
      logger.info(`build-service: cancelled timed-out job ${jobId}`);
    } catch {
      logger.warn(`build-service: failed to cancel job ${jobId}`);
    }

    throw new LLMError(
      `build-service: job ${jobId} timed out after ${this._timeoutMs}ms`,
      ErrorCode.LLM_TIMEOUT,
      'AI analysis timed out. Try again or use a simpler symbol.'
    );
  }

  /** Perform an HTTP POST and return parsed JSON. */
  private _httpPost<T = Record<string, unknown>>(
    path: string,
    payload: Record<string, unknown>
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this._baseUrl);
      const body = JSON.stringify(payload);

      const mod = url.protocol === 'https:' ? https : http;
      const req = mod.request(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 500)}`));
              return;
            }
            try {
              resolve(JSON.parse(data) as T);
            } catch {
              reject(new Error(`Invalid JSON response: ${data.substring(0, 200)}`));
            }
          });
        }
      );

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  /** Perform an HTTP GET and return parsed JSON. */
  private _httpGet<T = Record<string, unknown>>(
    path: string,
    params?: Record<string, string>
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this._baseUrl);
      if (params) {
        for (const [key, value] of Object.entries(params)) {
          url.searchParams.set(key, value);
        }
      }

      const mod = url.protocol === 'https:' ? https : http;
      const req = mod.request(url, { method: 'GET' }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 500)}`));
            return;
          }
          try {
            resolve(JSON.parse(data) as T);
          } catch {
            reject(new Error(`Invalid JSON response: ${data.substring(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.end();
    });
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
