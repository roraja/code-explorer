/**
 * Copilot / Claude Process Monitor
 *
 * A standalone web server that discovers all running copilot and claude CLI
 * processes, shows their status in a dashboard, and provides:
 *   - Live stdout/stderr log streaming via SSE
 *   - Process control (SIGTERM / SIGKILL)
 *   - stdin/stdout/stderr I/O stats from /proc/<pid>/io
 *   - Process tree visualization (parent chain)
 *   - Working directory (cwd) and prompt detection
 *   - Ability to re-drive (restart) a process with the same args/cwd
 *
 * Usage:
 *   node server.js [--port 9100]
 *   Then open http://localhost:9100
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--port') || '9100', 10);

// Process names we care about
const PROCESS_PATTERNS = ['copilot', 'claude'];

// SSE clients for live log streaming  (pid -> Set<ServerResponse>)
const sseClients = new Map();

// Captured log lines per PID (ring buffer, last 2000 lines)
const logBuffers = new Map();
const MAX_LOG_LINES = 2000;

// Active strace/log-tail child processes  (pid -> ChildProcess)
const activeTracers = new Map();

// ---------------------------------------------------------------------------
// Process Discovery
// ---------------------------------------------------------------------------

/**
 * Parse a single /proc/<pid> into a process info object.
 * Returns null if the process doesn't match our patterns or isn't readable.
 */
function readProcInfo(pid) {
  const base = `/proc/${pid}`;
  try {
    // cmdline
    const cmdlineRaw = fs.readFileSync(`${base}/cmdline`, 'utf8');
    const cmdArgs = cmdlineRaw.split('\0').filter(Boolean);
    const cmdline = cmdArgs.join(' ');

    // Only include actual copilot/claude agent processes — not shell wrappers,
    // grep results, or the process monitor itself.
    const lowerCmd = cmdline.toLowerCase();

    // The process's executable name (from /proc/<pid>/status) is the most
    // reliable indicator.  We also inspect cmdArgs[0] for wrapper scripts.
    const statusRaw_ = fs.readFileSync(`${base}/status`, 'utf8');
    const nameMatch = statusRaw_.match(/^Name:\s*(.+)/m);
    const procName = (nameMatch ? nameMatch[1].trim() : '').toLowerCase();

    // Fast-reject: process name must be one of our targets, OR the first
    // cmdline arg must contain copilot/claude/uv/python (for launcher chains).
    const firstArg = (cmdArgs[0] || '').toLowerCase();
    const isRelevantName = PROCESS_PATTERNS.some(p => procName.includes(p));
    const isRelevantCmd =
      PROCESS_PATTERNS.some(p => firstArg.includes(p)) ||
      firstArg.includes('uv') ||
      (firstArg.includes('python') && lowerCmd.includes('mai-claude'));

    if (!isRelevantName && !isRelevantCmd) return null;

    // Exclude false positives: shell commands that merely mention
    // "claude" in their arguments (e.g. shell-snapshot sources,
    // /tmp/claude-* file paths in zsh -c wrappers).
    if (procName === 'zsh' || procName === 'bash' || procName === 'sh') {
      // These are shell wrappers spawned by claude internally — not the
      // agent itself.  Only include them if they are the uv/mai-claude
      // launcher wrapper.
      if (!lowerCmd.includes('mai-claude')) return null;
    }

    // Skip the process monitor itself and grep
    if (lowerCmd.includes('process-monitor') || lowerCmd.includes('server.js')) return null;
    if (procName === 'grep' || procName === 'rg') return null;

    const matchedPattern = PROCESS_PATTERNS.find(p => lowerCmd.includes(p)) || 'unknown';

    // status
    const statusRaw = fs.readFileSync(`${base}/status`, 'utf8');
    const statusLines = {};
    for (const line of statusRaw.split('\n')) {
      const [key, ...rest] = line.split(':');
      if (key) statusLines[key.trim()] = (rest.join(':') || '').trim();
    }

    // stat (for start time, state)
    const statRaw = fs.readFileSync(`${base}/stat`, 'utf8');
    const statFields = statRaw.match(/\) (.+)/);
    const statParts = statFields ? statFields[1].split(' ') : [];
    const state = statParts[0] || '?';
    const startTimeTicks = parseInt(statParts[19] || '0', 10);

    // cwd
    let cwd = '';
    try { cwd = fs.readlinkSync(`${base}/cwd`); } catch {}

    // exe
    let exe = '';
    try { exe = fs.readlinkSync(`${base}/exe`); } catch {}

    // io
    let io = {};
    try {
      const ioRaw = fs.readFileSync(`${base}/io`, 'utf8');
      for (const line of ioRaw.split('\n')) {
        const [key, val] = line.split(':').map(s => s.trim());
        if (key && val) io[key] = parseInt(val, 10);
      }
    } catch {}

    // ppid
    const ppid = parseInt(statusLines['PPid'] || '0', 10);

    // tty
    let tty = '';
    try {
      const fdStdout = fs.readlinkSync(`${base}/fd/0`);
      if (fdStdout.startsWith('/dev/pts/')) {
        tty = fdStdout.replace('/dev/', '');
      }
    } catch {}

    // RSS in KB
    const rssPages = parseInt(statParts[21] || '0', 10);
    const rssKb = rssPages * 4; // page size typically 4KB

    // elapsed time
    let uptimeSeconds = 0;
    try {
      const uptimeRaw = fs.readFileSync('/proc/uptime', 'utf8');
      const systemUptime = parseFloat(uptimeRaw.split(' ')[0]);
      const clockTicks = 100; // sysconf(_SC_CLK_TCK) = 100 on Linux
      const processStartSec = startTimeTicks / clockTicks;
      uptimeSeconds = Math.floor(systemUptime - processStartSec);
    } catch {}

    // VmRSS from status (more accurate)
    const vmRss = statusLines['VmRSS'] || `${rssKb} kB`;

    // Threads
    const threads = statusLines['Threads'] || '1';

    return {
      pid,
      ppid,
      cmdline,
      cmdArgs,
      command: cmdArgs[0] || '',
      name: statusLines['Name'] || '',
      state,
      stateDesc: describeState(state),
      cwd,
      exe,
      tty,
      rssKb: parseInt(vmRss) || rssKb,
      threads: parseInt(threads) || 1,
      uptimeSeconds,
      uptimeFormatted: formatUptime(uptimeSeconds),
      io,
      matchedPattern,
    };
  } catch {
    return null;
  }
}

function describeState(s) {
  const map = { R: 'Running', S: 'Sleeping', D: 'Disk Sleep', Z: 'Zombie', T: 'Stopped', t: 'Tracing', X: 'Dead' };
  return map[s] || s;
}

