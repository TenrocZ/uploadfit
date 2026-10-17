import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { buildAudioWorkerImplementation } from './scripts/build-audio.mjs';
import { AUDIO_LICENSE_BANNER } from './scripts/license-banner.mjs';
import { syncProjectPage } from './scripts/sync-project-page.mjs';
import { userscriptHeader } from './scripts/userscript-header.mjs';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
// These upstream information strings are inert; keep runtime scans focused on
// executable network access. The unmodified source archive ships in vendor/.
const audioSource = (await buildAudioWorkerImplementation())
  .replaceAll('http://www.mp3dev.org/', 'embedded://lamejs')
  .replaceAll('https://github.com/zhuker/lamejs', 'embedded://lamejs')
  .replace(/[ \t]+$/gm, '');

const artifacts = {};
for (const [name, entryPoint, globalName, banner] of [
  ['uploadfit.user.js', 'userscript-entry.js', '__uploadfit_userscript__', userscriptHeader(pkg.version) + AUDIO_LICENSE_BANNER],
  ['uploadfit.js', 'production-entry.js', '__uploadfit_bundle__', AUDIO_LICENSE_BANNER]
]) {
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src', entryPoint)],
    outfile: path.join(rootDir, 'dist', name),
    bundle: true,
    format: 'iife',
    globalName,
    platform: 'browser',
    target: ['es2022'],
    minify: true,
    charset: 'utf8',
    sourcemap: false,
    legalComments: 'none',
    banner: { js: banner },
    define: {
      __UPLOADFIT_VERSION__: JSON.stringify(pkg.version),
      __UPLOADFIT_MODE__: JSON.stringify('production'),
      __UPLOADFIT_AUDIO_IMPLEMENTATION_SOURCE__: JSON.stringify(audioSource)
    },
    logLevel: 'silent'
  });

  const outputPath = path.join(rootDir, 'dist', name);
  // Tabbit trims a terminal newline when saving a pasted script.
  const source = readFileSync(outputPath, 'utf8').replace(/\r?\n$/, '');
  writeFileSync(outputPath, source, 'utf8');
  artifacts[name] = source;
  console.log(`UploadFit ${pkg.version}: dist/${name} (${Buffer.byteLength(source)} bytes).`);
}
writeFileSync(path.join(rootDir, 'dist/uploadfit.meta.js'), userscriptHeader(pkg.version), 'utf8');
await syncProjectPage(rootDir, artifacts);
console.log('Userscript, optional Tabbit script and project page synchronized.');
