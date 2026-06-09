# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mockery is a Chrome extension with a companion Bun server that intercepts HTTP requests and returns mock responses. The extension uses Manifest V3 and injects code into the page's main world to patch `fetch()` and `XMLHttpRequest`.

**Zero Dependencies** - This project runs with just Bun and has no external dependencies. No node_modules, no build steps, native TypeScript!

## Quick Start

For developers who just downloaded this repository:

```bash
# 1. Install Bun (one-time, if not already installed)
curl -fsSL https://bun.sh/install | bash

# 2. Clone the repository
git clone <repo-url>
cd mockery

# 3. Start the server (no other installation needed!)
bun run server/index.ts

# 4. Load the Chrome extension
# - Go to chrome://extensions/
# - Enable "Developer mode"
# - Click "Load unpacked" and select this folder
# - The extension is ready to use!
```

## Common Commands

### Server Operations
```bash
# Start the mock server (default port 8756)
bun run server/index.ts

# Start with custom port
bun run server/index.ts 9000

# Start with custom config file
bun run server/index.ts --config ./my-mocks.ts

# Auto-restart server on changes
bun --watch run server/index.ts

# Using package.json scripts
bun start          # same as bun run server/index.ts
bun run dev        # same as bun --watch run server/index.ts

# Stop the server (if needed)
pkill -f 'bun.*server/index.ts'
```

### Extension Development
1. Make changes to extension files
2. Go to `chrome://extensions/`
3. Click refresh icon on the extension
4. Reload test pages to see changes

**Refreshing Rules:**
- Edit `mocks/.config.ts` or add/modify files in `mocks/` folder
- Click "Refresh Rules" in the extension popup to update both JavaScript and declarativeNetRequest rules
- Or restart the server to automatically refresh rules on next page load

**Handler Hot Reload:**
- Handler files automatically reload when saved (no server restart needed, uses built-in `fs.watch`)
- Check server console for reload notifications

## Architecture

### Request Interception Flow

The extension uses a **hybrid architecture** that intercepts different types of requests through different mechanisms:

1. **JavaScript Requests** (fetch/XMLHttpRequest)
   - **MAIN-world Script** (`injector.js`) - patches `window.fetch()` and `XMLHttpRequest.prototype`
   - **ISOLATED-world Bridge** (`bridge.js`) - bridges to background service worker
   - **Background Service Worker** (`background.js`) - fetches from Bun server

2. **HTML Resource Requests** (img tags, CSS, script tags)
   - **declarativeNetRequest API** - intercepts at network layer
   - **Dynamic Rule Generation** - converts mocks/.config.ts to Chrome rules
   - **Redirect to Server** - routes to same Bun companion server

### Message Flow Examples

**JavaScript Request:**
```
fetch("https://api.example.com/users")
  → injector.js (MAIN world) checks rules
  → postMessage to bridge.js (ISOLATED world)
  → chrome.runtime.sendMessage to background.js
  → fetch from Bun server (localhost:8756)
  → response back through chain
  → synthesized Response object returned to page
```

**HTML Resource Request:**
```
<img src="https://example.com/logo.svg">
  → declarativeNetRequest rule matches pattern
  → redirects to http://localhost:8756/resolve?url=https://example.com/logo.svg
  → Bun server returns mock file content
  → browser displays mock content
```

### Why This Hybrid Architecture?

- **MAIN world injection** handles dynamic JavaScript requests that can't be intercepted by declarativeNetRequest
- **declarativeNetRequest** handles HTML resources (img, css, script tags) that can't be intercepted by JavaScript patches
- **ISOLATED world bridge** provides Chrome API access from MAIN world
- **Background service worker** enables localhost communication without CORS
- **Bun server** provides file-based mock management and MIME detection
- **Bun server** is required because Chrome extensions cannot read arbitrary local files

## Configuration Management

### Manual File System Approach

Rules are managed through direct file system manipulation:

1. **Create mock files** in the `mocks/` folder (or subfolders)
2. **Create handler functions** in the `mocks/handlers/` folder (optional)
3. **Edit `mocks/.config.ts`** to add URL patterns, file paths, and handlers (inline or imported)
4. **Server hot-reloads** configuration when `mocks/.config.ts` or handler files change

### Configuration File

`mocks/.config.ts` format (TypeScript module with ESM exports):
```typescript
import type { MockRule } from '../server/index.ts';

export default [
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
    handler: (await import('./handlers/modify-response.ts')).default,
  },
  {
    pattern: ".*\\.example\\.com.*address-book.*",
    file: "api/address-book.json",
    isRegex: true
  }
] satisfies MockRule[];
```

### Handler Functions

Handler functions allow dynamic response generation and modification with three approaches:

