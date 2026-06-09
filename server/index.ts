#!/usr/bin/env bun
/**
 * Mock Server — zero-dependency companion for the Mockery Chrome extension.
 * Powered by Bun.
 *
 * Usage:
 *   bun run server/index.ts                    # reads mocks/.config.ts from cwd
 *   bun run server/index.ts 9000               # custom port
 *   bun run server/index.ts --config ./my-mocks.ts   # custom config path
 *
 * Config format (mocks/.config.ts):
 *   export default [
 *     { pattern: "https://api.example.com/users", file: "users.json" },
 *     { pattern: "https://api.example.com/dynamic", handler: async (req) => ({ status: 200, body: "Hi" }) },
 *     { pattern: "address-book\\.smtnbnxt\\.json", file: "icon.svg", isRegex: true }
 *   ];
 *
 * File paths:
 *   - Relative paths without directory separators default to mocks/ folder
 *   - "users.json" resolves to "mocks/users.json"
 *   - "data/users.json" stays as "data/users.json" (explicit path)
 *   - Absolute paths are used as-is
 *
 * Handler functions:
 *   - "handler": "handlers/dynamic.ts" resolves to "mocks/handlers/dynamic.ts"
 *   - Handlers receive (request, originalResponse) and return response object
 *   - Hot reloading via built-in fs.watch (no dependencies needed)
 *   - Can be combined with file to modify existing response
 */

import { watch, existsSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join, resolve, extname, dirname, isAbsolute } from 'path';
import { AsyncLocalStorage } from 'node:async_hooks';

// ── Types ────────────────────────────────────────────────────────────────────

export interface MockRule {
  pattern: string;
  file?: string;
  isRegex?: boolean;
  method?: string;
  enabled?: boolean;
  handler?: HandlerFunction | string;
  comment?: string;
}

export interface HandlerRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  query: URLSearchParams;
  timestamp: string;
}

export interface HandlerResponse {
  status: number;
  headers: Record<string, string>;
  body: string | Buffer;
}

export type HandlerFunction = (request: HandlerRequest, originalResponse: HandlerResponse | null) => Promise<HandlerResponse>;

interface CachedHandler {
  handler: HandlerFunction;
  mtime: Date;
}

// ── Handler caching ─────────────────────────────────────────────────────────
const handlerCache = new Map<string, CachedHandler>();

// Enable hot reload for handlers using built-in fs.watch (recursive supported on macOS/Windows)
const handlersPath = join(process.cwd(), 'mocks', 'handlers');
if (existsSync(handlersPath)) {
  try {
    watch(handlersPath, { recursive: true }, (_eventType, filename) => {
      if (!filename || !filename.endsWith('.ts')) return;
      const filePath = join(handlersPath, filename);

      console.log(`[mockery] Handler changed: mocks/handlers/${filename}`);

      // Clear from cache
      handlerCache.delete(filePath);

      console.log('[mockery] Handler reloaded - next request will use updated version');
    });
  } catch {
    // fs.watch recursive not supported on this platform — handlers won't hot reload
  }
}

// ── CLI args ────────────────────────────────────────────────────────────────
let port = 8756;
let configPath = join(process.cwd(), 'mocks', '.config.ts');

for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--config' && process.argv[i + 1]) {
    configPath = resolve(process.argv[++i]);
  } else if (/^\d+$/.test(arg)) {
    port = Number(arg);
  }
}

// ── Rule overrides persistence ──────────────────────────────────────────────
const overridesPath = join(dirname(configPath), '.rule-overrides.json');

