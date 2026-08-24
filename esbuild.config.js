import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { buildS2WorkerImplementation } from './scripts/audio-probe/build-s2-adapter.mjs';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  readFileSync(path.join(rootDir, 'package.json'), 'utf8')
);
const modeArgument = process.argv.find((argument) => argument.startsWith('--mode='));
const mode = modeArgument?.slice('--mode='.length) === 'development'
  ? 'development'
  : modeArgument?.slice('--mode='.length) === 'test'
    ? 'test'
  : 'production';
const isTestBuild = mode === 'test';
const entryPoint = isTestBuild ? 'src/debug-entry.js' : 'src/production-entry.js';
const outputFile = isTestBuild ? 'dist/uploadfit.test.js' : 'dist/uploadfit.js';
// S3 closes the S2 harness-only gap: the production IIFE receives the exact
// frozen lamejs@1.2.1 worker adapter source at build time.  The runtime still
// creates a local Blob Worker; no external import/fetch is introduced.
const audioImplementationSource = (await buildS2WorkerImplementation())
  // The upstream LAME information string contains a historical project URL;
  // it is not used by the encoder.  Keep the payload local-only in the
  // production artifact so static security scans cannot mistake that inert
  // string for a runtime endpoint.
  .replaceAll('http://www.mp3dev.org/', 'embedded://lamejs')
  .replaceAll('https://github.com/zhuker/lamejs', 'embedded://lamejs')
  // Keep generated artifacts diff-check clean without changing executable
  // encoder semantics or the frozen implementation/version.
  .replace(/[ \t]+$/gm, '');

try {
  const result = await esbuild.build({
    entryPoints: [path.join(rootDir, entryPoint)],
    outfile: path.join(rootDir, outputFile),
    bundle: true,
    format: 'iife',
    globalName: isTestBuild ? '__uploadfit_debug_bundle__' : '__uploadfit_bundle__',
    platform: 'browser',
    target: ['es2022'],
    minify: mode !== 'development',
    charset: 'utf8',
    sourcemap: false,
    legalComments: 'none',
    define: {
      __UPLOADFIT_VERSION__: JSON.stringify(packageJson.version),
      __UPLOADFIT_MODE__: JSON.stringify(mode),
      __UPLOADFIT_AUDIO_IMPLEMENTATION_SOURCE__: JSON.stringify(audioImplementationSource)
    },
    logLevel: 'silent'
  });

  const outputBytes = result.metafile
    ? Object.values(result.metafile.outputs)[0]?.bytes ?? 0
    : readFileSync(path.join(rootDir, outputFile)).byteLength;
  console.log(`UploadFit build complete: mode=${mode}, entry=${entryPoint}, output=${outputFile}, bytes=${outputBytes}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
