#!/usr/bin/env node

import { mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const rootDir = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const outputDir = path.join(rootDir, 'test-pages', 'generated');
const outputFile = path.join(outputDir, 'audio-probe.bundle.js');
const entryPoint = path.join(rootDir, 'scripts', 'audio-probe', 'probe-entry.js');
const workerEntryPoint = path.join(rootDir, 'scripts', 'audio-probe', 'worker-entry.js');
const lameInlinePath = path.join(outputDir, '.lamejs-inline.js');
const lameSource = await readFile(path.join(rootDir, 'node_modules', 'lamejs', 'lame.min.js'), 'utf8');
const LICENSE_BANNER = '/*! UploadFit audio probe includes unmodified lamejs 1.2.1 (package-declared LGPL-3.0). Source: https://github.com/zhuker/lamejs/tree/v1.2.1 . License, notice and relinking instructions: docs/evidence/V2-S0/licenses/ */';
const lamePlugin = {
  name: 'inline-lamejs-min',
  setup(build) {
    build.onResolve({ filter: /^lamejs\/lame\.min\.js$/ }, () => ({ path: lameInlinePath }));
    build.onLoad({ filter: /\.lamejs-inline\.js$/ }, () => ({
      contents: `${lameSource}\nexport const Mp3Encoder = lamejs.Mp3Encoder;\n`,
      loader: 'js'
    }));
  }
};

await mkdir(outputDir, { recursive: true });
const workerBuild = await esbuild.build({
  entryPoints: [workerEntryPoint],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  charset: 'utf8',
  sourcemap: false,
  legalComments: 'none',
  write: false,
  plugins: [lamePlugin],
  logLevel: 'silent'
});
const workerSource = workerBuild.outputFiles[0].text;
await esbuild.build({
  entryPoints: [entryPoint],
  outfile: outputFile,
  bundle: true,
  format: 'iife',
  globalName: '__uploadfit_audio_s0_probe__',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  charset: 'utf8',
  sourcemap: false,
  legalComments: 'none',
  banner: { js: LICENSE_BANNER },
  define: {
    __AUDIO_WORKER_SOURCE__: JSON.stringify(workerSource)
  },
  plugins: [lamePlugin],
  logLevel: 'silent'
});

const bytes = await readFile(outputFile);
const sha256 = createHash('sha256').update(bytes).digest('hex').toUpperCase();
const source = bytes.toString('utf8');
const bannerPrefix = `${LICENSE_BANNER}\n`;
const executablePayload = source.startsWith(bannerPrefix) ? source.slice(bannerPrefix.length) : null;
const executablePayloadSha256 = executablePayload
  ? createHash('sha256').update(executablePayload).digest('hex').toUpperCase()
  : null;
const forbidden = ['eval(', 'new Function', 'import(', 'fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon'];
const forbiddenMatches = forbidden.filter((token) => source.includes(token));
process.stdout.write(`${JSON.stringify({
  artifact: 'audio-s0-probe-iife',
  bytes: bytes.byteLength,
  sha256,
  licenseBannerBytes: Buffer.byteLength(bannerPrefix),
  executablePayloadBytes: executablePayload ? Buffer.byteLength(executablePayload) : null,
  executablePayloadSha256,
  singleIife: source.includes('(function') || source.includes('(()=>'),
  forbiddenMatches,
  productionUntouched: true,
  outputIsTemporary: true
}, null, 2)}\n`);
