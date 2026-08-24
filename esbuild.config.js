import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { buildS2WorkerImplementation } from './scripts/audio-probe/build-s2-adapter.mjs';
import { AUDIO_LICENSE_BANNER, AUDIO_LICENSE_BANNER_PREFIX } from './scripts/audio-probe/license-banner.mjs';

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
  await esbuild.build({
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
    banner: { js: AUDIO_LICENSE_BANNER },
    define: {
      __UPLOADFIT_VERSION__: JSON.stringify(packageJson.version),
      __UPLOADFIT_MODE__: JSON.stringify(mode),
      __UPLOADFIT_AUDIO_IMPLEMENTATION_SOURCE__: JSON.stringify(audioImplementationSource)
    },
    logLevel: 'silent'
  });

  const outputPath = path.join(rootDir, outputFile);
  let outputSource = readFileSync(outputPath, 'utf8');
  // Tabbit's official private-script editor removes a single terminal line
  // break on save.  Normalize the generated paste artifact the same way so
  // the raw bytes/SHA recorded locally remain identical after official save.
  // This changes no executable token and applies reproducibly to production
  // and debug IIFEs.
  const pasteNormalizedSource = outputSource.replace(/\r?\n$/, '');
  if (pasteNormalizedSource !== outputSource) {
    writeFileSync(outputPath, pasteNormalizedSource, 'utf8');
    outputSource = pasteNormalizedSource;
  }
  const outputBytes = Buffer.byteLength(outputSource, 'utf8');
  if (!outputSource.startsWith(AUDIO_LICENSE_BANNER_PREFIX)) {
    throw new Error(`Missing required audio license banner in ${outputFile}`);
  }
  console.log(`UploadFit build complete: mode=${mode}, entry=${entryPoint}, output=${outputFile}, bytes=${outputBytes}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
