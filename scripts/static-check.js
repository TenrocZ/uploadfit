import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUDIO_LICENSE_BANNER_PREFIX } from './license-banner.mjs';
import { userscriptHeader } from './userscript-header.mjs';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourceDir = path.join(rootDir, 'src');
const pkg = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
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
for (const name of ['uploadfit.js', 'uploadfit.user.js']) {
  const buildPath = path.join(rootDir, 'dist', name);
  const expectedPrefix = (name.endsWith('.user.js') ? userscriptHeader(pkg.version) : '') + AUDIO_LICENSE_BANNER_PREFIX;
  if (!existsSync(buildPath)) {
    violations.push(`dist/${name} is missing`);
  } else {
    // Artifact size is informational; runtime restrictions remain hard gates.
    artifactBytes = statSync(buildPath).size;
    artifactSha256 = createHash('sha256').update(readFileSync(buildPath)).digest('hex').toUpperCase();
    const artifact = readFileSync(buildPath, 'utf8');
    if (!artifact.startsWith(expectedPrefix)) {
      violations.push(`dist/${name} has an invalid metadata/license header`);
    }
    // The validated legal banner contains a source URL, not executable code.
    const runtimeArtifact = artifact.startsWith(expectedPrefix)
      ? artifact.slice(expectedPrefix.length) : artifact;
    for (const forbidden of forbiddenPatterns) {
      if (forbidden.pattern.test(runtimeArtifact)) {
        violations.push(`dist/${name} contains ${forbidden.name}`);
      }
    }
    if (name.endsWith('.user.js') && /LLMBridge|TabbitAiProvider/.test(runtimeArtifact)) {
      violations.push('Universal userscript contains a platform AI dependency');
    }
    console.log(`${name}: bytes=${artifactBytes}, SHA-256=${artifactSha256}`);
  }
}

if (violations.length > 0) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Static security check passed. Artifact bytes=${artifactBytes} (informational; no size gate). SHA-256=${artifactSha256}`);
  for (const finding of reviewedFindings) console.log(`Static review: ${finding}`);
}