function formatUptime(seconds) {
  if (seconds <= 0) return 'unknown';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

/**
 * Discover all copilot/claude processes by scanning /proc.
 * Groups them into "sessions" — a process tree rooted at the launcher
 * (uv/mai-claude or direct copilot/claude invocation).
 */
function discoverProcesses() {
  const allProcs = [];
  let entries;
  try {
    entries = fs.readdirSync('/proc');
  } catch {
    return [];
  }

  for (const entry of entries) {
    const pid = parseInt(entry, 10);
    if (isNaN(pid) || pid <= 1) continue;
    const info = readProcInfo(pid);
    if (info) allProcs.push(info);
  }

  // Build sessions: group by process tree
  // A "session" is the top-level launcher (uv or direct copilot/claude)
  // plus all its descendants that we care about.
  const pidMap = new Map(allProcs.map(p => [p.pid, p]));
  const sessions = [];
  const assigned = new Set();

  // Find root processes (whose parent is NOT in our list)
  const roots = allProcs.filter(p => !pidMap.has(p.ppid));

  for (const root of roots) {
    const chain = [root];
    assigned.add(root.pid);

    // Walk children
    let current = root;
    let depth = 0;
    while (depth < 10) {
      const child = allProcs.find(p => p.ppid === current.pid && !assigned.has(p.pid));
      if (!child) break;
      chain.push(child);
      assigned.add(child.pid);
      current = child;
      depth++;
    }

    // The "main" process is the leaf (actual copilot/claude binary)
    const mainProc = chain[chain.length - 1];

    // Determine type
    let type = 'unknown';
    const fullCmd = chain.map(p => p.cmdline).join(' ').toLowerCase();
    if (fullCmd.includes('mai-claude') || (mainProc.name === 'claude' && fullCmd.includes('uv'))) {
      type = 'mai-claude';
    } else if (mainProc.name === 'claude' || mainProc.cmdline.includes('claude')) {
      type = 'claude';
    } else if (fullCmd.includes('copilot')) {
      type = 'copilot';
    }

    // Try to detect if this is a "detached" (non-interactive) or interactive session
    const hasYolo = fullCmd.includes('--yolo');
    const hasSilent = fullCmd.includes(' -s ') || fullCmd.includes(' -s') || fullCmd.includes('--output-format');
    const hasPrintMode = fullCmd.includes(' -p ') || fullCmd.includes(' -p');
    const isNonInteractive = hasSilent || hasPrintMode;

    sessions.push({
      id: mainProc.pid,
      type,
      mainPid: mainProc.pid,
      rootPid: root.pid,
      chain,
      tty: mainProc.tty || root.tty,
      cwd: mainProc.cwd || root.cwd,
      state: mainProc.stateDesc,
      rssKb: chain.reduce((sum, p) => sum + p.rssKb, 0),
      rssMb: Math.round(chain.reduce((sum, p) => sum + p.rssKb, 0) / 1024),
      threads: chain.reduce((sum, p) => sum + p.threads, 0),
      uptimeFormatted: root.uptimeFormatted,
      io: mainProc.io,
      isInteractive: !isNonInteractive,
      hasYolo,
      flags: {
        yolo: hasYolo,
        silent: hasSilent,
        printMode: hasPrintMode,
      },
      args: mainProc.cmdArgs.slice(1),
      logLines: logBuffers.get(mainProc.pid)?.length || 0,
      isTracing: activeTracers.has(mainProc.pid),
    });
  }

  // Also add any orphaned processes not assigned
  for (const proc of allProcs) {
    if (!assigned.has(proc.pid)) {
      sessions.push({
        id: proc.pid,
        type: proc.matchedPattern,
        mainPid: proc.pid,
        rootPid: proc.pid,
        chain: [proc],
        tty: proc.tty,
        cwd: proc.cwd,
        state: proc.stateDesc,
        rssKb: proc.rssKb,
        rssMb: Math.round(proc.rssKb / 1024),
        threads: proc.threads,
        uptimeFormatted: proc.uptimeFormatted,
        io: proc.io,
        isInteractive: true,
        hasYolo: false,
        flags: {},
        args: proc.cmdArgs.slice(1),
        logLines: logBuffers.get(proc.pid)?.length || 0,
        isTracing: activeTracers.has(proc.pid),
      });
    }
  }

  // Sort by type then uptime
  sessions.sort((a, b) => {
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return a.mainPid - b.mainPid;
  });

  return sessions;
}

// ---------------------------------------------------------------------------
// Prompt Detection
// ---------------------------------------------------------------------------

/**
 * Try to detect the prompt that was given to a copilot/claude process.
 * Strategy:
 *   1. Check /tmp/claude-prompt-*.txt files
 *   2. Check code-explorer LLM log files for the PID
 *   3. Read from /proc/<pid>/fd/0 (stdin) — usually a pipe, so limited
 */
function detectPrompt(pid) {
  const results = { prompt: null, source: null, logFile: null };

  // Strategy 1: check /tmp for prompt files
  try {
    const tmpFiles = fs.readdirSync('/tmp').filter(f => f.startsWith('claude-prompt'));
    for (const f of tmpFiles) {
      try {
        const content = fs.readFileSync(`/tmp/${f}`, 'utf8');
        if (content.length > 0) {
          results.prompt = content;
          results.source = `/tmp/${f}`;
          return results;
        }
      } catch {}
    }
  } catch {}

  // Strategy 2: scan code-explorer LLM logs for this PID
  const logDirs = [
    path.join(process.env.HOME || '', '.vscode/code-explorer-logs/llms/'),
  ];

  // Also search all workspace .vscode dirs
  try {
    const proc = readProcInfo(pid);
    if (proc?.cwd) {
      logDirs.push(path.join(proc.cwd, '.vscode', 'code-explorer-logs', 'llms'));
    }
  } catch {}

  for (const logDir of logDirs) {
    try {
      if (!fs.existsSync(logDir)) continue;
      const files = fs.readdirSync(logDir)
        .filter(f => f.endsWith('.md'))
        .sort()
        .reverse()
        .slice(0, 20); // check last 20 log files

      for (const f of files) {
        try {
          const content = fs.readFileSync(path.join(logDir, f), 'utf8');
          if (content.includes(`PID=${pid}`) || content.includes(`pid: ${pid}`)) {
            // Extract prompt section
            const promptMatch = content.match(/## Prompt\n\n([\s\S]*?)(?=\n## |\n---|\Z)/);
            if (promptMatch) {
              results.prompt = promptMatch[1].trim();
              results.source = 'llm-log';
              results.logFile = path.join(logDir, f);
              return results;
            }
            // If no prompt section, return the whole file
            results.prompt = content.substring(0, 5000);
            results.source = 'llm-log-full';
            results.logFile = path.join(logDir, f);
            return results;
          }
        } catch {}
      }
    } catch {}
  }

  // Strategy 3: Try to read cmdline for inline prompts (unlikely but worth trying)
  try {
    const proc = readProcInfo(pid);
    if (proc) {
      const pFlag = proc.cmdArgs.indexOf('-p');
      if (pFlag >= 0 && proc.cmdArgs[pFlag + 1]) {
        results.prompt = proc.cmdArgs[pFlag + 1];
        results.source = 'cmdline-arg';
        return results;
      }
    }
  } catch {}

  return results;
}

// ---------------------------------------------------------------------------
// Live Log Capture (using strace on the process's write syscalls)
// ---------------------------------------------------------------------------

/**
 * Start capturing live stdout/stderr from a process.
 * Uses `strace -e trace=write -p <pid>` to intercept write() syscalls
 * to fd 1 (stdout) and fd 2 (stderr).
 */
function startLogCapture(pid) {
  if (activeTracers.has(pid)) return;

  // Initialize log buffer
  if (!logBuffers.has(pid)) {
    logBuffers.set(pid, []);
  }
  const buf = logBuffers.get(pid);

  // Use strace to capture writes
  const child = spawn('strace', [
    '-e', 'trace=write,read',
    '-e', 'read=0',
    '-e', 'write=1,2',
    '-s', '4096',  // capture up to 4KB per syscall
    '-p', String(pid),
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  activeTracers.set(pid, child);

  const processStraceOutput = (data) => {
    const text = data.toString();
    const lines = text.split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;

      // Parse strace output:
      // write(1, "text here...", 123) = 123
      // write(2, "stderr text...", 45) = 45
      // read(0, "input text...", 4096) = 123
      const writeMatch = line.match(/write\((\d+),\s*"((?:[^"\\]|\\.)*)"/);
      const readMatch = line.match(/read\((\d+),\s*"((?:[^"\\]|\\.)*)"/);

      let logEntry = null;

      if (writeMatch) {
        const fd = parseInt(writeMatch[1], 10);
        let content = writeMatch[2];
        // Unescape strace string escapes
        content = content.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r').replace(/\\\\/g, '\\');

        if (fd === 1) {
          logEntry = { time: Date.now(), fd: 'stdout', content };
        } else if (fd === 2) {
          logEntry = { time: Date.now(), fd: 'stderr', content };
        }
      } else if (readMatch) {
        const fd = parseInt(readMatch[1], 10);
        let content = readMatch[2];
        content = content.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r').replace(/\\\\/g, '\\');

        if (fd === 0) {
          logEntry = { time: Date.now(), fd: 'stdin', content };
        }
      }

      if (logEntry) {
        buf.push(logEntry);
        if (buf.length > MAX_LOG_LINES) buf.shift();

        // Broadcast to SSE clients
        const clients = sseClients.get(pid);
        if (clients) {
          const event = `data: ${JSON.stringify(logEntry)}\n\n`;
          for (const res of clients) {
            try { res.write(event); } catch { clients.delete(res); }
          }
        }
      }
    }
  };

  // strace writes to stderr
  child.stderr.on('data', processStraceOutput);
  child.stdout.on('data', processStraceOutput);

  child.on('close', () => {
    activeTracers.delete(pid);
    const entry = { time: Date.now(), fd: 'system', content: `[Trace ended for PID ${pid}]` };
    buf.push(entry);
    const clients = sseClients.get(pid);
    if (clients) {
      for (const res of clients) {
        try { res.write(`data: ${JSON.stringify(entry)}\n\n`); } catch {}
      }
    }
  });

  child.on('error', (err) => {
    activeTracers.delete(pid);
    const entry = { time: Date.now(), fd: 'error', content: `[Trace error: ${err.message}]` };
    buf.push(entry);
  });

  buf.push({ time: Date.now(), fd: 'system', content: `[Started tracing PID ${pid}]` });
}

function stopLogCapture(pid) {
  const child = activeTracers.get(pid);
  if (child) {
    child.kill('SIGTERM');
    activeTracers.delete(pid);
  }
}

// ---------------------------------------------------------------------------
// Process Control
// ---------------------------------------------------------------------------

function sendSignal(pid, signal) {
  try {
    process.kill(pid, signal);
    return { success: true, message: `Sent ${signal} to PID ${pid}` };
  } catch (err) {
    return { success: false, message: `Failed to send ${signal} to PID ${pid}: ${err.message}` };
  }
}

function redriveProcess(session) {
  // Re-launch the root process with the same args and cwd
  const root = session.chain[0];
  const [cmd, ...args] = root.cmdArgs;

  const child = spawn(cmd, args, {
    cwd: session.cwd || process.cwd(),
    stdio: 'ignore',
    detached: true,
    env: { ...process.env },
  });

  child.unref();

  return {
    success: true,
    message: `Re-driven process: ${cmd} ${args.join(' ')} (new PID: ${child.pid})`,
    newPid: child.pid,
  };
}

// ---------------------------------------------------------------------------
// Build Service Jobs (HTTP proxy to Go build service)
// ---------------------------------------------------------------------------

const BUILD_SERVICE_URL = process.env.BUILD_SERVICE_URL || 'http://localhost:8090';

/**
 * Fetch running/queued copilot jobs from the Go build service.
 * Falls back gracefully if the service is not running.
 */
async function fetchBuildServiceJobs() {
  return new Promise((resolve) => {
    const url = new URL('/api/v1/jobs', BUILD_SERVICE_URL);
    const req = http.request(url, { method: 'GET', timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          // The jobs endpoint may return { jobs: [...] } or an array
          const jobs = Array.isArray(parsed) ? parsed : (parsed.jobs || []);
          resolve(jobs);
        } catch {
          resolve([]);
        }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
    req.end();
  });
}

/**
 * Fetch logs for a specific build service job.
 */
async function fetchBuildServiceJobLogs(jobId, tail) {
  return new Promise((resolve) => {
    const url = new URL(`/api/v1/jobs/${jobId}/logs`, BUILD_SERVICE_URL);
    if (tail) url.searchParams.set('tail', String(tail));
    const req = http.request(url, { method: 'GET', timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ log: '', offset: 0, is_complete: true }); }
      });
    });
    req.on('error', () => resolve({ log: '', offset: 0, is_complete: true }));
    req.on('timeout', () => { req.destroy(); resolve({ log: '', offset: 0, is_complete: true }); });
    req.end();
  });
}

