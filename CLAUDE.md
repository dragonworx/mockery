# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HTTP Request Mocker is a Chrome extension with a companion Node.js server that intercepts HTTP requests and returns mock responses. The extension uses Manifest V3 and injects code into the page's main world to patch `fetch()` and `XMLHttpRequest`.

## Common Commands

### Server Operations
```bash
# Start the mock server (default port 8756)
npm start
# or
node mock-server.js

# Start with custom port
node mock-server.js 9000

# Start with custom config file
node mock-server.js --config ./my-mocks.json

# Stop the server
npm run kill
```

### Extension Development
1. Make changes to extension files
2. Go to `chrome://extensions/`
3. Click refresh icon on the extension
4. Reload test pages to see changes

## Architecture

### Request Interception Flow

The extension uses a three-layer architecture to intercept requests:

1. **MAIN-world Script** (`mock-injector.js`)
   - Injected into page's JavaScript context using `world: "MAIN"`
   - Patches `window.fetch()` and `XMLHttpRequest.prototype` directly
   - Prevents requests from hitting the network
   - Communicates with ISOLATED world via `window.postMessage()`

2. **ISOLATED-world Bridge** (`content-bridge.js`)
   - Standard content script with Chrome API access
   - Bridges between MAIN world and background service worker
   - Fetches rules from Node server and pushes them to MAIN world
   - Shows toast notifications for intercepted requests

3. **Background Service Worker** (`background.js`)
   - Receives `RESOLVE_MOCK` messages from bridge
   - Fetches mock data from Node server (localhost:8756)
   - Returns mock body and MIME type to bridge
   - Tracks recent activity in `chrome.storage.local`

4. **Node.js Companion Server** (`mock-server.js`)
   - Zero-dependency HTTP server
   - Serves mock files based on URL pattern matching
   - Hot-reloads `.mocks.json` configuration
   - Provides RESTful API for rule management

### Message Flow for Request Interception

```
fetch("https://api.example.com/users")
  → mock-injector.js (MAIN world) checks rules
  → postMessage to content-bridge.js (ISOLATED world)
  → chrome.runtime.sendMessage to background.js
  → fetch from Node server (localhost:8756)
  → response back through chain
  → synthesized Response object returned to page
```

### Why This Architecture?

- **MAIN world injection** is required because Chrome extensions cannot intercept `fetch()`/`XMLHttpRequest` from ISOLATED world
- **ISOLATED world bridge** is required because MAIN world cannot access Chrome APIs (`chrome.runtime`, `chrome.storage`)
- **Background service worker** is required to fetch from localhost without CORS issues
- **Node server** is required because Chrome extensions cannot read arbitrary local files

## Configuration File

`.mocks.json` format (in project root):
```json
[
  {
    "pattern": "https://api.example.com/users",
    "file": "./mocks/users.json",
    "isRegex": false
  },
  {
    "pattern": ".*\\.example\\.com.*address-book.*",
    "file": "./mocks/address-book.json",
    "isRegex": true
  }
]
```

### File Path Resolution

Relative paths in rules are resolved in this order:
1. Relative to `.mocks.json` location
2. Relative to project root (cwd)
3. If in `mocks/` folder, resolves to `{cwd}/mocks/{filename}`

## Key Implementation Details

### Pattern Matching
- String patterns: exact match OR substring match (`url.includes(pattern)`)
- Regex patterns: tested with `new RegExp(pattern).test(url)`
- Bad regex patterns are silently skipped

### File Upload Feature
- Files uploaded via popup are saved to `mocks/{basename}_{timestamp}{ext}`
- Uses timestamp to avoid filename conflicts
- Returns relative path (e.g., `mocks/test_1234567890.json`) for use in rules
- Creates `mocks/` directory if it doesn't exist

### MIME Type Detection
Mock server auto-detects content-type:
- `.json` → `application/json`
- `.html`, `.htm` → `text/html`
- `.xml` → `application/xml`
- `.js` → `application/javascript`
- `.css` → `text/css`
- `.csv` → `text/csv`
- `.txt` → `text/plain`
- `.svg` → `image/svg+xml`

### Toast Notifications
- Success: green toast showing URL → file mapping
- Error: red toast with specific error message
- Displayed for 4s (success) or 6s (error)
- Slide-in animation from right
- Positioned at top-right, z-index 10000

## Server API Endpoints

- `GET /health` — Server status and rule count
- `GET /rules` — List all rules
- `POST /rules` — Add a new rule (`{pattern, file, isRegex}`)
- `DELETE /rules` — Remove rule by pattern (`{pattern}`)
- `POST /save-file` — Save file to mocks folder (`{fileName, fileContent}`)
- `GET /resolve?url=<encoded>` — Resolve mock for URL (used by extension)
- `GET /pwd` — Get current working directory and mocks path

## Important Notes

### Extension Permissions
- `storage` — for persisting enabled state and server URL
- `host_permissions: ["http://localhost/*"]` — for communicating with Node server
- No `declarativeNetRequest` — v2.0 uses main-world injection instead

### Security Considerations
- Extension only communicates with localhost by default
- No external network requests from extension
- Mock files are served from local filesystem only
- HTML escaping in popup UI to prevent XSS

### Debugging
- MAIN world logs: Open page console, look for `[HTTP Mocker]`
- ISOLATED world logs: Open page console, look for `[HTTP Mocker] ISOLATED bridge loaded`
- Background logs: Go to `chrome://extensions/` → "service worker" link
- Server logs: Watch terminal where `node mock-server.js` is running
- Activity tracking: Check "Activity" tab in extension popup

## File Structure

```
.
├── manifest.json           # Extension configuration (Manifest V3)
├── background.js          # Background service worker
├── content-bridge.js      # ISOLATED-world bridge script
├── mock-injector.js       # MAIN-world request interceptor
├── popup.html/js/css      # Extension popup UI
├── mock-server.js         # Node.js companion server
├── .mocks.json           # Server configuration (rules)
├── package.json          # Node.js package config
└── mocks/               # Mock response files
```
