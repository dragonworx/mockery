/**
 * Background Service Worker for Mockery
 * Bridges RESOLVE_MOCK messages from the content script to the local Node
 * companion server (http://localhost:8756 by default).
 * Also manages declarativeNetRequest rules for HTML resource interception.
 */

const DEFAULT_SERVER = 'http://localhost:8756';

/**
 * Initialize extension on install
 */
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[Mockery] Extension installed');
  const storage = await chrome.storage.local.get(['enabled', 'serverUrl']);
  if (storage.enabled === undefined) {
    await chrome.storage.local.set({ enabled: true });
  }
  if (!storage.serverUrl) {
    await chrome.storage.local.set({ serverUrl: DEFAULT_SERVER });
  }

  // Initialize declarativeNetRequest rules
  await updateDeclarativeRules();
});

/**
 * Update declarativeNetRequest rules based on current mocks/config.js
 */
async function updateDeclarativeRules() {
  try {
    const { enabled, serverUrl } = await chrome.storage.local.get(['enabled', 'serverUrl']);
    if (!enabled) {
      // Clear all rules if disabled
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: (await chrome.declarativeNetRequest.getDynamicRules()).map(r => r.id)
      });
      return;
    }

    const base = serverUrl || DEFAULT_SERVER;

    // Fetch rules from Node server
    const resp = await fetch(`${base}/rules`);
    if (!resp.ok) {
      console.warn('[Mockery] Could not fetch rules for declarativeNetRequest:', resp.status);
      return;
    }

    const mocksRules = await resp.json();

    // Convert mocks rules to declarativeNetRequest rules
    const declarativeRules = [];
    let ruleId = 1;

    for (const rule of mocksRules) {
      // Create a declarativeNetRequest rule that redirects to our server
      const declarativeRule = {
        id: ruleId++,
        priority: 1,
        action: {
          type: "redirect",
          redirect: {}
        },
        condition: {}
      };

      // Skip disabled rules
      if (rule.enabled === false) continue;

      // Skip non-GET rules — declarativeNetRequest only handles resource loads (always GET)
      const ruleMethod = (rule.method || '*').toUpperCase();
      if (ruleMethod !== '*' && ruleMethod !== 'GET') {
        continue;
      }

      // Set up URL matching and redirection
      // Use simpler urlFilter to avoid 2KB regex limit
      let urlFilter;
      if (rule.isRegex) {
        // Skip regex rules for declarativeNetRequest due to complexity
        console.warn('[Mockery] Skipping regex rule for declarativeNetRequest:', rule.pattern);
        continue;
      } else {
        if (rule.pattern.startsWith('http')) {
          // Full URL pattern
          urlFilter = rule.pattern;
        } else {
          // Partial URL match - use wildcards
          urlFilter = `*${rule.pattern}*`;
        }
      }

      declarativeRule.condition.urlFilter = urlFilter;

      // Use simple redirect to a pattern-specific endpoint
      declarativeRule.action = {
        type: "redirect",
        redirect: {
          url: `${base}/resolve-pattern?pattern=${encodeURIComponent(rule.pattern)}`
        }
      };

      // Only intercept HTML resource types (not JavaScript fetch/XHR)
      declarativeRule.condition.resourceTypes = [
        "image",
        "stylesheet",
        "script",
        "font",
        "media"
      ];

      declarativeRules.push(declarativeRule);
    }

    // Update dynamic rules
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existingRules.map(r => r.id),
      addRules: declarativeRules
    });

    console.log(`[Mockery] Updated declarativeNetRequest rules: ${declarativeRules.length} active`);

  } catch (err) {
    console.error('[Mockery] Error updating declarativeNetRequest rules:', err);
  }
}

/**
 * Refresh rules when extension enabled/disabled or server URL changes
 */
chrome.storage.local.onChanged.addListener((changes) => {
  if (changes.enabled || changes.serverUrl) {
    updateDeclarativeRules();
  }
});

/**
 * SSE connection for hot reload — listens for config changes on the server
 * and notifies all tabs to re-fetch rules.
 */