function loadOverrides(): Record<string, boolean> {
  try {
    const raw = readFileSync(overridesPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveOverrides(obj: Record<string, boolean>): void {
  writeFileSync(overridesPath, JSON.stringify(obj, null, 2));
}

function applyOverrides(): void {
  const overrides = loadOverrides();
  for (const [index, enabled] of Object.entries(overrides)) {
    const i = Number(index);
    if (rules[i]) {
      rules[i].enabled = enabled;
    }
  }
}

// ── Config loading + hot-reload ─────────────────────────────────────────────
let rules: MockRule[] = [];

async function loadConfig(): Promise<void> {
  try {
    // Use dynamic import with cache-busting query string for hot-reload
    const module = await import(`${configPath}?t=${Date.now()}`);
    const loadedRules = module.default;

    if (!Array.isArray(loadedRules)) {
      throw new Error('Config must export a default array of rules');
    }

    rules = loadedRules;
    applyOverrides();
    console.log(`[mockery] Loaded ${rules.length} rule(s) from ${configPath}`);
  } catch (err: any) {
    if (err.code === 'ENOENT' || err.code === 'ERR_MODULE_NOT_FOUND') {
      console.warn(`[mockery] Config not found: ${configPath} — starting with 0 rules`);
      rules = [];
    } else {
      console.error(`[mockery] Error reading config:`, err.message);
      rules = [];
    }
  }
}

await loadConfig();

try {
  watch(configPath, { persistent: false }, (eventType) => {
    if (eventType === 'change' || eventType === 'rename') {
      console.log('[mockery] Config changed, reloading…');
      loadConfig().then(() => broadcastConfigChange());
    }
  });
} catch {
  // file might not exist yet — that's fine
}

// ── SSE (Server-Sent Events) for hot reload ─────────────────────────────────
const sseControllers = new Set<ReadableStreamDefaultController>();

function broadcastConfigChange(): void {
  const data = `data: ${JSON.stringify({ type: 'config-changed', timestamp: Date.now() })}\n\n`;
  for (const controller of sseControllers) {
    try {
      controller.enqueue(data);
    } catch {
      sseControllers.delete(controller);
    }
  }
}

// ── Handler loading ─────────────────────────────────────────────────────────
async function loadHandler(handlerOrPath: HandlerFunction | string): Promise<HandlerFunction | null> {
  // If handler is already a function (inline), return it directly
  if (typeof handlerOrPath === 'function') {
    return handlerOrPath;
  }

  // Otherwise, treat it as a file path
  const fullPath = resolve('mocks', handlerOrPath);

  try {
    // Check if handler is cached and file hasn't changed
    if (handlerCache.has(fullPath)) {
      const cached = handlerCache.get(fullPath)!;
      const stats = statSync(fullPath);
      if (stats.mtime <= cached.mtime) {
        return cached.handler;
      }
    }

    // Load handler with cache-busting for hot reload
    const module = await import(`${fullPath}?t=${Date.now()}`);
    const handler = module.default;
    const stats = statSync(fullPath);

    // Validate handler
    if (typeof handler !== 'function') {
      throw new Error('Handler must export a default function');
    }

    // Cache with modification time
    handlerCache.set(fullPath, { handler, mtime: stats.mtime });

    return handler;
  } catch (error: any) {
    console.error(`[mockery] Error loading handler ${handlerOrPath}:`, error.message);
    return null;
  }
}

function buildRequestObject(req: Request, url: string, targetMethod: string, body: string | null): HandlerRequest {
  return {
    url,
    method: targetMethod || 'GET',
    headers: Object.fromEntries(req.headers.entries()),
    body,
    query: new URL(url).searchParams,
    timestamp: new Date().toISOString()
  };
}

// ── Handler logger ─────────────────────────────────────────────────────────
// Handlers `import { log } from '../server/index.ts'` and call log.info/...
// Each call:
//   1. prints to the server terminal (so devs see it locally)
//   2. is captured into the current request's buffer so it can be replayed
//      in the browser console via the X-Mockery-Logs response header.
type CapturedLog = { level: 'log' | 'info' | 'warn' | 'error' | 'debug'; args: unknown[] };

interface HandlerContext {
  logs: CapturedLog[];
  handlerName: string;
}

const handlerContext = new AsyncLocalStorage<HandlerContext>();

// Safely stringify each argument so it survives JSON transport.
function safeSerialize(value: unknown, seen = new WeakSet()): unknown {
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return value;
  if (t === 'bigint') return `${(value as bigint).toString()}n`;
  if (t === 'function') return `[Function ${(value as Function).name || 'anonymous'}]`;
  if (t === 'symbol') return (value as symbol).toString();
  if (value instanceof Error) {
    return { __type: 'Error', name: value.name, message: value.message, stack: value.stack };
  }
  if (value instanceof Date) return { __type: 'Date', iso: value.toISOString() };
  if (value instanceof RegExp) return { __type: 'RegExp', source: value.source, flags: value.flags };
  if (value instanceof URLSearchParams) return { __type: 'URLSearchParams', entries: [...value.entries()] };
  if (value instanceof Map) return { __type: 'Map', entries: [...value.entries()].map(([k, v]) => [safeSerialize(k, seen), safeSerialize(v, seen)]) };
  if (value instanceof Set) return { __type: 'Set', values: [...value].map(v => safeSerialize(v, seen)) };
  if (typeof (value as any)?.toJSON === 'function') {
    try { return safeSerialize((value as any).toJSON(), seen); } catch { /* fall through */ }
  }
  if (t === 'object') {
    if (seen.has(value as object)) return '[Circular]';
    seen.add(value as object);
    if (Array.isArray(value)) return value.map(v => safeSerialize(v, seen));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as object)) {
      try { out[k] = safeSerialize(v, seen); } catch { out[k] = '[Unserializable]'; }
    }
    return out;
  }
  return String(value);
}

function emit(level: CapturedLog['level'], args: unknown[]) {
  // 1. Always print to the server terminal so dev sees it locally.
  const consoleFn = (console[level] || console.log) as (...a: unknown[]) => void;
  const ctx = handlerContext.getStore();
  if (ctx) {
    consoleFn.call(console, `[mockery:${ctx.handlerName}]`, ...args);
    // 2. Capture for transport to the browser
    try {
      ctx.logs.push({ level, args: args.map(a => safeSerialize(a)) });
    } catch {
      ctx.logs.push({ level, args: ['[Mockery] failed to serialize log args'] });
    }
  } else {
    // Called outside a handler request — just print locally.
    consoleFn.call(console, ...args);
  }
}

/**
 * Logger for handlers. Mirrors the console API surface (log/info/warn/error/debug).
 * Logs are printed to the server terminal AND forwarded to the browser console.
 *
 * Usage in a handler:
 *   import { log } from '../server/index.ts';
 *   log.info('something happened', { detail: 42 });
 */
export const log = {
  log: (...args: unknown[]) => emit('log', args),
  info: (...args: unknown[]) => emit('info', args),
  warn: (...args: unknown[]) => emit('warn', args),
  error: (...args: unknown[]) => emit('error', args),
  debug: (...args: unknown[]) => emit('debug', args),
};

async function withHandlerContext<T>(handlerName: string, fn: () => Promise<T>): Promise<{ result: T; logs: CapturedLog[] }> {
  const ctx: HandlerContext = { logs: [], handlerName };
  const result = await handlerContext.run(ctx, fn);
  return { result, logs: ctx.logs };
}

async function resolveWithHandler(
  targetUrl: string,
  rule: MockRule,
  req: Request,
  targetMethod: string,
  body: string | null = null
): Promise<HandlerResponse | null> {
  let originalResponse: HandlerResponse | null = null;

  // Load file response if specified
  if (rule.file) {
    const filePath = resolveFilePath(rule.file);
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath);
        originalResponse = {
          status: 200,
          headers: { 'Content-Type': guessMime(filePath) },
          body: content.toString()
        };
      } catch (err: any) {
        console.error(`[mockery] Error reading file ${filePath}:`, err.message);
        return {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'File read error', file: rule.file, detail: err.message })
        };
      }
    }
  }

  // Apply handler if specified
  if (rule.handler) {
    const handler = await loadHandler(rule.handler);
    if (handler) {
      const handlerName = typeof rule.handler === 'function' ? 'inline function' : rule.handler;
      try {
        const requestObj = buildRequestObject(req, targetUrl, targetMethod, body);
        const { result, logs } = await withHandlerContext(handlerName, () => handler(requestObj, originalResponse));

        // Validate handler response
        if (!result || typeof result !== 'object') {
          throw new Error('Handler must return a response object');
        }

        console.log(`[mockery] ${targetMethod || req.method} ${targetUrl} → ${handlerName} (handler)`);

        // Attach captured logs as a custom header so the browser can replay them.
        const merged: HandlerResponse = {
          ...result,
          headers: {
            ...(result.headers || {}),
            ...(logs.length ? { 'X-Mockery-Logs': encodeMockeryLogs(logs, handlerName) } : {}),
          },
        };
        return merged;
      } catch (err: any) {
        console.error(`[mockery] Handler execution error for ${handlerName}:`, err.stack || err.message);
        return {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: 'Handler execution error',
            handler: handlerName,
            detail: err.message,
            name: err.name,
            stack: err.stack,
          })
        };
      }
    } else {
      const handlerName = typeof rule.handler === 'function' ? 'inline function' : rule.handler;
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Failed to load handler', handler: handlerName })
      };
    }
  }

  return originalResponse;
}

