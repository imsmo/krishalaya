#!/usr/bin/env node
// ops/security/dast-probes/vulnerable-stub.mjs · DEV-34
//
// A DELIBERATELY-VULNERABLE local HTTP stub used ONLY to negative-test probe-suite.mjs itself — DEV-33's
// own standing lesson ("a gate that can't fail is not a gate") requires proving the harness actually
// reports FAIL against a target with real defects, not just proving it reports PASS against the
// already-hardened real api. This file is NEVER booted as part of any real environment and ships no
// route the real apps/api has — it exists purely as a fixture. Zero dependencies (node:http only).
//
// Deliberately violates: HDR-1..8 (no security headers at all, banners on), COOKIE-1 (a plain, non-
// HttpOnly/Secure/SameSite cookie), CORS-1/2 (reflects ANY origin + credentials:true, the textbook
// misconfiguration), ERR-1/2 (returns a fake stack trace + absolute path on error), METHOD-1 (TRACE
// echoes the request body — the classic Cross-Site-Tracing shape), TRAV-1 (echoes a passwd-shaped
// string for a traversal-looking path), RATE-1 (no rate limiting of any kind), JWT-1 (accepts an
// alg:none token as authenticated), MASS-1 (echoes back every field it's given, no schema).
import http from 'node:http';

const PORT = Number(process.env.STUB_PORT || 9199);

const server = http.createServer((req, res) => {
  const url = req.url || '';
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    // No security headers at all. Banner disclosure on purpose.
    res.setHeader('X-Powered-By', 'Express');
    res.setHeader('Server', 'VulnerableStub/1.0 (Node.js Express)');

    // CORS misconfiguration: reflect ANY origin AND allow credentials — textbook bad.
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    if (req.method === 'TRACE') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`TRACE ${url} HTTP/1.1\r\n` + Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n'));
      return;
    }

    if (url.startsWith('/v1/auth/otp') && req.method === 'POST') {
      // Non-HttpOnly, non-Secure, no SameSite cookie — the exact anti-pattern COOKIE-1 checks for.
      res.setHeader('Set-Cookie', 'sessionid=deadbeef1234; Path=/');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: { sent: true, devCode: '123456' } }));
      return;
    }

    if (url.startsWith('/v1/auth/verify') && req.method === 'POST') {
      // Verbose stack-trace + absolute filesystem path leakage on purpose.
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'TypeError: Cannot read properties of undefined',
        stack: 'at OtpService.verify (/home/deploy/apps/api/src/modules/identity/services/otp.service.js:142:18)\n    at node_modules/express/lib/router/layer.js:95:5',
      }));
      return;
    }

    if (url.includes('etc%2fpasswd') || url.includes('../../etc/passwd')) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('root:x:0:0:root:/root:/bin/bash\nbin:x:1:1:bin:/bin:/usr/sbin/nologin\n');
      return;
    }

    if (url.startsWith('/v1/auth/sessions')) {
      const authz = req.headers.authorization || '';
      // Accepts ANY bearer token, including an alg:none forged one — deliberate JWT-1 failure.
      if (authz.startsWith('Bearer ')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'fake-session' }] }));
        return;
      }
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthenticated' }));
      return;
    }

    if (url.startsWith('/v1/listings') && req.method === 'POST') {
      // Mass-assignment: echoes back literally everything it was given, no schema at all.
      let parsed = {};
      try { parsed = JSON.parse(body || '{}'); } catch { /* ignore */ }
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: { id: 'fake-listing', ...parsed } }));
      return;
    }

    if (url.startsWith('/v1/does-not-exist-route-xyz')) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Cannot GET ${url}\n    at node_modules/express/lib/router/index.js:47:12`);
      return;
    }

    // default: plain 200, no rate limiting of any kind regardless of how many times this is hit.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: { status: 'ok' } }));
  });
});

server.listen(PORT, () => { console.log(`VULNERABLE STUB listening on :${PORT} (negative-test fixture only, never a real environment)`); });

process.on('SIGTERM', () => process.exit(0));
