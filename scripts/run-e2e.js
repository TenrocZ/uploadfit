import { request } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const healthUrl = 'http://127.0.0.1:8765/test-pages/probe.html';
let serverProcess = null;
let ownsServer = false;

function probeServer(url, timeoutMs = 500) {
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const finish = (available) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(available);
    };

    const requestHandle = request(url, { method: 'HEAD' }, (response) => {
      const isUploadFitServer = response.headers['x-uploadfit-test-server'] === '1';
      response.resume();
      finish(isUploadFitServer && response.statusCode >= 200 && response.statusCode < 500);
    });
    requestHandle.setTimeout(timeoutMs, () => {
      requestHandle.destroy();
      finish(false);
    });
    requestHandle.once('error', () => finish(false));
    timer = setTimeout(() => {
      requestHandle.destroy();
      finish(false);
    }, timeoutMs + 50);
    requestHandle.end();
  });
}

function startServer() {
  serverProcess = spawn(process.execPath, ['scripts/serve-test.js'], {
    cwd: rootDir,
    stdio: 'inherit'
  });
  ownsServer = true;
  serverProcess.once('error', (error) => {
    // The child has its own listener for EADDRINUSE. Keep the parent from
    // turning a recoverable race with an already healthy test server into an
    // unhandled error.
    if (error.code !== 'EADDRINUSE') console.error(error);
  });
}

async function stopServer() {
  if (!ownsServer || !serverProcess) return;
  const child = serverProcess;
  ownsServer = false;
  serverProcess = null;
  if (child.exitCode !== null || child.signalCode !== null) return;

  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, 2_000);
    child.once('exit', finish);
    try {
      child.kill();
    } catch {
      finish();
    }
  });
}

function waitForServer(url, timeoutMs = 30_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      probeServer(url).then((available) => {
        if (available) {
          resolve();
          return;
        }
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`Test server did not start within ${timeoutMs}ms`));
        return;
      }
      setTimeout(check, 100);
    };

    check();
  });
}

async function main() {
  try {
    if (await probeServer(healthUrl)) {
      console.log('Reusing existing UploadFit test server on 127.0.0.1:8765');
    } else {
      startServer();
    }
    await waitForServer(healthUrl);
    const cliPath = path.join(rootDir, 'node_modules', '@playwright', 'test', 'cli.js');
    const testProcess = spawn(process.execPath, [
      cliPath,
      'test',
      '--config=playwright.config.js',
      ...process.argv.slice(2)
    ], { cwd: rootDir, stdio: 'inherit' });
    const [exitCode] = await new Promise((resolve, reject) => {
      testProcess.once('error', reject);
      testProcess.once('exit', (code, signal) => resolve([code ?? (signal ? 1 : 0)]));
    });
    process.exitCode = exitCode;
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await stopServer();
  }
}

process.once('SIGINT', () => {
  process.exitCode = 130;
  void stopServer();
});
process.once('SIGTERM', () => {
  process.exitCode = 143;
  void stopServer();
});

await main();