/**
 * Cancel a build service job.
 */
async function cancelBuildServiceJob(jobId) {
  return new Promise((resolve) => {
    const url = new URL(`/api/v1/jobs/${jobId}/cancel`, BUILD_SERVICE_URL);
    const body = JSON.stringify({});
    const req = http.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 5000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ error: 'Invalid response' }); }
      });
    });
    req.on('error', (err) => resolve({ error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'Timeout' }); });
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// HTTP Server + API
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API Routes
  if (pathname === '/api/processes') {
    const sessions = discoverProcesses();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ sessions, timestamp: Date.now() }));
    return;
  }

  if (pathname.startsWith('/api/process/') && pathname.endsWith('/prompt')) {
    const pid = parseInt(pathname.split('/')[3], 10);
    const prompt = detectPrompt(pid);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(prompt));
    return;
  }

  if (pathname.startsWith('/api/process/') && pathname.endsWith('/io')) {
    const pid = parseInt(pathname.split('/')[3], 10);
    const info = readProcInfo(pid);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(info?.io || {}));
    return;
  }

  if (pathname.startsWith('/api/process/') && pathname.endsWith('/logs')) {
    const pid = parseInt(pathname.split('/')[3], 10);
    const lines = logBuffers.get(pid) || [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ pid, lines, count: lines.length }));
    return;
  }

  // SSE endpoint for live log streaming
  if (pathname.startsWith('/api/process/') && pathname.endsWith('/logs/stream')) {
    const pid = parseInt(pathname.split('/')[3], 10);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Auto-start tracing if not already active
    startLogCapture(pid);

    // Register client
    if (!sseClients.has(pid)) sseClients.set(pid, new Set());
    sseClients.get(pid).add(res);

    // Send existing buffered lines
    const existing = logBuffers.get(pid) || [];
    for (const entry of existing) {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    }

    // Keepalive
    const keepalive = setInterval(() => {
      try { res.write(': keepalive\n\n'); } catch {}
    }, 15000);

    req.on('close', () => {
      clearInterval(keepalive);
      const clients = sseClients.get(pid);
      if (clients) {
        clients.delete(res);
        if (clients.size === 0) {
          sseClients.delete(pid);
          // Stop tracing if no more clients
          stopLogCapture(pid);
        }
      }
    });

    return;
  }

  // POST: send signal to process
  if (req.method === 'POST' && pathname.startsWith('/api/process/') && pathname.endsWith('/signal')) {
    const pid = parseInt(pathname.split('/')[3], 10);
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { signal } = JSON.parse(body);
        const result = sendSignal(pid, signal || 'SIGTERM');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // POST: re-drive a process
  if (req.method === 'POST' && pathname.startsWith('/api/process/') && pathname.endsWith('/redrive')) {
    const pid = parseInt(pathname.split('/')[3], 10);
    const sessions = discoverProcesses();
    const session = sessions.find(s => s.mainPid === pid);
    if (!session) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Session for PID ${pid} not found` }));
      return;
    }
    const result = redriveProcess(session);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // POST: start/stop trace
  if (req.method === 'POST' && pathname.startsWith('/api/process/') && pathname.endsWith('/trace/start')) {
    const pid = parseInt(pathname.split('/')[3], 10);
    startLogCapture(pid);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: `Tracing started for PID ${pid}` }));
    return;
  }

  if (req.method === 'POST' && pathname.startsWith('/api/process/') && pathname.endsWith('/trace/stop')) {
    const pid = parseInt(pathname.split('/')[3], 10);
    stopLogCapture(pid);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: `Tracing stopped for PID ${pid}` }));
    return;
  }

  // --- Build Service API proxy routes ---

  if (pathname === '/api/build-service/jobs') {
    const jobs = await fetchBuildServiceJobs();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jobs, timestamp: Date.now() }));
    return;
  }

  if (pathname.startsWith('/api/build-service/jobs/') && pathname.endsWith('/logs')) {
    const jobId = pathname.split('/')[4];
    const tail = url.searchParams.get('tail');
    const logs = await fetchBuildServiceJobLogs(jobId, tail);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(logs));
    return;
  }

  if (req.method === 'POST' && pathname.startsWith('/api/build-service/jobs/') && pathname.endsWith('/cancel')) {
    const jobId = pathname.split('/')[4];
    const result = await cancelBuildServiceJob(jobId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // Serve the HTML UI
  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getIndexHTML());
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ┌──────────────────────────────────────────────┐`);
  console.log(`  │  Copilot/Claude Process Monitor              │`);
  console.log(`  │  http://localhost:${PORT}                       │`);
  console.log(`  └──────────────────────────────────────────────┘\n`);
});

