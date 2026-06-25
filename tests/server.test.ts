import { test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Spins up the real server against a throwaway config and exercises the core
// endpoints. Zero dependencies — uses Bun's built-in test runner + Bun.spawn.

const PORT = 18756;
const BASE = `http://localhost:${PORT}`;

let proc: ReturnType<typeof Bun.spawn>;
let tmp: string;

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'mockery-test-'));
  mkdirSync(join(tmp, 'mocks'), { recursive: true });
  writeFileSync(join(tmp, 'mocks', 'hello.json'), JSON.stringify({ hello: 'world' }));
  writeFileSync(join(tmp, 'rules.ts'), `
    import type { MockRule } from '${join(process.cwd(), 'server', 'index.ts')}';
    export default [
      { pattern: "api.test/hello", file: "hello.json" },
      { pattern: /\\/users\\/\\d+$/, file: "hello.json" },
      { pattern: "api.test/only-post", method: "POST", file: "hello.json" },
      {
        pattern: "api.test/dynamic",
        handler: async (req) => ({
          status: 201,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: req.method }),
        }),
      },
    ] satisfies MockRule[];
  `);

  proc = Bun.spawn(['bun', 'run', 'server/index.ts', String(PORT), '--config', join(tmp, 'rules.ts')], {
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
  });

  // Wait for the server to come up.
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error('server did not start in time');
});

afterAll(() => {
  proc?.kill();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

test('GET /health reports rule count', async () => {
  const res = await fetch(`${BASE}/health`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.rules).toBe(4);
});

test('matches a RegExp pattern', async () => {
  const hit = await fetch(`${BASE}/resolve?url=${encodeURIComponent('https://api.test/users/42')}`);
  expect(hit.status).toBe(200);
  expect(await hit.json()).toEqual({ hello: 'world' });
  // A non-numeric id should not match /\/users\/\d+$/
  const miss = await fetch(`${BASE}/resolve?url=${encodeURIComponent('https://api.test/users/abc')}`);
  expect(miss.status).toBe(404);
});

test('resolves a static file rule', async () => {
  const res = await fetch(`${BASE}/resolve?url=${encodeURIComponent('https://api.test/hello')}`);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('application/json');
  expect(await res.json()).toEqual({ hello: 'world' });
});

test('runs an inline handler', async () => {
  const res = await fetch(`${BASE}/resolve?url=${encodeURIComponent('https://api.test/dynamic')}&method=GET`);
  expect(res.status).toBe(201);
  expect(await res.json()).toEqual({ method: 'GET' });
});

test('respects the method filter', async () => {
  const url = encodeURIComponent('https://api.test/only-post');
  // GET should miss the POST-only rule
  expect((await fetch(`${BASE}/resolve?url=${url}&method=GET`)).status).toBe(404);
  // POST should hit it
  expect((await fetch(`${BASE}/resolve?url=${url}&method=POST`)).status).toBe(200);
});

test('unmatched URL returns 404', async () => {
  const res = await fetch(`${BASE}/resolve?url=${encodeURIComponent('https://api.test/nope')}`);
  expect(res.status).toBe(404);
});

test('missing ?url= returns 400', async () => {
  const res = await fetch(`${BASE}/resolve`);
  expect(res.status).toBe(400);
});
