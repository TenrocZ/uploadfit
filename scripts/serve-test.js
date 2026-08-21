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
const serverHeader = { 'x-uploadfit-test-server': '1' };

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
      response.writeHead(404, {
        'content-type': 'text/plain; charset=utf-8',
        ...serverHeader
      });
      response.end('Not found');
      return;
    }
    const body = await readFile(filePath);
    const contentType = mimeTypes[path.extname(filePath).toLowerCase()]
      ?? 'application/octet-stream';
    response.writeHead(200, { 'content-type': contentType, ...serverHeader });
    response.end(body);
  } catch (error) {
    response.writeHead(500, {
      'content-type': 'text/plain; charset=utf-8',
      ...serverHeader
    });
    response.end('Internal test server error');
    console.error(error);
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    // run-e2e.js probes for the marker before starting us. This handler also
    // covers a narrow startup race without printing an unhandled stack.
    process.exitCode = 0;
    return;
  }
  console.error(error);
  process.exitCode = 1;
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
