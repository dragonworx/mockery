/**
 * MAIN-world content script — injected into the page's JS context.
 * Patches fetch() and XMLHttpRequest so intercepted requests never hit the
 * network. Instead, the mock body is retrieved from the companion Node server
 * via the ISOLATED-world bridge (content.js → background.js → localhost).
 */

(function () {
  'use strict';

  // Avoid double-injection
  if (window.__mockeryInjected) return;
  window.__mockeryInjected = true;

  const CHANNEL = '__MOCKERY__';
  let enabled = true;
  let rules = [];
  let showNotifications = true;

  // ── Log banners ────────────────────────────────────────────────────────────────
  const LOG_BANNER = '✅';
  const ERROR_BANNER = '❌';

  // ── Logger ─────────────────────────────────────────────────────────────────────
  const LOG_LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };
  const LOG_COLORS = {
    debug: '#64748b',
    info: '#8b5cf6',
    warn: '#f59e0b',
    error: '#ef4444',
  };
  let logLevel = 'info';
  function shouldLog(level) {
    return LOG_LEVELS[level] <= (LOG_LEVELS[logLevel] ?? LOG_LEVELS.info);
  }
  function prefixStyles(level) {
    return [`color:${LOG_COLORS[level] || LOG_COLORS.info};font-weight:bold`, 'color:inherit'];
  }

  // ── Wait for initial rules before intercepting ─────────────────────────
  let _rulesReady;
  const rulesLoaded = new Promise((resolve) => { _rulesReady = resolve; });

  // ── Rule cache — pushed from the ISOLATED world ───────────────────────
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.channel !== CHANNEL) return;

    const msg = event.data;

    if (msg.type === 'RULES_UPDATE') {
      rules = msg.rules || [];
      enabled = msg.enabled;
      showNotifications = msg.showNotifications !== false; // Default to true
      if (msg.logLevel && LOG_LEVELS[msg.logLevel] !== undefined) logLevel = msg.logLevel;
      _rulesReady(); // Signal that rules have arrived
    }
  });

  // Request rules on load
  window.postMessage({ channel: CHANNEL, type: 'REQUEST_RULES' }, '*');

  // Timeout: don't block requests forever if rules never arrive
  setTimeout(() => _rulesReady(), 2000);

  // ── Matching ──────────────────────────────────────────────────────────
  function findMatch(url, method) {
    if (!enabled || rules.length === 0) return null;
    const normalizedMethod = (method || 'GET').toUpperCase();

    for (const rule of rules) {
      try {
        if (rule.enabled === false) continue;
        const ruleMethod = (rule.method || '*').toUpperCase();
        if (ruleMethod !== '*' && ruleMethod !== normalizedMethod) continue;
        if (rule.isRegex) {
          if (new RegExp(rule.pattern).test(url)) return rule;
        } else {
          if (url === rule.pattern || url.includes(rule.pattern)) return rule;
        }
      } catch {
        // bad regex — skip
      }
    }
    return null;
  }

  // ── Async bridge: ask ISOLATED world to fetch from server ─────────────
  let _reqId = 0;
  const _pending = new Map();

  function requestMock(url, method, body) {
    return new Promise((resolve) => {
      const id = ++_reqId;
      _pending.set(id, resolve);
      window.postMessage({ channel: CHANNEL, type: 'RESOLVE_MOCK', id, url, method: method || 'GET', body: typeof body === 'string' ? body : null }, '*');

      // Timeout — fall through to real network after 5 s
      setTimeout(() => {
        if (_pending.has(id)) {
          _pending.delete(id);
          resolve(null);
        }
      }, 5000);
    });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.channel !== CHANNEL) return;
    if (event.data.type === 'MOCK_RESPONSE') {
      const { id, body, mime, error, handlerLogs } = event.data;
      const resolve = _pending.get(id);
      if (resolve) {
        _pending.delete(id);
        resolve(error ? null : { body, mime, handlerLogs });
      }
    }
  });

  // ── Handler log replay (MAIN world console) ──────────────────────────
  function decodeHandlerLogs(encoded) {
    try {
      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return JSON.parse(new TextDecoder('utf-8').decode(bytes));
    } catch { return null; }
  }

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

  function replayHandlerLogs(encoded, url) {
    if (!encoded) return;
    const decoded = decodeHandlerLogs(encoded);
    if (!decoded || !Array.isArray(decoded.logs) || decoded.logs.length === 0) return;
    const levelColors = {
      log:   { fg: '#475569', bg: '#f1f5f9' },
      info:  { fg: '#1e40af', bg: '#dbeafe' },
      warn:  { fg: '#92400e', bg: '#fef3c7' },
      error: { fg: '#991b1b', bg: '#fee2e2' },
      debug: { fg: '#3730a3', bg: '#e0e7ff' },
    };
    for (const entry of decoded.logs) {
      const fn = (console[entry.level] || console.log).bind(console);
      const args = (entry.args || []).map(reviveLogArg);
      const c = levelColors[entry.level] || levelColors.log;
      const tag = `%c[${entry.level.toUpperCase()}]%c`;
      const tagStyles = [`color:${c.fg};font-weight:bold;background:${c.bg};padding:1px 4px;border-radius:3px`, 'color:inherit'];
      try { fn(tag, ...tagStyles, ...args); }
      catch { try { fn(`${ERROR_BANNER} failed to replay log`, entry); } catch { /* swallow */ } }
    }
  }

  // ── Patch fetch() ────────────────────────────────────────────────────
  const originalFetch = window.fetch;

  window.fetch = async function (input, init) {
    const rawUrl = (typeof input === 'string') ? input : (input instanceof Request ? input.url : String(input));
    // Resolve relative URLs to absolute so patterns can match full URLs
    let url;
    try { url = new URL(rawUrl, document.baseURI).href; } catch { url = rawUrl; }
    const method = (init && init.method) ? init.method.toUpperCase() : (input instanceof Request ? input.method.toUpperCase() : 'GET');

    // Wait for rules to be loaded before deciding
    await rulesLoaded;

    const rule = findMatch(url, method);

    if (rule) {
      // Extract body as string when possible (most APIs send JSON strings or Blobs)
      let bodyForServer = null;
      try {
        if (input instanceof Request) {
          bodyForServer = await input.clone().text();
        } else if (init?.body != null) {
          const b = init.body;
          if (typeof b === 'string') {
            bodyForServer = b;
          } else if (b instanceof Blob) {
            bodyForServer = await b.text();
          } else if (b instanceof ArrayBuffer) {
            bodyForServer = new TextDecoder().decode(b);
          } else if (ArrayBuffer.isView(b)) {
            bodyForServer = new TextDecoder().decode(b.buffer);
          } else if (b instanceof URLSearchParams) {
            bodyForServer = b.toString();
          }
        }
      } catch { /* ignore body extraction errors */ }

      const mock = await requestMock(url, method, bodyForServer);

      if (mock) {
        // Replay any console output the server-side handler produced
        replayHandlerLogs(mock.handlerLogs, url);

        if (shouldLog('info')) {
          let parsedMock;
          try { parsedMock = JSON.parse(mock.body); } catch { parsedMock = mock.body; }

          const [pBold, pReset] = prefixStyles('info');
          console.groupCollapsed(
            `%c${LOG_BANNER}%c ${method} %c${url}%c → %c${rule.file || 'handler'}`,
            pBold, pReset,
            'color:#06b6d4', 'color:inherit',
            'color:#10b981;font-weight:bold'
          );
          const reqBody = init?.body;
          let parsedReqBody = reqBody;
          if (typeof reqBody === 'string' && reqBody.startsWith('{') && reqBody.endsWith('}')) {
            try { parsedReqBody = JSON.parse(reqBody); } catch { /* keep as string */ }
          }
          console.log('%crequest  %o', 'color:#64748b;font-weight:bold', { method, url, headers: init?.headers || {}, body: parsedReqBody });
          console.log('%cmocked   %o', 'color:#10b981;font-weight:bold', { status: 200, mime: mock.mime, body: parsedMock });
          console.groupEnd();
        }

        // Handle binary data for fetch responses
        let responseBody;
        if (mock.isBinary) {
          // Convert base64 back to binary for fetch Response
          const binaryString = atob(mock.body);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          responseBody = bytes;
        } else {
          responseBody = mock.body;
        }

        return new Response(responseBody, {
          status: 200,
          statusText: 'OK (mocked)',
          headers: { 'Content-Type': mock.mime },
        });
      } else if (shouldLog('warn')) {
        const [pBold, pReset] = prefixStyles('warn');
        console.warn(`%c${LOG_BANNER}%c ${method} %c${url}%c — mock was null, falling through to network`, pBold, pReset, 'color:#06b6d4', 'color:inherit');
      }
    }

    return originalFetch.apply(this, arguments);
  };

  // ── Patch XMLHttpRequest ─────────────────────────────────────────────
  const XHR = XMLHttpRequest;
  const origOpen = XHR.prototype.open;
  const origSend = XHR.prototype.send;

  XHR.prototype.open = function (method, url, ...rest) {
    const rawUrl = (typeof url === 'string') ? url : String(url);
    // Resolve relative URLs to absolute so patterns can match full URLs
    try { this.__mockUrl = new URL(rawUrl, document.baseURI).href; } catch { this.__mockUrl = rawUrl; }
    this.__mockMethod = (typeof method === 'string') ? method.toUpperCase() : 'GET';
    return origOpen.call(this, method, url, ...rest);
  };

  XHR.prototype.send = function (body) {
    const xhr = this;
    const url = xhr.__mockUrl;

    // Wait for rules before deciding to intercept
    rulesLoaded.then(() => {
      const rule = findMatch(url, xhr.__mockMethod || 'GET');

      if (!rule) {
        origSend.call(xhr, body);
        return;
      }

      const xhrMethod = xhr.__mockMethod || 'GET';
      const xhrBody = typeof body === 'string' ? body : null;
      requestMock(url, xhrMethod, xhrBody).then((mock) => {
      if (!mock) {
        // Fallback to real network
        origSend.call(xhr, body);
        return;
      }

      // Replay any console output the server-side handler produced
      replayHandlerLogs(mock.handlerLogs, url);

      let parsedMock;
      try { parsedMock = JSON.parse(mock.body); } catch { parsedMock = mock.body; }
      if (shouldLog('info')) {
        const [pBold, pReset] = prefixStyles('info');
        console.groupCollapsed(
          `%c${LOG_BANNER}%c ${xhrMethod} %c${url}%c → %c${rule.file || 'handler'}`,
          pBold, pReset,
          'color:#06b6d4', 'color:inherit',
          'color:#10b981;font-weight:bold'
        );
        let parsedReqBody = body;
        if (typeof body === 'string' && body.startsWith('{') && body.endsWith('}')) {
          try { parsedReqBody = JSON.parse(body); } catch { /* keep as string */ }
        }
        console.log('%crequest  %o', 'color:#64748b;font-weight:bold', { method: xhrMethod, url, body: parsedReqBody });
        console.log('%cmocked   %o', 'color:#10b981;font-weight:bold', { status: 200, mime: mock.mime, body: parsedMock });
        console.groupEnd();
      }

      // Handle different response types for XMLHttpRequest
      let responseText = mock.body;
      let response = mock.body;

      if (mock.isBinary) {
        // For binary data, set up response based on responseType
        const responseType = xhr.responseType || 'text';

        if (responseType === 'arraybuffer') {
          const binaryString = atob(mock.body);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          response = bytes.buffer;
          responseText = ''; // Can't convert binary to text
        } else if (responseType === 'blob') {
          const binaryString = atob(mock.body);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          response = new Blob([bytes], { type: mock.mime });
          responseText = ''; // Can't convert binary to text
        } else {
          // For 'text', 'document', or default - keep as base64 string
          // This isn't ideal but maintains backward compatibility
          response = mock.body;
          responseText = mock.body;
        }
      }

      // Synthesise a completed XHR
      Object.defineProperty(xhr, 'readyState', { get: () => 4 });
      Object.defineProperty(xhr, 'status', { get: () => 200 });
      Object.defineProperty(xhr, 'statusText', { get: () => 'OK (mocked)' });
      Object.defineProperty(xhr, 'responseText', { get: () => responseText });
      Object.defineProperty(xhr, 'response', { get: () => response });
      Object.defineProperty(xhr, 'responseURL', { get: () => url });
      Object.defineProperty(xhr, 'getResponseHeader', {
        value: (name) => {
          if (name.toLowerCase() === 'content-type') return mock.mime;
          return null;
        }
      });

      // Fire lifecycle events
      const readyStateEvent = new Event('readystatechange');
      xhr.dispatchEvent(readyStateEvent);
      if (typeof xhr.onreadystatechange === 'function') xhr.onreadystatechange(readyStateEvent);

      const loadEvent = new ProgressEvent('load');
      xhr.dispatchEvent(loadEvent);
      if (typeof xhr.onload === 'function') xhr.onload(loadEvent);

      const loadEndEvent = new ProgressEvent('loadend');
      xhr.dispatchEvent(loadEndEvent);
      if (typeof xhr.onloadend === 'function') xhr.onloadend(loadEndEvent);
      });
    });
  };

  if (shouldLog('debug')) {
    const [pBold, pReset] = prefixStyles('debug');
    console.debug(`%c${LOG_BANNER}%c Injector ready`, pBold, pReset);
  }
})();
