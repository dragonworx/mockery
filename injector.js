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
  let enableLogging = true;

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
      enableLogging = msg.enableLogging !== false;       // Default to true
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

  function requestMock(url, method) {
    return new Promise((resolve) => {
      const id = ++_reqId;
      _pending.set(id, resolve);
      window.postMessage({ channel: CHANNEL, type: 'RESOLVE_MOCK', id, url, method: method || 'GET' }, '*');

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
      const { id, body, mime, error } = event.data;
      const resolve = _pending.get(id);
      if (resolve) {
        _pending.delete(id);
        resolve(error ? null : { body, mime });
      }
    }
  });

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

    // Diagnostic log for address-book URLs
    if (url.includes('address-book')) {
      console.log(`%c[Mockery]%c fetch intercepted: ${method} %c${url}`, 'color:#8b5cf6;font-weight:bold', 'color:inherit;font-weight:bold', 'color:#06b6d4');
      console.log(`%c[Mockery]%c enabled=%c${enabled}%c, rules.length=%c${rules.length}`, 'color:#8b5cf6;font-weight:bold', 'color:inherit', 'color:#f59e0b;font-weight:bold', 'color:inherit', 'color:#f59e0b;font-weight:bold');
      rules.forEach((r, i) => console.log(`%c[Mockery]%c rule[${i}]: method=%c${r.method}%c, pattern=%c${r.pattern.substring(0, 60)}…`, 'color:#8b5cf6;font-weight:bold', 'color:inherit', 'color:#10b981', 'color:inherit', 'color:#06b6d4'));
    }

    const rule = findMatch(url, method);

    if (rule) {
      if (enableLogging) {
        console.log(`%c[Mockery]%c ${method} %c${url}%c — %crule matched%c, requesting mock…`, 'color:#8b5cf6;font-weight:bold', 'color:inherit;font-weight:bold', 'color:#06b6d4', 'color:inherit', 'color:#10b981;font-weight:bold', 'color:inherit');
      }
      // Fetch mock and original response in parallel
      const [mock, originalRes] = await Promise.all([
        requestMock(url, method),
        originalFetch.apply(this, arguments).catch(() => null),
      ]);

      if (mock) {
        if (enableLogging) {
          let parsedMock;
          try { parsedMock = JSON.parse(mock.body); } catch { parsedMock = mock.body; }

          let parsedOriginal = null;
          if (originalRes) {
            try {
              const cloned = originalRes.clone();
              const text = await cloned.text();
              try { parsedOriginal = JSON.parse(text); } catch { parsedOriginal = text; }
            } catch { /* ignore */ }
          }

          console.groupCollapsed(
            `%c[Mockery]%c ${method} %c${url}%c → %c${rule.file || 'handler'}`,
            'color:#8b5cf6;font-weight:bold', 'color:inherit;font-weight:bold',
            'color:#06b6d4', 'color:inherit',
            'color:#10b981;font-weight:bold'
          );
          console.log('%crequest  %o', 'color:#64748b;font-weight:bold', { method, url, headers: init?.headers || {}, body: init?.body });
          console.log('%coriginal %o', 'color:#f59e0b;font-weight:bold', originalRes ? { status: originalRes.status, body: parsedOriginal } : '(failed or unavailable)');
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
      } else if (enableLogging) {
        console.warn(`%c[Mockery]%c ${method} %c${url}%c — mock was null, falling through to network`, 'color:#8b5cf6;font-weight:bold', 'color:inherit;font-weight:bold', 'color:#06b6d4', 'color:#f59e0b');
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
      Promise.all([
        requestMock(url, xhrMethod),
        // Fire the original request in parallel to capture the original response for logging
        enableLogging
          ? originalFetch(url, { method: xhrMethod, body: body, headers: {} }).then(r => r.text().then(t => ({ status: r.status, body: t }))).catch(() => null)
          : Promise.resolve(null),
      ]).then(([mock, originalRes]) => {
      if (!mock) {
        // Fallback to real network
        origSend.call(xhr, body);
        return;
      }

      let parsedMock;
      try { parsedMock = JSON.parse(mock.body); } catch { parsedMock = mock.body; }
      if (enableLogging) {
        let parsedOriginal = null;
        if (originalRes) {
          try { parsedOriginal = JSON.parse(originalRes.body); } catch { parsedOriginal = originalRes.body; }
        }

        console.groupCollapsed(
          `%c[Mockery]%c ${xhrMethod} %c${url}%c → %c${rule.file || 'handler'}`,
          'color:#8b5cf6;font-weight:bold', 'color:inherit;font-weight:bold',
          'color:#06b6d4', 'color:inherit',
          'color:#10b981;font-weight:bold'
        );
        console.log('%crequest  %o', 'color:#64748b;font-weight:bold', { method: xhrMethod, url, body });
        console.log('%coriginal %o', 'color:#f59e0b;font-weight:bold', originalRes ? { status: originalRes.status, body: parsedOriginal } : '(failed or unavailable)');
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

  console.log('%c[Mockery]%c Injector ready', 'color:#8b5cf6;font-weight:bold', 'color:inherit');
})();
