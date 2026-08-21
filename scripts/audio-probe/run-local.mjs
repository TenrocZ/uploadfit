#!/usr/bin/env node

/* Auxiliary Chromium page probe. It is explicitly not Tabbit S0 evidence. */
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const rootDir = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const outputFile = path.join(rootDir, 'docs', 'evidence', 'V2-S0', 'chromium-capability-result.json');

function mime(filePath) {
  return filePath.endsWith('.html') ? 'text/html; charset=utf-8'
    : filePath.endsWith('.css') ? 'text/css; charset=utf-8'
      : 'text/javascript; charset=utf-8';
}

function runBuild() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(rootDir, 'scripts', 'audio-probe', 'build.mjs')], {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(stderr || `probe build exited ${code}`)));
  });
}

async function main() {
  await runBuild();
  const server = createServer(async (request, response) => {
    const requestPath = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    const relative = requestPath.replace(/^\/+/, '') || 'test-pages/audio-probe.html';
    const filePath = path.resolve(rootDir, relative);
    if (!filePath.startsWith(`${rootDir}${path.sep}`) || !existsSync(filePath)) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    response.writeHead(200, { 'content-type': mime(filePath) });
    response.end(await readFile(filePath));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  if (!port) throw new Error('probe server did not bind');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/test-pages/audio-probe.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean(window.uploadFitAudioS0ProbeResult), null, { timeout: 10_000 });
    const capabilities = await page.evaluate(() => window.uploadFitAudioS0ProbeResult);
    const smallEncode = await page.evaluate(() => window.uploadFitAudioS0Encoder.runSmallSyntheticEncode());
    const result = {
      schemaVersion: 1,
      status: 'AUXILIARY_ONLY',
      environment: 'Playwright Chromium headless',
      tabbitEvidence: false,
      localServerClosed: true,
      capabilities,
      smallEncode,
      limitation: 'Chromium capability output cannot satisfy the real Tabbit 200MB→100MB gate.'
    };
    await mkdir(path.dirname(outputFile), { recursive: true });
    await writeFile(outputFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
