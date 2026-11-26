import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http, { type IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { test } from 'node:test';
import { createServer } from 'vite';
import { configuredGateway, gatewayGuard, gatewayProxy, gatewayRoute, validGatewayOrigin } from './gateway';

test('configuration requires both server-only settings and rejects unsafe values', () => {
  assert.throws(() => configuredGateway('/', {}), /Set SENTINEL_API_ORIGIN and SENTINEL_API_TOKEN/);
  for (const origin of ['http://example.test', 'https://u:p@example.test', 'https://example.test/path', 'https://example.test?x=1']) {
    assert.throws(() => configuredGateway('/', { SENTINEL_API_ORIGIN: origin, SENTINEL_API_TOKEN: 'fixture-only' }), /HTTPS origin/);
  }
  assert.throws(() => configuredGateway('/', { SENTINEL_API_ORIGIN: 'https://example.test', SENTINEL_API_TOKEN: 'Bearer fixture-only' }), /without Bearer/);
  assert.throws(() => configuredGateway('/', { SENTINEL_API_ORIGIN: 'https://example.test', SENTINEL_API_TOKEN: 'x\r\ny' }), /line breaks/);
  const gateway = configuredGateway('/sat/', { SENTINEL_API_ORIGIN: 'https://example.test', SENTINEL_API_TOKEN: 'fixture-only' });
  assert.deepEqual(Object.keys(gateway.proxy), ['^/sat/api/(state$|incidents/[^/?]+$)', '^/sat/ws$']);
});

test('allowlist excludes queries, traversal, encoded separators and non-read endpoints', () => {
  assert.equal(gatewayRoute('/api/state', '/'), 'state');
  assert.equal(gatewayRoute('/sat/api/incidents/INC-123', '/sat/'), 'incident');
  assert.equal(gatewayRoute('/sat/ws', '/sat/'), 'ws');
  for (const path of ['/api/state?target=elsewhere', '/api/incidents/%2fattack', '/api/incidents/%5cattack',
    '/api/incidents/..', '/api/incidents/%00', '/api/incidents/%zz', '/api/attack',
    '/api/sample', '/api/analysis/replay', '/api/state/more', '/ws?token=not-allowed']) {
    assert.equal(gatewayRoute(path, '/'), null, path);
  }
});

test('cross-origin browser requests are rejected, including WebSocket requests', () => {
  const req = (origin: string, host = 'dashboard.test') => ({ headers: { origin, host } }) as IncomingMessage;
  assert.equal(validGatewayOrigin(req('https://dashboard.test')), true);
  assert.equal(validGatewayOrigin(req('https://attacker.test')), false);
  assert.equal(validGatewayOrigin(req('null')), false);
  assert.equal(validGatewayOrigin({ headers: { 'sec-fetch-site': 'cross-site' } } as IncomingMessage), false);
});

test('actual HTTP and WS proxy injects the server credential, strips cookies, and blocks writes', { timeout: 20000 }, async t => {
  // Isolated fixture credential only; this test never reads the application's Secrets.
  const fixtureToken = 'isolated-test-credential';
  const received: { url: string; authorization?: string; cookie?: string; websocket: boolean }[] = [];
  const sockets = new Set<Socket>();
  const upstream = http.createServer((req, res) => {
    received.push({ url: req.url!, authorization: req.headers.authorization, cookie: req.headers.cookie, websocket: false });
    if (req.url === '/api/incidents/redirect') {
      res.writeHead(302, { Location: 'https://unrelated.test/' }); res.end(); return;
    }
    if (req.url === '/api/incidents/unauthorized') {
      res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"detail":"Unauthorized"}'); return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'upstream-cookie=fixture' });
    res.end(JSON.stringify({ ok: true, path: req.url }));
  });
  upstream.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  upstream.on('upgrade', (req, socket) => {
    received.push({ url: req.url!, authorization: req.headers.authorization, cookie: req.headers.cookie, websocket: true });
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const message = Buffer.from('{"fixture_stream":true}');
    socket.write(Buffer.concat([Buffer.from([0x81, message.length]), message]));
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = (upstream.address() as { port: number }).port;
  const prefix = '/sat';
  const vite = await createServer({
    configFile: false, base: prefix + '/', logLevel: 'silent',
    plugins: [gatewayGuard(prefix + '/')], optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: '127.0.0.1', port: 0, watch: null,
      proxy: gatewayProxy(`http://127.0.0.1:${upstreamPort}`, fixtureToken, prefix + '/') },
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await vite.close();
    await new Promise<void>(resolve => upstream.close(() => resolve()));
  });
  await vite.listen();
  const port = (vite.httpServer!.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}${prefix}`;
  const response = await fetch(base + '/api/state', {
    headers: { Authorization: 'Bearer caller-must-not-win', Cookie: 'browser-session=must-not-forward' },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, path: '/api/state' });
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('authorization'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(received[0].authorization, `Bearer ${fixtureToken}`);
  assert.equal(received[0].cookie, undefined);
  assert.equal((await fetch(base + '/api/incidents/INC-1')).status, 200);
  assert.equal((await fetch(base + '/api/incidents/redirect')).status, 502);
  assert.equal((await fetch(base + '/api/incidents/unauthorized')).status, 401);
  const before = received.length;
  assert.equal((await fetch(base + '/api/state', { method: 'POST' })).status, 405);
  assert.equal((await fetch(base + '/api/state', { headers: { Origin: 'https://attacker.test' } })).status, 403);
  assert.equal((await fetch(base + '/api/attack', { method: 'POST' })).status, 404);
  assert.equal((await fetch(base + '/api/state?target=elsewhere')).status, 404);
  assert.equal(received.length, before, 'blocked requests never reach the upstream');
  const websocket = new WebSocket(base.replace('http:', 'ws:') + '/ws');
  t.after(() => websocket.close());
  const message = await new Promise<string>((resolve, reject) => {
    websocket.addEventListener('message', event => resolve(String(event.data)), { once: true });
    websocket.addEventListener('error', () => reject(new Error('Fixture WebSocket failed')), { once: true });
  });
  assert.equal(JSON.parse(message).fixture_stream, true);
  assert.equal(received.at(-1)?.websocket, true);
  assert.equal(received.at(-1)?.authorization, `Bearer ${fixtureToken}`);
});
