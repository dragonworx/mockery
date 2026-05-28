/**
 * Background Service Worker for HTTP Request Mocker
 * Bridges RESOLVE_MOCK messages from the content script to the local Node
 * companion server (http://localhost:8765 by default).
 */

const DEFAULT_SERVER = 'http://localhost:8756';

/**
 * Initialize extension on install
 */
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[HTTP Mocker] Extension installed');
  const storage = await chrome.storage.local.get(['enabled', 'serverUrl']);
  if (storage.enabled === undefined) {
    await chrome.storage.local.set({ enabled: true });
  }
  if (!storage.serverUrl) {
    await chrome.storage.local.set({ serverUrl: DEFAULT_SERVER });
  }
});

/**
 * Handle RESOLVE_MOCK messages from content scripts.
 * Fetches the mock body from the companion Node server.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'RESOLVE_MOCK') return false;

  (async () => {
    try {
      const { enabled, serverUrl } = await chrome.storage.local.get(['enabled', 'serverUrl']);
      if (enabled === false) {
        sendResponse({ error: 'disabled' });
        return;
      }

      const base = serverUrl || DEFAULT_SERVER;
      const url = `${base}/resolve?url=${encodeURIComponent(message.url)}`;

      const resp = await fetch(url);

      if (!resp.ok) {
        const body = await resp.text();
        sendResponse({ error: `Server returned ${resp.status}`, detail: body });
        return;
      }

      const mime = resp.headers.get('content-type') || 'application/json';
      const body = await resp.text();

      // Log activity
      const activity = {
        url: message.url,
        mime,
        timestamp: new Date().toISOString(),
      };
      const { recentActivity = [] } = await chrome.storage.local.get('recentActivity');
      recentActivity.unshift(activity);
      await chrome.storage.local.set({
        recentActivity: recentActivity.slice(0, 20),
      });

      sendResponse({ body, mime });
    } catch (err) {
      console.error('[HTTP Mocker] Error resolving mock:', err);
      sendResponse({ error: err.message });
    }
  })();

  return true; // keep message channel open for async response
});

