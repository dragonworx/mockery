/**
 * MAIN-world content script — injected into the page's JS context.
 * Patches fetch() and XMLHttpRequest so intercepted requests never hit the
 * network. Instead, the mock body is retrieved from the companion Node server
 * via the ISOLATED-world bridge (content.js → background.js → localhost).
 */

(function () {
  'use strict';

  // Avoid double-injection
  if (window.__httpMockerInjected) return;
  window.__httpMockerInjected = true;

  const CHANNEL = '__HTTP_MOCKER__';
  let enabled = true;
  let rules = [];

  // ── Rule cache — pushed from the ISOLATED world ───────────────────────
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.channel !== CHANNEL) return;

    const msg = event.data;

    if (msg.type === 'RULES_UPDATE') {
      rules = msg.rules || [];
      enabled = msg.enabled;
    }
  });

  // Request rules on load
  window.postMessage({ channel: CHANNEL, type: 'REQUEST_RULES' }, '*');

  // ── Matching ──────────────────────────────────────────────────────────
  function findMatch(url) {
    console.log('[HTTP Mocker] DEBUG: findMatch called with:', url);
    console.log('[HTTP Mocker] DEBUG: enabled:', enabled, 'rules count:', rules.length);

    if (!enabled || rules.length === 0) return null;

    for (const rule of rules) {
      console.log('[HTTP Mocker] DEBUG: Testing rule:', rule);
      try {
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

  function requestMock(url) {
    return new Promise((resolve) => {
      const id = ++_reqId;
      _pending.set(id, resolve);
      window.postMessage({ channel: CHANNEL, type: 'RESOLVE_MOCK', id, url }, '*');

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
    const url = (typeof input === 'string') ? input : (input instanceof Request ? input.url : String(input));
    console.log('[HTTP Mocker] DEBUG: Fetch called for:', url);

    const rule = findMatch(url);
    console.log('[HTTP Mocker] DEBUG: Rule found:', rule);

    if (rule) {
      console.log('[HTTP Mocker] DEBUG: Requesting mock for:', url);
      const mock = await requestMock(url);
      console.log('[HTTP Mocker] DEBUG: Mock response:', mock);

      if (mock) {
        let parsed;
        try { parsed = JSON.parse(mock.body); } catch { parsed = mock.body; }
        console.groupCollapsed(`[HTTP Mocker] fetch → ${rule.file}`);
        console.log('url ', url);
        console.log('mime', mock.mime);
        console.log('body', parsed);
        console.groupEnd();

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
      }
    }

    return originalFetch.apply(this, arguments);
  };

  // ── Patch XMLHttpRequest ─────────────────────────────────────────────
  const XHR = XMLHttpRequest;
  const origOpen = XHR.prototype.open;
  const origSend = XHR.prototype.send;

  XHR.prototype.open = function (method, url, ...rest) {
    this.__mockUrl = (typeof url === 'string') ? url : String(url);
    this.__mockRule = findMatch(this.__mockUrl);
    return origOpen.call(this, method, url, ...rest);
  };

  XHR.prototype.send = function (body) {
    const rule = this.__mockRule;

    if (!rule) {
      return origSend.call(this, body);
    }

    const xhr = this;
    const url = xhr.__mockUrl;

    requestMock(url).then((mock) => {
      if (!mock) {
        // Fallback to real network
        origSend.call(xhr, body);
        return;
      }

      let parsed;
      try { parsed = JSON.parse(mock.body); } catch { parsed = mock.body; }
      console.groupCollapsed(`[HTTP Mocker] XHR → ${rule.file}`);
      console.log('url ', url);
      console.log('mime', mock.mime);
      console.log('body', parsed);
      console.groupEnd();

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
  };

  console.log('[HTTP Mocker] MAIN-world injector loaded');
})();
