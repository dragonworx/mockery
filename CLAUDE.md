# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HTTP Request Mocker is a Chrome extension with a companion Node.js server that intercepts HTTP requests and returns mock responses. The extension uses Manifest V3 and injects code into the page's main world to patch `fetch()` and `XMLHttpRequest`.

**Zero Dependencies** - This project runs with just Node.js (18+) and has no external dependencies. No package.json, no node_modules, no build steps!

## Quick Start

For developers who just downloaded this repository:

```bash
# 1. Clone the repository
git clone <repo-url>
cd http-request-mocker

# 2. Start the server (no installation needed!)
node mock-server.js

# 3. Load the Chrome extension
# - Go to chrome://extensions/
# - Enable "Developer mode"
# - Click "Load unpacked" and select this folder
# - The extension is ready to use!
```

## Common Commands

### Server Operations
```bash
# Start the mock server (default port 8756)
node mock-server.js

# Start with custom port
node mock-server.js 9000

# Start with custom config file
node mock-server.js --config ./my-mocks.js

# Auto-restart server on changes (Node.js 18+)
node --watch mock-server.js

# Stop the server (if needed)
pkill -f 'node.*mock-server.js'
```

### Extension Development
1. Make changes to extension files
2. Go to `chrome://extensions/`
3. Click refresh icon on the extension
4. Reload test pages to see changes

**Refreshing Rules:**
- Edit `mocks/config.js` or add/modify files in `mocks/` folder
- Click "Refresh Rules" in the extension popup to update both JavaScript and declarativeNetRequest rules
- Or restart the server to automatically refresh rules on next page load

**Handler Hot Reload:**
- Install chokidar for automatic handler reloading: `npm install chokidar` (optional)
- Handler files automatically reload when saved (no server restart needed)
- Check server console for reload notifications

## Architecture

### Request Interception Flow

The extension uses a **hybrid architecture** that intercepts different types of requests through different mechanisms:

1. **JavaScript Requests** (fetch/XMLHttpRequest)
   - **MAIN-world Script** (`mock-injector.js`) - patches `window.fetch()` and `XMLHttpRequest.prototype`
   - **ISOLATED-world Bridge** (`content-bridge.js`) - bridges to background service worker
   - **Background Service Worker** (`background.js`) - fetches from Node server

2. **HTML Resource Requests** (img tags, CSS, script tags)
   - **declarativeNetRequest API** - intercepts at network layer
   - **Dynamic Rule Generation** - converts mocks/config.js to Chrome rules
   - **Redirect to Server** - routes to same Node.js companion server

### Message Flow Examples

**JavaScript Request:**
```
fetch("https://api.example.com/users")
  → mock-injector.js (MAIN world) checks rules
  → postMessage to content-bridge.js (ISOLATED world)
  → chrome.runtime.sendMessage to background.js
  → fetch from Node server (localhost:8756)
  → response back through chain
  → synthesized Response object returned to page
```

**HTML Resource Request:**
```
<img src="https://example.com/logo.svg">
  → declarativeNetRequest rule matches pattern
  → redirects to http://localhost:8756/resolve?url=https://example.com/logo.svg
  → Node server returns mock file content
  → browser displays mock content
```

### Why This Hybrid Architecture?

- **MAIN world injection** handles dynamic JavaScript requests that can't be intercepted by declarativeNetRequest
- **declarativeNetRequest** handles HTML resources (img, css, script tags) that can't be intercepted by JavaScript patches
- **ISOLATED world bridge** provides Chrome API access from MAIN world
- **Background service worker** enables localhost communication without CORS
- **Node server** provides file-based mock management and MIME detection
- **Node server** is required because Chrome extensions cannot read arbitrary local files

## Configuration Management

### Manual File System Approach

Rules are managed through direct file system manipulation:

1. **Create mock files** in the `mocks/` folder (or subfolders)
2. **Create handler functions** in the `mocks/handlers/` folder (optional)
3. **Edit `mocks/config.js`** to add URL patterns, file paths, and handlers (inline or imported)
4. **Server hot-reloads** configuration when `mocks/config.js` or handler files change

### Configuration File

`mocks/config.js` format (JavaScript module):
```javascript
// HTTP Request Mocker Configuration
module.exports = [
  {
    pattern: "https://api.example.com/users",
    file: "users.json",
    isRegex: false
  },
  {
    pattern: "https://api.example.com/dynamic",
    // Inline handler function
    handler: async (request, originalResponse) => {
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Hello from ${request.method} ${request.url}`,
          timestamp: new Date().toISOString()
        })
      };
    }
  },
  {
    pattern: "https://api.example.com/enhanced",
    file: "users.json",
    handler: require('./handlers/modify-response.js'), // Import handler
  },
  {
    pattern: ".*\\.example\\.com.*address-book.*",
    file: "api/address-book.json",
    isRegex: true
  }
];
```

### Handler Functions

Handler functions allow dynamic response generation and modification with three approaches:

- **Inline Functions**: Define handlers directly in `config.js`
- **Imported Modules**: Import handlers using `require('./handlers/file.js')`
- **File Path Strings**: Reference handler files by path (legacy support)
- **Function signature**: `async (request, originalResponse) => responseObject`
- **Hot reload**: Configuration and handler files reload automatically
- **Combination**: Can be used with `file` to modify existing responses

**Inline Handler Example:**
```javascript
module.exports = [
  {
    pattern: "https://api.example.com/time",
    handler: async (request) => ({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        time: new Date().toISOString(),
        url: request.url
      })
    })
  }
];
```

**Imported Handler Example:**
```javascript
// config.js
const dynamicHandler = require('./handlers/dynamic.js');

