import { createHash } from 'node:crypto';
import { cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { transform } from 'esbuild';

const escapeHtml = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function replaceOnce(text, pattern, replacement) {
  const matches = [...text.matchAll(new RegExp(pattern.source, 'g'))];
  if (matches.length !== 1) throw new Error(`Expected one project-page marker: ${pattern}`);
  return text.replace(pattern, replacement);
}

export function scriptHashes(html) {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) =>
    `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`
  ).join(' ');
}

export async function syncProjectPage(root, artifacts) {
  const source = artifacts['uploadfit.user.js'];
  const pageDir = path.join(root, 'project-page');
  const indexPath = path.join(pageDir, 'index.html');
  let html = (await readFile(indexPath, 'utf8')).replace(/\r\n/g, '\n');
  const header = source.slice(0, source.indexOf('// ==/UserScript==') + '// ==/UserScript=='.length) + '\n';
  const formatted = header + (await transform(source.slice(header.length), { minify: false, charset: 'utf8', legalComments: 'inline' })).code;
  html = replaceOnce(html, /(<textarea id="source-raw"[^>]*>)[\s\S]*?(<\/textarea>)/,
    (_match, open, close) => open + escapeHtml(source) + close);
  html = replaceOnce(html, /(<code id="source-dev-preview">)[\s\S]*?(<\/code>)/,
    (_match, open, close) => open + escapeHtml(formatted) + close);
  html = replaceOnce(html, /<span><strong>[\d,]+<\/strong> bytes<\/span>/,
    `<span><strong>${Buffer.byteLength(source).toLocaleString('en-US')}</strong> bytes</span>`);
  html = replaceOnce(html, /<strong data-userscript-bytes>[^<]*<\/strong>/,
    `<strong data-userscript-bytes>${Buffer.byteLength(source).toLocaleString('en-US')} bytes</strong>`);
  html = replaceOnce(html, /<span><strong>[\d,]+<\/strong> 行阅读视图<\/span>/,
    `<span><strong>${formatted.trimEnd().split('\n').length.toLocaleString('en-US')}</strong> 行阅读视图</span>`);
  const hashes = scriptHashes(html);
  if (!hashes) throw new Error('Project page has no inline scripts');
  html = replaceOnce(html, /script-src [^;]+;/, `script-src ${hashes};`);
  await writeFile(indexPath, html, 'utf8');
  for (const [name, content] of Object.entries(artifacts)) {
    await writeFile(path.join(pageDir, name), content, 'utf8');
  }
  const headersPath = path.join(pageDir, '_headers');
  const headers = (await readFile(headersPath, 'utf8')).replace(/\r\n/g, '\n');
  await writeFile(headersPath, replaceOnce(headers, /script-src [^;]+;/, `script-src ${hashes};`), 'utf8');
  await cp(path.join(root, 'licenses'), path.join(pageDir, 'licenses'), { recursive: true });
  for (const name of ['LICENSE', 'NOTICE']) {
    await cp(path.join(root, name), path.join(pageDir, name));
  }
}