// Encode captured logs for transport over an HTTP header.
// Headers are ASCII-only and can't contain newlines, so we JSON-stringify then base64-encode.
function encodeMockeryLogs(logs: CapturedLog[], handlerName: string): string {
  try {
    const json = JSON.stringify({ handler: handlerName, logs });
    // btoa-equivalent for arbitrary unicode strings
    return Buffer.from(json, 'utf8').toString('base64');
  } catch {
    return '';
  }
}

function resolveFilePath(file: string): string {
  if (isAbsolute(file)) {
    return file;
  }

  // For relative paths, always try in mocks/ folder first
  const mocksRelative = join('mocks', file);
  const configDir = dirname(resolve(configPath));
  const mocksPath = join(configDir, mocksRelative);

  if (existsSync(mocksPath)) {
    return mocksPath;
  }

  // If not found in mocks/, try relative to config file directory
  const configRelative = join(configDir, file);
  if (existsSync(configRelative)) {
    return configRelative;
  } else {
    // Fall back to relative to current working directory in mocks/
    return resolve(mocksRelative);
  }
}

// ── MIME helper ─────────────────────────────────────────────────────────────
function guessMime(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.json': 'application/json',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.xml': 'application/xml',
    '.js': 'application/javascript',
    '.ts': 'application/javascript',
    '.css': 'text/css',
    '.csv': 'text/csv',
    '.txt': 'text/plain',
    '.svg': 'image/svg+xml',
    // Image formats
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.bmp': 'image/bmp',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff',
    // Document formats
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    // Audio/Video
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.wav': 'audio/wav',
    '.avi': 'video/x-msvideo',
    // Archives
    '.zip': 'application/zip',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    // Fonts
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    // Other
    '.bin': 'application/octet-stream',
  };
  return map[ext] || 'application/octet-stream';
}

