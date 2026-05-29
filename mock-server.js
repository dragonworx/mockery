#!/usr/bin/env node
/**
 * Mock Server — zero-dependency companion for the HTTP Request Mocker extension.
 *
 * Usage:
 *   cd /path/to/your/project
 *   node /path/to/mock-server.js            # reads .mocks/config.json from cwd
 *   node /path/to/mock-server.js 9000        # custom port
 *   node /path/to/mock-server.js --config ./my-mocks.json   # custom config path
 *
 * Config format (.mocks/config.json):
 *   [
 *     { "pattern": "https://api.example.com/users", "file": "users.json" },
 *     { "pattern": "https://api.example.com/dynamic", "handler": "handlers/dynamic.js" },
 *     { "pattern": "https://api.example.com/modify", "file": "users.json", "handler": "handlers/modify.js" },
 *     { "pattern": "address-book\\.smtnbnxt\\.json", "file": "icon.svg", "isRegex": true }
 *   ]
 *
 * File paths:
 *   - Relative paths without directory separators default to .mocks/ folder
 *   - "users.json" resolves to ".mocks/users.json"
 *   - "data/users.json" stays as "data/users.json" (explicit path)
 *   - Absolute paths are used as-is
 *
 * Handler functions:
 *   - "handler": "handlers/dynamic.js" resolves to ".mocks/handlers/dynamic.js"
 *   - Handlers receive (request, originalResponse) and return response object
 *   - Hot reloading supported when chokidar is installed (npm install chokidar)
 *   - Can be combined with file to modify existing response
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// ── Handler caching ─────────────────────────────────────────────────────────
const handlerCache = new Map();

// Enable hot reload for handlers if chokidar is available
let chokidarAvailable = false;
try {
  const chokidar = require('chokidar');
  chokidarAvailable = true;

  // Watch handlers directory for changes
  const handlersPath = path.join('.mocks', 'handlers');
  if (fs.existsSync(handlersPath)) {
    chokidar.watch(handlersPath + '/**/*.js').on('change', (filePath) => {
      console.log(`[mock-server] Handler changed: ${path.relative(process.cwd(), filePath)}`);

      // Clear from cache
      handlerCache.delete(filePath);
      delete require.cache[require.resolve(filePath)];

      console.log('[mock-server] Handler reloaded - next request will use updated version');
    });
  }
} catch (err) {
  // chokidar not installed - that's fine, handlers will still work but won't hot reload
}

// ── CLI args ────────────────────────────────────────────────────────────────
let port = 8756;
let configPath = path.join(process.cwd(), '.mocks', 'config.json');

for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--config' && process.argv[i + 1]) {
    configPath = path.resolve(process.argv[++i]);
  } else if (/^\d+$/.test(arg)) {
    port = Number(arg);
  }
}

// ── Config loading + hot-reload ─────────────────────────────────────────────
let rules = [];

function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    rules = JSON.parse(raw);
    console.log(`[mock-server] Loaded ${rules.length} rule(s) from ${configPath}`);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn(`[mock-server] Config not found: ${configPath} — starting with 0 rules`);
      rules = [];
    } else {
      console.error(`[mock-server] Error reading config:`, err.message);
    }
  }
}

loadConfig();

try {
  fs.watch(configPath, { persistent: false }, (eventType) => {
    if (eventType === 'change' || eventType === 'rename') {
      console.log('[mock-server] Config changed, reloading…');
      loadConfig();
    }
  });
} catch {
  // file might not exist yet — that's fine
}

// ── Handler loading ─────────────────────────────────────────────────────────
async function loadHandler(handlerPath) {
  const fullPath = path.resolve('.mocks', handlerPath);

  try {
    // Check if handler is cached and file hasn't changed
    if (handlerCache.has(fullPath)) {
      const cached = handlerCache.get(fullPath);
      const stats = fs.statSync(fullPath);
      if (stats.mtime <= cached.mtime) {
        return cached.handler;
      }
    }

    // Clear from require cache for hot reload
    delete require.cache[require.resolve(fullPath)];

    // Load handler
    const handler = require(fullPath);
    const stats = fs.statSync(fullPath);

    // Validate handler
    if (typeof handler !== 'function') {
      throw new Error('Handler must export a function');
    }

    // Cache with modification time
    handlerCache.set(fullPath, {
      handler,
      mtime: stats.mtime
    });

    return handler;
  } catch (error) {
    console.error(`[mock-server] Error loading handler ${handlerPath}:`, error.message);
    return null;
  }
}

function buildRequestObject(req, url) {
  return {
    url,
    method: req.method,
    headers: req.headers,
    body: req.body || null,
    query: new URL(url).searchParams,
    timestamp: new Date().toISOString()
  };
}

async function resolveWithHandler(targetUrl, rule, req) {
  let originalResponse = null;

  // Load file response if specified
  if (rule.file) {
    const filePath = resolveFilePath(rule.file);
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath);
        originalResponse = {
          status: 200,
          headers: { 'Content-Type': guessMime(filePath) },
          body: content.toString()
        };
      } catch (err) {
        console.error(`[mock-server] Error reading file ${filePath}:`, err.message);
        return {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'File read error', file: rule.file, detail: err.message })
        };
      }
    }
  }

  // Apply handler if specified
  if (rule.handler) {
    const handler = await loadHandler(rule.handler);
    if (handler) {
      try {
        const requestObj = buildRequestObject(req, targetUrl);
        const result = await handler(requestObj, originalResponse);

        // Validate handler response
        if (!result || typeof result !== 'object') {
          throw new Error('Handler must return a response object');
        }

        console.log(`[mock-server] ${targetUrl} → ${rule.handler} (handler)`);
        return result;
      } catch (err) {
        console.error(`[mock-server] Handler execution error for ${rule.handler}:`, err.message);
        return {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Handler execution error', handler: rule.handler, detail: err.message })
        };
      }
    } else {
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Failed to load handler', handler: rule.handler })
      };
    }
  }

  return originalResponse;
}

