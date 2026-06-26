#!/usr/bin/env bun
/**
 * Mock Server — zero-dependency companion for the Mockery Chrome extension.
 * Powered by Bun.
 *
 * Usage:
 *   bun run server/index.ts                    # reads config/rules.ts from cwd
 *   bun run server/index.ts 9000               # custom port
 *   bun run server/index.ts --config ./my-mocks.ts   # custom config path
 *
 * Config format (config/rules.ts):
 *   export default [
 *     { pattern: "https://api.example.com/users", file: "users.json" },
 *     { pattern: "https://api.example.com/dynamic", handler: async (req) => ({ status: 200, body: "Hi" }) },
 *     { pattern: /\/users\/\d+$/, file: "user.json" }   // RegExp = regex match
 *   ];
 *
 * File paths:
 *   - Relative paths without directory separators default to mocks/ folder
 *   - "users.json" resolves to "mocks/users.json"
 *   - "data/users.json" stays as "data/users.json" (explicit path)
 *   - Absolute paths are used as-is
 *
 * Handler functions:
 *   - "handler": "handlers/dynamic.ts" resolves to "config/handlers/dynamic.ts"
 *   - Handlers receive (request, originalResponse) and return response object
 *   - Hot reloading via built-in fs.watch (no dependencies needed)
 *   - Can be combined with file to modify existing response
 */

import { watch, existsSync, readFileSync, writeFileSync, statSync, mkdirSync } from 'fs';
import { join, resolve, extname, dirname, isAbsolute } from 'path';
import { AsyncLocalStorage } from 'node:async_hooks';

// ── Log banners ──────────────────────────────────────────────────────────────
const LOG_BANNER = '✅';
const ERROR_BANNER = '❌';

// When set (MOCKERY_DEBUG=1), error responses sent back to the page include
// stack traces. Off by default so internal code paths aren't leaked to mocked
// pages — the server terminal always logs the full stack regardless.
const DEBUG = process.env.MOCKERY_DEBUG === '1' || process.env.MOCKERY_DEBUG === 'true';

// ── Types ────────────────────────────────────────────────────────────────────

export interface MockRule {
  /**
   * URL to match.
   *   - A **string** is a literal match (exact URL, or substring of the URL).
   *   - A **RegExp** (e.g. `/\/users\/\d+$/`) is matched as a regular expression.
   * The type decides the matching mode — no flag needed.
   */
  pattern: string | RegExp;
  /** Optional human-friendly name for the rule, shown on the page toast and in logs. */
  name?: string;
  file?: string;
  requestFile?: string;        // Load request template from mocks/ folder
  forwardRequest?: boolean;    // Forward (modified) request to real server
  /** @deprecated Use a RegExp literal for `pattern` instead. Still honored for string patterns. */
  isRegex?: boolean;
  method?: string;
  enabled?: boolean;
  handler?: HandlerFunction | string;
  comment?: string;
}

/** True if the rule should be matched as a regex (RegExp pattern, or legacy isRegex flag). */
function isRegexRule(rule: MockRule): boolean {
  return rule.pattern instanceof RegExp || rule.isRegex === true;
}

/** The pattern as a plain string (RegExp source), for logging, keys, and the wire format. */
function patternString(rule: MockRule): string {
  return rule.pattern instanceof RegExp ? rule.pattern.source : rule.pattern;
}

