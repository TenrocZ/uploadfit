import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function buildAudioWorkerImplementation() {
  const lameSource = await readFile(path.join(rootDir, 'node_modules/lamejs/lame.min.js'), 'utf8');
  const result = await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/audio/worker-adapter.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2022'],
    minify: true,
    charset: 'utf8',
    sourcemap: false,
    legalComments: 'none',
    write: false,
    plugins: [{
      name: 'inline-lamejs',
      setup(build) {
        build.onResolve({ filter: /^lamejs\/lame\.min\.js$/ }, () => ({
          path: 'lamejs', namespace: 'uploadfit-codec'
        }));
        build.onLoad({ filter: /.*/, namespace: 'uploadfit-codec' }, () => ({
          contents: `${lameSource}\nexport const Mp3Encoder = lamejs.Mp3Encoder;\n`,
          loader: 'js'
        }));
      }
    }],
    logLevel: 'silent'
  });
  return result.outputFiles[0].text;
}
