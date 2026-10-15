import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { renderSite, type RenderOptions, type RenderResult } from './site.js';

/** Running localhost viewer. close() releases the port and removes its temporary output. */
export interface Viewer extends RenderResult { url: string; close(): Promise<void> }
const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
};

/** Creates disposable output and installs cleanup before rendering or opening a port. */
export async function startViewer(input: string, options: RenderOptions = {}): Promise<Viewer> {
  const directory = await mkdtemp(path.join(tmpdir(), 'md-render-'));
  const cleanup = (): void => rmSync(directory, { recursive: true, force: true });
  process.once('exit', cleanup);
  const signal = (name: NodeJS.Signals): void => { cleanup(); process.exit(name === 'SIGINT' ? 130 : 143); };
  const interrupt = (): void => signal('SIGINT');
  const terminate = (): void => signal('SIGTERM');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  const removeHandlers = (): void => {
    process.off('exit', cleanup); process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);
  };
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end('Method not allowed'); return; }
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const target = path.resolve(directory, relative);
      if (!target.startsWith(directory + path.sep)) { response.writeHead(403).end('Forbidden'); return; }
      const bytes = await readFile(target);
      response.writeHead(200, { 'Content-Type': contentTypes[path.extname(target)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const missing = code === 'ENOENT' || code === 'EISDIR';
      response.writeHead(missing ? 404 : error instanceof URIError ? 400 : 500).end(missing ? 'Not found' : (error as Error).message);
    }
  });
  try {
    const result = await renderSite(input, directory, options);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No localhost port assigned');
    let closed = false;
    return { ...result, url: `http://127.0.0.1:${address.port}/${result.pages[0]!.split('/').map(encodeURIComponent).join('/')}`, async close() {
      if (closed) return;
      closed = true;
      try {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
          server.closeAllConnections();
        });
      } finally { cleanup(); removeHandlers(); }
    } };
  } catch (error) {
    server.close();
    cleanup(); removeHandlers();
    throw error;
  }
}
