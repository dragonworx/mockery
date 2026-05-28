#!/usr/bin/env node
/**
 * Mock Server — zero-dependency companion for the HTTP Request Mocker extension.
 *
 * Usage:
 *   cd /path/to/your/project
 *   node /path/to/mock-server.js            # reads .mocks.json from cwd
 *   node /path/to/mock-server.js 9000        # custom port
 *   node /path/to/mock-server.js --config ./my-mocks.json   # custom config path
 *
 * Config format (.mocks.json):
 *   [
 *     { "pattern": "https://api.example.com/users", "file": "./stubs/users.json" },
 *     { "pattern": "address-book\\.smtnbnxt\\.json", "file": "./stubs/address-book.json", "isRegex": true }
 *   ]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// ── CLI args ────────────────────────────────────────────────────────────────
let port = 8756;
let configPath = path.join(process.cwd(), '.mocks.json');

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
  };
  return map[ext] || 'application/octet-stream';
}

// ── Matching ────────────────────────────────────────────────────────────────
function findMatch(url) {
  for (const rule of rules) {
    try {
      if (rule.isRegex) {
        if (new RegExp(rule.pattern).test(url)) return rule;
      } else {
        if (url === rule.pattern || url.includes(rule.pattern)) return rule;
      }
    } catch {
      // bad regex — skip
    }
  }
  return null;
}

// ── HTTP server ─────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
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

    // Resolve file path - handle both absolute and relative paths
    // Relative paths are resolved from project root, with mocks folder as fallback
    let filePath;
    if (path.isAbsolute(rule.file)) {
      filePath = rule.file;
    } else {
      // Try relative to project root first
      const relativeFromRoot = path.resolve(path.dirname(configPath), rule.file);
      if (fs.existsSync(relativeFromRoot)) {
        filePath = relativeFromRoot;
      } else {
        // Fallback to resolving relative to project root (handles mocks/ paths)
        filePath = path.resolve(process.cwd(), rule.file);
      }
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        console.error(`[mock-server] File read error: ${filePath}`, err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File read error', file: rule.file, detail: err.message }));
        return;
      }

      const mime = guessMime(filePath);
      console.log(`[mock-server] ✓ ${targetUrl}  →  ${rule.file} (${mime})`);
      res.writeHead(200, { 'Content-Type': mime });
      res.end(data);
    });
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

  // ── POST /rules — add a rule ──────────────────────────────────────────
  if (parsed.pathname === '/rules' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const rule = JSON.parse(body);
        if (!rule.pattern || !rule.file) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'pattern and file are required' }));
          return;
        }

        // Allow both absolute and relative paths (relative paths are in mocks folder)
        // No validation needed - we handle both cases in the resolve logic
        rules.push({ pattern: rule.pattern, file: rule.file, isRegex: !!rule.isRegex });
        const snapshot = [...rules];
        fs.writeFileSync(configPath, JSON.stringify(snapshot, null, 2));
        console.log(`[mock-server] Rule added: ${rule.pattern} → ${rule.file}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, rules: snapshot }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ── DELETE /rules — remove a rule by pattern ──────────────────────────
  if (parsed.pathname === '/rules' && req.method === 'DELETE') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { pattern } = JSON.parse(body);
        const before = rules.length;
        rules = rules.filter(r => r.pattern !== pattern);
        const snapshot = [...rules];
        fs.writeFileSync(configPath, JSON.stringify(snapshot, null, 2));
        console.log(`[mock-server] Rule removed: ${pattern} (${before - snapshot.length} removed)`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, rules: snapshot }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ── POST /save-file — save file content to mocks folder ──────────────────────────
  if (parsed.pathname === '/save-file' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { fileContent, fileName } = JSON.parse(body);
        if (!fileContent || !fileName) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'fileContent and fileName are required' }));
          return;
        }

        // Create mocks directory if it doesn't exist
        const mocksDir = path.join(process.cwd(), 'mocks');
        if (!fs.existsSync(mocksDir)) {
          fs.mkdirSync(mocksDir, { recursive: true });
        }

        // Generate unique filename to avoid conflicts
        const timestamp = Date.now();
        const ext = path.extname(fileName);
        const baseName = path.basename(fileName, ext);
        const uniqueFileName = `${baseName}_${timestamp}${ext}`;
        const destPath = path.join(mocksDir, uniqueFileName);
        const relativePath = path.join('mocks', uniqueFileName);

        // Save the file content
        fs.writeFile(destPath, fileContent, 'utf8', (err) => {
          if (err) {
            console.error(`[mock-server] File save error: ${destPath}`, err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'File save error', detail: err.message }));
            return;
          }

          console.log(`[mock-server] File saved: ${relativePath}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            filePath: relativePath,
            originalName: fileName,
            uniqueName: uniqueFileName
          }));
        });
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ── GET /pwd — return current working directory ─────────────────────────
  if (parsed.pathname === '/pwd' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      cwd: process.cwd(),
      mocksDir: path.join(process.cwd(), 'mocks')
    }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[mock-server] Listening on http://localhost:${port}`);
  console.log(`[mock-server] Config: ${configPath}`);
  console.log(`[mock-server] Endpoints:`);
  console.log(`  GET /resolve?url=<encoded>   — serve a matched mock`);
  console.log(`  GET /rules                   — list current rules`);
  console.log(`  POST /rules                  — add a rule`);
  console.log(`  DELETE /rules                — remove a rule`);
  console.log(`  POST /save-file              — save file content to mocks folder`);
  console.log(`  GET /health                  — server status`);
  console.log(`  GET /pwd                     — get project directory`);
});
