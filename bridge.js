/**
 * ISOLATED-world content script — bridge between the MAIN-world injector
 * and the background service worker.
 *
 * Responsibilities:
 *  1. Push rules + enabled state into the MAIN world whenever they change.
 *  2. Forward RESOLVE_MOCK requests from the MAIN world to the background SW,
 *     which fetches the bytes from the companion Node server.
 *  3. Show toast notifications when a mock is served.
 */

const CHANNEL = '__MOCKERY__';
const DEFAULT_TOAST_DURATION_MS = 10000;
let toastDurationMs = DEFAULT_TOAST_DURATION_MS;

// ── Logger ───────────────────────────────────────────────────────────────────────────────
const LOG_LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };
const LOG_COLORS = {
  debug: '#64748b',
  info: '#8b5cf6',
  warn: '#f59e0b',
  error: '#ef4444',
};
let currentLogLevel = 'info';
function shouldLog(level) {
  return LOG_LEVELS[level] <= (LOG_LEVELS[currentLogLevel] ?? LOG_LEVELS.info);
}
function logPrefix(level) {
  const c = LOG_COLORS[level] || LOG_COLORS.info;
  return [`%c[Mockery]%c`, `color:${c};font-weight:bold`, 'color:inherit'];
}
const LOG_METHOD_BY_LEVEL = { debug: 'debug', info: 'log', warn: 'warn', error: 'error' };
function log(level, ...args) {
  if (!shouldLog(level)) return;
  const method = LOG_METHOD_BY_LEVEL[level] || 'log';
  console[method](...logPrefix(level), ...args);
}

function applyToastDuration(value) {
  const n = Number.parseInt(value, 10);
  if (Number.isFinite(n) && n >= 1 && n <= 60) {
    toastDurationMs = n * 1000;
  } else {
    toastDurationMs = DEFAULT_TOAST_DURATION_MS;
  }
}

chrome.storage.local.get('toastDuration').then(({ toastDuration }) => applyToastDuration(toastDuration));

// ── Push rules into MAIN world ──────────────────────────────────────────────

async function pushRules() {
  const { enabled, serverUrl, showNotifications, logLevel, enableLogging } = await chrome.storage.local.get([
    'enabled', 'serverUrl', 'showNotifications', 'logLevel', 'enableLogging'
  ]);
  // Resolve log level (migrate legacy enableLogging boolean if present)
  let resolvedLevel;
  if (LOG_LEVELS[logLevel] !== undefined) resolvedLevel = logLevel;
  else if (enableLogging === false) resolvedLevel = 'silent';
  else resolvedLevel = 'info';
  currentLogLevel = resolvedLevel;
  const base = serverUrl || 'http://localhost:8756';
  let rules = [];

  if (enabled !== false) {
    try {
      const resp = await fetch(`${base}/rules`);
      if (resp.ok) rules = await resp.json();
    } catch {
      // server unreachable — no rules
    }
  }

  window.postMessage({
    channel: CHANNEL,
    type: 'RULES_UPDATE',
    rules,
    enabled: enabled !== false,
    showNotifications: showNotifications !== false, // Default to true
    logLevel: resolvedLevel,
  }, '*');
}

// Initial push + refresh on storage changes
pushRules();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.enabled || changes.serverUrl || changes.showNotifications || changes.logLevel || changes.enableLogging)) {
    pushRules();
  }
  if (area === 'local' && changes.toastDuration) {
    applyToastDuration(changes.toastDuration.newValue);
  }
});

// Re-push when the injector asks (e.g. on late load)
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.channel === CHANNEL && event.data.type === 'REQUEST_RULES') {
    pushRules();
  }
});

// Re-push when background notifies of config change (SSE hot reload)
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'RULES_CHANGED') {
    log('debug', 'Hot reload: rules updated');
    pushRules();
  }
});

// ── Forward mock resolution requests ────────────────────────────────────────