- **Inline Functions**: Define handlers directly in `.config.ts`
- **Imported Modules**: Import handlers using `import` (ESM)
- **File Path Strings**: Reference handler files by path (resolved at runtime)
- **Function signature**: `async (request, originalResponse) => responseObject`
- **Hot reload**: Configuration and handler files reload automatically
- **Combination**: Can be used with `file` to modify existing responses
- **Type safety**: Import `HandlerFunction` type for full autocomplete

**Inline Handler Example:**
```typescript
import type { MockRule } from '../server/index.ts';

export default [
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
] satisfies MockRule[];
```

**Imported Handler Example:**
```typescript
import dynamicHandler from './handlers/dynamic-response.ts';
import type { MockRule } from '../server/index.ts';

export default [
  {
    pattern: "https://api.example.com/dynamic",
    handler: dynamicHandler
  }
] satisfies MockRule[];
```

**Handler File Example:**
```typescript
import type { HandlerFunction } from '../../server/index.ts';
import { success } from './utils/common-responses.ts';

const handler: HandlerFunction = async (request, originalResponse) => {
  return success({ message: 'Hello', url: request.url });
};

export default handler;
```

### File Path Resolution

Relative paths in rules are resolved as follows:
- Simple filenames (e.g. `"users.json"`) automatically resolve to `mocks/users.json`
- Paths with directories (e.g. `"api/users.json"`) resolve to `mocks/api/users.json`
- Paths starting with `./` or `../` are resolved relative to `mocks/.config.ts` location
- Absolute paths are used as-is

### Folder Organization

The `mocks/` folder can be organized however you prefer:
```
mocks/
├── .config.ts           # Main configuration file (TypeScript module)
├── api/
│   ├── users.json
│   └── auth/
│       └── token.json
├── handlers/           # TypeScript handler files
│   ├── search-filter.ts
│   ├── dynamic-response.ts
│   ├── modify-response.ts
│   └── utils/
│       └── common-responses.ts
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
- `.js`, `.ts` → `application/javascript`
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
- `GET /rules` — List all rules from mocks/.config.ts
- `GET /resolve?url=<encoded>&method=<method>` — Resolve mock for URL (used by extension)
- `GET /resolve-pattern?pattern=<encoded>` — Resolve mock by pattern (used by declarativeNetRequest)
- `GET /events` — SSE stream for hot reload notifications
- `POST /rules/:index/toggle` — Enable/disable a specific rule

## Testing Handler Functions

The handler functionality can be tested directly through the mock server endpoints:

### Test Examples with curl

```bash
# Start the server
bun run server/index.ts

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
2. **Save changes**: Handler automatically reloads (via built-in fs.watch)
3. **Test immediately**: Use curl or refresh browser page
4. **Check logs**: Server console shows handler execution and errors

### Handler Development Tips

- Use `console.log()` in handlers for debugging - output appears in server console
- Return detailed error messages during development for easier troubleshooting
- Test both with and without original file responses
- Validate handler response format (status, headers, body)
- Import `HandlerFunction` type for autocomplete and type checking

## Important Notes

### Extension Permissions
- `storage` — for persisting enabled state and server URL
- `host_permissions: ["http://localhost/*"]` — for communicating with Bun server
- `declarativeNetRequest` — for intercepting HTML resource requests

### Security Considerations
- Extension only communicates with localhost by default
- No external network requests from extension
- Mock files are served from local filesystem only
- HTML escaping in popup UI to prevent XSS

### Debugging
- MAIN world logs: Open page console, look for `[Mockery]`
- ISOLATED world logs: Open page console, look for `[Mockery] ISOLATED bridge loaded`
- Background logs: Go to `chrome://extensions/` → "service worker" link
- Server logs: Watch terminal where `bun run server/index.ts` is running
- Activity tracking: Check "Activity" tab in extension popup

## File Structure

```
.
├── manifest.json           # Extension configuration (Manifest V3)
├── background.js          # Background service worker
├── bridge.js              # ISOLATED-world bridge script
├── injector.js            # MAIN-world request interceptor
├── popup.html/js/css      # Extension popup UI
├── server/
│   └── index.ts           # Bun companion server (TypeScript, zero dependencies!)
└── mocks/                 # Mock response files (organize as needed)
    ├── .config.ts          # Server configuration (TypeScript module)
    └── handlers/          # TypeScript handler functions
```

## Distribution Benefits

This setup provides the ultimate simplicity for developers:

- **No build steps** - Bun runs TypeScript directly
- **No dependencies** - Works with just Bun installed
- **No package managers** - No npm install needed
- **No compilation** - TypeScript runs natively
- **Type safety** - Full autocomplete and type checking in handlers/config
- **Instant setup** - Install Bun once, then clone and run
- **Zero configuration** - Works out of the box

Perfect for quick demos, testing, development tools, and sharing with team members who just want it to work immediately!