let sseRetryTimeout = null;

function connectSSE() {
  chrome.storage.local.get(['serverUrl', 'enabled'], ({ serverUrl, enabled }) => {
    if (enabled === false) return;

    const base = serverUrl || DEFAULT_SERVER;
    const controller = new AbortController();

    fetch(`${base}/events`, { signal: controller.signal })
      .then(response => {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        function read() {
          reader.read().then(({ done, value }) => {
            if (done) {
              // Connection closed — reconnect
              scheduleSSEReconnect();
              return;
            }

            const text = decoder.decode(value, { stream: true });
            const lines = text.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const event = JSON.parse(line.slice(6));
                  if (event.type === 'config-changed') {
                    console.log('[Mockery] Config changed, notifying tabs…');
                    notifyAllTabs();
                    updateDeclarativeRules();
                  }
                } catch {}
              }
            }
            read();
          }).catch(() => scheduleSSEReconnect());
        }

        read();
      })
      .catch(() => scheduleSSEReconnect());

    // Store controller so we can abort on disable
    globalThis.__sseController = controller;
  });
}

function scheduleSSEReconnect() {
  if (sseRetryTimeout) clearTimeout(sseRetryTimeout);
  sseRetryTimeout = setTimeout(connectSSE, 3000);
}

function notifyAllTabs() {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: 'RULES_CHANGED' }).catch(() => {});
    }
  });
}

// Start SSE connection
connectSSE();

// Reconnect SSE when server URL or enabled state changes
chrome.storage.local.onChanged.addListener((changes) => {
  if (changes.serverUrl || changes.enabled) {
    if (globalThis.__sseController) {
      globalThis.__sseController.abort();
    }
    connectSSE();
  }
});

/**
 * Handle RESOLVE_MOCK messages from content scripts.
 * Fetches the mock body from the companion Node server.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'REFRESH_DECLARATIVE_RULES') {
    // Handle refresh request from popup
    updateDeclarativeRules();
    return false;
  }

  if (message.type !== 'RESOLVE_MOCK') return false;

  (async () => {
    try {
      const { enabled, serverUrl } = await chrome.storage.local.get(['enabled', 'serverUrl']);
      if (enabled === false) {
        sendResponse({ error: 'disabled' });
        return;
      }

      const base = serverUrl || DEFAULT_SERVER;
      const method = (message.method || 'GET').toUpperCase();
      const url = `${base}/resolve?url=${encodeURIComponent(message.url)}&method=${encodeURIComponent(method)}`;

      const resp = await fetch(url);

      if (!resp.ok) {
        const body = await resp.text();
        sendResponse({ error: `Server returned ${resp.status}`, detail: body });
        return;
      }

      const mime = resp.headers.get('content-type') || 'application/json';

      // Handle binary vs text data properly
      let body;
      let isBinary = false;
      if ((mime.startsWith('image/') && mime !== 'image/svg+xml') ||
          mime.startsWith('audio/') ||
          mime.startsWith('video/') ||
          mime === 'application/pdf' ||
          mime === 'application/zip' ||
          mime === 'application/octet-stream' ||
          mime.startsWith('font/')) {
        // Binary data - convert to base64
        const buffer = await resp.arrayBuffer();
        const uint8Array = new Uint8Array(buffer);
        const binaryString = Array.from(uint8Array, byte => String.fromCharCode(byte)).join('');
        body = btoa(binaryString);
        isBinary = true;
      } else {
        // Text data - use as-is
        body = await resp.text();
      }

      // Log activity
      const activity = {
        url: message.url,
        method,
        mime,
        timestamp: new Date().toISOString(),
      };
      const { recentActivity = [] } = await chrome.storage.local.get('recentActivity');
      recentActivity.unshift(activity);
      await chrome.storage.local.set({
        recentActivity: recentActivity.slice(0, 20),
      });

      sendResponse({ body, mime, isBinary });
    } catch (err) {
      console.error('[Mockery] Error resolving mock:', err);
      sendResponse({ error: err.message });
    }
  })();

  return true; // keep message channel open for async response
});