// ---------------------------------------------------------------------------
// HTML UI (single-file, no build step)
// ---------------------------------------------------------------------------

function getIndexHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Copilot/Claude Process Monitor</title>
<style>
  :root {
    --bg: #0d1117;
    --bg-card: #161b22;
    --bg-hover: #1c2333;
    --bg-input: #0d1117;
    --border: #30363d;
    --border-active: #58a6ff;
    --text: #e6edf3;
    --text-muted: #8b949e;
    --text-bright: #ffffff;
    --accent-blue: #58a6ff;
    --accent-green: #3fb950;
    --accent-red: #f85149;
    --accent-orange: #d29922;
    --accent-purple: #bc8cff;
    --accent-cyan: #39d353;
    --stdout-color: #e6edf3;
    --stderr-color: #f0883e;
    --stdin-color: #58a6ff;
    --system-color: #8b949e;
    --font-mono: 'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'SF Mono', Monaco, Consolas, monospace;
    --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: var(--font-sans);
    background: var(--bg);
    color: var(--text);
    line-height: 1.5;
    min-height: 100vh;
  }

  /* Header */
  .header {
    background: var(--bg-card);
    border-bottom: 1px solid var(--border);
    padding: 16px 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: sticky;
    top: 0;
    z-index: 100;
  }

  .header h1 {
    font-size: 18px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .header h1 .icon { font-size: 22px; }

  .header-stats {
    display: flex;
    gap: 20px;
    font-size: 13px;
    color: var(--text-muted);
  }

  .header-stats .stat-value {
    color: var(--accent-blue);
    font-weight: 600;
    font-family: var(--font-mono);
  }

  .header-actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  /* Main layout */
  .main {
    display: flex;
    height: calc(100vh - 57px);
  }

  /* Process list sidebar */
  .sidebar {
    width: 420px;
    min-width: 320px;
    border-right: 1px solid var(--border);
    overflow-y: auto;
    background: var(--bg);
  }

  .sidebar-header {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    display: flex;
    justify-content: space-between;
    align-items: center;
    position: sticky;
    top: 0;
    background: var(--bg);
    z-index: 10;
  }

  .process-card {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    transition: background 0.15s;
  }

  .process-card:hover { background: var(--bg-hover); }
  .process-card.active { background: var(--bg-hover); border-left: 3px solid var(--accent-blue); }

  .process-card .card-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
  }

  .process-card .card-type {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 600;
  }

  .type-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 600;
    font-family: var(--font-mono);
  }

  .type-badge.copilot { background: rgba(88, 166, 255, 0.15); color: var(--accent-blue); }
  .type-badge.claude { background: rgba(188, 140, 255, 0.15); color: var(--accent-purple); }
  .type-badge.mai-claude { background: rgba(63, 185, 80, 0.15); color: var(--accent-green); }

  .state-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
  }

  .state-dot.running { background: var(--accent-green); box-shadow: 0 0 6px var(--accent-green); }
  .state-dot.sleeping { background: var(--accent-orange); }
  .state-dot.stopped { background: var(--accent-red); }
  .state-dot.zombie { background: var(--accent-red); box-shadow: 0 0 6px var(--accent-red); }

  .process-card .card-meta {
    font-size: 11px;
    color: var(--text-muted);
    font-family: var(--font-mono);
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }

  .process-card .card-cwd {
    font-size: 11px;
    color: var(--text-muted);
    font-family: var(--font-mono);
    margin-top: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .process-card .card-flags {
    display: flex;
    gap: 4px;
    margin-top: 4px;
  }

  .flag-tag {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-family: var(--font-mono);
    background: rgba(139, 148, 158, 0.15);
    color: var(--text-muted);
  }

  .flag-tag.interactive { background: rgba(63, 185, 80, 0.15); color: var(--accent-green); }
  .flag-tag.batch { background: rgba(210, 153, 34, 0.15); color: var(--accent-orange); }

  /* Detail panel */
  .detail {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .detail-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    color: var(--text-muted);
    font-size: 14px;
    flex-direction: column;
    gap: 8px;
  }

  .detail-empty .icon { font-size: 48px; opacity: 0.3; }

  .detail-header {
    padding: 12px 20px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-card);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  .detail-header .detail-title {
    font-size: 15px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .detail-actions {
    display: flex;
    gap: 6px;
  }

  .btn {
    padding: 5px 12px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg-card);
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    transition: all 0.15s;
    font-family: var(--font-sans);
  }

  .btn:hover { border-color: var(--border-active); background: var(--bg-hover); }
  .btn.danger { border-color: rgba(248, 81, 73, 0.3); color: var(--accent-red); }
  .btn.danger:hover { background: rgba(248, 81, 73, 0.1); border-color: var(--accent-red); }
  .btn.primary { border-color: rgba(88, 166, 255, 0.3); color: var(--accent-blue); }
  .btn.primary:hover { background: rgba(88, 166, 255, 0.1); border-color: var(--accent-blue); }
  .btn.success { border-color: rgba(63, 185, 80, 0.3); color: var(--accent-green); }
  .btn.success:hover { background: rgba(63, 185, 80, 0.1); border-color: var(--accent-green); }

  /* Tabs in detail panel */
  .detail-tabs {
    display: flex;
    border-bottom: 1px solid var(--border);
    background: var(--bg-card);
    padding: 0 20px;
  }

  .detail-tab {
    padding: 8px 16px;
    font-size: 13px;
    cursor: pointer;
    color: var(--text-muted);
    border-bottom: 2px solid transparent;
    transition: all 0.15s;
  }

  .detail-tab:hover { color: var(--text); }
  .detail-tab.active { color: var(--accent-blue); border-bottom-color: var(--accent-blue); }

  /* Tab content */
  .tab-content {
    flex: 1;
    overflow: hidden;
    display: none;
  }

  .tab-content.active { display: flex; flex-direction: column; }

  /* Info tab */
  .info-grid {
    padding: 20px;
    overflow-y: auto;
    flex: 1;
  }

  .info-section {
    margin-bottom: 20px;
  }

  .info-section h3 {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    margin-bottom: 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border);
  }

  .info-row {
    display: flex;
    padding: 4px 0;
    font-size: 13px;
  }

  .info-label {
    width: 140px;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .info-value {
    font-family: var(--font-mono);
    font-size: 12px;
    word-break: break-all;
  }

  /* IO Stats */
  .io-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px;
    padding: 8px 0;
  }

  .io-stat {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px;
    text-align: center;
  }

  .io-stat .value {
    font-size: 20px;
    font-weight: 700;
    font-family: var(--font-mono);
    color: var(--accent-blue);
  }

  .io-stat .label {
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 4px;
  }

  /* Process chain */
  .process-chain {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 0;
  }

  .chain-node {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .chain-node .chain-pid {
    color: var(--accent-blue);
    font-weight: 600;
    min-width: 60px;
  }

  .chain-node .chain-name {
    color: var(--accent-green);
    min-width: 80px;
  }

  .chain-arrow {
    color: var(--text-muted);
    padding-left: 20px;
    font-size: 14px;
  }

  /* Log viewer */
  .log-viewer {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.6;
    background: #010409;
  }

  .log-line {
    padding: 1px 16px;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .log-line:hover { background: rgba(139, 148, 158, 0.05); }

  .log-line .log-time {
    color: var(--text-muted);
    margin-right: 8px;
    font-size: 10px;
  }

  .log-line .log-fd {
    display: inline-block;
    min-width: 50px;
    font-weight: 600;
    margin-right: 8px;
  }

  .log-line.stdout .log-fd { color: var(--stdout-color); }
  .log-line.stderr .log-fd { color: var(--stderr-color); }
  .log-line.stdin .log-fd { color: var(--stdin-color); }
  .log-line.system .log-fd { color: var(--system-color); }
  .log-line.error .log-fd { color: var(--accent-red); }

  .log-line.stdout .log-content { color: var(--stdout-color); }
  .log-line.stderr .log-content { color: var(--stderr-color); }
  .log-line.stdin .log-content { color: var(--stdin-color); }
  .log-line.system .log-content { color: var(--system-color); font-style: italic; }
  .log-line.error .log-content { color: var(--accent-red); }

  .log-controls {
    padding: 8px 16px;
    border-bottom: 1px solid var(--border);
    display: flex;
    gap: 8px;
    align-items: center;
    background: var(--bg-card);
  }

  .log-controls label {
    font-size: 12px;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
  }

  .log-controls input[type="checkbox"] {
    accent-color: var(--accent-blue);
  }

  /* Prompt viewer */
  .prompt-viewer {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
  }

  .prompt-content {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 100%;
    overflow-y: auto;
  }

  .prompt-source {
    font-size: 11px;
    color: var(--text-muted);
    margin-bottom: 8px;
    font-style: italic;
  }

  .prompt-loading {
    color: var(--text-muted);
    font-style: italic;
  }

  /* Auto-refresh indicator */
  .refresh-indicator {
    font-size: 11px;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .pulse {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent-green);
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0% { opacity: 1; }
    50% { opacity: 0.3; }
    100% { opacity: 1; }
  }

  /* Toast notifications */
  .toast-container {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .toast {
    padding: 10px 16px;
    border-radius: 8px;
    font-size: 13px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    animation: slideIn 0.3s ease;
    max-width: 400px;
  }

  .toast.success { border-color: var(--accent-green); }
  .toast.error { border-color: var(--accent-red); }

  @keyframes slideIn {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }

  /* Scrollbar styling */
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: var(--bg); }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }

  /* Responsive */
  @media (max-width: 900px) {
    .main { flex-direction: column; }
    .sidebar { width: 100%; height: 40vh; min-width: unset; border-right: none; border-bottom: 1px solid var(--border); }
    .detail { height: 60vh; }
  }
</style>
</head>
<body>

<div class="header">
  <h1><span class="icon">&#x2699;</span> Copilot/Claude Process Monitor</h1>
  <div class="header-stats" id="headerStats">
    <span>Processes: <span class="stat-value" id="statTotal">-</span></span>
    <span>Claude: <span class="stat-value" id="statClaude">-</span></span>
    <span>Copilot: <span class="stat-value" id="statCopilot">-</span></span>
    <span>Build Svc Jobs: <span class="stat-value" id="statBuildSvc">-</span></span>
    <span>Memory: <span class="stat-value" id="statMemory">-</span></span>
  </div>
  <div class="header-actions">
    <div class="refresh-indicator">
      <div class="pulse"></div>
      <span>Auto-refresh 3s</span>
    </div>
    <button class="btn primary" onclick="refreshProcesses()">Refresh</button>
  </div>
</div>

<div class="main">
  <div class="sidebar">
    <div class="sidebar-header">
      <span>Process Sessions</span>
      <span id="processCount">0</span>
    </div>
    <div id="processList"></div>
    <div class="sidebar-header" style="margin-top: 4px; border-top: 2px solid var(--border-active);">
      <span>Build Service Jobs</span>
      <span id="buildJobCount">0</span>
    </div>
    <div id="buildJobList"></div>
  </div>

  <div class="detail" id="detailPanel">
    <div class="detail-empty" id="detailEmpty">
      <div class="icon">&#x1F50D;</div>
      <div>Select a process to view details</div>
      <div style="font-size: 12px;">Click on a process in the sidebar</div>
    </div>
  </div>
</div>

<div class="toast-container" id="toasts"></div>

<script>
// State
let sessions = [];
let buildJobs = [];
let selectedPid = null;
let selectedJobId = null;
let activeEventSource = null;
let autoScroll = true;
let showStdout = true;
let showStderr = true;
let showStdin = true;
let activeTab = 'info';

// Refresh processes
async function refreshProcesses() {
  try {
    const [procResp, jobsResp] = await Promise.all([
      fetch('/api/processes'),
      fetch('/api/build-service/jobs').catch(() => ({ ok: false })),
    ]);

    const procData = await procResp.json();
    sessions = procData.sessions;

    if (jobsResp.ok) {
      const jobsData = await jobsResp.json();
      buildJobs = jobsData.jobs || [];
    }

    renderProcessList();
    renderBuildJobList();
    updateStats();

    // If selected process still exists, update detail
    if (selectedPid && sessions.find(s => s.mainPid === selectedPid)) {
      if (activeTab === 'info') renderInfoTab();
    }
  } catch (err) {
    console.error('Failed to refresh:', err);
  }
}

function updateStats() {
  document.getElementById('statTotal').textContent = sessions.length;
  document.getElementById('statClaude').textContent = sessions.filter(s => s.type.includes('claude')).length;
  document.getElementById('statCopilot').textContent = sessions.filter(s => s.type === 'copilot').length;
  document.getElementById('statBuildSvc').textContent = buildJobs.length;
  const totalMb = sessions.reduce((sum, s) => sum + s.rssMb, 0);
  document.getElementById('statMemory').textContent = totalMb > 1024 ? (totalMb / 1024).toFixed(1) + ' GB' : totalMb + ' MB';
  document.getElementById('processCount').textContent = sessions.length;
  document.getElementById('buildJobCount').textContent = buildJobs.length;
}

function renderProcessList() {
  const container = document.getElementById('processList');
  container.innerHTML = sessions.map(s => {
    const stateClass = s.state.toLowerCase().includes('run') ? 'running' :
                        s.state.toLowerCase().includes('sleep') ? 'sleeping' :
                        s.state.toLowerCase().includes('stop') ? 'stopped' :
                        s.state.toLowerCase().includes('zombie') ? 'zombie' : 'sleeping';
    const isActive = selectedPid === s.mainPid;
    return \`
      <div class="process-card \${isActive ? 'active' : ''}" onclick="selectProcess(\${s.mainPid})">
        <div class="card-top">
          <div class="card-type">
            <span class="state-dot \${stateClass}" title="\${s.state}"></span>
            <span class="type-badge \${s.type}">\${s.type}</span>
            <span style="color: var(--text-muted); font-size: 11px; font-family: var(--font-mono);">PID \${s.mainPid}</span>
          </div>
          <span style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono);">\${s.uptimeFormatted}</span>
        </div>
        <div class="card-cwd" title="\${s.cwd}">\${s.cwd}</div>
        <div class="card-meta">
          <span>TTY: \${s.tty || 'none'}</span>
          <span>RSS: \${s.rssMb}MB</span>
          <span>Threads: \${s.threads}</span>
          \${s.isTracing ? '<span style="color: var(--accent-green);">&#x25CF; Tracing</span>' : ''}
        </div>
        <div class="card-flags">
          <span class="flag-tag \${s.isInteractive ? 'interactive' : 'batch'}">\${s.isInteractive ? 'interactive' : 'batch'}</span>
          \${s.flags.yolo ? '<span class="flag-tag">--yolo</span>' : ''}
          \${s.flags.silent ? '<span class="flag-tag">-s</span>' : ''}
          \${s.flags.printMode ? '<span class="flag-tag">-p</span>' : ''}
        </div>
      </div>
    \`;
  }).join('');
}

function renderBuildJobList() {
  const container = document.getElementById('buildJobList');
  if (!container) return;

  if (buildJobs.length === 0) {
    container.innerHTML = '<div style="padding: 12px 16px; color: var(--text-muted); font-size: 12px; font-style: italic;">No build service jobs (service may be offline)</div>';
    return;
  }

  container.innerHTML = buildJobs.map(j => {
    const status = j.status || 'unknown';
    const stateClass = status === 'running' ? 'running' :
                        status === 'queued' ? 'sleeping' :
                        status === 'completed' ? 'running' :
                        status === 'failed' ? 'stopped' :
                        status === 'cancelled' ? 'stopped' : 'sleeping';
    const isActive = selectedJobId === j.job_id;
    const label = j.label || j.job_id;
    const duration = j.duration_seconds ? j.duration_seconds + 's' : (j.started_at ? 'running...' : 'queued');
    return \`
      <div class="process-card \${isActive ? 'active' : ''}" onclick="selectBuildJob('\${j.job_id}')">
        <div class="card-top">
          <div class="card-type">
            <span class="state-dot \${stateClass}" title="\${status}"></span>
            <span class="type-badge copilot">\${status}</span>
            <span style="color: var(--text-muted); font-size: 11px; font-family: var(--font-mono);">\${j.job_id.substring(0, 16)}</span>
          </div>
          <span style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono);">\${duration}</span>
        </div>
        <div class="card-cwd" title="\${label}">\${label}</div>
        <div class="card-meta">
          \${j.exit_code !== null && j.exit_code !== undefined ? '<span>exit: ' + j.exit_code + '</span>' : ''}
          \${j.started_at ? '<span>started: ' + new Date(j.started_at).toLocaleTimeString() + '</span>' : ''}
        </div>
      </div>
    \`;
  }).join('');
}

function selectBuildJob(jobId) {
  selectedJobId = jobId;
  selectedPid = null;
  activeTab = 'info';

  if (activeEventSource) {
    activeEventSource.close();
    activeEventSource = null;
  }

  renderProcessList();
  renderBuildJobList();
  renderBuildJobDetail();
}

async function renderBuildJobDetail() {
  const job = buildJobs.find(j => j.job_id === selectedJobId);
  if (!job) return;

  const panel = document.getElementById('detailPanel');
  const status = job.status || 'unknown';
  const isRunning = status === 'running' || status === 'queued';

  panel.innerHTML = \`
    <div class="detail-header">
      <div class="detail-title">
        <span class="type-badge copilot">build-svc</span>
        <span>\${job.job_id}</span>
        <span style="color: var(--text-muted); font-size: 12px;">\${status}</span>
      </div>
      <div class="detail-actions">
        \${isRunning ? '<button class="btn danger" onclick="cancelBuildJob(\\'' + job.job_id + '\\')">&#x23F9; Cancel</button>' : ''}
      </div>
    </div>
    <div class="detail-tabs">
      <div class="detail-tab active" onclick="renderBuildJobDetail()">Info & Logs</div>
    </div>
    <div class="tab-content active" style="display: flex; flex-direction: column;">
      <div class="info-grid">
        <div class="info-section">
          <h3>Job Details</h3>
          <div class="info-row"><span class="info-label">Job ID</span><span class="info-value">\${job.job_id}</span></div>
          <div class="info-row"><span class="info-label">Status</span><span class="info-value">\${status}</span></div>
          <div class="info-row"><span class="info-label">Exit Code</span><span class="info-value">\${job.exit_code ?? 'n/a'}</span></div>
          <div class="info-row"><span class="info-label">Started</span><span class="info-value">\${job.started_at || 'n/a'}</span></div>
          <div class="info-row"><span class="info-label">Completed</span><span class="info-value">\${job.completed_at || 'n/a'}</span></div>
          <div class="info-row"><span class="info-label">Duration</span><span class="info-value">\${job.duration_seconds ? job.duration_seconds + 's' : 'n/a'}</span></div>
          <div class="info-row"><span class="info-label">Label</span><span class="info-value">\${job.label || 'n/a'}</span></div>
          <div class="info-row"><span class="info-label">Log Dir</span><span class="info-value">\${job.log_dir || 'n/a'}</span></div>
          \${job.error ? '<div class="info-row"><span class="info-label">Error</span><span class="info-value" style="color: var(--accent-red);">' + escapeHtml(job.error) + '</span></div>' : ''}
        </div>
        <div class="info-section">
          <h3>Output Tail</h3>
          <pre class="prompt-content" style="max-height: 400px; overflow-y: auto;">\${escapeHtml(job.output_tail || '(no output)')}</pre>
        </div>
        <div class="info-section" id="buildJobLogs">
          <h3>Full Logs <button class="btn" onclick="loadBuildJobLogs('\\'\${job.job_id}\\'')">Load</button></h3>
          <div id="buildJobLogContent" style="font-family: var(--font-mono); font-size: 12px; color: var(--text-muted);">Click "Load" to fetch full logs from build service</div>
        </div>
      </div>
    </div>
  \`;
}

async function loadBuildJobLogs(jobId) {
  const container = document.getElementById('buildJobLogContent');
  if (!container) return;
  container.textContent = 'Loading...';
  try {
    const resp = await fetch(\`/api/build-service/jobs/\${jobId}/logs\`);
    const data = await resp.json();
    container.innerHTML = '<pre class="prompt-content" style="max-height: 600px; overflow-y: auto;">' + escapeHtml(data.log || '(empty)') + '</pre>';
  } catch (err) {
    container.textContent = 'Error: ' + err.message;
  }
}

async function cancelBuildJob(jobId) {
  if (!confirm('Cancel this build service job?')) return;
  try {
    const resp = await fetch(\`/api/build-service/jobs/\${jobId}/cancel\`, { method: 'POST' });
    const data = await resp.json();
    showToast(data.message || 'Cancel requested', data.error ? 'error' : 'success');
    setTimeout(refreshProcesses, 1000);
  } catch (err) {
    showToast('Failed: ' + err.message, 'error');
  }
}

function selectProcess(pid) {
  selectedPid = pid;
  selectedJobId = null;
  activeTab = 'info';

  // Close any existing SSE connection
  if (activeEventSource) {
    activeEventSource.close();
    activeEventSource = null;
  }

  renderProcessList();
  renderDetailPanel();
}

function renderDetailPanel() {
  const session = sessions.find(s => s.mainPid === selectedPid);
  if (!session) return;

  const panel = document.getElementById('detailPanel');
  panel.innerHTML = \`
    <div class="detail-header">
      <div class="detail-title">
        <span class="type-badge \${session.type}">\${session.type}</span>
        <span>PID \${session.mainPid}</span>
        <span style="color: var(--text-muted); font-size: 12px;">\${session.state}</span>
      </div>
      <div class="detail-actions">
        <button class="btn success" onclick="sendSig(\${session.mainPid}, 'SIGCONT')" title="Resume (SIGCONT)">&#x25B6; Resume</button>
        <button class="btn" onclick="sendSig(\${session.mainPid}, 'SIGTSTP')" title="Suspend (SIGTSTP)">&#x23F8; Suspend</button>
        <button class="btn danger" onclick="sendSig(\${session.mainPid}, 'SIGTERM')" title="Terminate (Ctrl+C / SIGTERM)">&#x23F9; SIGTERM</button>
        <button class="btn danger" onclick="if(confirm('Force kill this process?')) sendSig(\${session.mainPid}, 'SIGKILL')" title="Force Kill (SIGKILL)">&#x2620; SIGKILL</button>
        <button class="btn primary" onclick="redriveProcess(\${session.mainPid})" title="Re-drive with same args">&#x21BB; Re-drive</button>
      </div>
    </div>
    <div class="detail-tabs">
      <div class="detail-tab \${activeTab === 'info' ? 'active' : ''}" onclick="switchTab('info')">Info & I/O</div>
      <div class="detail-tab \${activeTab === 'logs' ? 'active' : ''}" onclick="switchTab('logs')">Live Logs</div>
      <div class="detail-tab \${activeTab === 'prompt' ? 'active' : ''}" onclick="switchTab('prompt')">Prompt</div>
      <div class="detail-tab \${activeTab === 'tree' ? 'active' : ''}" onclick="switchTab('tree')">Process Tree</div>
    </div>
    <div class="tab-content \${activeTab === 'info' ? 'active' : ''}" id="tabInfo"></div>
    <div class="tab-content \${activeTab === 'logs' ? 'active' : ''}" id="tabLogs"></div>
    <div class="tab-content \${activeTab === 'prompt' ? 'active' : ''}" id="tabPrompt"></div>
    <div class="tab-content \${activeTab === 'tree' ? 'active' : ''}" id="tabTree"></div>
  \`;

  if (activeTab === 'info') renderInfoTab();
  else if (activeTab === 'logs') renderLogsTab();
  else if (activeTab === 'prompt') renderPromptTab();
  else if (activeTab === 'tree') renderTreeTab();
}

function switchTab(tab) {
  activeTab = tab;
  renderDetailPanel();
}

function renderInfoTab() {
  const session = sessions.find(s => s.mainPid === selectedPid);
  if (!session) return;

  const io = session.io || {};
  const container = document.getElementById('tabInfo');
  container.innerHTML = \`
    <div class="info-grid">
      <div class="info-section">
        <h3>I/O Statistics</h3>
        <div class="io-grid">
          <div class="io-stat">
            <div class="value">\${formatBytes(io.rchar || 0)}</div>
            <div class="label">Characters Read</div>
          </div>
          <div class="io-stat">
            <div class="value">\${formatBytes(io.wchar || 0)}</div>
            <div class="label">Characters Written</div>
          </div>
          <div class="io-stat">
            <div class="value">\${(io.syscr || 0).toLocaleString()}</div>
            <div class="label">Read Syscalls</div>
          </div>
          <div class="io-stat">
            <div class="value">\${(io.syscw || 0).toLocaleString()}</div>
            <div class="label">Write Syscalls</div>
          </div>
          <div class="io-stat">
            <div class="value">\${formatBytes(io.read_bytes || 0)}</div>
            <div class="label">Disk Read</div>
          </div>
          <div class="io-stat">
            <div class="value">\${formatBytes(io.write_bytes || 0)}</div>
            <div class="label">Disk Write</div>
          </div>
        </div>
      </div>

      <div class="info-section">
        <h3>Process Details</h3>
        <div class="info-row"><span class="info-label">Main PID</span><span class="info-value">\${session.mainPid}</span></div>
        <div class="info-row"><span class="info-label">Root PID</span><span class="info-value">\${session.rootPid}</span></div>
        <div class="info-row"><span class="info-label">Type</span><span class="info-value">\${session.type}</span></div>
        <div class="info-row"><span class="info-label">State</span><span class="info-value">\${session.state}</span></div>
        <div class="info-row"><span class="info-label">TTY</span><span class="info-value">\${session.tty || 'none'}</span></div>
        <div class="info-row"><span class="info-label">Working Dir</span><span class="info-value">\${session.cwd}</span></div>
        <div class="info-row"><span class="info-label">Uptime</span><span class="info-value">\${session.uptimeFormatted}</span></div>
        <div class="info-row"><span class="info-label">RSS Memory</span><span class="info-value">\${session.rssMb} MB</span></div>
        <div class="info-row"><span class="info-label">Threads</span><span class="info-value">\${session.threads}</span></div>
        <div class="info-row"><span class="info-label">Interactive</span><span class="info-value">\${session.isInteractive ? 'Yes' : 'No (batch/pipe)'}</span></div>
      </div>

      <div class="info-section">
        <h3>Command Line Arguments</h3>
        <div style="padding: 8px 0;">
          \${session.chain.map(p => \`
            <div style="margin-bottom: 6px;">
              <span style="color: var(--accent-blue); font-family: var(--font-mono); font-size: 12px;">[\${p.name || p.pid}]</span>
              <code style="font-size: 12px; color: var(--text); display: block; padding: 4px 0; word-break: break-all;">\${escapeHtml(p.cmdline)}</code>
            </div>
          \`).join('')}
        </div>
      </div>
    </div>
  \`;

  // Live-refresh I/O stats
  refreshIO();
}

async function refreshIO() {
  if (activeTab !== 'info' || !selectedPid) return;
  try {
    const resp = await fetch(\`/api/process/\${selectedPid}/io\`);
    const io = await resp.json();
    // Update the session's IO data
    const session = sessions.find(s => s.mainPid === selectedPid);
    if (session) session.io = io;
  } catch {}
}

function renderLogsTab() {
  const container = document.getElementById('tabLogs');
  container.innerHTML = \`
    <div class="log-controls">
      <label><input type="checkbox" checked onchange="showStdout = this.checked; filterLogs()"> stdout</label>
      <label><input type="checkbox" checked onchange="showStderr = this.checked; filterLogs()"> stderr</label>
      <label><input type="checkbox" checked onchange="showStdin = this.checked; filterLogs()"> stdin</label>
      <label><input type="checkbox" checked onchange="autoScroll = this.checked"> Auto-scroll</label>
      <span style="flex:1;"></span>
      <button class="btn" onclick="clearLogs()">Clear</button>
      <button class="btn primary" onclick="downloadLogs()">Download</button>
    </div>
    <div class="log-viewer" id="logViewer"></div>
  \`;

  // Start SSE connection for live logs
  startLogStream();
}

function startLogStream() {
  if (activeEventSource) {
    activeEventSource.close();
  }

  const viewer = document.getElementById('logViewer');
  if (!viewer) return;

  activeEventSource = new EventSource(\`/api/process/\${selectedPid}/logs/stream\`);

  activeEventSource.onmessage = (event) => {
    try {
      const entry = JSON.parse(event.data);
      appendLogEntry(entry);
    } catch {}
  };

  activeEventSource.onerror = () => {
    appendLogEntry({ time: Date.now(), fd: 'system', content: '[Connection lost — reconnecting...]' });
  };
}

function appendLogEntry(entry) {
  const viewer = document.getElementById('logViewer');
  if (!viewer) return;

  // Filter check
  if (entry.fd === 'stdout' && !showStdout) return;
  if (entry.fd === 'stderr' && !showStderr) return;
  if (entry.fd === 'stdin' && !showStdin) return;

  const line = document.createElement('div');
  line.className = \`log-line \${entry.fd}\`;

  const time = new Date(entry.time);
  const timeStr = time.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
                  '.' + String(time.getMilliseconds()).padStart(3, '0');

  line.innerHTML = \`<span class="log-time">\${timeStr}</span><span class="log-fd">\${entry.fd}</span><span class="log-content">\${escapeHtml(entry.content)}</span>\`;

  viewer.appendChild(line);

  // Cap displayed lines
  while (viewer.children.length > 3000) {
    viewer.removeChild(viewer.firstChild);
  }

  if (autoScroll) {
    viewer.scrollTop = viewer.scrollHeight;
  }
}

function filterLogs() {
  const lines = document.querySelectorAll('#logViewer .log-line');
  lines.forEach(line => {
    if (line.classList.contains('stdout')) line.style.display = showStdout ? '' : 'none';
    if (line.classList.contains('stderr')) line.style.display = showStderr ? '' : 'none';
    if (line.classList.contains('stdin')) line.style.display = showStdin ? '' : 'none';
  });
}

function clearLogs() {
  const viewer = document.getElementById('logViewer');
  if (viewer) viewer.innerHTML = '';
}

function downloadLogs() {
  const viewer = document.getElementById('logViewer');
  if (!viewer) return;
  const text = Array.from(viewer.querySelectorAll('.log-line')).map(l => l.textContent).join('\\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = \`process-\${selectedPid}-logs.txt\`;
  a.click();
  URL.revokeObjectURL(url);
}

async function renderPromptTab() {
  const container = document.getElementById('tabPrompt');
  container.innerHTML = '<div class="prompt-viewer"><div class="prompt-loading">Detecting prompt...</div></div>';

  try {
    const resp = await fetch(\`/api/process/\${selectedPid}/prompt\`);
    const data = await resp.json();

    if (data.prompt) {
      container.innerHTML = \`
        <div class="prompt-viewer">
          <div class="prompt-source">Source: \${data.source}\${data.logFile ? ' — ' + data.logFile : ''}</div>
          <pre class="prompt-content">\${escapeHtml(data.prompt)}</pre>
        </div>
      \`;
    } else {
      container.innerHTML = \`
        <div class="prompt-viewer">
          <div class="prompt-loading">
            No prompt detected for this process.<br><br>
            Prompts can be detected from:<br>
            &bull; /tmp/claude-prompt-*.txt files<br>
            &bull; Code Explorer LLM log files (matching PID)<br>
            &bull; Command line arguments (-p flag)
          </div>
        </div>
      \`;
    }
  } catch (err) {
    container.innerHTML = \`<div class="prompt-viewer"><div class="prompt-loading">Error: \${err.message}</div></div>\`;
  }
}

function renderTreeTab() {
  const session = sessions.find(s => s.mainPid === selectedPid);
  if (!session) return;

  const container = document.getElementById('tabTree');
  let html = '<div class="info-grid"><div class="info-section"><h3>Process Chain</h3><div class="process-chain">';

  session.chain.forEach((proc, i) => {
    if (i > 0) {
      html += '<div class="chain-arrow">&#x2502;</div>';
      html += '<div class="chain-arrow">&#x251C;&#x2500;&#x2500;</div>';
    }
    html += \`
      <div class="chain-node">
        <span class="chain-pid">PID \${proc.pid}</span>
        <span class="chain-name">\${proc.name}</span>
        <span style="color: var(--text-muted);">\${proc.stateDesc}</span>
        <span style="color: var(--text-muted); margin-left: auto;">\${proc.rssKb} KB | \${proc.threads} threads</span>
      </div>
    \`;
  });

  html += '</div></div>';

  // File descriptors info
  html += '<div class="info-section"><h3>File Descriptors (main process)</h3>';
  html += '<div style="font-family: var(--font-mono); font-size: 12px; padding: 8px 0;">';

  const mainProc = session.chain[session.chain.length - 1];
  html += \`<div class="info-row"><span class="info-label">stdin (fd 0)</span><span class="info-value">/dev/\${session.tty || 'pipe'}</span></div>\`;
  html += \`<div class="info-row"><span class="info-label">stdout (fd 1)</span><span class="info-value">/dev/\${session.tty || 'pipe'}</span></div>\`;
  html += \`<div class="info-row"><span class="info-label">stderr (fd 2)</span><span class="info-value">/dev/\${session.tty || 'pipe'}</span></div>\`;
  html += '</div></div>';

  html += '</div>';
  container.innerHTML = html;
}

// Actions
async function sendSig(pid, signal) {
  try {
    const resp = await fetch(\`/api/process/\${pid}/signal\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signal }),
    });
    const data = await resp.json();
    showToast(data.message, data.success ? 'success' : 'error');
    setTimeout(refreshProcesses, 1000);
  } catch (err) {
    showToast('Failed: ' + err.message, 'error');
  }
}

async function redriveProcess(pid) {
  if (!confirm('Re-drive this process with the same arguments and working directory?')) return;
  try {
    const resp = await fetch(\`/api/process/\${pid}/redrive\`, { method: 'POST' });
    const data = await resp.json();
    showToast(data.message, data.success ? 'success' : 'error');
    setTimeout(refreshProcesses, 2000);
  } catch (err) {
    showToast('Failed: ' + err.message, 'error');
  }
}

// Utils
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toasts');
  const toast = document.createElement('div');
  toast.className = \`toast \${type}\`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

// Auto-refresh
setInterval(refreshProcesses, 3000);
setInterval(refreshIO, 2000);

// Initial load
refreshProcesses();
</script>
</body>
</html>`;
}