module.exports = [
  {
    pattern: "https://api.example.com/dynamic",
    handler: dynamicHandler
  }
];
```

### File Path Resolution

Relative paths in rules are resolved as follows:
- Simple filenames (e.g. `"users.json"`) automatically resolve to `mocks/users.json`
- Paths with directories (e.g. `"api/users.json"`) resolve to `mocks/api/users.json`
- Paths starting with `./` or `../` are resolved relative to `mocks/config.js` location
- Absolute paths are used as-is

### Folder Organization

The `mocks/` folder can be organized however you prefer:
```
mocks/
├── config.js           # Main configuration file (JavaScript module)
├── api/
│   ├── users.json
│   └── auth/
│       └── token.json
├── handlers/           # JavaScript handler files
│   ├── search-filter.js
│   ├── dynamic-response.js
│   └── utils/
│       └── common-responses.js
├── images/
│   ├── logo.svg
│   └── avatar.png
└── data.csv
```

## Key Implementation Details

### Pattern Matching
- String patterns: exact match OR substring match (`url.includes(pattern)`)
- Regex patterns: tested with `new RegExp(pattern).test(url)`
- Bad regex patterns are silently skipped

### MIME Type Detection
Mock server auto-detects content-type for a wide range of file types:

**Text/Document Formats:**
- `.json` → `application/json`
- `.html`, `.htm` → `text/html`
- `.xml` → `application/xml`
- `.js` → `application/javascript`
- `.css` → `text/css`
- `.csv` → `text/csv`
- `.txt` → `text/plain`
- `.pdf` → `application/pdf`
- `.doc` → `application/msword`
- `.docx` → `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- `.xls` → `application/vnd.ms-excel`
- `.xlsx` → `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`

**Image Formats:**
- `.png` → `image/png`
- `.jpg`, `.jpeg` → `image/jpeg`
- `.gif` → `image/gif`
- `.webp` → `image/webp`
- `.svg` → `image/svg+xml`
- `.ico` → `image/x-icon`
- `.bmp` → `image/bmp`
- `.tiff`, `.tif` → `image/tiff`

**Audio/Video:**
- `.mp3` → `audio/mpeg`
- `.mp4` → `video/mp4`
- `.wav` → `audio/wav`
- `.avi` → `video/x-msvideo`

**Fonts:**
- `.woff` → `font/woff`
- `.woff2` → `font/woff2`
- `.ttf` → `font/ttf`
- `.otf` → `font/otf`

**Archives:**
- `.zip` → `application/zip`
- `.tar` → `application/x-tar`
- `.gz` → `application/gzip`

**Binary Data Handling:**
The extension properly handles binary files (images, PDFs, fonts, archives) by:
- Converting binary data to base64 during transport
- Reconstructing proper binary responses in the browser
- Supporting different XMLHttpRequest responseTypes (`arraybuffer`, `blob`)
- Maintaining correct Content-Type headers

### Toast Notifications
- Success: green toast showing URL → file mapping
- Error: red toast with specific error message
- Displayed for 4s (success) or 6s (error)
- Slide-in animation from right
- Positioned at top-right, z-index 10000

## Server API Endpoints

- `GET /health` — Server status and rule count
- `GET /rules` — List all rules from mocks/config.js
- `GET /resolve?url=<encoded>` — Resolve mock for URL (used by extension)

## Testing Handler Functions

The handler functionality can be tested directly through the mock server endpoints:

### Test Examples with curl

```bash
# Start the server
node mock-server.js

# Test static file response
curl "http://localhost:8756/resolve?url=https://api.example.com/users"

# Test file + handler combination (enhanced users with timestamps)
curl "http://localhost:8756/resolve?url=https://api.example.com/users/enhanced"

# Test search functionality with query parameters
curl "http://localhost:8756/resolve?url=https://api.example.com/search?q=john&sort=name&limit=1"

# Test purely dynamic handler
curl "http://localhost:8756/resolve?url=https://api.example.com/dynamic?name=TestUser&count=3"

# Test POST request handling
curl -X POST "http://localhost:8756/resolve?url=https://api.example.com/dynamic?name=TestUser"
```

### Development Workflow

1. **Create/modify handler**: Edit files in `mocks/handlers/`
2. **Save changes**: Handler automatically reloads (if chokidar installed)
3. **Test immediately**: Use curl or refresh browser page
4. **Check logs**: Server console shows handler execution and errors

### Handler Development Tips

- Use `console.log()` in handlers for debugging - output appears in server console
- Return detailed error messages during development for easier troubleshooting
- Test both with and without original file responses
- Validate handler response format (status, headers, body)

## Important Notes

### Extension Permissions
- `storage` — for persisting enabled state and server URL
- `host_permissions: ["http://localhost/*"]` — for communicating with Node server
- `declarativeNetRequest` — for intercepting HTML resource requests

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
├── mock-server.js         # Node.js companion server (zero dependencies!)
└── mocks/               # Mock response files (organize as needed)
    ├── config.js         # Server configuration (JavaScript module)
    └── handlers/         # JavaScript handler functions
```

## Distribution Benefits

This setup provides the ultimate simplicity for developers:

✅ **No build steps** - Everything runs directly
✅ **No dependencies** - Works with just Node.js 18+
✅ **No package managers** - No npm, yarn, or bun needed
✅ **No compilation** - Pure JavaScript, ready to run
✅ **Instant setup** - Clone and run in seconds
✅ **Zero configuration** - Works out of the box

Perfect for quick demos, testing, development tools, and sharing with team members who just want it to work immediately!