// ── Matching ────────────────────────────────────────────────────────────────
function findMatch(url: string, method: string): MockRule | null {
  const normalizedMethod = (method || 'GET').toUpperCase();

  function methodMatches(rule: MockRule): boolean {
    const ruleMethod = (rule.method || '*').toUpperCase();
    return ruleMethod === '*' || ruleMethod === normalizedMethod;
  }

  // First pass: look for exact matches
  for (const rule of rules) {
    try {
      if (rule.enabled === false) continue;
      if (!methodMatches(rule)) continue;
      if (rule.isRegex) {
        if (new RegExp(rule.pattern).test(url)) {
          return rule;
        }
      } else {
        if (url === rule.pattern) {
          return rule;
        }
      }
    } catch {
      // bad regex — skip
    }
  }

  // Second pass: look for substring matches
  for (const rule of rules) {
    try {
      if (rule.enabled === false) continue;
      if (!methodMatches(rule)) continue;
      if (!rule.isRegex) {
        if (url.includes(rule.pattern)) {
          return rule;
        }
      }
    } catch {
      // shouldn't happen for non-regex, but just in case
    }
  }

  return null;
}

// ── HTTP server (Bun.serve) ─────────────────────────────────────────────────
const server = Bun.serve({
  port,
  hostname: '127.0.0.1',

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // CORS headers for all responses
    const corsHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Expose-Headers': 'X-Mockery-Logs, Content-Type',
    };

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // ── GET /resolve?url=<encoded>&method=<METHOD> ──────────────────────────
    if (url.pathname === '/resolve') {
      const targetUrl = url.searchParams.get('url');
      if (!targetUrl) {
        return Response.json({ error: 'Missing ?url= parameter' }, { status: 400, headers: corsHeaders });
      }

      const targetMethod = (url.searchParams.get('method') || 'GET').toUpperCase();

      const rule = findMatch(targetUrl, targetMethod);
      if (!rule) {
        return Response.json(
          { error: 'No matching rule', url: targetUrl, method: targetMethod },
          { status: 404, headers: corsHeaders }
        );
      }

      try {
        // Read forwarded body if present (POST from background.js when page sent a body)
        let forwardedBody: string | null = null;
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          try { forwardedBody = await req.text(); }
          catch { forwardedBody = null; }
          if (forwardedBody === '') forwardedBody = null;
        }

        const result = await resolveWithHandler(targetUrl, rule, req, targetMethod, forwardedBody);

        if (!result) {
          return Response.json(
            { error: 'No response generated', url: targetUrl },
            { status: 404, headers: corsHeaders }
          );
        }

        const status = result.status || 200;
        const headers = { ...corsHeaders, ...result.headers };
        const body = result.body || '';

        return new Response(body, { status, headers });
      } catch (error: any) {
        console.error(`[mockery] Request processing error:`, error);
        return Response.json(
          { error: 'Internal server error', name: error.name, detail: error.message, stack: error.stack },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // ── GET /resolve-pattern?pattern=<encoded> ─────────────────────────────
    if (url.pathname === '/resolve-pattern') {
      const pattern = url.searchParams.get('pattern');
      if (!pattern) {
        return Response.json({ error: 'Missing ?pattern= parameter' }, { status: 400, headers: corsHeaders });
      }

      const rule = rules.find(r => r.pattern === pattern);
      if (!rule) {
        return Response.json(
          { error: 'No matching rule for pattern', pattern },
          { status: 404, headers: corsHeaders }
        );
      }

      try {
        const result = await resolveWithHandler(pattern, rule, req, 'GET');

        if (!result) {
          return Response.json(
            { error: 'No response generated', pattern },
            { status: 404, headers: corsHeaders }
          );
        }

        const status = result.status || 200;
        const headers = { ...corsHeaders, ...result.headers };
        const body = result.body || '';

        return new Response(body, { status, headers });
      } catch (error: any) {
        console.error(`[mockery] Request processing error:`, error);
        return Response.json(
          { error: 'Internal server error', name: error.name, detail: error.message, stack: error.stack },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // ── GET /events — SSE stream for hot reload ─────────────────────────────
    if (url.pathname === '/events' && req.method === 'GET') {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
          sseControllers.add(controller);

          // Clean up on abort
          req.signal.addEventListener('abort', () => {
            sseControllers.delete(controller);
          });
        },
        cancel(controller) {
          sseControllers.delete(controller);
        }
      });

      return new Response(stream, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        }
      });
    }

    // ── GET /rules — return current rule list ─────────────────────────────
    if (url.pathname === '/rules' && req.method === 'GET') {
      const serialized = rules.map(r => ({
        pattern: r.pattern,
        file: r.file || null,
        isRegex: r.isRegex || false,
        method: r.method || '*',
        enabled: r.enabled !== false,
        hasHandler: typeof r.handler === 'function' || typeof r.handler === 'string',
      }));
      return Response.json(serialized, { headers: corsHeaders });
    }

    // ── GET /health ───────────────────────────────────────────────────────
    if (url.pathname === '/health') {
      return Response.json({ ok: true, rules: rules.length }, { headers: corsHeaders });
    }

    // ── POST /rules/:index/toggle — enable/disable a rule ─────────────────
    const toggleMatch = url.pathname.match(/^\/rules\/(\d+)\/toggle$/);
    if (toggleMatch && req.method === 'POST') {
      const index = Number(toggleMatch[1]);
      if (index < 0 || index >= rules.length) {
        return Response.json(
          { error: 'Rule index out of range', index },
          { status: 404, headers: corsHeaders }
        );
      }

      let payload: any;
      try {
        payload = await req.json();
      } catch {
        return Response.json(
          { error: 'Invalid JSON body' },
          { status: 400, headers: corsHeaders }
        );
      }

      const enabled = payload.enabled !== false;
      rules[index].enabled = enabled;

      // Persist to overrides file
      const overrides = loadOverrides();
      overrides[String(index)] = enabled;
      saveOverrides(overrides);

      // Broadcast so SSE listeners (background.js) pick up the change
      broadcastConfigChange();

      return Response.json(
        { ok: true, index, enabled, pattern: rules[index].pattern },
        { headers: corsHeaders }
      );
    }

    return Response.json({ error: 'Not found' }, { status: 404, headers: corsHeaders });
  }
});

console.log(`[mockery] Listening on http://localhost:${server.port}`);
console.log(`[mockery] Config: ${configPath}`);
console.log(`[mockery] Endpoints:`);
console.log(`  GET /resolve?url=<encoded>       — serve a matched mock`);
console.log(`  GET /resolve-pattern?pattern=<>  — serve mock by pattern (for declarativeNetRequest)`);
console.log(`  GET /rules                       — list current rules from mocks/.config.ts`);
console.log(`  GET /events                      — SSE stream for hot reload`);
console.log(`  GET /health                      — server status`);

// Graceful shutdown
function shutdown(signal: string): void {
  console.log(`\n[mockery] ${signal} received, shutting down…`);
  server.stop();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