/** Compile a fresh RegExp for the rule (fresh each call so lastIndex never carries over). */
function compileRegex(rule: MockRule): RegExp {
  return rule.pattern instanceof RegExp
    ? new RegExp(rule.pattern.source, rule.pattern.flags)
    : new RegExp(rule.pattern as string);
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

/** Modified request to forward to real server (Option B) */
export interface ModifiedRequest {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
}

/** Handler can return just a response OR a request modification + optional response transform */
export interface HandlerResult {
  request?: ModifiedRequest;           // Modified request to forward
  response?: HandlerResponse;          // Mock response OR response transform config
  skipForward?: boolean;               // If true, don't forward even if forwardRequest is set
}

/** Handler function signature - can return a response directly or a HandlerResult for request modification */
export type HandlerFunction = (
  request: HandlerRequest,
  responseTemplate: HandlerResponse | null,
  requestTemplate: object | null
) => Promise<HandlerResponse | HandlerResult>;

export interface MatchInfo {
  start: number;
  end: number;
  pattern: string;
  isRegex: boolean;
  kind: 'exact' | 'regex' | 'substring';
  /** Optional rule name, carried through to the page toast. */
  name?: string;
}

interface CachedHandler {
  handler: HandlerFunction;
  mtime: Date;
}

// ── Handler caching ─────────────────────────────────────────────────────────
const handlerCache = new Map<string, CachedHandler>();

// Enable hot reload for handlers using built-in fs.watch (recursive supported on macOS/Windows)
const handlersPath = join(process.cwd(), 'config', 'handlers');
if (existsSync(handlersPath)) {
  try {
    watch(handlersPath, { recursive: true }, (_eventType, filename) => {
      if (!filename || !filename.endsWith('.ts')) return;
      const filePath = join(handlersPath, filename);

      console.log(`${LOG_BANNER} Handler changed: config/handlers/${filename}`);

      // Clear from cache
      handlerCache.delete(filePath);

      console.log(`${LOG_BANNER} Handler reloaded - next request will use updated version`);
    });
  } catch {
    // fs.watch recursive not supported on this platform — handlers won't hot reload
  }
}

// ── CLI args ────────────────────────────────────────────────────────────────
let port = 8756;
let configPath = join(process.cwd(), 'config', 'rules.ts');

for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--config' && process.argv[i + 1]) {
    configPath = resolve(process.argv[++i]);
  } else if (/^\d+$/.test(arg)) {
    port = Number(arg);
  }
}

// ── Rule overrides persistence ──────────────────────────────────────────────
// Overrides are keyed by a stable rule identity (`${method}:${pattern}`) rather
// than array index, so reordering rules in rules.ts preserves toggle state.
const overridesPath = join(dirname(configPath), 'rule-overrides.json');

function ruleKey(rule: MockRule): string {
  return `${(rule.method || '*').toUpperCase()}:${patternString(rule)}`;
}

