import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import type { Plugin, ProxyOptions } from 'vite';

const UNAVAILABLE = 'SentinelSat gateway unavailable. Check the Windows backend, gateway, tunnel, and server Secrets.';
const json = (res: ServerResponse, status: number, detail: string) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ detail }));
};
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function gatewayRoute(url: string, basePath: string): 'state' | 'incident' | 'ws' | null {
  const prefix = basePath.replace(/\/$/, '');
  if (!url.startsWith(prefix + '/') || url.includes('?') || url.includes('#')) return null;
  const path = url.slice(prefix.length);
  if (path === '/api/state') return 'state';
  if (path === '/ws') return 'ws';
  if (!/^\/api\/incidents\/[^/?]+$/.test(path)) return null;
  try {
    const id = decodeURIComponent(path.slice('/api/incidents/'.length));
    return id && id !== '.' && id !== '..' && !/[/\\\u0000-\u001f\u007f]/.test(id) ? 'incident' : null;
  } catch { return null; }
}

export function validGatewayOrigin(req: IncomingMessage) {
  const origin = req.headers.origin;
  if (!origin) return req.headers['sec-fetch-site'] !== 'cross-site';
  try {
    const url = new URL(origin);
    // Replit may forward the original browser host while routing to the local service.
    const forwarded = req.headers['x-forwarded-host'];
    const hosts = [req.headers.host, typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : undefined];
    return ['http:', 'https:'].includes(url.protocol) && hosts.includes(url.host);
  } catch { return false; }
}

export function gatewayMiddleware(basePath: string) {
  const prefix = basePath.replace(/\/$/, '');
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = (req.url ?? '').split('?')[0];
    if (!(path === prefix + '/ws' || path === prefix + '/api' || path.startsWith(prefix + '/api/'))) return next();
    const route = gatewayRoute(req.url ?? '', basePath);
    if (!route || route === 'ws') return json(res, 404, 'This gateway only exposes telemetry state, incident reads, and WebSocket upgrades.');
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return json(res, 405, 'The telemetry gateway is read-only.');
    }
    if (!validGatewayOrigin(req)) return json(res, 403, 'Cross-origin gateway requests are not allowed.');
    next();
  };
}

export function gatewayGuard(basePath: string): Plugin {
  return {
    name: 'sentinelsat-readonly-gateway',
    configureServer(server) {
      server.middlewares.use(gatewayMiddleware(basePath));
      const rejectUnsafeUpgrade = (req: IncomingMessage, socket: Socket) => {
        const prefix = basePath.replace(/\/$/, '');
        const path = (req.url ?? '').split('?')[0];
        if (path !== prefix + '/ws' && !path.startsWith(prefix + '/api/')) return;
        if (gatewayRoute(req.url ?? '', basePath) !== 'ws') {
          socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        }
      };
      server.httpServer?.prependListener('upgrade', rejectUnsafeUpgrade);
      server.httpServer?.once('close', () => server.httpServer?.removeListener('upgrade', rejectUnsafeUpgrade));
    },
  };
}

/** Arguments come from server configuration only, never from an HTTP caller. */
export function gatewayProxy(target: string, token: string, basePath: string): Record<string, ProxyOptions> {
  const prefix = basePath.replace(/\/$/, '');
  const upstream: ProxyOptions = {
    target, changeOrigin: true, followRedirects: false, timeout: 25000, proxyTimeout: 25000,
    headers: { Authorization: `Bearer ${token}` },
    bypass(req) {
      if (!gatewayRoute(req.url ?? '', basePath) || req.method !== 'GET' || !validGatewayOrigin(req)) return false;
      return undefined;
    },
    rewrite: path => path.slice(prefix.length),
    configure(proxy) {
      const authenticate = (outgoing: { setHeader(name: string, value: string): void; removeHeader(name: string): void }) => {
        outgoing.setHeader('Authorization', `Bearer ${token}`);
        outgoing.removeHeader('cookie');
        outgoing.removeHeader('proxy-authorization');
      };
      proxy.on('proxyReq', authenticate);
      proxy.on('proxyReqWs', authenticate);
      proxy.on('proxyRes', response => {
        delete response.headers['set-cookie'];
        delete response.headers.authorization;
        delete response.headers['proxy-authorization'];
        response.headers['cache-control'] = 'no-store';
        // Do not redirect a browser directly to the credential-protected upstream.
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
          delete response.headers.location;
          response.statusCode = 502;
        }
      });
      proxy.on('error', (_error, _req, response) => {
        // Never serialize the error or request/options: they can contain the injected credential.
        if ('writeHead' in response && !response.headersSent)
          json(response as ServerResponse, 502, UNAVAILABLE);
        else if ('destroy' in response) response.destroy();
      });
    },
  };
  const escaped = escapeRegex(prefix);
  return {
    [`^${escaped}/api/(state$|incidents/[^/?]+$)`]: upstream,
    [`^${escaped}/ws$`]: { ...upstream, ws: true, timeout: 0, proxyTimeout: 0 },
  };
}

export function configuredGateway(basePath: string, env: Record<string, string | undefined> = process.env) {
  const target = env.SENTINEL_API_ORIGIN;
  const token = env.SENTINEL_API_TOKEN?.trim();
  if (!target || !token) throw new Error('Set SENTINEL_API_ORIGIN and SENTINEL_API_TOKEN in Replit Secrets.');
  let url: URL;
  try { url = new URL(target); }
  catch { throw new Error('SENTINEL_API_ORIGIN must be a valid HTTPS origin.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('SENTINEL_API_ORIGIN must be an HTTPS origin without credentials, a path, query, or fragment.');
  if (/^Bearer\s/i.test(token) || /[\r\n]/.test(token))
    throw new Error('SENTINEL_API_TOKEN must contain the token alone, without Bearer or line breaks.');
  return { proxy: gatewayProxy(url.origin, token, basePath), plugin: gatewayGuard(basePath) };
}