function resolveFilePath(file) {
  if (path.isAbsolute(file)) {
    return file;
  }

  // For relative paths, always try in .mocks/ folder first
  const mocksRelative = path.join('.mocks', file);
  const configDir = path.dirname(path.resolve(configPath));
  const mocksPath = path.join(configDir, mocksRelative);

  if (fs.existsSync(mocksPath)) {
    return mocksPath;
  }

  // If not found in .mocks/, try relative to config file directory
  const configRelative = path.join(configDir, file);
  if (fs.existsSync(configRelative)) {
    return configRelative;
  } else {
    // Fall back to relative to current working directory in .mocks/
    return path.resolve(mocksRelative);
  }
}

// ── MIME helper ─────────────────────────────────────────────────────────────
function guessMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.json': 'application/json',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.xml': 'application/xml',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.csv': 'text/csv',
    '.txt': 'text/plain',
    '.svg': 'image/svg+xml',
    // Image formats
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.bmp': 'image/bmp',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff',
    // Document formats
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    // Audio/Video
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.wav': 'audio/wav',
    '.avi': 'video/x-msvideo',
    // Archives
    '.zip': 'application/zip',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    // Fonts
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    // Other
    '.bin': 'application/octet-stream',
  };
  return map[ext] || 'application/octet-stream';
}

// ── Matching ────────────────────────────────────────────────────────────────
function findMatch(url) {
  // First pass: look for exact matches
  for (const rule of rules) {
    try {
      if (rule.isRegex) {
        if (new RegExp(rule.pattern).test(url)) {
          return rule;
        }
      } else {
        if (url === rule.pattern) {
          return rule;
        }
      }
    } catch {
      // bad regex — skip
    }
  }

  // Second pass: look for substring matches
  for (const rule of rules) {
    try {
      if (!rule.isRegex) {
        if (url.includes(rule.pattern)) {
          return rule;
        }
      }
    } catch {
      // shouldn't happen for non-regex, but just in case
    }
  }

  return null;
}

// ── HTTP server ─────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // CORS — the extension's background SW fetches from here
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsed = new URL(req.url, `http://localhost:${port}`);

  // ── GET /resolve?url=<encoded> ────────────────────────────────────────
  if (parsed.pathname === '/resolve') {
    const targetUrl = parsed.searchParams.get('url');
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing ?url= parameter' }));
      return;
    }

    const rule = findMatch(targetUrl);
    if (!rule) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No matching rule', url: targetUrl }));
      return;
    }

    try {
      // Use handler-aware resolution
      const result = await resolveWithHandler(targetUrl, rule, req);

      if (!result) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No response generated', url: targetUrl }));
        return;
      }

      // Send the response
      const status = result.status || 200;
      const headers = result.headers || {};
      const body = result.body || '';

      res.writeHead(status, headers);

      // Handle binary data properly
      if (typeof body === 'string') {
        res.end(body);
      } else if (Buffer.isBuffer(body)) {
        res.end(body);
      } else {
        res.end(String(body));
      }

    } catch (error) {
      console.error(`[mock-server] Request processing error:`, error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error', detail: error.message }));
    }
    return;
  }

  // ── GET /resolve-pattern?pattern=<encoded> ─────────────────────────────
  // Alternative endpoint for declarativeNetRequest that can't pass original URL
  if (parsed.pathname === '/resolve-pattern') {
    const pattern = parsed.searchParams.get('pattern');
    if (!pattern) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing ?pattern= parameter' }));
      return;
    }

    // Find the rule by pattern
    const rule = rules.find(r => r.pattern === pattern);
    if (!rule) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No matching rule for pattern', pattern }));
      return;
    }

    try {
      // Use handler-aware resolution (use pattern as targetUrl for this endpoint)
      const result = await resolveWithHandler(pattern, rule, req);

      if (!result) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No response generated', pattern }));
        return;
      }

      // Send the response
      const status = result.status || 200;
      const headers = result.headers || {};
      const body = result.body || '';

      res.writeHead(status, headers);

      // Handle binary data properly
      if (typeof body === 'string') {
        res.end(body);
      } else if (Buffer.isBuffer(body)) {
        res.end(body);
      } else {
        res.end(String(body));
      }

    } catch (error) {
      console.error(`[mock-server] Request processing error:`, error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error', detail: error.message }));
    }
    return;
  }

  // ── GET /rules — return current rule list ─────────────────────────────
  if (parsed.pathname === '/rules' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(rules));
    return;
  }

  // ── GET /health ───────────────────────────────────────────────────────
  if (parsed.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rules: rules.length }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[mock-server] Listening on http://localhost:${port}`);
  console.log(`[mock-server] Config: ${configPath}`);
  console.log(`[mock-server] Endpoints:`);
  console.log(`  GET /resolve?url=<encoded>       — serve a matched mock`);
  console.log(`  GET /resolve-pattern?pattern=<>  — serve mock by pattern (for declarativeNetRequest)`);
  console.log(`  GET /rules                       — list current rules from .mocks/config.json`);
  console.log(`  GET /health                  — server status`);
});
