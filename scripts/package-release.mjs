import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) throw new Error('Commit the reviewed source and generated files before packaging.');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const revision = git('rev-parse', 'HEAD');
const name = `uploadfit-${pkg.version}-source.zip`;
const releaseDir = path.join(root, 'release');
mkdirSync(releaseDir, { recursive: true });
git('archive', '--format=zip', '--prefix=uploadfit/', '-o', path.join(releaseDir, name), 'HEAD');
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
writeFileSync(path.join(releaseDir, 'SHA256SUMS.txt'),
  `${hash(path.join(releaseDir, name))}  ${name}\n${hash(path.join(root, 'dist/uploadfit.js'))}  dist/uploadfit.js\n`);
writeFileSync(path.join(releaseDir, 'SOURCE.txt'), `Repository: https://github.com/TenrocZ/uploadfit\nRevision: ${revision}\nVersion: ${pkg.version}\n`);
console.log(`Complete source distribution: release/${name}\nRevision: ${revision}`);
