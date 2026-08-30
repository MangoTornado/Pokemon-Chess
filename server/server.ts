/**
 * The `node:http` adapter — the only part of the server that touches the network.
 *
 * It parses the request (JSON body with a hard size cap, cookies), delegates all logic to the pure
 * {@link handleApi}, emits the session cookie with the right security flags, and serves the built client
 * for everything else so the whole game is one process behind one port — the simplest thing to run on a
 * single Oracle Cloud VM. Put TLS in front with a reverse proxy (Caddy/Nginx); this speaks plain HTTP to
 * localhost and trusts the proxy for HTTPS, which is why `Secure` is gated on `NODE_ENV=production`.
 */

import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';

import { Accounts } from './accounts.ts';
import { Matches } from './matches.ts';
import { handleApi, SESSION_COOKIE } from './api.ts';
import type { ApiResponse } from './api.ts';

const MAX_BODY_BYTES = 64 * 1024; // a profile with an avatar is small; anything larger is abuse
const SESSION_TTL_SECONDS = 14 * 24 * 60 * 60;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export interface ServerOptions {
  readonly accounts: Accounts;
  /** The live-match manager for online play. Omit to run without multiplayer. */
  readonly matches?: Matches;
  /** Directory of the built client (Vite `dist`). Omit to run API-only. */
  readonly staticDir?: string;
  /** Emit `Secure` cookies; set true behind an HTTPS proxy in production. */
  readonly secureCookies?: boolean;
}

export function createServer(options: ServerOptions): Server {
  return createHttpServer((req, res) => void handle(options, req, res));
}

async function handle(options: ServerOptions, req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;

    if (path.startsWith('/api/')) {
      const body = await readJsonBody(req, res);
      if (body === OVERSIZE) return; // response already sent
      const response = await handleApi(options.accounts, {
        method: req.method ?? 'GET',
        path,
        body,
        cookies: parseCookies(req.headers.cookie),
        // The rate-limit key. Deliberately the socket's own address and not a forwarded header: behind no proxy
        // an X-Forwarded-For would be attacker-controlled, which would make the limiter trivially bypassable.
        // A deploy that does terminate at a proxy must read the trusted hop instead.
        client: req.socket.remoteAddress ?? 'unknown',
      }, options.matches);
      sendApi(res, response, options.secureCookies ?? false);
      return;
    }

    // Everything else: the built client, with SPA fallback to index.html.
    if (options.staticDir) {
      await serveStatic(options.staticDir, path, res);
      return;
    }
    res.writeHead(404).end('Not found');
  } catch {
    // Never leak an internal error's shape to the client.
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal error.' }));
  }
}

const OVERSIZE = Symbol('oversize');

function readJsonBody(req: IncomingMessage, res: ServerResponse): Promise<unknown | typeof OVERSIZE> {
  return new Promise((resolve) => {
    if (req.method === 'GET' || req.method === 'HEAD') return resolve(undefined);
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        res.writeHead(413, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Request too large.' }));
        req.destroy();
        resolve(OVERSIZE);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({}); // a malformed body validates as empty and is rejected downstream
      }
    });
    req.on('error', () => resolve({}));
  });
}

function sendApi(res: ServerResponse, response: ApiResponse, secure: boolean): void {
  const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8' };
  if (response.session !== undefined) {
    headers['Set-Cookie'] = cookieHeader(response.session, secure);
  }
  res.writeHead(response.status, headers);
  res.end(JSON.stringify(response.json ?? {}));
}

/** Builds the session Set-Cookie value: httpOnly, SameSite=Lax, path-scoped, Secure in production. */
function cookieHeader(token: string | null, secure: boolean): string {
  const base = `${SESSION_COOKIE}=`;
  const flags = ['Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (secure) flags.push('Secure');
  if (token === null) {
    return `${base}; ${flags.join('; ')}; Max-Age=0`;
  }
  return `${base}${token}; ${flags.join('; ')}; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

async function serveStatic(dir: string, path: string, res: ServerResponse): Promise<void> {
  // Resolve within the static root; a normalised path that escapes it falls back to the SPA entry.
  const rel = normalize(path).replace(/^(\.\.[/\\])+/, '');
  let file = join(dir, rel === '/' || rel === '' ? 'index.html' : rel);
  if (!file.startsWith(dir)) file = join(dir, 'index.html');

  try {
    const info = await stat(file);
    if (info.isDirectory()) file = join(file, 'index.html');
  } catch {
    // No such file: serve the SPA entry so client routing works on deep links.
    file = join(dir, 'index.html');
  }

  try {
    const data = await readFile(file);
    const type = MIME[extname(file)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }).end(data);
  } catch {
    res.writeHead(404).end('Not found');
  }
}