window.addEventListener('message', async (event) => {
  if (event.source !== window) return;
  if (!event.data || event.data.channel !== CHANNEL) return;
  if (event.data.type !== 'RESOLVE_MOCK') return;

  const { id, url, method, body } = event.data;

  try {
    // Ask the background SW (which can fetch localhost without mixed-content issues)
    const result = await chrome.runtime.sendMessage({
      type: 'RESOLVE_MOCK',
      url,
      method: method || 'GET',
      body: typeof body === 'string' ? body : null,
    });

    if (result && !result.error) {
      window.postMessage({
        channel: CHANNEL,
        type: 'MOCK_RESPONSE',
        id,
        body: result.body,
        mime: result.mime,
        handlerLogs: result.handlerLogs || null,
      }, '*');

      // Handler logs are replayed in injector.js (MAIN world) — don't double-log here.

      showToast(url, result.file, 'success', null, result.handlerLogs || null);
    } else {
      window.postMessage({
        channel: CHANNEL,
        type: 'MOCK_RESPONSE',
        id,
        error: true,
      }, '*');

      // Show error toast with details
      const errorInfo = buildErrorInfo(result);
      showToast(url, null, 'error', errorInfo);
    }
  } catch (err) {
    window.postMessage({
      channel: CHANNEL,
      type: 'MOCK_RESPONSE',
      id,
      error: true,
    }, '*');

    showToast(url, null, 'error', {
      summary: 'Server connection failed',
      detail: err?.message || String(err),
      stack: err?.stack || null,
    });
  }
});

// ── Handler-log replay ──────────────────────────────────────────────────────

// Decode the X-Mockery-Logs base64-JSON header forwarded by background.js and
// replay each captured log call into THIS world's console (page DevTools).
function replayHandlerLogs(encoded, url) {
  if (!encoded) return;
  const decoded = decodeHandlerLogs(encoded);
  if (!decoded) return;
  const { logs } = decoded;
  if (!Array.isArray(logs) || logs.length === 0) return;

  const levelColors = {
    log:   { fg: '#475569', bg: '#f1f5f9' },
    info:  { fg: '#1e40af', bg: '#dbeafe' },
    warn:  { fg: '#92400e', bg: '#fef3c7' },
    error: { fg: '#991b1b', bg: '#fee2e2' },
    debug: { fg: '#3730a3', bg: '#e0e7ff' },
  };
  for (const entry of logs) {
    const fn = (console[entry.level] || console.log).bind(console);
    const args = (entry.args || []).map(reviveLogArg);
    const c = levelColors[entry.level] || levelColors.log;
    const tag = `%c[${entry.level.toUpperCase()}]%c`;
    const tagStyles = [`color:${c.fg};font-weight:bold;background:${c.bg};padding:1px 4px;border-radius:3px`, 'color:inherit'];
    try {
      fn(tag, ...tagStyles, ...args);
    } catch {
      try { fn('[Mockery] failed to replay log', entry); } catch { /* swallow */ }
    }
  }
}

