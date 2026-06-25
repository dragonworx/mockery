// Mockery Configuration — EXAMPLE
//
// This is a reference file showing every kind of rule. It is committed to git.
// Your real rules live in `config/rules.ts`, which is gitignored and local to
// you. To get started:
//
//   cp config/rules.example.ts config/rules.ts
//
// ...then uncomment/edit the rules you need. The server hot-reloads on save.
// (If config/rules.ts is missing, the server seeds a minimal one on startup.)
//
// Quick reference (see README.md "Cookbook" for the full list):
//   pattern        URL to match — substring by default, regex when isRegex: true
//   file           mock file to serve, relative to mocks/
//   handler        function to generate/modify a response (inline or imported)
//   method         restrict to an HTTP method (GET, POST, …)
//   isRegex        treat `pattern` as a regular expression
//   enabled        set false to disable a rule without deleting it
//   forwardRequest forward the (modified) request to the real server

import type { MockRule } from '@server/index.ts';

export default [
  // ── Serve a static JSON file ────────────────────────────────────────────────
  {
    pattern: "api.example.com/users",
    file: "users.json", // → mocks/users.json
  },

  // ── Match with a regex and filter by method ─────────────────────────────────
  {
    pattern: "/users/\\d+$",
    isRegex: true,
    method: "GET",
    file: "user.json",
  },

  // ── Generate a dynamic response with an inline handler ───────────────────────
  {
    pattern: "api.example.com/time",
    handler: async (request) => ({
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ time: new Date().toISOString(), url: request.url }),
    }),
  },

  // ── Validate a request body against a template (imported handler) ───────────
  {
    pattern: "api.example.com/validate",
    method: "POST",
    requestFile: "requests/expected-payload.json", // → mocks/requests/...
    file: "responses/validation-success.json",
    handler: (await import("@handlers/validate-request.ts")).default,
  },

  // ── Add a header and forward the request to the real server ─────────────────
  {
    pattern: "api.example.com/submit",
    method: "POST",
    forwardRequest: true, // requires the <all_urls> optional permission
    handler: (await import("@handlers/forward-example.ts")).default,
  },
] satisfies MockRule[];