function loadOverrides(): Record<string, boolean> {
  try {
    const raw = readFileSync(overridesPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveOverrides(obj: Record<string, boolean>): void {
  mkdirSync(dirname(overridesPath), { recursive: true });
  writeFileSync(overridesPath, JSON.stringify(obj, null, 2));
}

/**
 * Migrate legacy index-keyed overrides (e.g. `{ "1": true }`) to the new
 * stable key format (e.g. `{ "GET:/foo": true }`). Returns the (possibly
 * rewritten) overrides object and persists the upgraded form on disk.
 */
function migrateOverrides(overrides: Record<string, boolean>): Record<string, boolean> {
  const keys = Object.keys(overrides);
  if (keys.length === 0) return overrides;

  const allNumeric = keys.every(k => /^\d+$/.test(k));
  if (!allNumeric) return overrides;

  const migrated: Record<string, boolean> = {};
  let migratedAny = false;
  for (const [index, enabled] of Object.entries(overrides)) {
    const rule = rules[Number(index)];
    if (rule) {
      migrated[ruleKey(rule)] = enabled;
      migratedAny = true;
    }
  }

  if (migratedAny) {
    saveOverrides(migrated);
    console.log(`${LOG_BANNER} Migrated rule-overrides.json from index-based to pattern-based keys`);
  }
  return migrated;
}

function applyOverrides(): void {
  const overrides = migrateOverrides(loadOverrides());
  for (const rule of rules) {
    const key = ruleKey(rule);
    if (key in overrides) {
      rule.enabled = overrides[key];
    }
  }
}

// ── Config loading + hot-reload ─────────────────────────────────────────────
let rules: MockRule[] = [];

// Starter template written on first run when rules.ts is missing, so a fresh
// checkout (or a custom --config path) always has a valid config to load.
// For a fuller set of examples, copy config/rules.example.ts to config/rules.ts.
const STARTER_RULES_TS = `// Mockery Configuration (local — gitignored)
// This file defines URL patterns and their corresponding mock responses.
// Edit freely — the server hot-reloads it on save.
// See config/rules.example.ts for one example of every rule type.

import type { MockRule } from '../server/index.ts';

export default [
  // Example:
  // {
  //   pattern: "https://api.example.com/users",
  //   file: "users.json",
  // },
] satisfies MockRule[];
`;

function ensureConfigExists(): void {
  if (existsSync(configPath)) return;
  try {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, STARTER_RULES_TS);
    console.log(`${LOG_BANNER} Created starter config: ${configPath}`);
  } catch (err: any) {
    console.warn(`${LOG_BANNER} Could not create starter config at ${configPath}: ${err.message}`);
  }
}

async function loadConfig(): Promise<void> {
  ensureConfigExists();
  try {
    // Use dynamic import with cache-busting query string for hot-reload
    const module = await import(`${configPath}?t=${Date.now()}`);
    const loadedRules = module.default;

    if (!Array.isArray(loadedRules)) {
      throw new Error('Config must export a default array of rules');
    }

    rules = loadedRules;
    applyOverrides();
    console.log(`${LOG_BANNER} Loaded ${rules.length} rule(s) from ${configPath}`);

    // Validate regex patterns once, up front, so a typo surfaces as a clear
    // warning instead of silently never matching at request time.
    for (const rule of rules) {
      if (isRegexRule(rule)) {
        try {
          compileRegex(rule);
        } catch (err: any) {
          console.warn(`${ERROR_BANNER} Invalid regex pattern (rule will never match): ${patternString(rule)} — ${err.message}`);
        }
      }
    }
  } catch (err: any) {
    if (err.code === 'ENOENT' || err.code === 'ERR_MODULE_NOT_FOUND') {
      console.warn(`${LOG_BANNER} Config not found: ${configPath} — starting with 0 rules`);
      rules = [];
    } else {
      console.error(`${ERROR_BANNER} Error reading config:`, err.message);
      rules = [];
    }
  }
}

await loadConfig();

try {
  watch(configPath, { persistent: false }, (eventType) => {
    if (eventType === 'change' || eventType === 'rename') {
      console.log(`${LOG_BANNER} Config changed, reloading…`);
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

  // Otherwise, treat it as a file path (relative to config/)
  const fullPath = resolve('config', handlerOrPath);

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
    console.error(`${ERROR_BANNER} Error loading handler ${handlerOrPath}:`, error.message);
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
      ctx.logs.push({ level, args: [`${ERROR_BANNER} failed to serialize log args`] });
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

/** Result from resolving a rule - can be a direct response or request modification instructions */
export interface ResolveResult {
  type: 'response' | 'forward';
  response?: HandlerResponse;
  modifiedRequest?: ModifiedRequest;
  forwardUrl?: string;
}

/** Check if result is a HandlerResult (has request or response keys) vs direct HandlerResponse */
function isHandlerResult(result: HandlerResponse | HandlerResult): result is HandlerResult {
  return 'request' in result || ('response' in result && !('status' in result));
}

async function resolveWithHandler(
  targetUrl: string,
  rule: MockRule,
  req: Request,
  targetMethod: string,
  body: string | null = null,
  match: MatchInfo | null = null
): Promise<ResolveResult | null> {
  let responseTemplate: HandlerResponse | null = null;
  let requestTemplate: object | null = null;

  const matchHeader: Record<string, string> = match
    ? { 'X-Mockery-Match': encodeMockeryMatch(match) }
    : {};

  // Load response file template if specified
  if (rule.file) {
    const filePath = resolveFilePath(rule.file);
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath);
        responseTemplate = {
          status: 200,
          headers: { 'Content-Type': guessMime(filePath) },
          body: content.toString()
        };
      } catch (err: any) {
        console.error(`${ERROR_BANNER} Error reading file ${filePath}:`, err.message);
        return {
          type: 'response',
          response: {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'File read error', file: rule.file, detail: err.message })
          }
        };
      }
    }
  }

  // Load request template if specified (Option C)
  if (rule.requestFile) {
    const filePath = resolveFilePath(rule.requestFile);
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        // Try to parse as JSON, fallback to raw string
        try {
          requestTemplate = JSON.parse(content);
        } catch {
          requestTemplate = { raw: content };
        }
      } catch (err: any) {
        console.error(`${ERROR_BANNER} Error reading request file ${filePath}:`, err.message);
        return {
          type: 'response',
          response: {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Request file read error', file: rule.requestFile, detail: err.message })
          }
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
        const { result, logs } = await withHandlerContext(handlerName, () => handler(requestObj, responseTemplate, requestTemplate));

        // Validate handler response
        if (!result || typeof result !== 'object') {
          throw new Error('Handler must return a response object or HandlerResult');
        }

        const logsHeader = logs.length ? { 'X-Mockery-Logs': encodeMockeryLogs(logs, handlerName) } : {};

        // Check if result is a HandlerResult (request modification) or direct response
        if (isHandlerResult(result)) {
          // Handler returned { request?, response?, skipForward? }
          const handlerResult = result as HandlerResult;

          // If handler wants to forward request (Option B)
          if (handlerResult.request && rule.forwardRequest && !handlerResult.skipForward) {
            return {
              type: 'forward',
              modifiedRequest: handlerResult.request,
              forwardUrl: handlerResult.request.url || targetUrl,
              response: handlerResult.response ? {
                ...handlerResult.response,
                headers: { ...handlerResult.response.headers, ...matchHeader, ...logsHeader }
              } : undefined
            };
          }

          // Handler returned a response (or we're not forwarding)
          if (handlerResult.response) {
            return {
              type: 'response',
              response: {
                ...handlerResult.response,
                headers: { ...handlerResult.response.headers, ...matchHeader, ...logsHeader }
              }
            };
          }

          // Handler only modified request but forwardRequest is false - use response template
          if (responseTemplate) {
            return {
              type: 'response',
              response: {
                ...responseTemplate,
                headers: { ...responseTemplate.headers, ...matchHeader, ...logsHeader }
              }
            };
          }

          throw new Error('Handler returned request modification but no response and forwardRequest is not enabled');
        }

        // Direct HandlerResponse
        const directResponse = result as HandlerResponse;
        return {
          type: 'response',
          response: {
            ...directResponse,
            headers: { ...directResponse.headers, ...matchHeader, ...logsHeader }
          }
        };
      } catch (err: any) {
        console.error(`${ERROR_BANNER} Handler execution error for ${handlerName}:`, err.stack || err.message);
        return {
          type: 'response',
          response: {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              error: 'Handler execution error',
              handler: handlerName,
              detail: err.message,
              name: err.name,
              ...(DEBUG ? { stack: err.stack } : {}),
            })
          }
        };
      }
    } else {
      const handlerName = typeof rule.handler === 'function' ? 'inline function' : rule.handler;
      return {
        type: 'response',
        response: {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Failed to load handler', handler: handlerName })
        }
      };
    }
  }

  // No handler - return response template if available
  if (responseTemplate) {
    return {
      type: 'response',
      response: {
        ...responseTemplate,
        headers: { ...responseTemplate.headers, ...matchHeader }
      }
    };
  }

  // No handler and no file - check if forwardRequest is enabled with requestTemplate
  if (rule.forwardRequest && requestTemplate) {
    return {
      type: 'forward',
      modifiedRequest: {
        body: typeof requestTemplate === 'object' ? JSON.stringify(requestTemplate) : String(requestTemplate)
      },
      forwardUrl: targetUrl
    };
  }

  return null;
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
interface MatchResult {
  rule: MockRule;
  match: MatchInfo;
}

