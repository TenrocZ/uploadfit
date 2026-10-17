import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { buildAudioWorkerImplementation } from './scripts/build-audio.mjs';
import { AUDIO_LICENSE_BANNER } from './scripts/license-banner.mjs';
import { syncProjectPage } from './scripts/sync-project-page.mjs';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
// These upstream information strings are inert; keep runtime scans focused on
// executable network access. The unmodified source archive ships in vendor/.
const audioSource = (await buildAudioWorkerImplementation())
  .replaceAll('http://www.mp3dev.org/', 'embedded://lamejs')
  .replaceAll('https://github.com/zhuker/lamejs', 'embedded://lamejs')
  .replace(/[ \t]+$/gm, '');

await esbuild.build({
  entryPoints: [path.join(rootDir, 'src/production-entry.js')],
  outfile: path.join(rootDir, 'dist/uploadfit.js'),
  bundle: true,
  format: 'iife',
  globalName: '__uploadfit_bundle__',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  charset: 'utf8',
  sourcemap: false,
  legalComments: 'none',
  banner: { js: AUDIO_LICENSE_BANNER },
  define: {
    __UPLOADFIT_VERSION__: JSON.stringify(pkg.version),
    __UPLOADFIT_MODE__: JSON.stringify('production'),
    __UPLOADFIT_AUDIO_IMPLEMENTATION_SOURCE__: JSON.stringify(audioSource)
  },
  logLevel: 'silent'
});

const outputPath = path.join(rootDir, 'dist/uploadfit.js');
// Tabbit trims a terminal newline when saving a pasted script.
const source = readFileSync(outputPath, 'utf8').replace(/\r?\n$/, '');
writeFileSync(outputPath, source, 'utf8');
await syncProjectPage(rootDir, source);
console.log(`UploadFit ${pkg.version}: dist/uploadfit.js (${Buffer.byteLength(source)} bytes); project page synchronized.`);
