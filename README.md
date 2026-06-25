# Mockery 🎭

**Intercept any HTTP request. Return whatever you want.**

A Chrome extension + companion server that lets you mock API responses, swap images, inject custom headers, or even forward modified requests to real servers—all from simple TypeScript config files. No build steps. No npm install. Just works.

**Requires [Bun](https://bun.sh)** — the fast JavaScript runtime that runs TypeScript natively.

```bash
curl -fsSL https://bun.sh/install | bash  # Install Bun (one-time)
git clone <repo-url> && cd mockery
bun start  # That's it!
```

---

## What Can It Do?

| Capability | Description |
|------------|-------------|
| 🎯 **Mock API responses** | Return static JSON files for any URL pattern |
| 🔄 **Dynamic responses** | Generate responses with TypeScript handlers |
| 🖼️ **Swap assets** | Replace images, fonts, CSS, or any resource |
| ✏️ **Modify requests** | Add headers, change bodies, then forward to real servers |
| 🔍 **Validate payloads** | Compare requests against expected templates |
| ⚡ **Hot reload** | Edit mocks/handlers, see changes instantly |

---

## 📖 Cookbook

Rules live in **`config/rules.ts`** — a TypeScript file that exports an array of
rule objects. Copy the committed template to create your local copy:

```bash
cp config/rules.example.ts config/rules.ts
```

Each snippet below is **one entry in that array**:

```typescript
// config/rules.ts
import type { MockRule } from '@server/index.ts';

export default [
  { pattern: "api.example.com/users", file: "users.json" },
  // ...more rules
] satisfies MockRule[];
```

The server hot-reloads the file every time you save it.

### Return a static JSON file

```typescript
{ pattern: "api.example.com/users", file: "users.json" }
```

### Match URLs with regex

A `string` pattern matches literally; a **`RegExp`** pattern matches as a regex —
the type is all you need (no `isRegex` flag):

```typescript
{ pattern: /\/users\/\d+$/, file: "user.json" }
```

### Filter by HTTP method

```typescript
{ pattern: "api.example.com/users", method: "POST", file: "created.json" }
```

### Generate dynamic responses

```typescript
{
  pattern: "api.example.com/time",
  handler: async () => ({
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ time: new Date().toISOString() })
  })
}
```

### Modify an existing mock with a handler

```typescript
{
  pattern: "api.example.com/users",
  file: "users.json",  // loaded as responseTemplate
  handler: async (req, responseTemplate) => ({
    ...responseTemplate,
    body: JSON.stringify({
      ...JSON.parse(responseTemplate.body),
      _cached: false,
      _timestamp: Date.now()
    })
  })
}
```

### Add headers and forward to real server

```typescript
{
  pattern: "api.example.com/users",
  forwardRequest: true,
  handler: async (request) => ({
    request: {
      ...request,
      headers: { ...request.headers, "X-Debug": "true" }
    }
  })
}
```

### Validate request body against a template

```typescript
{
  pattern: "api.example.com/transfer",
  method: "POST",
  requestFile: "requests/expected-transfer.json",  // loaded as requestTemplate
  file: "responses/success.json",
  handler: async (req, responseTemplate, requestTemplate) => {
    const actual = JSON.parse(req.body);
    const isValid = actual.amount === requestTemplate.amount;
    return isValid ? responseTemplate : { status: 400, body: "Invalid" };
  }
}
```

### Replace request body with a template and forward

```typescript
{
  pattern: "api.example.com/submit",
  method: "POST",
  requestFile: "requests/fixed-payload.json",
  forwardRequest: true,
  handler: async (req, _, requestTemplate) => ({
    request: { ...req, body: JSON.stringify(requestTemplate) }
  })
}
```

### Mock an image

```typescript
{ pattern: "cdn.example.com/logo.png", file: "images/mock-logo.png" }
```

### Log requests without mocking

```typescript
{
  pattern: "analytics.example.com",
  handler: async (req) => {
    console.log("Analytics:", req.url);
    return null;  // Let request pass through
  }
}
```

---

## Quick Start

**1. Create your local config**
```bash
cp config/rules.example.ts config/rules.ts
```
`config/rules.ts` is gitignored and yours to edit — `rules.example.ts` is the
committed reference with one example of every rule type. (If you skip this step,
the server seeds a minimal `config/rules.ts` for you on first run.)

**2. Start the server**
```bash
bun start                        # Port 8756
bun start 9000                   # Custom port
bun --watch run server/index.ts  # Auto-restart on changes
```

**3. Load the Chrome extension**
1. Go to `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** → select this folder
4. Toggle on—matched requests now serve your mocks

**4. Add your mocks**
- Put response files in `mocks/` (gitignored)
- Edit rules in `config/rules.ts` (gitignored)
- Changes hot-reload automatically

---

## How It Works

```
                         Chrome Extension
 ┌─────────────────────────────────────────────────────────┐
 │                                                         │
 │   MAIN World              ISOLATED World                │
 │  ┌──────────────┐       ┌────────────────┐              │
 │  │   injector   │◄─────►│     bridge     │              │
 │  │              │  msg  │                │              │
 │  │ patches:     │       └───────┬────────┘              │
 │  │  • fetch()   │               │ chrome.runtime        │
 │  │  • XHR       │               ▼                       │
 │  └──────────────┘       ┌────────────────┐              │
 │                         │  background.js │              │
 │  declarativeNetRequest  │  service worker│              │
 │  ┌──────────────┐       └──────┬─────────┘              │
 │  │ intercepts:  │              │                        │
 │  │  • <img>     │              │ fetch()                │
 │  │  • <link>    │              ▼                        │
 │  │  • <script>  ├──────► localhost:8756                 │
 │  └──────────────┘        (Bun server)                   │
 └─────────────────────────────────────────────────────────┘
```

**JavaScript requests** (fetch/XHR) → Patched in page's main world → routed to local server

**HTML resources** (images, CSS, scripts) → Intercepted via `declarativeNetRequest` → redirected to local server

---

## Configuration

```
config/
├── rules.example.ts      # Committed reference — copy to rules.ts to start
├── rules.ts              # Your mocking rules (gitignored, local)
├── rule-overrides.json   # Enable/disable toggles (gitignored, auto-generated)
└── handlers/             # Reusable handler functions (committed)
    ├── forward-example.ts
    └── validate-request.ts

mocks/                    # Your mock files (gitignored)
├── users.json
├── images/
│   └── logo.png
└── requests/
    └── expected-payload.json
```

### Rule Options

| Field | Type | Description |
|-------|------|-------------|
| `pattern` | `string \| RegExp` | URL to match. **String** = literal (exact or substring); **RegExp** = regex |
| `file` | `string` | Mock file path, relative to `mocks/` |
| `handler` | `function` | `(request, responseTemplate?, requestTemplate?) => response` |
| `requestFile` | `string` | Request template file, relative to `mocks/` |
| `forwardRequest` | `boolean` | Forward modified request to real server |
| `method` | `string` | HTTP method filter (`GET`, `POST`, etc.) |
| `enabled` | `boolean` | Set `false` to disable |
| `isRegex` | `boolean` | _Deprecated_ — use a `RegExp` pattern. Treats a string `pattern` as regex |

---

## Request Flow

```
fetch(url) called
       │
       ▼
  Rule matches?
  ┌────┴────┐
 No         Yes
  │          │
  ▼          ▼
Real     Load templates (file, requestFile)
fetch          │
               ▼
         Run handler(request, responseTemplate, requestTemplate)
               │
               ▼
      ┌────────┴────────┐
   Returns          Returns
  {response}    {request, response?}
      │                │
      ▼                ▼
  Return mock    forwardRequest?
                 ┌────┴────┐
                No        Yes
                 │         │
                 ▼         ▼
            Return    Forward to
             mock     real server
```

---

## Handler API

```typescript
import type { HandlerFunction } from '@server/index.ts';

const handler: HandlerFunction = async (request, responseTemplate, requestTemplate) => {
  // request: { url, method, headers, body, query, timestamp }
  // responseTemplate: loaded from `file` (if specified)
  // requestTemplate: loaded from `requestFile` (if specified)

  // Return a response
  return { status: 200, headers: {...}, body: "..." };

  // Or modify the request and forward
  return { request: { ...request, headers: {...} } };

  // Or return null to pass through without mocking
  return null;
};
```

---

## Pattern Matching

| Pattern type | Example | Matches |
|------|---------|---------|
| String (exact) | `"https://api.com/users"` | The exact URL |
| String (substring) | `"api/users"` | Any URL containing `api/users` |
| RegExp | `/\/users\/\d+$/` | `…/users/123`, `…/users/456` |

A **string** is tried as an exact match first, then as a substring. A **RegExp**
literal is always matched as a regular expression.

---

## Debugging

| Where | What |
|-------|------|
| Page Console | `✅` mock hits, `❌` errors |
| Server Terminal | Request logs, handler output |
| Extension Popup | Activity tab, rule toggles |
| `chrome://extensions/` | Service worker logs |

Run with `MOCKERY_DEBUG=1 bun start` to include full stack traces in error
responses sent back to the page (off by default; the terminal always logs them).

### Tests

```bash
bun test   # spins up the server and exercises the core endpoints
```

---

## Why Mockery?

- **Just Bun** — No node_modules, no package installs, no build tools
- **Native TypeScript** — Bun runs `.ts` files directly
- **Hot reload** — Edit files, see changes instantly
- **Full coverage** — Intercepts fetch, XHR, images, CSS, fonts
- **Powerful handlers** — Dynamic responses, request modification, validation
- **File-based** — Version control your mocks

---

## License

ISC
