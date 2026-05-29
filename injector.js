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

    // DEBUG: unconditional log to diagnose matching
    if (url.includes('address-book')) {
      console.log(`[Mockery DEBUG] fetch intercepted: ${method} ${url}`);
      console.log(`[Mockery DEBUG] enabled=${enabled}, rules.length=${rules.length}`);
      rules.forEach((r, i) => console.log(`[Mockery DEBUG] rule[${i}]: method=${r.method}, pattern=${r.pattern.substring(0, 60)}...`));
    }

    const rule = findMatch(url, method);

    if (rule) {
      if (enableLogging) {
        console.log(`[Mockery] Rule matched for ${method} ${url}, requesting mock…`);
      }
      const mock = await requestMock(url, method);

      if (mock) {
        if (enableLogging) {
          let parsed;
          try { parsed = JSON.parse(mock.body); } catch { parsed = mock.body; }
          console.groupCollapsed(`[Mockery] fetch → ${rule.file || 'handler'}`);
          console.log('url ', url);
          console.log('mime', mock.mime);
          console.log('body', parsed);
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
        console.warn(`[Mockery] Mock response was null for ${method} ${url} — falling through to network`);
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

      requestMock(url, xhr.__mockMethod || 'GET').then((mock) => {
      if (!mock) {
        // Fallback to real network
        origSend.call(xhr, body);
        return;
      }

      let parsed;
      try { parsed = JSON.parse(mock.body); } catch { parsed = mock.body; }
      if (enableLogging) {
        console.groupCollapsed(`[Mockery] XHR → ${rule.file}`);
        console.log('url ', url);
        console.log('mime', mock.mime);
        console.log('body', parsed);
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

  console.log('[Mockery] Injector ready');
})();
