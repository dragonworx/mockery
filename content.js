/**
 * Content Script for HTTP Request Mocker
 * Shows toast notifications when requests are intercepted
 */

// Track if we've already injected the toast container
let toastContainer = null;

/**
 * Create the toast container if it doesn't exist
 */
function createToastContainer() {
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

/**
 * Show a toast notification
 */
function showToast(message, type = 'success') {
  const container = createToastContainer();

  const toast = document.createElement('div');
  toast.style.cssText = `
    background: ${type === 'success' ? '#d4edda' : '#f8d7da'};
    color: ${type === 'success' ? '#155724' : '#721c24'};
    border: 1px solid ${type === 'success' ? '#c3e6cb' : '#f5c6cb'};
    padding: 12px 16px;
    border-radius: 6px;
    margin-bottom: 10px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    font-size: 14px;
    font-weight: 500;
    max-width: 350px;
    word-wrap: break-word;
    pointer-events: auto;
    opacity: 0;
    transform: translateX(100%);
    transition: all 0.3s ease-out;
  `;

  toast.textContent = message;
  container.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(0)';
  });

  // Auto-remove after 4 seconds
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, 4000);
}

/**
 * Listen for messages from background script
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'RULE_INVOKED') {
    const { pattern, filename, url } = message.data;

    // Extract domain from URL for cleaner display
    let displayUrl = url;
    try {
      const urlObj = new URL(url);
      displayUrl = urlObj.hostname + urlObj.pathname;
      if (displayUrl.length > 40) {
        displayUrl = displayUrl.substring(0, 37) + '...';
      }
    } catch (e) {
      // Keep original URL if parsing fails
      if (displayUrl.length > 40) {
        displayUrl = displayUrl.substring(0, 37) + '...';
      }
    }

    showToast(`🔄 HTTP Mock: ${displayUrl} → ${filename}`);
    sendResponse({ success: true });
  }
});

console.log('[HTTP Mocker] Content script loaded');