function decodeHandlerLogs(encoded) {
  try {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const json = new TextDecoder('utf-8').decode(bytes);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// Render the captured handler logs as a list inside a success toast.
function buildHandlerLogsHtml(encoded, mutedColor, textColor, accentColor) {
  if (!encoded) return '';
  const decoded = decodeHandlerLogs(encoded);
  const logs = decoded?.logs;
  if (!Array.isArray(logs) || logs.length === 0) return '';

  const levelStyles = {
    log:   { fg: '#475569', bg: '#f1f5f9' },
    info:  { fg: '#1e40af', bg: '#dbeafe' },
    warn:  { fg: '#92400e', bg: '#fef3c7' },
    error: { fg: '#991b1b', bg: '#fee2e2' },
    debug: { fg: '#3730a3', bg: '#e0e7ff' },
  };

  const items = logs.map((entry) => {
    const lvl = entry.level || 'log';
    const c = levelStyles[lvl] || levelStyles.log;
    const args = Array.isArray(entry.args) ? entry.args : [];
    const text = args.map(formatLogArg).join(' ');
    return `
      <li style="display:flex;gap:6px;align-items:flex-start;padding:2px 0;list-style:none;">
        <span style="flex:0 0 auto;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10px;font-weight:700;color:${c.fg};background:${c.bg};padding:1px 5px;border-radius:3px;line-height:1.5;">${escapeHtml(lvl.toUpperCase())}</span>
        <span style="flex:1 1 auto;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;color:${textColor};white-space:pre-wrap;word-break:break-word;">${escapeHtml(text)}</span>
      </li>
    `;
  }).join('');

  return `
    <div style="margin-top:8px;padding-top:6px;border-top:1px dashed ${mutedColor};">
      <div style="font-size:10px;font-weight:700;letter-spacing:0.4px;color:${accentColor};margin-bottom:4px;">HANDLER LOGS (${logs.length})</div>
      <ul style="margin:0;padding:0;max-height:200px;overflow:auto;">${items}</ul>
    </div>
  `;
}

// Render one log argument as a compact single-line string for the toast.
function formatLogArg(value) {
  if (value === null || value === undefined) return String(value);
  const t = typeof value;
  if (t === 'string') return value;
  if (t === 'number' || t === 'boolean' || t === 'bigint') return String(value);
  if (value && typeof value === 'object') {
    if (value.__type === 'Error') return `${value.name || 'Error'}: ${value.message || ''}`;
    if (value.__type === 'Date') return value.iso;
    if (value.__type === 'RegExp') return `/${value.source}/${value.flags || ''}`;
    try { return JSON.stringify(value); }
    catch { return '[object]'; }
  }
  return String(value);
}

// Inverse of server-side safeSerialize: turn sentinel-tagged objects back into
// browser equivalents so console.log renders nicely.
function reviveLogArg(value) {
  if (value && typeof value === 'object') {
    if (value.__type === 'Error') {
      const err = new Error(value.message);
      err.name = value.name || 'Error';
      if (value.stack) err.stack = value.stack;
      return err;
    }
    if (value.__type === 'Date') return new Date(value.iso);
    if (value.__type === 'RegExp') return new RegExp(value.source, value.flags);
    if (value.__type === 'URLSearchParams') {
      const p = new URLSearchParams();
      for (const [k, v] of value.entries || []) p.append(k, v);
      return p;
    }
    if (value.__type === 'Map') {
      const m = new Map();
      for (const [k, v] of value.entries || []) m.set(reviveLogArg(k), reviveLogArg(v));
      return m;
    }
    if (value.__type === 'Set') {
      const s = new Set();
      for (const v of value.values || []) s.add(reviveLogArg(v));
      return s;
    }
    if (Array.isArray(value)) return value.map(reviveLogArg);
    const out = {};
    for (const k of Object.keys(value)) out[k] = reviveLogArg(value[k]);
    return out;
  }
  return value;
}

// ── Toast notifications ─────────────────────────────────────────────────────
// Build a structured error info object from whatever the background SW returned.
// Result shape: { summary, name, handler, detail, stack, status, raw }
function buildErrorInfo(result) {
  const info = {
    summary: result?.error || 'Unknown error',
    name: null,
    handler: null,
    detail: null,
    stack: null,
    status: null,
    raw: null,
  };

  // result.error often looks like "Server returned 500"
  const statusMatch = /Server returned (\d+)/.exec(info.summary);
  if (statusMatch) info.status = Number(statusMatch[1]);

  // result.detail is the raw response body from the server (usually JSON)
  if (typeof result?.detail === 'string') {
    info.raw = result.detail;
    try {
      const parsed = JSON.parse(result.detail);
      info.summary = parsed.error || info.summary;
      info.name = parsed.name || null;
      info.handler = parsed.handler || null;
      info.detail = parsed.detail || null;
      info.stack = parsed.stack || null;

      // Nice friendly rewrites for common cases
      if (parsed.error === 'File read error' && parsed.file) {
        info.summary = `File not found: ${parsed.file}`;
      } else if (parsed.error === 'No matching rule') {
        info.summary = 'No rule matches this URL';
      }
    } catch {
      // Not JSON — use raw text as detail
      info.detail = result.detail;
    }
  }

  return info;
}

// Kept for backward compatibility; unused in the new error toast path.
function parseErrorDetail(detail) {
  try {
    const error = JSON.parse(detail);
    if (error.error === 'File read error') {
      return `File not found: ${error.file}`;
    }
    if (error.error === 'No matching rule') {
      return 'No rule matches this URL';
    }
    return error.error || 'Unknown error';
  } catch {
    return detail || 'Unknown error';
  }
}

let toastContainer = null;
let toastList = null;
let dismissAllBtn = null;

function dismissToast(toast) {
  if (!toast || toast.__dismissed) return;
  toast.__dismissed = true;
  if (toast.__timer) clearTimeout(toast.__timer);
  toast.style.opacity = '0';
  toast.style.transform = 'translateX(100%)';
  setTimeout(() => {
    toast.remove();
    updateDismissAllVisibility();
  }, 300);
}

function dismissAllToasts() {
  if (!toastList) return;
  for (const t of Array.from(toastList.children)) dismissToast(t);
}

// Pressing Escape dismisses any open Mockery toasts.
// Captured at document level (capture phase) so it works even when focus is
// inside a contenteditable / iframe-free input on the page.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!toastList) return;
  const active = Array.from(toastList.children).filter(t => !t.__dismissed);
  if (active.length === 0) return;
  dismissAllToasts();
}, true);

