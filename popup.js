/**
 * Popup UI Logic for Mockery
 * Connects to the companion Node mock server.
 */

const enableToggle = document.getElementById('enableToggle');
const statusText = document.getElementById('statusText');
const serverUrlInput = document.getElementById('serverUrl');
const serverStatus = document.getElementById('serverStatus');
const serverHint = document.getElementById('serverHint');
const connectBtn = document.getElementById('connectBtn');
const refreshBtn = document.getElementById('refreshBtn');
const ruleCount = document.getElementById('ruleCount');
const rulesList = document.getElementById('rulesList');
const activityList = document.getElementById('activityList');
const clearActivityBtn = document.getElementById('clearActivityBtn');
const notifyToggle = document.getElementById('notifyToggle');
const autoDismissToggle = document.getElementById('autoDismissToggle');
const logLevelSelect = document.getElementById('logLevel');
const toastDurationInput = document.getElementById('toastDuration');
const forwardPermissionStatus = document.getElementById('forwardPermissionStatus');
const grantForwardPermission = document.getElementById('grantForwardPermission');

const LOG_LEVELS = new Set(['silent', 'error', 'warn', 'info', 'debug']);
const DEFAULT_LOG_LEVEL = 'info';

const DEFAULT_SERVER = 'http://127.0.0.1:8756';
const DEFAULT_TOAST_DURATION = 10;

// ── Init ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const { enabled, serverUrl, showNotifications, enableLogging, logLevel, toastDuration, autoDismissToasts } = await chrome.storage.local.get([
    'enabled', 'serverUrl', 'showNotifications', 'enableLogging', 'logLevel', 'toastDuration', 'autoDismissToasts'
  ]);

  enableToggle.checked = enabled !== false;
  updateStatusText(enabled !== false);
  serverUrlInput.value = serverUrl || DEFAULT_SERVER;

  // Load settings with defaults
  notifyToggle.checked = showNotifications !== false; // Default to true

  // Migrate legacy enableLogging boolean → logLevel
  let resolvedLevel = LOG_LEVELS.has(logLevel) ? logLevel : null;
  if (!resolvedLevel) {
    resolvedLevel = enableLogging === false ? 'silent' : DEFAULT_LOG_LEVEL;
    await chrome.storage.local.set({ logLevel: resolvedLevel });
    if (enableLogging !== undefined) await chrome.storage.local.remove('enableLogging');
  }
  logLevelSelect.value = resolvedLevel;
  toastDurationInput.value = clampDuration(toastDuration);
  autoDismissToggle.checked = autoDismissToasts !== false; // Default to true
  updateToastDurationDisabled();

  enableToggle.addEventListener('change', handleToggle);
  connectBtn.addEventListener('click', handleConnect);
  refreshBtn.addEventListener('click', fetchRules);
  clearActivityBtn.addEventListener('click', handleClearActivity);
  notifyToggle.addEventListener('change', handleNotifyToggle);
  autoDismissToggle.addEventListener('change', handleAutoDismissToggle);
  logLevelSelect.addEventListener('change', handleLogLevelChange);
  toastDurationInput.addEventListener('change', handleToastDurationChange);
  toastDurationInput.addEventListener('blur', handleToastDurationChange);
  grantForwardPermission.addEventListener('click', handleGrantForwardPermission);

  await checkServer();
  await loadActivity();
  await checkForwardPermission();
});

// ── Enable / Disable ────────────────────────────────────────────────────────
async function handleToggle() {
  const enabled = enableToggle.checked;
  await chrome.storage.local.set({ enabled });
  updateStatusText(enabled);
  showNotification(enabled ? 'Enabled' : 'Disabled', 'success');
}

function updateStatusText(enabled) {
  statusText.textContent = enabled ? 'Enabled' : 'Disabled';
  statusText.className = `status-text ${enabled ? 'enabled' : 'disabled'}`;
}

// ── Settings ────────────────────────────────────────────────────────────────
async function handleNotifyToggle() {
  const showNotifications = notifyToggle.checked;
  await chrome.storage.local.set({ showNotifications });
}

async function handleAutoDismissToggle() {
  const autoDismissToasts = autoDismissToggle.checked;
  await chrome.storage.local.set({ autoDismissToasts });
  updateToastDurationDisabled();
}

function updateToastDurationDisabled() {
  toastDurationInput.disabled = !autoDismissToggle.checked;
}

