#!/usr/bin/env node

/*
 * Bundle the S2 worker adapter (frozen lamejs + s2-worker-adapter.js) into a
 * self-contained classic-script string.  Reuses the S0 inline-lamejs esbuild
 * plugin so the encoder provenance stays identical to ADR-005.  Imported as a
 * library by the real-encoder integration test and run-s2-gate.mjs; run as a
 * CLI it prints build metadata only.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const rootDir = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const adapterEntryPoint = path.join(rootDir, 'scripts', 'audio-probe', 's2-worker-adapter.js');
const lameInlinePath = path.join(rootDir, 'test-pages', 'generated', '.lamejs-s2-inline.js');
const lameSource = await readFile(path.join(rootDir, 'node_modules', 'lamejs', 'lame.min.js'), 'utf8');

const lamePlugin = {
  name: 'inline-lamejs-min',
  setup(build) {
    build.onResolve({ filter: /^lamejs\/lame\.min\.js$/ }, () => ({ path: lameInlinePath }));
    build.onLoad({ filter: /\.lamejs-s2-inline\.js$/ }, () => ({
      contents: `${lameSource}\nexport const Mp3Encoder = lamejs.Mp3Encoder;\n`,
      loader: 'js'
    }));
  }
};

/** Build the S2 worker implementation source string (frozen encoder inlined). */
export async function buildS2WorkerImplementation() {
  const build = await esbuild.build({
    entryPoints: [adapterEntryPoint],
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
  return build.outputFiles[0].text;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const source = await buildS2WorkerImplementation();
  const forbidden = ['eval(', 'new Function', 'import(', 'fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon'];
  process.stdout.write(`${JSON.stringify({
    artifact: 'audio-s2-worker-adapter',
    bytes: Buffer.byteLength(source),
    encoder: 'lamejs@1.2.1 (S0/ADR-005 frozen, inlined)',
    definesUploadfitAudioEncode: source.includes('__uploadfitAudioEncode'),
    forbiddenMatches: forbidden.filter((token) => source.includes(token))
  }, null, 2)}\n`);
}
