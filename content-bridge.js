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

const CHANNEL = '__HTTP_MOCKER__';

// ── Push rules into MAIN world ──────────────────────────────────────────────

async function pushRules() {
  const { enabled, serverUrl } = await chrome.storage.local.get(['enabled', 'serverUrl']);
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
  }, '*');
}

// Initial push + refresh on storage changes
pushRules();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.enabled || changes.serverUrl)) {
    pushRules();
  }
});

// Re-push when the injector asks (e.g. on late load)
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.channel === CHANNEL && event.data.type === 'REQUEST_RULES') {
    pushRules();
  }
});

// ── Forward mock resolution requests ────────────────────────────────────────

window.addEventListener('message', async (event) => {
  if (event.source !== window) return;
  if (!event.data || event.data.channel !== CHANNEL) return;
  if (event.data.type !== 'RESOLVE_MOCK') return;

  const { id, url } = event.data;

  try {
    // Ask the background SW (which can fetch localhost without mixed-content issues)
    const result = await chrome.runtime.sendMessage({
      type: 'RESOLVE_MOCK',
      url,
    });

    if (result && !result.error) {
      window.postMessage({
        channel: CHANNEL,
        type: 'MOCK_RESPONSE',
        id,
        body: result.body,
        mime: result.mime,
      }, '*');

      showToast(url, result.file);
    } else {
      window.postMessage({
        channel: CHANNEL,
        type: 'MOCK_RESPONSE',
        id,
        error: true,
      }, '*');
    }
  } catch (err) {
    window.postMessage({
      channel: CHANNEL,
      type: 'MOCK_RESPONSE',
      id,
      error: true,
    }, '*');
  }
});

// ── Toast notifications ─────────────────────────────────────────────────────

let toastContainer = null;

function ensureToastContainer() {
  if (toastContainer) return toastContainer;
  toastContainer = document.createElement('div');
  toastContainer.id = 'http-mocker-toast-container';
  toastContainer.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 10000;
    pointer-events: none;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;
  document.body.appendChild(toastContainer);
  return toastContainer;
}

function showToast(url, file) {
  const container = ensureToastContainer();
  let displayUrl = url;
  try {
    const u = new URL(url);
    displayUrl = u.hostname + u.pathname;
    if (displayUrl.length > 50) displayUrl = displayUrl.substring(0, 47) + '…';
  } catch {}

  const toast = document.createElement('div');
  toast.style.cssText = `
    background: #d4edda; color: #155724;
    border: 1px solid #c3e6cb;
    padding: 12px 16px; border-radius: 6px;
    margin-bottom: 10px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    font-size: 14px; font-weight: 500;
    max-width: 380px; word-wrap: break-word;
    pointer-events: auto;
    opacity: 0; transform: translateX(100%);
    transition: all 0.3s ease-out;
  `;
  toast.textContent = `🔄 Mock: ${displayUrl} → ${file || 'stub'}`;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(0)';
  });

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

console.log('[HTTP Mocker] ISOLATED bridge loaded');