function findMatch(url: string, method: string): MatchResult | null {
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
      if (isRegexRule(rule)) {
        const m = compileRegex(rule).exec(url);
        if (m) {
          return {
            rule,
            match: { start: m.index, end: m.index + m[0].length, pattern: patternString(rule), isRegex: true, kind: 'regex', name: rule.name },
          };
        }
      } else if (url === rule.pattern) {
        return {
          rule,
          match: { start: 0, end: url.length, pattern: patternString(rule), isRegex: false, kind: 'exact', name: rule.name },
        };
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
      if (!isRegexRule(rule)) {
        const pat = patternString(rule);
        const idx = url.indexOf(pat);
        if (idx !== -1) {
          return {
            rule,
            match: { start: idx, end: idx + pat.length, pattern: pat, isRegex: false, kind: 'substring', name: rule.name },
          };
        }
      }
    } catch {
      // shouldn't happen for non-regex, but just in case
    }
  }

  return null;
}

// Encode match info for transport over an HTTP response header.
function encodeMockeryMatch(match: MatchInfo): string {
  try {
    return Buffer.from(JSON.stringify(match), 'utf8').toString('base64');
  } catch {
    return '';
  }
}

// ANSI helpers for highlighting the matched URL portion in the server console.
const ANSI_RESET = '\x1b[0m';
const ANSI_DIM = '\x1b[2m';
const ANSI_HIGHLIGHT = '\x1b[1;96m'; // bold bright cyan

