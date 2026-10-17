import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scriptHashes } from './sync-project-page.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFileSync(path.join(root, name), 'utf8');
for (const name of ['LICENSE', 'NOTICE', 'README.md', 'README.en.md', 'SECURITY.md', 'CONTRIBUTING.md',
  'package-lock.json', 'vendor/lamejs-1.2.1.tgz', 'licenses/NOTICE.md', 'licenses/RELINKING.md',
  'licenses/LGPL-3.0.txt', 'licenses/GPL-3.0.txt', 'licenses/lamejs-1.2.1-LICENSE.txt',
  'licenses/lamejs-embedded-COPYING-LGPL-2.0.txt', 'licenses/use-strict-1.0.1-LICENSE.txt']) {
  assert(existsSync(path.join(root, name)), `Missing release material: ${name}`);
}
for (const name of ['docs', 'tests', 'test-pages', 'scripts/audio-probe', 'src/debug-entry.js', 'src/index.js']) {
  assert(!existsSync(path.join(root, name)), `Internal material in release tree: ${name}`);
}
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
assert.equal(pkg.license, 'MIT');
assert.equal(lock.packages[''].license, pkg.license);
assert.equal(lock.packages[''].version, pkg.version);
assert.equal(lock.packages['node_modules/lamejs'].version, pkg.dependencies.lamejs);
assert.equal(lock.packages['node_modules/esbuild'].version, pkg.devDependencies.esbuild);
for (const [name, value] of Object.entries(lock.packages)) {
  if (value.resolved) assert(value.resolved.startsWith('https://registry.npmjs.org/'), `Non-public registry: ${name}`);
}

const bundle = read('dist/uploadfit.js');
assert.equal(read('project-page/uploadfit.js'), bundle, 'Project-page script differs from production');
const html = read('project-page/index.html');
const raw = html.match(/<textarea id="source-raw"[^>]*>([\s\S]*?)<\/textarea>/)?.[1];
assert(raw, 'Missing embedded script');
const unescape = (s) => s.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
assert.equal(unescape(raw), bundle, 'Copy button contains a stale script');
const policy = `script-src ${scriptHashes(html)};`;
assert(html.includes(policy), 'Page CSP does not match its scripts');
assert(read('project-page/_headers').includes(policy), 'HTTP CSP does not match its scripts');
for (const file of readdirSync(path.join(root, 'licenses'))) {
  assert.equal(read(`project-page/licenses/${file}`), read(`licenses/${file}`), `Stale page notice: ${file}`);
}
for (const file of ['LICENSE', 'NOTICE']) assert.equal(read(`project-page/${file}`), read(file));

const provenance = JSON.parse(read('licenses/provenance.json'));
const archive = readFileSync(path.join(root, provenance.sourceArchive));
assert.equal('sha1-' + createHash('sha1').update(archive).digest('base64'), provenance.npmIntegrity, 'Vendor archive integrity mismatch');
assert.equal(createHash('sha256').update(archive).digest('hex'), provenance.sourceArchiveSha256, 'Vendor archive SHA-256 mismatch');
const sha = createHash('sha256').update(bundle).digest('hex');
console.log(`Release consistency passed. Production SHA-256: ${sha}`);
