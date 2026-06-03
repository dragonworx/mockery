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
  const { enabled, serverUrl, showNotifications, enableLogging } = await chrome.storage.local.get([
    'enabled', 'serverUrl', 'showNotifications', 'enableLogging'
  ]);
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
    enableLogging: enableLogging !== false,       // Default to true
  }, '*');
}

// Initial push + refresh on storage changes
pushRules();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.enabled || changes.serverUrl || changes.showNotifications || changes.enableLogging)) {
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
    console.log('[Mockery] Hot reload: rules updated');
    pushRules();
  }
});

// ── Forward mock resolution requests ────────────────────────────────────────

window.addEventListener('message', async (event) => {
  if (event.source !== window) return;
  if (!event.data || event.data.channel !== CHANNEL) return;
  if (event.data.type !== 'RESOLVE_MOCK') return;

  const { id, url, method } = event.data;

  try {
    // Ask the background SW (which can fetch localhost without mixed-content issues)
    const result = await chrome.runtime.sendMessage({
      type: 'RESOLVE_MOCK',
      url,
      method: method || 'GET',
    });

    if (result && !result.error) {
      window.postMessage({
        channel: CHANNEL,
        type: 'MOCK_RESPONSE',
        id,
        body: result.body,
        mime: result.mime,
      }, '*');

      showToast(url, result.file, 'success');
    } else {
      window.postMessage({
        channel: CHANNEL,
        type: 'MOCK_RESPONSE',
        id,
        error: true,
      }, '*');

      // Show error toast with details
      const errorMessage = result?.detail ? parseErrorDetail(result.detail) : result?.error || 'Unknown error';
      showToast(url, null, 'error', errorMessage);
    }
  } catch (err) {
    window.postMessage({
      channel: CHANNEL,
      type: 'MOCK_RESPONSE',
      id,
      error: true,
    }, '*');

    showToast(url, null, 'error', 'Server connection failed');
  }
});

// ── Toast notifications ─────────────────────────────────────────────────────

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

function showToast(url, file, type = 'success', customMessage = null) {
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
    max-width: min(720px, calc(100vw - 40px));
    width: max-content;
    pointer-events: auto;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    opacity: 0; transform: translateX(100%);
    transition: all 0.3s ease-out;
  `;

  const { origin, path } = splitUrl(url);

  if (isError) {
    toast.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <span style="font-size:14px;">${icon}</span>
        <span style="font-size:11px;font-weight:700;letter-spacing:0.5px;color:${accentColor};">${label}</span>
        <span style="font-size:12px;color:${mutedColor};">${escapeHtml(customMessage || '')}</span>
      </div>
      <div style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;word-break:break-all;">
        <span style="color:${mutedColor};">${escapeHtml(origin)}</span><span style="font-weight:600;color:${textColor};">${escapeHtml(path)}</span>
      </div>
    `;
  } else {
    toast.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <span style="font-size:14px;">${icon}</span>
        <span style="font-size:11px;font-weight:700;letter-spacing:0.5px;color:${accentColor};">${label}</span>
        <span style="font-size:12px;color:${mutedColor};">→ ${escapeHtml(file || 'stub')}</span>
      </div>
      <div style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;word-break:break-all;">
        <span style="color:${mutedColor};">${escapeHtml(origin)}</span><span style="font-weight:600;color:${textColor};">${escapeHtml(path)}</span>
      </div>
    `;
  }

  toast.title = 'Click to dismiss';
  toast.addEventListener('click', () => dismissToast(toast));

  list.appendChild(toast);
  updateDismissAllVisibility();

  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(0)';
  });

  toast.__timer = setTimeout(() => dismissToast(toast), toastDurationMs);
}

console.log('[Mockery] ISOLATED bridge loaded');
