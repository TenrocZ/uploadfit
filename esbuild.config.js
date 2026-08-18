import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as esbuild from 'esbuild';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  readFileSync(path.join(rootDir, 'package.json'), 'utf8')
);
const modeArgument = process.argv.find((argument) => argument.startsWith('--mode='));
const mode = modeArgument?.slice('--mode='.length) === 'development'
  ? 'development'
  : 'production';

try {
  const result = await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/index.js')],
    outfile: path.join(rootDir, 'dist/uploadfit.js'),
    bundle: true,
    format: 'iife',
    globalName: '__uploadfit_debug_bundle__',
    platform: 'browser',
    target: ['es2022'],
    minify: mode === 'production',
    sourcemap: false,
    legalComments: 'none',
    define: {
      __UPLOADFIT_VERSION__: JSON.stringify(packageJson.version),
      __UPLOADFIT_MODE__: JSON.stringify(mode)
    },
    logLevel: 'silent'
  });

  const outputBytes = result.metafile
    ? Object.values(result.metafile.outputs)[0]?.bytes ?? 0
    : readFileSync(path.join(rootDir, 'dist/uploadfit.js')).byteLength;
  console.log(`UploadFit build complete: mode=${mode}, bytes=${outputBytes}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