function ansiHighlightUrl(url: string, match: MatchInfo): string {
  const before = url.slice(0, match.start);
  const hit = url.slice(match.start, match.end);
  const after = url.slice(match.end);
  return `${ANSI_DIM}${before}${ANSI_RESET}${ANSI_HIGHLIGHT}${hit}${ANSI_RESET}${ANSI_DIM}${after}${ANSI_RESET}`;
}

function logMockServed(method: string, url: string, rule: MockRule, match: MatchInfo): void {
  const target = rule.handler
    ? `${typeof rule.handler === 'function' ? 'inline function' : rule.handler} (handler)`
    : rule.file ?? '(no body)';
  const namePart = rule.name ? `${ANSI_HIGHLIGHT}[${rule.name}]${ANSI_RESET} ` : '';
  console.log(`${LOG_BANNER} ${namePart}${method} ${ansiHighlightUrl(url, match)} → ${target}`);
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
      'Access-Control-Expose-Headers': 'X-Mockery-Logs, X-Mockery-Match, Content-Type',
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

      const matched = findMatch(targetUrl, targetMethod);
      if (!matched) {
        return Response.json(
          { error: 'No matching rule', url: targetUrl, method: targetMethod },
          { status: 404, headers: corsHeaders }
        );
      }
      const { rule, match } = matched;

      try {
        // Read forwarded body if present (POST from background.js when page sent a body)
        let forwardedBody: string | null = null;
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          try { forwardedBody = await req.text(); }
          catch { forwardedBody = null; }
          if (forwardedBody === '') forwardedBody = null;
        }

        const result = await resolveWithHandler(targetUrl, rule, req, targetMethod, forwardedBody, match);

        if (!result) {
          return Response.json(
            { error: 'No response generated', url: targetUrl },
            { status: 404, headers: corsHeaders }
          );
        }

        // Handle forward request mode (Option B)
        if (result.type === 'forward') {
          logMockServed(targetMethod || req.method, targetUrl, rule, match);
          console.log(`${LOG_BANNER} → Forwarding modified request to ${result.forwardUrl}`);
          
          // Return forward instructions to the extension
          return Response.json({
            forward: true,
            forwardUrl: result.forwardUrl,
            modifiedRequest: result.modifiedRequest,
            // Include response transform if handler specified one
            responseTransform: result.response ? {
              status: result.response.status,
              headers: result.response.headers,
              body: typeof result.response.body === 'string' ? result.response.body : result.response.body.toString()
            } : null
          }, { headers: corsHeaders });
        }

        // Standard response mode
        logMockServed(targetMethod || req.method, targetUrl, rule, match);

        const response = result.response!;
        const status = response.status || 200;
        const headers = { ...corsHeaders, ...response.headers };
        const body = response.body || '';

        return new Response(body, { status, headers });
      } catch (error: any) {
        console.error(`${ERROR_BANNER} Request processing error:`, error);
        return Response.json(
          { error: 'Internal server error', name: error.name, detail: error.message, ...(DEBUG ? { stack: error.stack } : {}) },
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

      const rule = rules.find(r => patternString(r) === pattern);
      if (!rule) {
        return Response.json(
          { error: 'No matching rule for pattern', pattern },
          { status: 404, headers: corsHeaders }
        );
      }

      // For pattern-based resolution the "URL" is the pattern itself, so the
      // entire string is the matched range.
      const ruleIsRegex = isRegexRule(rule);
      const match: MatchInfo = {
        start: 0,
        end: pattern.length,
        pattern,
        isRegex: ruleIsRegex,
        kind: ruleIsRegex ? 'regex' : 'exact',
      };

      try {
        const result = await resolveWithHandler(pattern, rule, req, 'GET', null, match);

        if (!result) {
          return Response.json(
            { error: 'No response generated', pattern },
            { status: 404, headers: corsHeaders }
          );
        }

        logMockServed('GET', pattern, rule, match);

        // Pattern-based resolution doesn't support forwarding (it's for static resources)
        if (result.type === 'forward') {
          return Response.json(
            { error: 'Forward request not supported for pattern-based resolution', pattern },
            { status: 400, headers: corsHeaders }
          );
        }

        const response = result.response!;
        const status = response.status || 200;
        const headers = { ...corsHeaders, ...response.headers };
        const body = response.body || '';

        return new Response(body, { status, headers });
      } catch (error: any) {
        console.error(`${ERROR_BANNER} Request processing error:`, error);
        return Response.json(
          { error: 'Internal server error', name: error.name, detail: error.message, ...(DEBUG ? { stack: error.stack } : {}) },
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
        pattern: patternString(r),
        name: r.name || null,
        file: r.file || null,
        requestFile: r.requestFile || null,
        forwardRequest: r.forwardRequest || false,
        isRegex: isRegexRule(r),
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

      // Persist to overrides file keyed by stable rule identity, so reordering
      // rules in rules.ts doesn't lose the toggle state.
      const overrides = loadOverrides();
      overrides[ruleKey(rules[index])] = enabled;
      saveOverrides(overrides);

      // Broadcast so SSE listeners (background.js) pick up the change
      broadcastConfigChange();

      return Response.json(
        { ok: true, index, enabled, pattern: patternString(rules[index]) },
        { headers: corsHeaders }
      );
    }

    return Response.json({ error: 'Not found' }, { status: 404, headers: corsHeaders });
  }
});

console.log(`${LOG_BANNER} Listening on http://127.0.0.1:${server.port}`);
console.log(`${LOG_BANNER} Config: ${configPath}`);
console.log(`${LOG_BANNER} Endpoints:`);
console.log(`  GET /resolve?url=<encoded>       — serve a matched mock`);
console.log(`  GET /resolve-pattern?pattern=<>  — serve mock by pattern (for declarativeNetRequest)`);
console.log(`  GET /rules                       — list current rules from config/rules.ts`);
console.log(`  GET /events                      — SSE stream for hot reload`);
console.log(`  GET /health                      — server status`);

// Graceful shutdown
function shutdown(signal: string): void {
  console.log(`\n${LOG_BANNER} ${signal} received, shutting down…`);
  server.stop();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
