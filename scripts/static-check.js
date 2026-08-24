import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUDIO_LICENSE_BANNER_PREFIX } from './audio-probe/license-banner.mjs';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourceDir = path.join(rootDir, 'src');
const buildPath = path.join(rootDir, 'dist', 'uploadfit.js');
const testBuildPath = path.join(rootDir, 'dist', 'uploadfit.test.js');
const forbiddenPatterns = [
  { name: 'eval', pattern: /\beval\s*\(/ },
  { name: 'new Function', pattern: /\bnew\s+Function\s*\(/ },
  { name: 'fetch', pattern: /\bfetch\s*\(/ },
  { name: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/ },
  { name: 'WebSocket', pattern: /\bWebSocket\b/ },
  { name: 'EventSource', pattern: /\bEventSource\b/ },
  { name: 'sendBeacon', pattern: /\bsendBeacon\s*\(/ },
  { name: 'innerHTML', pattern: /\binnerHTML\b/ },
  { name: 'outerHTML', pattern: /\bouterHTML\b/ },
  { name: 'insertAdjacentHTML', pattern: /\binsertAdjacentHTML\s*\(/ },
  { name: 'document.cookie', pattern: /\bdocument\.cookie\b/ },
  { name: 'browser storage', pattern: /\b(?:localStorage|sessionStorage|indexedDB)\b/ },
  { name: 'remote URL or script source', pattern: /https?:\/\/|<script[^>]+src=/i },
  { name: 'credential or secret literal', pattern: /api[_-]?key|bearer\s+|private[_-]?key|client[_-]?secret/i }
];

const businessClickPattern = /\.click\s*\(/;
const ownUiClickFiles = new Set([
  path.join('src', 'ui', 'host.js'),
  path.join('src', 'ui', 'task-card.js')
]);

function listJavaScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listJavaScriptFiles(entryPath) : [entryPath];
  }).filter((entryPath) => entryPath.endsWith('.js'));
}

const violations = [];
const reviewedFindings = [];
for (const filePath of listJavaScriptFiles(sourceDir)) {
  const source = readFileSync(filePath, 'utf8');
  const relativePath = path.relative(rootDir, filePath);
  for (const forbidden of forbiddenPatterns) {
    if (forbidden.pattern.test(source)) {
      violations.push(`${relativePath} contains ${forbidden.name}`);
    }
  }
  if (businessClickPattern.test(source)) {
    if (ownUiClickFiles.has(relativePath)) {
      reviewedFindings.push(`${relativePath}: own UploadFit UI click only`);
    } else {
      violations.push(`${relativePath} contains an unapproved business click`);
    }
  }
}

let artifactBytes = null;
let artifactSha256 = null;
if (!existsSync(buildPath)) {
  violations.push('dist/uploadfit.js is missing');
} else {
  // Product decision (2026-08-19): artifact size is informational only. Runtime
  // safety, a standalone IIFE and direct Tabbit paste/save/run remain hard gates.
  artifactBytes = statSync(buildPath).size;
  artifactSha256 = createHash('sha256').update(readFileSync(buildPath)).digest('hex').toUpperCase();
  const artifact = readFileSync(buildPath, 'utf8');
  if (!artifact.startsWith(AUDIO_LICENSE_BANNER_PREFIX)) {
    violations.push('dist/uploadfit.js is missing the required lamejs license banner');
  }
  for (const forbidden of forbiddenPatterns) {
    if (forbidden.pattern.test(artifact)) {
      violations.push(`dist/uploadfit.js contains ${forbidden.name}`);
    }
  }
}

if (existsSync(testBuildPath)) {
  const testArtifact = readFileSync(testBuildPath, 'utf8');
  if (!testArtifact.startsWith(AUDIO_LICENSE_BANNER_PREFIX)) {
    violations.push('dist/uploadfit.test.js is missing the required lamejs license banner');
  }
}

if (violations.length > 0) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Static security check passed. Artifact bytes=${artifactBytes} (informational; no size gate). SHA-256=${artifactSha256}`);
  for (const finding of reviewedFindings) console.log(`Static review: ${finding}`);
}
