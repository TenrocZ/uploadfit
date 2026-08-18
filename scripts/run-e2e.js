import { request } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const healthUrl = 'http://127.0.0.1:8765/test-pages/probe.html';
const serverProcess = spawn(process.execPath, ['scripts/serve-test.js'], {
  cwd: rootDir,
  stdio: 'inherit'
});

function stopServer() {
  if (!serverProcess.killed) serverProcess.kill();
}

function waitForServer(url, timeoutMs = 30_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const requestHandle = request(url, { method: 'HEAD' }, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) {
          resolve();
          return;
        }
        retry();
      });
      requestHandle.on('error', retry);
      requestHandle.end();
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
    stopServer();
  }
}

process.once('SIGINT', () => {
  stopServer();
  process.exitCode = 130;
});
process.once('SIGTERM', () => {
  stopServer();
  process.exitCode = 143;
});

await main();