function updateDismissAllVisibility() {
  if (!dismissAllBtn || !toastList) return;
  const active = Array.from(toastList.children).filter(t => !t.__dismissed).length;
  dismissAllBtn.style.display = active > 1 ? 'inline-flex' : 'none';
}

function ensureToastContainer() {
  if (toastContainer) return toastList;
  toastContainer = document.createElement('div');
  toastContainer.id = 'mockery-toast-container';
  toastContainer.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 10000;
    pointer-events: none;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  `;

  dismissAllBtn = document.createElement('button');
  dismissAllBtn.type = 'button';
  dismissAllBtn.textContent = 'Dismiss all';
  dismissAllBtn.style.cssText = `
    display: none;
    align-items: center;
    margin-bottom: 8px;
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.3px;
    color: #fff;
    background: rgba(30, 30, 30, 0.85);
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 4px;
    cursor: pointer;
    pointer-events: auto;
    box-shadow: 0 2px 6px rgba(0,0,0,0.2);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;
  dismissAllBtn.addEventListener('click', dismissAllToasts);
  toastContainer.appendChild(dismissAllBtn);

  toastList = document.createElement('div');
  toastList.style.cssText = `
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    pointer-events: none;
  `;
  toastContainer.appendChild(toastList);

  document.body.appendChild(toastContainer);
  return toastList;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function splitUrl(url) {
  try {
    const u = new URL(url);
    return {
      origin: u.origin,
      path: u.pathname + u.search + u.hash,
    };
  } catch {
    return { origin: '', path: url };
  }
}

function showToast(url, file, type = 'success', errorInfoOrMessage = null, encodedHandlerLogs = null) {
  const list = ensureToastContainer();
  const isError = type === 'error';
  const toast = document.createElement('div');

  // Different styles for success vs error
  const backgroundColor = isError ? '#f8d7da' : '#d4edda';
  const textColor      = isError ? '#721c24' : '#155724';
  const borderColor    = isError ? '#f5c6cb' : '#c3e6cb';
  const accentColor    = isError ? '#a71d2a' : '#0b5d2a';
  const mutedColor     = isError ? '#9c4951' : '#4a7a59';
  const label          = isError ? 'MOCK ERROR' : 'MOCKED';
  const icon           = isError ? '❌' : '🔄';

  // Error toasts get extra width to fit stack traces; success toasts widen too when logs are present.
  const hasHandlerLogs = !isError && !!encodedHandlerLogs;
  const maxWidth = (isError || hasHandlerLogs) ? 'min(880px, calc(100vw - 40px))' : 'min(720px, calc(100vw - 40px))';

  toast.style.cssText = `
    position: relative;
    background: ${backgroundColor}; color: ${textColor};
    border: 1px solid ${borderColor};
    border-left: 4px solid ${accentColor};
    padding: 10px 14px; border-radius: 6px;
    margin-bottom: 10px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    font-size: 13px; line-height: 1.4;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    max-width: ${maxWidth};
    width: max-content;
    pointer-events: auto;
    cursor: ${(isError || hasHandlerLogs) ? 'default' : 'pointer'};
    ${(isError || hasHandlerLogs) ? '' : 'user-select: none; -webkit-user-select: none;'}
    opacity: 0; transform: translateX(100%);
    transition: all 0.3s ease-out;
  `;

  const { origin, path } = splitUrl(url);

  if (isError) {
    // Normalize: support legacy string customMessage as well as structured info
    const info = (errorInfoOrMessage && typeof errorInfoOrMessage === 'object')
      ? errorInfoOrMessage
      : { summary: errorInfoOrMessage || 'Unknown error' };

    const lines = [];
    if (info.handler) lines.push(['handler', info.handler]);
    if (info.name && info.name !== 'Error') lines.push(['type', info.name]);
    if (info.status) lines.push(['status', String(info.status)]);
    if (info.detail && info.detail !== info.summary) lines.push(['message', info.detail]);

    const metaHtml = lines.length
      ? `<div style="margin-top:6px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:1.5;">
          ${lines.map(([k, v]) => `<div><span style="color:${mutedColor};">${escapeHtml(k)}:</span> <span style="color:${textColor};">${escapeHtml(v)}</span></div>`).join('')}
        </div>`
      : '';

    const stackHtml = info.stack
      ? `<details style="margin-top:8px;">
          <summary style="cursor:pointer;font-size:11px;font-weight:600;color:${accentColor};user-select:none;-webkit-user-select:none;">Stack trace</summary>
          <pre style="margin:6px 0 0 0;padding:8px;background:rgba(0,0,0,0.06);border-radius:4px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:1.45;color:${textColor};white-space:pre-wrap;word-break:break-word;max-height:240px;overflow:auto;">${escapeHtml(info.stack)}</pre>
        </details>`
      : '';

    const closeBtn = `<button type="button" data-mockery-close style="position:absolute;top:6px;right:8px;background:transparent;border:none;color:${mutedColor};font-size:16px;line-height:1;cursor:pointer;padding:2px 6px;border-radius:3px;" title="Dismiss">×</button>`;

    toast.innerHTML = `
      ${closeBtn}
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;padding-right:18px;">
        <span style="font-size:14px;">${icon}</span>
        <span style="font-size:11px;font-weight:700;letter-spacing:0.5px;color:${accentColor};">${label}</span>
        <span style="font-size:12px;color:${textColor};font-weight:600;">${escapeHtml(info.summary || 'Unknown error')}</span>
      </div>
      <div style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;word-break:break-all;">
        <span style="color:${mutedColor};">${escapeHtml(origin)}</span><span style="font-weight:600;color:${textColor};">${escapeHtml(path)}</span>
      </div>
      ${metaHtml}
      ${stackHtml}
    `;
  } else {
    const logsHtml = buildHandlerLogsHtml(encodedHandlerLogs, mutedColor, textColor, accentColor);
    const closeBtn = hasHandlerLogs
      ? `<button type="button" data-mockery-close style="position:absolute;top:6px;right:8px;background:transparent;border:none;color:${mutedColor};font-size:16px;line-height:1;cursor:pointer;padding:2px 6px;border-radius:3px;" title="Dismiss">×</button>`
      : '';
    toast.innerHTML = `
      ${closeBtn}
      <div style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;word-break:break-all;${hasHandlerLogs ? 'padding-right:18px;' : ''}">
        <span style="font-weight:600;color:${textColor};">${escapeHtml(path)}</span>
      </div>
      ${logsHtml}
    `;
  }

  if (isError) {
    // Only the explicit close button dismisses an error toast — keep auto-timer too,
    // but allow text selection / details expansion inside.
    const closeEl = toast.querySelector('[data-mockery-close]');
    if (closeEl) closeEl.addEventListener('click', (e) => { e.stopPropagation(); dismissToast(toast); });
    toast.title = 'Click × to dismiss';
  } else if (hasHandlerLogs) {
    // Success-with-logs: avoid click-to-dismiss so users can scroll/select inside.
    const closeEl = toast.querySelector('[data-mockery-close]');
    if (closeEl) closeEl.addEventListener('click', (e) => { e.stopPropagation(); dismissToast(toast); });
    toast.title = 'Click × to dismiss';
  } else {
    toast.title = 'Click to dismiss';
    toast.addEventListener('click', () => dismissToast(toast));
  }

  list.appendChild(toast);
  updateDismissAllVisibility();

  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(0)';
  });

  // Error toasts persist longer so the user has time to read the stack
  const duration = isError ? Math.max(toastDurationMs, 30_000) : toastDurationMs;
  toast.__timer = setTimeout(() => dismissToast(toast), duration);
}

log('debug', 'ISOLATED bridge loaded');