async function handleLogLevelChange() {
  const value = logLevelSelect.value;
  const logLevel = LOG_LEVELS.has(value) ? value : DEFAULT_LOG_LEVEL;
  await chrome.storage.local.set({ logLevel });
}

// ── Forward Permission ────────────────────────────────────────────────────────
async function checkForwardPermission() {
  try {
    const hasPermission = await chrome.permissions.contains({
      origins: ['<all_urls>']
    });
    
    if (hasPermission) {
      forwardPermissionStatus.textContent = 'Granted';
      forwardPermissionStatus.className = 'permission-badge granted';
      grantForwardPermission.style.display = 'none';
    } else {
      forwardPermissionStatus.textContent = 'Not granted';
      forwardPermissionStatus.className = 'permission-badge not-granted';
      grantForwardPermission.style.display = 'inline-block';
    }
  } catch (err) {
    forwardPermissionStatus.textContent = 'Error';
    forwardPermissionStatus.className = 'permission-badge error';
  }
}

async function handleGrantForwardPermission() {
  try {
    const granted = await chrome.permissions.request({
      origins: ['<all_urls>']
    });
    
    if (granted) {
      showNotification('Permission granted', 'success');
    } else {
      showNotification('Permission denied', 'error');
    }
    
    await checkForwardPermission();
  } catch (err) {
    showNotification('Failed to request permission', 'error');
  }
}

function clampDuration(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return DEFAULT_TOAST_DURATION;
  return Math.min(60, Math.max(1, n));
}

async function handleToastDurationChange() {
  const toastDuration = clampDuration(toastDurationInput.value);
  toastDurationInput.value = toastDuration;
  await chrome.storage.local.set({ toastDuration });
}

// ── Server connection ────────────────────────────────────────────────────────
async function serverBase() {
  const { serverUrl } = await chrome.storage.local.get('serverUrl');
  return (serverUrl || DEFAULT_SERVER).replace(/\/+$/, '');
}

async function handleConnect() {
  const url = serverUrlInput.value.trim().replace(/\/+$/, '');
  if (!url) return;
  await chrome.storage.local.set({ serverUrl: url });
  await checkServer();
}

async function checkServer() {
  const base = await serverBase();

  try {
    const resp = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) });
    if (resp.ok) {
      serverStatus.className = 'status-dot online';
      serverHint.textContent = 'Connected';
      serverHint.style.color = '#28a745';
      await fetchRules();
      return;
    }
  } catch {}

  serverStatus.className = 'status-dot offline';
  serverHint.innerHTML = 'Server offline — run <code>bun start</code>';
  serverHint.style.color = '#888';
  rulesList.innerHTML = '<div class="empty-state">Cannot reach mock server.</div>';
  ruleCount.textContent = '0';
}

// ── Rules from server ────────────────────────────────────────────────────────
async function fetchRules() {
  const base = await serverBase();

  try {
    const resp = await fetch(`${base}/rules`, { signal: AbortSignal.timeout(2000) });
    if (!resp.ok) throw new Error(resp.statusText);
    const rules = await resp.json();
    renderRules(rules);

    // Also refresh declarativeNetRequest rules
    chrome.runtime.sendMessage({ type: 'REFRESH_DECLARATIVE_RULES' });
  } catch (err) {
    rulesList.innerHTML = '<div class="empty-state">Failed to load rules.</div>';
    ruleCount.textContent = '0';
  }
}

function renderRules(rules) {
  if (!Array.isArray(rules)) { fetchRules(); return; }
  ruleCount.textContent = rules.length;
  rulesList.innerHTML = '';

  if (rules.length === 0) {
    rulesList.innerHTML = '<div class="empty-state">No rules in config/rules.ts</div>';
    return;
  }

  rules.forEach((rule, index) => {
    const div = document.createElement('div');
    const enabled = rule.enabled !== false;
    div.className = `rule-item${enabled ? '' : ' rule-item--disabled'}`;
    div.dataset.index = index;

    const badge = rule.isRegex ? 'regex' : 'exact';
    const target = rule.file ? escapeHtml(rule.file) : (rule.hasHandler ? 'handler' : '—');

    div.innerHTML = `
      <label class="rule-toggle-wrap">
        <input type="checkbox" class="rule-toggle-input" ${enabled ? 'checked' : ''}>
        <span class="rule-toggle-slider"></span>
      </label>
      <div class="rule-main">
        <span class="rule-pattern">${escapeHtml(rule.pattern)}</span>
        <div class="rule-file">→ <code>${target}</code>
          <span class="rule-badge ${badge}">${badge}</span>
        </div>
      </div>
    `;

    const checkbox = div.querySelector('.rule-toggle-input');
    checkbox.addEventListener('change', () => handleRuleToggle(index, checkbox));

    rulesList.appendChild(div);
  });
}

