#!/usr/bin/env node

/**
 * Read-only V2-S4 Tabbit A1 editor probe.
 *
 * The only supported invocation is `--dry-run`.  It uses the native raw-CDP
 * transport to inspect the official editor and emits a redacted JSON summary;
 * it never edits a control or saves the private script.
 */

import {
  attachTarget,
  connectTabbit,
  detachTarget,
  getTargets
} from './tabbit-raw-cdp.mjs';

const OFFICIAL_ORIGIN = 'https://web.tabbit.com';

function isOfficialEditorTarget(target) {
  if (target?.type !== 'page' || typeof target.url !== 'string') return false;
  try {
    const url = new URL(target.url);
    return url.origin === OFFICIAL_ORIGIN && url.pathname.startsWith('/skill/');
  } catch {
    return false;
  }
}

function editorSummaryExpression() {
  // This expression deliberately uses DOM reads only.  Keep all values that
  // can contain user data inside the page and return lengths/presence instead.
  return `(() => {
    const first = (selector) => document.querySelector(selector);
    const text = (node) => String(node?.textContent || '').replace(/\\s+/g, ' ').trim();
    const value = (node) => typeof node?.value === 'string' ? node.value : '';
    const presence = (node) => ({ found: Boolean(node), length: value(node).length });
    const name = first('input[placeholder="请输入妙招名称"]');
    const description = first('textarea[placeholder="请输入妙招描述"]');
    const textareaCandidates = [...document.querySelectorAll('textarea')]
      .filter((node) => node !== description);
    const noPlaceholder = textareaCandidates.filter((node) => {
      const placeholder = node.getAttribute('placeholder');
      return placeholder === null || placeholder.trim() === '';
    });
    const script = [...(noPlaceholder.length ? noPlaceholder : textareaCandidates)]
      .sort((left, right) => value(right).length - value(left).length)[0] || null;
    const matchUrl = first('input[placeholder="https://example.com"]');
    const save = [...document.querySelectorAll('button')]
      .find((node) => text(node) === '保存');

    const nearbyLabel = (node) => {
      if (!node) return '';
      const labelledBy = node.getAttribute('aria-labelledby');
      if (labelledBy) {
        const labelledText = labelledBy.split(/\\s+/)
          .map((id) => document.getElementById(id))
          .map(text)
          .filter(Boolean)
          .join(' ');
        if (labelledText) return labelledText.slice(0, 120);
      }
      const ariaLabel = node.getAttribute('aria-label');
      if (ariaLabel) return ariaLabel.trim().slice(0, 120);
      const explicitLabel = node.id
        && [...document.querySelectorAll('label')].find((label) => label.htmlFor === node.id);
      if (explicitLabel) return text(explicitLabel).slice(0, 120);
      const wrappingLabel = node.closest('label');
      if (wrappingLabel) return text(wrappingLabel).slice(0, 120);
      let parent = node.parentElement;
      for (let depth = 0; parent && depth < 3; depth += 1, parent = parent.parentElement) {
        const parentText = text(parent);
        if (parentText && parentText.length <= 160) return parentText.slice(0, 120);
      }
      return '';
    };
    const switchCandidates = [...document.querySelectorAll(
      '[role="switch"], input[type="checkbox"]'
    )];
    const autoRun = switchCandidates.find((node) => /自动运行|auto[- ]?run/i.test(nearbyLabel(node)))
      || switchCandidates[0]
      || null;
    const state = (node) => {
      if (!node) return null;
      const ariaChecked = node.getAttribute('aria-checked');
      if (ariaChecked === 'true' || ariaChecked === 'false') return ariaChecked === 'true';
      if (typeof node.checked === 'boolean') return node.checked;
      const dataState = node.getAttribute('data-state');
      if (dataState === 'checked' || dataState === 'on') return true;
      if (dataState === 'unchecked' || dataState === 'off') return false;
      return null;
    };
    const safeMatchUrl = () => {
      const raw = value(matchUrl).trim();
      if (!raw) return null;
      try {
        const parsed = new URL(raw, location.href);
        const local = parsed.protocol === 'http:'
          && parsed.hostname === '127.0.0.1'
          && parsed.port === '8765'
          && parsed.pathname.startsWith('/test-pages/');
        return local ? 'http://127.0.0.1:8765/test-pages/*' : '[REDACTED]';
      } catch {
        return '[REDACTED]';
      }
    };

    return {
      name: presence(name),
      description: presence(description),
      scriptLength: value(script).length,
      script: { found: Boolean(script), length: value(script).length },
      matchUrl: { found: Boolean(matchUrl), value: safeMatchUrl() },
      save: {
        found: Boolean(save),
        disabled: save ? save.disabled === true || save.getAttribute('aria-disabled') === 'true' : null
      },
      controlPresence: {
        name: Boolean(name),
        description: Boolean(description),
        script: Boolean(script),
        matchUrl: Boolean(matchUrl)
      },
      autoRun: {
        found: Boolean(autoRun),
        state: state(autoRun),
        label: nearbyLabel(autoRun)
      }
    };
  })()`;
}

function safeErrorCode(error) {
  if (error?.code === 'CDP_TIMEOUT') return 'CDP_TIMEOUT';
  const message = String(error?.message || '');
  if (/DevToolsActivePort|CDP open/i.test(message)) return 'TABBIT_CONNECTION_UNAVAILABLE';
  if (/official Tabbit editor target/i.test(message)) return 'EDITOR_NOT_FOUND';
  if (/Runtime\.evaluate/i.test(message)) return 'EDITOR_EVALUATION_FAILED';
  if (error?.code === 'SCRIPT_TOO_SHORT') return 'SCRIPT_TOO_SHORT';
  return 'PROBE_FAILED';
}

async function runDryRun() {
  let cdp = null;
  let session = null;
  try {
    ({ cdp } = await connectTabbit());
    const targets = await getTargets(cdp);
    const editor = targets.find(isOfficialEditorTarget);
    if (!editor) throw new Error('Official Tabbit editor target not found');
    session = await attachTarget(cdp, editor.targetId);
    const controls = await session.evaluateValue(editorSummaryExpression());
    if (!Number.isInteger(controls?.scriptLength) || controls.scriptLength <= 100_000) {
      const error = new Error('Script control is missing or unexpectedly short');
      error.code = 'SCRIPT_TOO_SHORT';
      throw error;
    }
    return {
      ok: true,
      mode: 'DRY_RUN_READ_ONLY',
      editor: { found: true, origin: 'web.tabbit.com' },
      pageTargetCount: targets.filter((target) => target?.type === 'page').length,
      controls
    };
  } finally {
    try {
      if (session) await detachTarget(cdp, session);
    } finally {
      if (cdp) await cdp.close();
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] !== '--dry-run') {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      mode: 'DRY_RUN_READ_ONLY',
      error: 'DRY_RUN_ONLY'
    })}\n`);
    process.exitCode = 2;
    return;
  }

  try {
    process.stdout.write(`${JSON.stringify(await runDryRun(), null, 2)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      mode: 'DRY_RUN_READ_ONLY',
      error: safeErrorCode(error)
    })}\n`);
    process.exitCode = 1;
  }
}

await main();
