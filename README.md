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

## How Configuration Works

Spend a minute on the mental model here and every Cookbook recipe will read like
plain English.

### Where config lives

All mocking is driven by **`config/rules.ts`** — a TypeScript file that exports
an array of rules. Copy the committed template to create your local copy:

```bash
cp config/rules.example.ts config/rules.ts
```

`rules.ts` is gitignored (it's yours to edit); `rules.example.ts` is the
committed reference. The server **hot-reloads** the file every time you save —
no restart needed.

```typescript
// config/rules.ts
import type { MockRule } from '@server/index.ts';

export default [
  { pattern: "api.example.com/users", file: "users.json" },
  // ...more rules
] satisfies MockRule[];
```

### A rule = "match a URL → decide what comes back"

Every rule has a **`pattern`** (which URLs it matches) and an instruction for
what to do on a match. Mockery sits between the page and the network:

```
page  ──request──▶  Mockery  ──┬─▶  mock response   (default — real server is never hit)
                                └─▶  real server     (only when forwardRequest: true)
```

There are two halves of the exchange you can touch — the **request** (page →
server) and the **response** (server → page) — and three things you can do:

| Goal | How | Real server hit? |
|------|-----|------------------|
| Serve canned data | `file` (a fixture in `mocks/`) | No |
| Build or edit the response | `handler` (optionally starting from `file`) | No |
| Modify the real request/response | `forwardRequest: true` + `handler` returning `{ request }` | Yes |

### 1. Serve mock data (response only)

Point a pattern at a file. The page receives that file as the response; the real
API is never contacted.

```typescript
{ pattern: "api.example.com/users", file: "users.json" }
```

### 2. Generate or modify the response with a handler

A `handler` builds the response in code. Add a `file` and it's loaded for you as
the **`responseTemplate`** — so you can start from your mock data and tweak it.
The handler also receives the live **`request`**, so responses can react to what
the page actually sent.

```typescript
{
  pattern: "api.example.com/users",
  file: "users.json",                      // loaded as responseTemplate
  handler: async (request, responseTemplate) => ({
    ...responseTemplate,                    // keep the mock data...
    body: JSON.stringify({                  // ...but modify it
      ...JSON.parse(responseTemplate.body),
      _injectedAt: Date.now(),
    }),
  }),
}
```

### 3. Modify the original request and forward it

Sometimes you don't want a mock at all — you want the **real** response, but with
a tweaked request on the way out. Set `forwardRequest: true` and return a
`{ request }` object. (Return `null` instead to observe without changing
anything.)

```typescript
{
  pattern: "api.example.com/submit",
  forwardRequest: true,                    // let it reach the real server
  handler: async (request) => ({
    request: {                             // rewrite the outgoing request
      ...request,
      headers: { ...request.headers, "X-Debug": "true" },
    },
    // no `response` ⇒ the real server's response is returned to the page
  }),
}
```

### Mock data vs. the original

- **Working with mock data** → use `file` (a response fixture) and `requestFile`
  (a request fixture), both loaded from `mocks/`. Ideal for deterministic,
  offline responses and for comparing or replacing request bodies.
- **Working with the original** → read the live `request` in your handler and,
  with `forwardRequest`, the real response — then transform either one.

The handler signature ties it together:

```typescript
(request, responseTemplate, requestTemplate) => response | { request, response? } | null
//  ▲ live       ▲ from `file`     ▲ from `requestFile`
```

| Return value | Effect |
|--------------|--------|
| `{ status, headers, body }` | Page gets this response (no real call) |
| `{ request }` (+ `forwardRequest`) | Forward the modified request; return the real response |
| `{ request, response }` | Forward, then apply your response transform |
| `null` | Don't mock — let the request pass through untouched |

### Rule options

| Field | Type | Description |
|-------|------|-------------|
| `pattern` | `string \| RegExp` | URL to match. **String** = literal (exact or substring); **RegExp** = regex |
| `file` | `string` | Response fixture, relative to `mocks/` (also passed to the handler as `responseTemplate`) |
| `handler` | `function` | `(request, responseTemplate?, requestTemplate?) => response \| { request } \| null` |
| `requestFile` | `string` | Request fixture, relative to `mocks/` (passed as `requestTemplate`) |
| `forwardRequest` | `boolean` | Send the (modified) request to the real server |
| `method` | `string` | HTTP method filter (`GET`, `POST`, …) |
| `enabled` | `boolean` | Set `false` to disable without deleting |
| `isRegex` | `boolean` | _Deprecated_ — use a `RegExp` pattern. Treats a string `pattern` as regex |

---

## 📖 Cookbook

Each snippet below is **one entry in the `config/rules.ts` array**.

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

## Project Layout

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

See [How Configuration Works](#how-configuration-works) for the full field
reference and the request/response model.

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
