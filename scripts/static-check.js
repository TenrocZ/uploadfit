import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

let artifactBytes = null;
if (!existsSync(buildPath)) {
  violations.push('dist/uploadfit.js is missing');
} else {
  // Product decision (2026-08-19): artifact size is informational only. Runtime
  // safety, a standalone IIFE and direct Tabbit paste/save/run remain hard gates.
  artifactBytes = statSync(buildPath).size;
}

if (violations.length > 0) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Static security check passed. Artifact bytes=${artifactBytes} (informational; no size gate).`);
}
