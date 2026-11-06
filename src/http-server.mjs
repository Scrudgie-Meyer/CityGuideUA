/** HTTP interface: validated API requests and static presentation files. */
import http from 'node:http';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CityRepository } from './data/city-repository.mjs';
import { CatalogService } from './services/catalog-service.mjs';
import { databasePath } from './config.mjs';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/** Read small JSON requests and reject malformed or excessive bodies. */
async function readJson(req) {
  return new Promise((resolve, reject) => {
    let chunks = [],
      size = 0,
      failed = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 32768 && !failed) {
        failed = true;
        chunks = [];
        reject(Object.assign(new Error('Request body too large'), { status: 413 }));
      } else if (!failed) {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      if (failed) {
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Invalid JSON request'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/** Create an injectable app; tests own their isolated in-memory repositories. */
export function createAppServer({ repository, client, dbPath = databasePath() } = {}) {
  const ownsRepository = !repository;
  repository ??= new CityRepository(dbPath);
  const service = new CatalogService(repository, { ...(client ? { client } : {}) });
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    const reply = (code, text, type = 'text/plain; charset=utf-8') => {
      res.writeHead(code, {
        'Content-Type': type,
        'Content-Length': Buffer.byteLength(text),
        'Cache-Control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : text);
    };
    const json = (code, value) =>
      reply(code, JSON.stringify(value), 'application/json; charset=utf-8');
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      return reply(400, 'Invalid path');
    }
    try {
      if (pathname.startsWith('/api/')) {
        if (pathname === '/api/cities' && req.method === 'GET') {
          return json(200, service.catalogue());
        }
        if (pathname === '/api/graph' && ['GET', 'HEAD'].includes(req.method)) {
          res.setHeader('Content-Disposition', 'attachment; filename="cityguide-cities.ttl"');
          return reply(200, service.exportRdf(), 'text/turtle; charset=utf-8');
        }
        if (pathname === '/api/query' && req.method === 'POST') {
          const body = await readJson(req);
          return json(200, await service.query(body?.query));
        }
        if (pathname === '/api/refresh' && req.method === 'POST') {
          if (
            req.headers.origin &&
            req.headers.origin !== `https://${req.headers.host}` &&
            req.headers.origin !== `http://${req.headers.host}`
          ) {
            return json(403, { error: 'Cross-origin updates are not allowed' });
          }
          try {
            await service.refresh();
          } catch (error) {
            throw Object.assign(error, { status: error.status ?? 502 });
          }
          return json(200, service.catalogue());
        }
        return json(404, { error: 'Unknown API route or method' });
      }
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.setHeader('Allow', 'GET, HEAD');
        return reply(405, 'Method not allowed');
      }
      if (pathname === '/healthz') {
        repository.stats();
        return json(200, { status: 'ok' });
      }
      if (
        pathname.includes('\\') ||
        pathname.includes('\0') ||
        pathname.split('/').includes('..')
      ) {
        return reply(400, 'Invalid path');
      }
      if (pathname === '/') {
        pathname = '/index.html';
      }
      const filename = path.resolve(root, '.' + pathname),
        relative = path.relative(root, filename);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        return reply(403, 'Forbidden');
      }
      const info = await stat(filename);
      if (!info.isFile()) {
        return reply(404, 'Not found');
      }
      res.writeHead(200, {
        'Content-Type': types[path.extname(filename)] ?? 'application/octet-stream',
        'Content-Length': info.size,
        'Cache-Control': 'no-cache',
      });
      if (req.method === 'HEAD') {
        return res.end();
      }
      const stream = createReadStream(filename);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    } catch (error) {
      if (res.headersSent) {
        return res.destroy();
      }
      const code = error.status ?? (['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : 500);
      return pathname.startsWith('/api/')
        ? json(code, {
            error:
              code >= 500
                ? 'Не вдалося обробити запит. Збережені дані залишаються доступними.'
                : error.message,
          })
        : reply(code, code === 404 ? 'Not found' : 'Server error');
    }
  });
  if (ownsRepository) {
    server.once('close', () => repository.close());
  }
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  return server;
}
