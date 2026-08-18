import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.UPLOADFIT_TEST_PORT ?? 8765);
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png'
};

function resolveRequestPath(requestUrl) {
  const parsedUrl = new URL(requestUrl ?? '/', 'http://127.0.0.1');
  const relativePath = decodeURIComponent(parsedUrl.pathname).replace(/^[/\\]+/, '')
    || path.join('test-pages', 'probe.html');
  const resolvedPath = path.resolve(rootDir, relativePath);
  const rootPrefix = `${rootDir}${path.sep}`;
  if (resolvedPath !== rootDir && !resolvedPath.startsWith(rootPrefix)) return null;
  return resolvedPath;
}

const server = createServer(async (request, response) => {
  try {
    const filePath = resolveRequestPath(request.url);
    if (!filePath || !existsSync(filePath)) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    const body = await readFile(filePath);
    const contentType = mimeTypes[path.extname(filePath).toLowerCase()]
      ?? 'application/octet-stream';
    response.writeHead(200, { 'content-type': contentType });
    response.end(body);
  } catch (error) {
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Internal test server error');
    console.error(error);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`UploadFit test server: http://127.0.0.1:${port}/test-pages/probe.html`);
});

function shutdown() {
  if (!server.listening) {
    process.exit(0);
    return;
  }
  server.close(() => process.exit(0));
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
