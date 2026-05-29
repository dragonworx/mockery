# Mockery

A Chrome extension paired with a zero-dependency Node.js server that intercepts HTTP requests and returns mock responses. Built for developers who need fast, file-based request stubbing without any build steps or package managers.

---

## How It Works

Mockery uses a hybrid interception architecture to cover every type of browser request:

```
                         Chrome Extension
 ┌─────────────────────────────────────────────────────────┐
 │                                                         │
 │   MAIN World              ISOLATED World                │
 │  ┌──────────────┐       ┌────────────────┐             │
 │  │mock-injector │◄─────►│ content-bridge │             │
 │  │              │  msg   │                │             │
 │  │ patches:     │       └───────┬────────┘             │
 │  │  • fetch()   │               │ chrome.runtime       │
 │  │  • XHR       │               ▼                      │
 │  └──────────────┘       ┌────────────────┐             │
 │                         │  background.js │             │
 │  declarativeNetRequest  │  service worker│             │
 │  ┌──────────────┐      └───────┬────────┘             │
 │  │ intercepts:  │               │                      │
 │  │  • <img>     │               │ fetch()              │
 │  │  • <link>    │               ▼                      │
 │  │  • <script>  ├──────► localhost:8756                │
 │  └──────────────┘        (Node.js server)              │
 └─────────────────────────────────────────────────────────┘
```

**JavaScript requests** (fetch/XHR) are intercepted by patching `window.fetch()` and `XMLHttpRequest` in the page's main world. Matched requests are routed through the extension's background service worker to the local Node server.

**HTML resource requests** (images, stylesheets, scripts, fonts) are intercepted via Chrome's `declarativeNetRequest` API at the network layer and redirected to the same Node server.

---

## Quick Start

```bash
# Clone the repository
git clone <repo-url> && cd mockery

# Start the companion server (no install needed)
npm start
```

Then load the extension in Chrome:

1. Navigate to `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this folder
4. Toggle the extension on - matched requests will serve your mock files

That's it. No `npm install`, no build step, no configuration ceremony.

---

## Configuration

All mocking rules live in `mocks/config.js`:

```javascript
module.exports = [
  // Static file response
  {
    pattern: "https://api.example.com/users",
    file: "users.json"
  },

  // Regex pattern matching
  {
    pattern: ".*\\.example\\.com.*address-book.*",
    file: "api/address-book.json",
    isRegex: true
  },

  // Dynamic handler (inline)
  {
    pattern: "https://api.example.com/time",
    handler: async (request) => ({
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ time: new Date().toISOString() })
    })
  },

  // Imported handler + file combination
  {
    pattern: "https://api.example.com/enhanced",
    file: "users.json",
    handler: require("./handlers/modify-response.js")
  }
];
```

### Rule Options

| Field       | Type                 | Description                                               |
|-------------|----------------------|-----------------------------------------------------------|
| `pattern`   | `string`             | URL to match (exact, substring, or regex)                 |
| `file`      | `string`             | Path to mock file, relative to `mocks/`                  |
| `handler`   | `function \| string` | Dynamic response generator `(request, originalResponse) => response` |
| `isRegex`   | `boolean`            | Treat `pattern` as a regular expression                   |
| `method`    | `string`             | HTTP method filter (`GET`, `POST`, etc.) - defaults to `*` |
| `enabled`   | `boolean`            | Set `false` to skip this rule                             |

---

## Server

### Commands

```bash
npm start                                  # Default port 8756
node server/index.js                       # Same as above
node server/index.js 9000                  # Custom port
node server/index.js --config ./custom.js  # Custom config path
node --watch server/index.js               # Auto-restart on changes (Node 18+)
```

### Endpoints

| Endpoint                          | Description                                |
|-----------------------------------|--------------------------------------------|
| `GET /health`                     | Server status and rule count               |
| `GET /rules`                      | Current rule list from config              |
| `GET /resolve?url=<encoded>`      | Resolve and serve a mock for a URL         |
| `GET /resolve-pattern?pattern=<>` | Serve mock by pattern (declarativeNetRequest) |
| `GET /events`                     | SSE stream for hot reload                  |

---

## Handler Functions

Handlers receive a request object and an optional original file response, then return a response object:

```javascript
// mocks/handlers/example.js
module.exports = async (request, originalResponse) => {
  // request: { url, method, headers, body, query, timestamp }
  // originalResponse: { status, headers, body } (if file is also specified)

  return {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Hello from handler" })
  };
};
```

Handlers hot-reload automatically when saved (requires `chokidar` for file watching, otherwise restart the server).

---

## Hot Reload

Mockery supports live reloading without restarting anything:

- **Config changes** (`mocks/config.js`) - detected via `fs.watch`, broadcast to the extension over SSE
- **Handler changes** (`mocks/handlers/**/*.js`) - reloaded on next request (with `chokidar`: instant)
- **Mock file changes** - served fresh on every request (no caching)

The extension popup also has a **Refresh Rules** button for manual reloads.

---

## Pattern Matching

| Type      | Behavior                                         | Example                        |
|-----------|--------------------------------------------------|--------------------------------|
| Exact     | `url === pattern`                                | `https://api.com/users`        |
| Substring | `url.includes(pattern)`                          | `api/users`                    |
| Regex     | `new RegExp(pattern).test(url)` (requires `isRegex: true`) | `.*\\.api\\.com/users.*` |

---

## MIME Type Detection

The server auto-detects content types from file extensions, covering:

- **Documents** - JSON, HTML, XML, CSS, JS, CSV, PDF, DOCX, XLSX
- **Images** - PNG, JPEG, GIF, WebP, SVG, ICO, BMP, TIFF
- **Media** - MP3, MP4, WAV, AVI
- **Fonts** - WOFF, WOFF2, TTF, OTF
- **Archives** - ZIP, TAR, GZIP

Binary files are base64-encoded during transport and reconstructed as proper binary in the browser.

---

## Debugging

| Context         | Where to look                                    | Prefix       |
|-----------------|--------------------------------------------------|--------------|
| Page console    | DevTools > Console                               | `[Mockery]`  |
| Service worker  | `chrome://extensions/` > service worker link     | `[Mockery]`  |
| Server          | Terminal running the server                       | `[mockery]`     |
| Extension popup | Activity tab in the popup UI                     | -            |

---

## Why Mockery?

- **Zero dependencies** - runs with Node.js alone, no `node_modules` needed
- **No build step** - pure JavaScript, ready to run immediately
- **File-based** - mock data lives in plain files you can version control
- **Full coverage** - intercepts fetch, XHR, and HTML resource loads
- **Hot reload** - edit mocks and see changes without restarting
- **Handler functions** - dynamic responses when static files aren't enough
- **Binary support** - images, PDFs, fonts all work correctly

---

## License

ISC
