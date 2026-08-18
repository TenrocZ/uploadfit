import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILD_LIMIT_BYTES } from '../src/config.js';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourceDir = path.join(rootDir, 'src');
const buildPath = path.join(rootDir, 'dist', 'uploadfit.js');
const forbiddenPatterns = [
  { name: 'eval', pattern: /\beval\s*\(/ },
  { name: 'new Function', pattern: /\bnew\s+Function\s*\(/ },
  { name: 'fetch', pattern: /\bfetch\s*\(/ },
  { name: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/ },
  { name: 'innerHTML', pattern: /\binnerHTML\b/ }
];

function listJavaScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listJavaScriptFiles(entryPath) : [entryPath];
  }).filter((entryPath) => entryPath.endsWith('.js'));
}

const violations = [];
for (const filePath of listJavaScriptFiles(sourceDir)) {
  const source = readFileSync(filePath, 'utf8');
  for (const forbidden of forbiddenPatterns) {
    if (forbidden.pattern.test(source)) {
      violations.push(`${path.relative(rootDir, filePath)} contains ${forbidden.name}`);
    }
  }
}

if (!existsSync(buildPath)) {
  violations.push('dist/uploadfit.js is missing');
} else if (statSync(buildPath).size > BUILD_LIMIT_BYTES) {
  violations.push(`dist/uploadfit.js exceeds ${BUILD_LIMIT_BYTES} bytes`);
}

if (violations.length > 0) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Static security check passed.');
}