async function handleRuleToggle(index, checkbox) {
  const enabled = checkbox.checked;
  const ruleItem = checkbox.closest('.rule-item');

  // Optimistic UI update
  ruleItem.classList.toggle('rule-item--disabled', !enabled);

  const base = await serverBase();
  try {
    const resp = await fetch(`${base}/rules/${index}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });

    if (!resp.ok) throw new Error(`Server responded ${resp.status}`);

    const data = await resp.json();
    showNotification(`Rule ${enabled ? 'enabled' : 'disabled'}: ${data.pattern}`, 'success');

    // Refresh declarativeNetRequest rules in background
    chrome.runtime.sendMessage({ type: 'REFRESH_DECLARATIVE_RULES' });
  } catch (err) {
    // Revert on failure
    checkbox.checked = !enabled;
    ruleItem.classList.toggle('rule-item--disabled', enabled);
    showNotification('Failed to toggle rule', 'error');
  }
}

// ── Activity ─────────────────────────────────────────────────────────────────
async function loadActivity() {
  const { recentActivity = [] } = await chrome.storage.local.get('recentActivity');
  renderActivity(recentActivity);
}

async function handleClearActivity() {
  await chrome.storage.local.set({ recentActivity: [] });
  renderActivity([]);
  showNotification('Activity cleared', 'success');
}

function renderActivity(items) {
  activityList.innerHTML = '';

  if (!items || items.length === 0) {
    activityList.innerHTML = '<div class="empty-activity">No recent activity</div>';
    return;
  }

  items.slice(0, 15).forEach((item) => {
    const div = document.createElement('div');
    div.className = 'activity-item';

    let displayUrl = item.url || '';
    try {
      const u = new URL(displayUrl);
      displayUrl = u.hostname + u.pathname;
      if (displayUrl.length > 60) displayUrl = displayUrl.substring(0, 57) + '…';
    } catch {}

    const time = item.timestamp ? new Date(item.timestamp).toLocaleTimeString() : '';

    div.innerHTML = `
      <div class="activity-url">${escapeHtml(displayUrl)}</div>
      <div class="activity-time">${escapeHtml(time)}</div>
    `;
    activityList.appendChild(div);
  });
}

// Listen for live activity updates
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.recentActivity) {
    renderActivity(changes.recentActivity.newValue || []);
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

function showNotification(message, type, error = null) {
  const existing = document.querySelector('.notification');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.className = `notification notification-${type}`;

  // If it's an error and we have an error object, show enhanced details
  if (type === 'error' && error instanceof Error) {
    const messageEl = document.createElement('div');
    messageEl.textContent = message;
    messageEl.style.fontWeight = 'bold';

    const detailsEl = document.createElement('details');
    detailsEl.style.marginTop = '8px';
    detailsEl.style.fontSize = '11px';

    const summaryEl = document.createElement('summary');
    summaryEl.textContent = 'Show technical details';
    summaryEl.style.cursor = 'pointer';
    summaryEl.style.color = '#ccc';

    const stackEl = document.createElement('pre');
    stackEl.textContent = error.stack || error.message;
    stackEl.style.fontSize = '10px';
    stackEl.style.marginTop = '4px';
    stackEl.style.padding = '4px';
    stackEl.style.backgroundColor = 'rgba(0,0,0,0.1)';
    stackEl.style.borderRadius = '3px';
    stackEl.style.overflow = 'auto';
    stackEl.style.maxHeight = '100px';
    stackEl.style.whiteSpace = 'pre-wrap';

    detailsEl.appendChild(summaryEl);
    detailsEl.appendChild(stackEl);

    el.appendChild(messageEl);
    el.appendChild(detailsEl);

    // Longer timeout for error messages with details
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
    }, 5000);
  } else {
    // Standard notification
    el.textContent = message;
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
    }, 2000);
  }

  document.body.appendChild(el);
}

// Enhanced error notification helper
function showError(message, error) {
  console.error('Extension error:', message, error);
  showNotification(message, 'error', error);
}
