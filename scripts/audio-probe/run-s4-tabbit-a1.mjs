#!/usr/bin/env node

/**
 * V2-S4 Tabbit A1 official-editor driver.
 *
 * `--dry-run` is read-only. `--install` changes only the official private
 * script form through focused controls and trusted CDP input/mouse events.
 * Neither mode evaluates the UploadFit bundle in a tested page.
 */

import {
  attachTarget,
  connectTabbit,
  detachTarget,
  getBrowserVersion,
  getTargets
} from './tabbit-raw-cdp.mjs';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OFFICIAL_ORIGIN = 'https://web.tabbit.com';
const ROOT_DIR = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const EXPECTED_BUNDLE_BYTES = 421_347;
const EXPECTED_BUNDLE_SHA256 = '842FA9AB712C028AB1B9A94526B4FBEE175016A73E5B944A3987BFAC169A78D0';
const EXPECTED_MATCH_PATTERN = 'http://127.0.0.1:8765/test-pages/*';
const TARGET_NAME = 'UploadFit V2 S4 验收脚本';
const TARGET_DESCRIPTION = 'UploadFit V2 S4 当前生产包私有实机验收';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

function makeRunId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `s4a1-${stamp}-${randomBytes(4).toString('hex')}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function poll(read, accept, { timeoutMs = 30_000, intervalMs = 100 } = {}) {
  const startedAt = Date.now();
  let last;
  while (Date.now() - startedAt < timeoutMs) {
    last = await read();
    if (accept(last)) return last;
    await delay(intervalMs);
  }
  const error = new Error('Timed out waiting for the official editor state');
  error.code = 'EDITOR_STATE_TIMEOUT';
  error.last = last;
  throw error;
}

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

function controlExpression(kind, { includeValue = false, focusAndSelect = false } = {}) {
  if (!['name', 'description', 'script', 'matchUrl', 'autoRun', 'save'].includes(kind)) {
    throw new TypeError('Unsupported editor control');
  }
  return `(() => {
    const kind = ${JSON.stringify(kind)};
    const text = (node) => String(node?.textContent || '').replace(/\\s+/g, ' ').trim();
    const description = document.querySelector('textarea[placeholder="请输入妙招描述"]');
    const scriptCandidates = [...document.querySelectorAll('textarea')]
      .filter((node) => node !== description)
      .sort((left, right) => String(right.value || '').length - String(left.value || '').length);
    const nearbyLabel = (node) => {
      let parent = node;
      for (let depth = 0; parent && depth < 4; depth += 1, parent = parent.parentElement) {
        const value = String(parent.innerText || '').replace(/\\s+/g, ' ').trim();
        if (value && value.length <= 180) return value;
      }
      return '';
    };
    const switches = [...document.querySelectorAll('[role="switch"], input[type="checkbox"]')];
    const controls = {
      name: document.querySelector('input[placeholder="请输入妙招名称"]'),
      description,
      script: scriptCandidates[0] || null,
      matchUrl: document.querySelector('input[placeholder="https://example.com"]'),
      autoRun: switches.find((node) => /自动运行|auto[- ]?run/i.test(nearbyLabel(node))) || switches[0] || null,
      save: [...document.querySelectorAll('button')].find((node) => text(node) === '保存') || null
    };
    const node = controls[kind];
    if (!node) return { found: false };
    ${focusAndSelect ? `node.scrollIntoView({ block: 'center', inline: 'center' });
    node.focus();
    if (typeof node.select === 'function') node.select();` : ''}
    const rect = node.getBoundingClientRect();
    const ariaChecked = node.getAttribute?.('aria-checked');
    const state = ariaChecked === 'true'
      ? true
      : ariaChecked === 'false'
        ? false
        : typeof node.checked === 'boolean'
          ? node.checked
          : null;
    const currentValue = typeof node.value === 'string' ? node.value : '';
    return {
      found: true,
      length: currentValue.length,
      ${includeValue ? 'value: currentValue,' : ''}
      state,
      disabled: node.disabled === true || node.getAttribute?.('aria-disabled') === 'true',
      rect: {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        width: rect.width,
        height: rect.height
      }
    };
  })()`;
}

async function readControl(session, kind, options = {}) {
  return session.evaluateValue(controlExpression(kind, options));
}

async function replaceControlText(session, kind, text, timeoutMs = 30_000) {
  const focused = await readControl(session, kind, { focusAndSelect: true });
  if (!focused?.found) {
    const error = new Error(`Official editor control missing: ${kind}`);
    error.code = 'EDITOR_CONTROL_MISSING';
    throw error;
  }
  await session.send('Input.insertText', { text }, { timeoutMs });
  return poll(
    () => readControl(session, kind),
    (current) => current?.found && current.length === text.length,
    { timeoutMs, intervalMs: 100 }
  );
}

async function clickControl(session, kind) {
  // The script editor is tall; switches and Save are commonly outside the
  // viewport after inserting the bundle. Scroll/focus before reading the box
  // so the trusted mouse event lands on the actual control.
  const control = await readControl(session, kind, { focusAndSelect: true });
  if (!control?.found || control.disabled) {
    const error = new Error(`Official editor control unavailable: ${kind}`);
    error.code = 'EDITOR_CONTROL_UNAVAILABLE';
    throw error;
  }
  const { x, y, width, height } = control.rect ?? {};
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    const error = new Error(`Official editor control has no click box: ${kind}`);
    error.code = 'EDITOR_CONTROL_UNAVAILABLE';
    throw error;
  }
  await session.click({ x, y });
}

function persistedEditorExpression({ includeScript = false } = {}) {
  return `(() => {
    const description = document.querySelector('textarea[placeholder="请输入妙招描述"]');
    const script = [...document.querySelectorAll('textarea')]
      .filter((node) => node !== description)
      .sort((left, right) => String(right.value || '').length - String(left.value || '').length)[0] || null;
    const text = (node) => String(node?.textContent || '').replace(/\\s+/g, ' ').trim();
    const nearbyLabel = (node) => {
      let parent = node;
      for (let depth = 0; parent && depth < 4; depth += 1, parent = parent.parentElement) {
        const value = String(parent.innerText || '').replace(/\\s+/g, ' ').trim();
        if (value && value.length <= 180) return value;
      }
      return '';
    };
    const switches = [...document.querySelectorAll('[role="switch"], input[type="checkbox"]')];
    const autoRun = switches.find((node) => /自动运行|auto[- ]?run/i.test(nearbyLabel(node))) || switches[0] || null;
    const ariaChecked = autoRun?.getAttribute?.('aria-checked');
    const autoRunState = ariaChecked === 'true'
      ? true
      : ariaChecked === 'false'
        ? false
        : typeof autoRun?.checked === 'boolean'
          ? autoRun.checked
          : null;
    const bodyText = String(document.body?.innerText || '').replace(/\\s+/g, ' ');
    const saveSignals = ['保存成功', '修改成功', '已保存', '保存完成']
      .filter((signal) => bodyText.includes(signal));
    const scriptValue = typeof script?.value === 'string' ? script.value : '';
    return {
      readyState: document.readyState,
      name: document.querySelector('input[placeholder="请输入妙招名称"]')?.value || '',
      description: description?.value || '',
      matchUrl: document.querySelector('input[placeholder="https://example.com"]')?.value || '',
      scriptLength: scriptValue.length,
      ${includeScript ? 'scriptValue,' : ''}
      autoRun: autoRunState,
      saveSignals
    };
  })()`;
}

async function readPersistedEditor(session, options = {}) {
  return session.evaluateValue(persistedEditorExpression(options), { timeoutMs: 120_000 });
}

async function loadBundle() {
  const bytes = await readFile(path.join(ROOT_DIR, 'dist', 'uploadfit.js'));
  const actualSha256 = sha256(bytes);
  if (bytes.length !== EXPECTED_BUNDLE_BYTES || actualSha256 !== EXPECTED_BUNDLE_SHA256) {
    const error = new Error('Production bundle does not match the frozen S4 artifact');
    error.code = 'BUNDLE_MISMATCH';
    throw error;
  }
  return { bytes, text: bytes.toString('utf8'), sha256: actualSha256 };
}

async function runInstall() {
  const startedAt = new Date().toISOString();
  const runId = makeRunId();
  const bundle = await loadBundle();
  let cdp = null;
  let session = null;
  try {
    ({ cdp } = await connectTabbit({ timeoutMs: 120_000 }));
    const version = await getBrowserVersion(cdp);
    const targets = await getTargets(cdp);
    const editor = targets.find(isOfficialEditorTarget);
    if (!editor) {
      const error = new Error('Official Tabbit editor target not found');
      error.code = 'EDITOR_NOT_FOUND';
      throw error;
    }
    session = await attachTarget(cdp, editor.targetId, { timeoutMs: 30_000 });
    await session.send('Page.enable');

    const before = await session.evaluateValue(editorSummaryExpression());
    if (!before?.controlPresence?.name
      || !before.controlPresence.description
      || !before.controlPresence.script
      || !before.controlPresence.matchUrl
      || !before.autoRun?.found
      || !before.save?.found) {
      const error = new Error('Official editor controls are incomplete');
      error.code = 'EDITOR_CONTROL_MISSING';
      throw error;
    }

    const currentForm = await readPersistedEditor(session, { includeScript: true });
    const currentScriptBytes = Buffer.from(currentForm.scriptValue, 'utf8');
    if (currentForm.name !== TARGET_NAME) {
      await replaceControlText(session, 'name', TARGET_NAME);
    }
    if (currentForm.description !== TARGET_DESCRIPTION) {
      await replaceControlText(session, 'description', TARGET_DESCRIPTION);
    }
    if (currentScriptBytes.length !== bundle.bytes.length
      || sha256(currentScriptBytes) !== bundle.sha256) {
      await replaceControlText(session, 'script', bundle.text, 120_000);
    }
    if (currentForm.matchUrl !== EXPECTED_MATCH_PATTERN) {
      await replaceControlText(session, 'matchUrl', EXPECTED_MATCH_PATTERN);
    }

    let autoRun = await readControl(session, 'autoRun');
    let autoRunRearmed = false;
    if (autoRun.state === true) {
      // Re-register the current script with Tabbit after browser upgrades or
      // prior temporary-target teardown. Both transitions are real clicks in
      // the official editor and the final persisted state remains enabled.
      await clickControl(session, 'autoRun');
      await poll(
        () => readControl(session, 'autoRun'),
        (current) => current?.state === false,
        { timeoutMs: 10_000 }
      );
      autoRunRearmed = true;
    }
    autoRun = await readControl(session, 'autoRun');
    if (autoRun.state !== true) {
      await clickControl(session, 'autoRun');
      autoRun = await poll(
        () => readControl(session, 'autoRun'),
        (current) => current?.state === true,
        { timeoutMs: 10_000 }
      );
    }

    const beforeSave = await readPersistedEditor(session, { includeScript: true });
    const beforeSaveBytes = Buffer.from(beforeSave.scriptValue, 'utf8');
    const beforeSaveSha256 = sha256(beforeSaveBytes);
    if (beforeSave.name !== TARGET_NAME
      || beforeSave.description !== TARGET_DESCRIPTION
      || beforeSave.matchUrl !== EXPECTED_MATCH_PATTERN
      || beforeSave.autoRun !== true
      || beforeSaveBytes.length !== bundle.bytes.length
      || beforeSaveSha256 !== bundle.sha256) {
      const error = new Error('Official editor form does not exactly match the S4 artifact');
      error.code = 'EDITOR_FORM_MISMATCH';
      throw error;
    }

    await clickControl(session, 'save');
    const saveObservedAt = new Date().toISOString();
    let afterClick = null;
    try {
      afterClick = await poll(
        () => readPersistedEditor(session),
        (current) => current?.saveSignals?.length > 0,
        { timeoutMs: 8_000, intervalMs: 100 }
      );
    } catch (error) {
      if (error?.code !== 'EDITOR_STATE_TIMEOUT') throw error;
      afterClick = await readPersistedEditor(session);
    }

    // Reloading the official editor forces a server-backed read. Exact SHA
    // equality after this boundary is the authoritative persistence proof.
    await delay(2_000);
    await session.send('Page.reload', { ignoreCache: true }, { timeoutMs: 30_000 });
    await poll(
      () => readPersistedEditor(session),
      (current) => current?.readyState === 'complete'
        && current.scriptLength === bundle.text.length
        && current.name === TARGET_NAME
        && current.description === TARGET_DESCRIPTION
        && current.matchUrl === EXPECTED_MATCH_PATTERN
        && current.autoRun === true,
      { timeoutMs: 60_000, intervalMs: 250 }
    );
    const persisted = await poll(
      () => readPersistedEditor(session, { includeScript: true }),
      (current) => {
        const currentBytes = Buffer.from(current?.scriptValue ?? '', 'utf8');
        return current?.name === TARGET_NAME
          && current.description === TARGET_DESCRIPTION
          && current.matchUrl === EXPECTED_MATCH_PATTERN
          && current.autoRun === true
          && currentBytes.length === bundle.bytes.length
          && sha256(currentBytes) === bundle.sha256;
      },
      { timeoutMs: 60_000, intervalMs: 250 }
    );
    const persistedBytes = Buffer.from(persisted.scriptValue, 'utf8');
    const persistedSha256 = sha256(persistedBytes);
    const exact = persisted.name === TARGET_NAME
      && persisted.description === TARGET_DESCRIPTION
      && persisted.matchUrl === EXPECTED_MATCH_PATTERN
      && persisted.autoRun === true
      && persistedBytes.length === bundle.bytes.length
      && persistedSha256 === bundle.sha256;
    if (!exact) {
      const error = new Error('Saved official private script failed exact persistence check');
      error.code = 'EDITOR_PERSISTENCE_MISMATCH';
      throw error;
    }

    return {
      stage: 'V2-S4',
      phase: 'PHASE_2A1_INSTALL',
      status: 'SAVED_PENDING_LR1_AUTORUN',
      runId,
      startedAt,
      completedAt: new Date().toISOString(),
      browser: {
        product: version.product,
        protocolVersion: version.protocolVersion,
        connection: 'TABBIT_REMOTE_CDP_DEVTOOLS_ACTIVE_PORT'
      },
      editor: {
        kind: 'OFFICIAL_PRIVATE_SCRIPT_EDITOR',
        url: 'https://web.tabbit.com/skill/[REDACTED]',
        shared: false,
        formInteraction: ['DOM_FOCUS_SELECT', 'CDP_INPUT_INSERT_TEXT', 'CDP_TRUSTED_MOUSE_CLICK'],
        saveClicked: true,
        saveObservedAt,
        visibleSaveSignals: afterClick?.saveSignals ?? [],
        persistedAfterOfficialEditorReload: true,
        autoRun: persisted.autoRun,
        autoRunRearmed,
        matchPattern: EXPECTED_MATCH_PATTERN
      },
      bundle: {
        bytes: bundle.bytes.length,
        sha256: bundle.sha256,
        format: 'single production IIFE'
      },
      readback: {
        scriptCharacters: persisted.scriptLength,
        utf8Bytes: persistedBytes.length,
        sha256: persistedSha256,
        exactBundleMatch: exact,
        nameExact: persisted.name === TARGET_NAME,
        descriptionExact: persisted.description === TARGET_DESCRIPTION
      },
      previous: {
        scriptCharacters: before.scriptLength,
        autoRun: before.autoRun.state
      },
      privacy: {
        scriptBodyRecorded: false,
        privateScriptIdRecorded: false,
        accountIdentifiersRecorded: false,
        localAbsolutePathRecorded: false,
        audioDataHandled: false
      },
      cleanup: {
        editorSessionDetached: true,
        websocketClosed: true,
        browserClosed: false,
        autoRunLeftEnabledForPendingLr: true
      }
    };
  } finally {
    try {
      if (session) await detachTarget(cdp, session);
    } finally {
      if (cdp) await cdp.close();
    }
  }
}

function pageStateExpression() {
  return `(() => {
    const session = globalThis.__uploadfit_session__;
    const build = globalThis.__uploadfit_build_info__;
    const scriptSources = [...document.scripts].map((node) => node.getAttribute('src') || 'INLINE');
    return {
      readyState: document.readyState,
      hostCount: document.querySelectorAll('[data-uploadfit-ui-host]').length,
      sessionPresent: Boolean(session),
      sessionId: typeof session?.sessionId === 'string' ? session.sessionId : null,
      sessionActive: session?.active === true,
      observerPresent: Boolean(session?.observer),
      controllerPresent: Boolean(session?.controller),
      inputCount: session?.inputs instanceof Set ? session.inputs.size : null,
      build: build ? { version: build.version, mode: build.mode } : null,
      pageOwnBundleScript: scriptSources.some((source) => /(?:^|\\/)dist\\/uploadfit(?:\\.test)?\\.js(?:[?#]|$)/i.test(source)),
      pageScriptKinds: scriptSources.map((source) => {
        if (source === 'INLINE') return 'INLINE';
        try {
          const url = new URL(source, location.href);
          if (url.origin === 'http://127.0.0.1:8765') return 'LOCAL_TEST_RESOURCE';
          return 'EXTERNAL_RESOURCE';
        } catch {
          return 'UNPARSEABLE_RESOURCE';
        }
      }),
      forbiddenDebugGlobals: [
        '__uploadfit_debug_bundle__',
        '__uploadfit_debug__',
        '__uploadfit_test_api__'
      ].filter((key) => Object.prototype.hasOwnProperty.call(globalThis, key))
    };
  })()`;
}

function sessionFingerprint(value) {
  return typeof value === 'string'
    ? createHash('sha256').update(value).digest('hex').slice(0, 16)
    : null;
}

function sanitizePageState(state) {
  const { sessionId, ...safe } = state;
  return { ...safe, sessionFingerprint: sessionFingerprint(sessionId) };
}

function createPageTelemetry(cdp, sessionId) {
  const requests = [];
  const errors = [];
  const off = [
    cdp.on('Network.requestWillBeSent', (params, message) => {
      if (message.sessionId !== sessionId) return;
      const rawUrl = String(params.request?.url ?? '');
      let kind = 'EXTERNAL';
      let externalOrigin = null;
      let initiatorKind = params.initiator?.type ?? 'unknown';
      try {
        const url = new URL(rawUrl);
        if (url.origin === 'http://127.0.0.1:8765') kind = 'LOCAL_TEST_RESOURCE';
        else if (url.protocol === 'blob:') kind = 'LOCAL_BLOB';
        else if (url.protocol === 'data:') kind = 'INLINE_DATA';
        else if (url.protocol === 'chrome-extension:') kind = 'TABBIT_EXTENSION_RESOURCE';
        else if (url.protocol === 'devtools:') kind = 'DEVTOOLS_RESOURCE';
        else if ((url.protocol === 'https:' || url.protocol === 'http:')
          && /(?:^|\.)tabbit\.com$/i.test(url.hostname)) kind = 'TABBIT_PLATFORM_NETWORK';
        if (kind === 'EXTERNAL' && ['http:', 'https:'].includes(url.protocol)) {
          externalOrigin = url.origin;
        }
      } catch {}
      const callFrameUrl = params.initiator?.stack?.callFrames?.[0]?.url ?? '';
      if (callFrameUrl) {
        try {
          const callFrame = new URL(callFrameUrl);
          if (callFrame.protocol === 'chrome-extension:') initiatorKind += ':TABBIT_EXTENSION';
          else if (callFrame.origin === 'http://127.0.0.1:8765') initiatorKind += ':LOCAL_TEST_PAGE';
          else if (/(?:^|\.)tabbit\.com$/i.test(callFrame.hostname)) initiatorKind += ':TABBIT_PLATFORM';
          else initiatorKind += ':OTHER_ORIGIN';
        } catch {
          initiatorKind += ':ANONYMOUS_OR_INLINE';
        }
      }
      if (kind === 'EXTERNAL' && initiatorKind.endsWith(':TABBIT_PLATFORM')) {
        kind = 'TABBIT_PLATFORM_TELEMETRY';
      }
      const postData = String(params.request?.postData ?? '');
      requests.push({
        kind,
        externalOrigin,
        initiatorKind,
        hasPostData: postData.length > 0,
        postDataBytes: Buffer.byteLength(postData, 'utf8'),
        sensitivePayloadMarkers: /(?:data:audio|base64|RIFF|ID3|audio\/(?:wav|mpeg|mp4)|\.wav|\.mp3|\.m4a)/i.test(postData),
        method: params.request?.method ?? null,
        resourceType: params.type ?? null
      });
    }),
    cdp.on('Runtime.exceptionThrown', (params, message) => {
      if (message.sessionId !== sessionId) return;
      errors.push({ kind: 'UNCAUGHT_EXCEPTION', text: params.exceptionDetails?.text ?? null });
    }),
    cdp.on('Runtime.consoleAPICalled', (params, message) => {
      if (message.sessionId !== sessionId || params.type !== 'error') return;
      errors.push({ kind: 'CONSOLE_ERROR' });
    }),
    cdp.on('Log.entryAdded', (params, message) => {
      if (message.sessionId !== sessionId || params.entry?.level !== 'error') return;
      const source = params.entry?.source ?? null;
      // A missing local favicon is a page-resource diagnostic, not an ESM or
      // product runtime failure. JavaScript/Worker errors remain blocking.
      if (!['javascript', 'worker'].includes(source)) return;
      errors.push({ kind: 'LOG_ERROR', source });
    })
  ];
  return {
    requests,
    errors,
    stop() { for (const remove of off) remove(); }
  };
}

async function attachInstrumentedTarget(cdp, targetId, options = {}) {
  // Tabbit runs private scripts for the active visible tab. A CDP-created
  // background target is not a valid substitute for that user lifecycle.
  await cdp.send('Target.activateTarget', { targetId });
  const session = await attachTarget(cdp, targetId);
  await session.send('Page.enable');
  await session.send('Runtime.enable');
  await session.send('Network.enable');
  try { await session.send('Log.enable'); } catch {}
  const telemetry = createPageTelemetry(cdp, session.sessionId);
  return {
    targetId,
    session,
    telemetry,
    ownsTarget: options.ownsTarget === true,
    restoreUrl: options.restoreUrl ?? null
  };
}

async function instrumentTarget(cdp, targetId, url, options = {}) {
  const target = await attachInstrumentedTarget(cdp, targetId, options);
  await target.session.send('Page.navigate', { url });
  await cdp.send('Target.activateTarget', { targetId });
  return target;
}

async function createInstrumentedTarget(cdp, url) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  return instrumentTarget(cdp, targetId, url, { ownsTarget: true });
}

async function openUserGestureTarget(cdp, parentTarget, url) {
  const before = new Set((await getTargets(cdp)).map((target) => target.targetId));
  const opened = await parentTarget.session.evaluateValue(
    `window.open(${JSON.stringify(url)}, '_blank') !== null`,
    { userGesture: true }
  );
  if (!opened) {
    const error = new Error('User-gesture new tab was blocked');
    error.code = 'LR1_NEW_TAB_BLOCKED';
    throw error;
  }
  const created = await poll(
    async () => (await getTargets(cdp)).find((target) => target.type === 'page'
      && !before.has(target.targetId)
      && target.url.startsWith(url)),
    Boolean,
    { timeoutMs: 30_000, intervalMs: 100 }
  );
  return attachInstrumentedTarget(cdp, created.targetId, { ownsTarget: true });
}

async function waitForProductionSession(session, previousSessionId = null) {
  return poll(
    () => session.evaluateValue(pageStateExpression()),
    (state) => state?.readyState === 'complete'
      && state.hostCount === 1
      && state.sessionPresent === true
      && state.sessionActive === true
      && state.observerPresent === true
      && state.controllerPresent === true
      && state.build?.mode === 'production'
      && state.pageOwnBundleScript === false
      && state.forbiddenDebugGlobals?.length === 0
      && (!previousSessionId || state.sessionId !== previousSessionId),
    { timeoutMs: 60_000, intervalMs: 100 }
  );
}

async function waitForLr1Gate(session, gate, previousSessionId = null) {
  try {
    return await waitForProductionSession(session, previousSessionId);
  } catch (error) {
    error.gate = gate;
    throw error;
  }
}

function summarizeTelemetry(telemetry) {
  const byKind = {};
  for (const request of telemetry.requests) {
    byKind[request.kind] = (byKind[request.kind] ?? 0) + 1;
  }
  return {
    requestCount: telemetry.requests.length,
    byKind,
    externalRequests: byKind.EXTERNAL ?? 0,
    externalOrigins: [...new Set(telemetry.requests
      .filter((request) => request.kind === 'EXTERNAL')
      .map((request) => request.externalOrigin ?? 'NON_HTTP_EXTERNAL'))],
    externalInitiators: [...new Set(telemetry.requests
      .filter((request) => request.kind === 'EXTERNAL')
      .map((request) => request.initiatorKind))],
    externalSensitivePayloadMarkers: telemetry.requests
      .filter((request) => request.kind === 'EXTERNAL')
      .some((request) => request.sensitivePayloadMarkers),
    tabbitPlatformRequests: (byKind.TABBIT_PLATFORM_NETWORK ?? 0)
      + (byKind.TABBIT_PLATFORM_TELEMETRY ?? 0),
    tabbitPlatformTelemetryOrigins: [...new Set(telemetry.requests
      .filter((request) => request.kind === 'TABBIT_PLATFORM_TELEMETRY')
      .map((request) => request.externalOrigin)
      .filter(Boolean))],
    runtimeErrors: telemetry.errors
  };
}

async function closeInstrumentedTarget(cdp, target) {
  target.telemetry.stop();
  if (!target.ownsTarget && target.restoreUrl) {
    try {
      await target.session.send('Page.navigate', { url: target.restoreUrl });
      await poll(
        () => target.session.evaluateValue('document.readyState'),
        (state) => state === 'complete',
        { timeoutMs: 30_000, intervalMs: 100 }
      );
    } finally {
      try { await detachTarget(cdp, target.session); } catch {}
    }
    return true;
  }
  try { await detachTarget(cdp, target.session); } catch {}
  const result = await cdp.send('Target.closeTarget', { targetId: target.targetId });
  return result.success === true;
}

async function runLr1() {
  const startedAt = new Date().toISOString();
  const runId = makeRunId().replace('s4a1-', 's4lr1-');
  const bundle = await loadBundle();
  const probeUrl = 'http://127.0.0.1:8765/test-pages/probe.html';
  let cdp = null;
  const targets = [];
  try {
    ({ cdp } = await connectTabbit({ timeoutMs: 120_000 }));
    const version = await getBrowserVersion(cdp);

    const existingTargets = await getTargets(cdp);
    const editorTarget = existingTargets.find(isOfficialEditorTarget);
    if (!editorTarget) {
      const error = new Error('Official Tabbit editor target not found');
      error.code = 'EDITOR_NOT_FOUND';
      throw error;
    }
    const firstTarget = await instrumentTarget(cdp, editorTarget.targetId, probeUrl, {
      ownsTarget: false,
      restoreUrl: editorTarget.url
    });
    targets.push(firstTarget);
    const firstRaw = await waitForLr1Gate(firstTarget.session, 'FIRST_LOAD');
    const firstSessionId = firstRaw.sessionId;
    const first = sanitizePageState(firstRaw);

    try {
      await firstTarget.session.evaluateValue(
        'location.reload(); true',
        { userGesture: true, timeoutMs: 10_000 }
      );
    } catch (error) {
      // Context destruction is the expected completion boundary for reload.
      if (!/context|closed|destroyed/i.test(String(error?.message ?? ''))) throw error;
    }
    const refreshRaw = await waitForLr1Gate(firstTarget.session, 'REFRESH', firstSessionId);
    const refresh = sanitizePageState(refreshRaw);

    const allFingerprints = [first.sessionFingerprint, refresh.sessionFingerprint];
    if (new Set(allFingerprints).size !== allFingerprints.length) {
      const error = new Error('Official auto-run did not create isolated sessions');
      error.code = 'LR1_SESSION_REUSE';
      throw error;
    }
    if (firstTarget.telemetry.errors.length) {
      const error = new Error('Runtime or module errors were observed');
      error.code = 'LR1_RUNTIME_ERROR';
      throw error;
    }

    const firstTelemetry = summarizeTelemetry(firstTarget.telemetry);
    if (firstTelemetry.externalRequests !== 0) {
      const error = new Error('Unexpected external request in LR1');
      error.code = 'LR1_EXTERNAL_REQUEST';
      error.network = {
        requestCount: firstTelemetry.requestCount,
        byKind: firstTelemetry.byKind,
        externalRequests: firstTelemetry.externalRequests,
        externalOrigins: firstTelemetry.externalOrigins,
        externalInitiators: firstTelemetry.externalInitiators,
        externalSensitivePayloadMarkers: firstTelemetry.externalSensitivePayloadMarkers
      };
      throw error;
    }

    const result = {
      stage: 'V2-S4',
      phase: 'PHASE_2A1',
      check: 'LR1',
      status: 'PASS',
      runId,
      startedAt,
      completedAt: new Date().toISOString(),
      browser: {
        product: version.product,
        protocolVersion: version.protocolVersion,
        connection: 'TABBIT_REMOTE_CDP_DEVTOOLS_ACTIVE_PORT'
      },
      officialPrivateScript: {
        installedViaOfficialEditor: true,
        editorUrl: 'https://web.tabbit.com/skill/[REDACTED]',
        shared: false,
        partialMatch: EXPECTED_MATCH_PATTERN,
        autoRun: true,
        directBundleInjectionIntoProbePage: false
      },
      bundle: {
        bytes: bundle.bytes.length,
        sha256: bundle.sha256,
        format: 'single production IIFE'
      },
      probePage: {
        pageOwnBundleScript: false,
        first: {
          ...first,
          duplicateHost: first.hostCount !== 1
        },
        refresh: {
          ...refresh,
          duplicateHost: refresh.hostCount !== 1,
          freshSession: refresh.sessionFingerprint !== first.sessionFingerprint
        },
        newTab: 'DEFERRED_TO_LR9'
      },
      network: {
        firstAndRefresh: firstTelemetry,
        productRuntimeRemoteDependencies: 0
      },
      privacy: {
        scriptBodyRecorded: false,
        privateScriptIdRecorded: false,
        sessionIdsRecorded: false,
        accountIdentifiersRecorded: false,
        localAbsolutePathRecorded: false
      },
      cleanup: {
        temporaryTargetsClosed: false,
        editorLeftOpen: true,
        officialPrivateScriptLeftEnabledForPendingLr: true,
        browserClosed: false
      }
    };

    const closed = [];
    while (targets.length) closed.push(await closeInstrumentedTarget(cdp, targets.pop()));
    result.cleanup.temporaryTargetsClosed = closed.every(Boolean);
    return result;
  } finally {
    while (targets.length && cdp) {
      try { await closeInstrumentedTarget(cdp, targets.pop()); } catch {}
    }
    if (cdp) await cdp.close();
  }
}

function parsePcmWav(bytes) {
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF'
    || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw Object.assign(new Error('Fixture is not RIFF/WAVE'), { code: 'LR3_FIXTURE_INVALID' });
  }
  let offset = 12;
  let format = null;
  let dataBytes = null;
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const payload = offset + 8;
    if (payload + size > bytes.length) break;
    if (type === 'fmt ' && size >= 16) {
      format = {
        codecTag: bytes.readUInt16LE(payload),
        channels: bytes.readUInt16LE(payload + 2),
        sampleRate: bytes.readUInt32LE(payload + 4),
        byteRate: bytes.readUInt32LE(payload + 8),
        blockAlign: bytes.readUInt16LE(payload + 12),
        bitDepth: bytes.readUInt16LE(payload + 14)
      };
    }
    if (type === 'data') dataBytes = size;
    offset = payload + size + (size % 2);
  }
  if (!format || format.codecTag !== 1 || !Number.isFinite(dataBytes)) {
    throw Object.assign(new Error('Fixture is not supported PCM WAV'), { code: 'LR3_FIXTURE_INVALID' });
  }
  return {
    container: 'wav',
    codec: 'pcm',
    bytes: bytes.length,
    dataBytes,
    durationMs: dataBytes / format.byteRate * 1000,
    channels: format.channels,
    sampleRate: format.sampleRate,
    bitDepth: format.bitDepth
  };
}

function synchsafe(bytes, offset) {
  return ((bytes[offset] & 0x7f) << 21)
    | ((bytes[offset + 1] & 0x7f) << 14)
    | ((bytes[offset + 2] & 0x7f) << 7)
    | (bytes[offset + 3] & 0x7f);
}

function parseMp3Independently(bytes) {
  const bitratesMpeg1Layer3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const bitratesMpeg2Layer3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const sampleRates = {
    3: [44_100, 48_000, 32_000],
    2: [22_050, 24_000, 16_000],
    0: [11_025, 12_000, 8_000]
  };
  let offset = bytes.length >= 10 && bytes.toString('ascii', 0, 3) === 'ID3'
    ? 10 + synchsafe(bytes, 6)
    : 0;
  let frames = 0;
  let durationMs = 0;
  let first = null;
  while (offset + 4 <= bytes.length) {
    const a = bytes[offset];
    const b = bytes[offset + 1];
    if (a !== 0xff || (b & 0xe0) !== 0xe0) {
      if (frames > 0) break;
      offset += 1;
      continue;
    }
    const versionBits = (b >> 3) & 0x03;
    const layerBits = (b >> 1) & 0x03;
    const bitrateIndex = (bytes[offset + 2] >> 4) & 0x0f;
    const sampleRateIndex = (bytes[offset + 2] >> 2) & 0x03;
    const padding = (bytes[offset + 2] >> 1) & 0x01;
    if (![0, 2, 3].includes(versionBits) || layerBits !== 1
      || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) break;
    const bitrate = (versionBits === 3 ? bitratesMpeg1Layer3 : bitratesMpeg2Layer3)[bitrateIndex];
    const sampleRate = sampleRates[versionBits][sampleRateIndex];
    const samplesPerFrame = versionBits === 3 ? 1152 : 576;
    const frameBytes = Math.floor((versionBits === 3 ? 144 : 72) * bitrate * 1000 / sampleRate) + padding;
    if (frameBytes < 4 || offset + frameBytes > bytes.length) break;
    const channelMode = (bytes[offset + 3] >> 6) & 0x03;
    first ??= { bitrateKbps: bitrate, sampleRate, channels: channelMode === 3 ? 1 : 2 };
    frames += 1;
    durationMs += samplesPerFrame / sampleRate * 1000;
    offset += frameBytes;
  }
  if (frames < 2 || !first) {
    throw Object.assign(new Error('Output is not independently decodable MP3'), { code: 'LR3_MP3_INVALID' });
  }
  return {
    container: 'mp3',
    codec: 'mp3',
    signature: bytes.toString('ascii', 0, 3) === 'ID3' ? 'ID3' : 'MPEG_FRAME_SYNC',
    bytes: bytes.length,
    frames,
    durationMs,
    averageBitrateKbps: bytes.length * 8 / durationMs,
    ...first
  };
}

function storageExpression() {
  return `(async () => {
    const readStore = (store) => Object.keys(store).sort().map((key) => [key, String(store.getItem(key) || '').length]);
    const databases = typeof indexedDB?.databases === 'function'
      ? (await indexedDB.databases()).map((item) => item.name || '').sort()
      : [];
    const cacheNames = typeof caches?.keys === 'function' ? (await caches.keys()).sort() : [];
    const opfsNames = [];
    try {
      const root = await navigator.storage.getDirectory();
      for await (const [name] of root.entries()) opfsNames.push(name);
      opfsNames.sort();
    } catch {}
    return {
      localStorage: readStore(localStorage),
      sessionStorage: readStore(sessionStorage),
      indexedDbNames: databases,
      cacheNames,
      opfsNames
    };
  })()`;
}

function summarizeStorage(raw) {
  const serialized = JSON.stringify(raw);
  return {
    localStorageKeys: raw.localStorage.length,
    sessionStorageKeys: raw.sessionStorage.length,
    indexedDbCount: raw.indexedDbNames.length,
    cacheCount: raw.cacheNames.length,
    opfsEntryCount: raw.opfsNames.length,
    fingerprint: sha256(Buffer.from(serialized, 'utf8')).slice(0, 16),
    sensitiveAudioMarkers: /(?:data:audio|base64|RIFF|ID3|\.wav|\.mp3|\.m4a)/i.test(serialized)
  };
}

function attributesOf(node) {
  const values = node?.attributes ?? [];
  const attributes = {};
  for (let index = 0; index + 1 < values.length; index += 2) {
    attributes[values[index]] = values[index + 1];
  }
  return attributes;
}

function walkDom(node, visit) {
  if (!node) return null;
  const result = visit(node);
  if (result) return result;
  for (const child of [
    ...(node.children ?? []),
    ...(node.shadowRoots ?? []),
    ...(node.contentDocument ? [node.contentDocument] : [])
  ]) {
    const found = walkDom(child, visit);
    if (found) return found;
  }
  return null;
}

async function domRoot(session) {
  await session.send('DOM.enable');
  return (await session.send('DOM.getDocument', { depth: -1, pierce: true })).root;
}

async function setFileInput(session, fixturePath) {
  const root = await domRoot(session);
  const input = walkDom(root, (node) => attributesOf(node).id === 'audio-s3-file' ? node : null);
  if (!input?.nodeId) {
    const error = new Error('Audio input was not found');
    error.code = 'LR3_INPUT_NOT_FOUND';
    throw error;
  }
  await session.send('DOM.setFileInputFiles', {
    nodeId: input.nodeId,
    files: [fixturePath]
  }, { timeoutMs: 30_000 });
}

async function clickShadowAction(session, action) {
  const pressNode = async (node) => {
    const resolved = await session.send('DOM.resolveNode', { nodeId: node.nodeId });
    const objectId = resolved.object?.objectId;
    if (!objectId) {
      const error = new Error('Closed-shadow UI node could not be resolved');
      error.code = 'LR3_UI_ACTION_NOT_FOUND';
      throw error;
    }
    try {
      await session.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: 'function () { this.click(); return true; }',
        awaitPromise: true,
        returnByValue: true,
        userGesture: true
      });
    } finally {
      try { await session.send('Runtime.releaseObject', { objectId }); } catch {}
    }
  };
  const clickNode = async (node) => {
    try { await session.send('DOM.scrollIntoViewIfNeeded', { nodeId: node.nodeId }); } catch {}
    const model = (await session.send('DOM.getBoxModel', { nodeId: node.nodeId })).model;
    const quad = model?.content ?? model?.border;
    if (!Array.isArray(quad) || quad.length < 8) return false;
    const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
    const y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
    await session.click({ x, y });
    return true;
  };
  const findAction = async () => walkDom(await domRoot(session), (candidate) => (
    attributesOf(candidate)['data-uf-action'] === action ? candidate : null
  ));
  let node = await findAction();
  if (!node?.nodeId) {
    const error = new Error(`UploadFit UI action was not found: ${action}`);
    error.code = 'LR3_UI_ACTION_NOT_FOUND';
    throw error;
  }
  let visible = false;
  try {
    const model = (await session.send('DOM.getBoxModel', { nodeId: node.nodeId })).model;
    const quad = model?.content ?? model?.border;
    visible = Array.isArray(quad) && quad.length >= 8;
  } catch (error) {
    if (!/box model/i.test(String(error?.message ?? ''))) throw error;
  }
  if (visible) {
    await pressNode(node);
    return;
  }

  // Confirmation cards are intentionally collapsed by default. Expand the
  // visible status pill through a real closed-shadow button click, then obtain
  // a fresh node/box for the requested action.
  const root = await domRoot(session);
  const toggle = walkDom(root, (candidate) => {
    const attributes = attributesOf(candidate);
    return String(attributes.class ?? '').split(/\s+/).includes('uf-pill-toggle')
      || String(attributes['aria-label'] ?? '').startsWith('UploadFit 状态')
      ? candidate
      : null;
  });
  if (!toggle?.nodeId || !(await clickNode(toggle))) {
    const error = new Error('UploadFit status pill could not be expanded');
    error.code = 'LR3_UI_ACTION_NOT_FOUND';
    throw error;
  }
  await delay(100);
  node = await findAction();
  if (!node?.nodeId) {
    const error = new Error(`UploadFit UI action disappeared: ${action}`);
    error.code = 'LR3_UI_ACTION_NOT_FOUND';
    throw error;
  }
  const model = (await session.send('DOM.getBoxModel', { nodeId: node.nodeId })).model;
  const quad = model?.content ?? model?.border;
  if (!Array.isArray(quad) || quad.length < 8) {
    const error = new Error(`UploadFit UI action has no box: ${action}`);
    error.code = 'LR3_UI_ACTION_NOT_FOUND';
    throw error;
  }
  await pressNode(node);
}

function audioStateExpression({ includeOutput = false } = {}) {
  return `(async () => {
    const page = globalThis.__uploadfitAudioS3;
    const session = globalThis.__uploadfit_session__;
    const controller = page?.controller || session?.controller;
    const snapshot = controller?.getSnapshot?.() || null;
    const task = snapshot?.activeTask || null;
    const internal = controller?.tasks instanceof Map && task
      ? controller.tasks.get(task.taskId)
      : null;
    const inputFile = page?.input?.files?.[0] || null;
    let outputBase64 = null;
    if (${includeOutput ? 'true' : 'false'} && inputFile) {
      const bytes = new Uint8Array(await inputFile.arrayBuffer());
      let binary = '';
      const chunk = 0x8000;
      for (let offset = 0; offset < bytes.length; offset += chunk) {
        binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunk)));
      }
      outputBase64 = btoa(binary);
    }
    return {
      readyState: document.readyState,
      hostCount: document.querySelectorAll('[data-uploadfit-ui-host]').length,
      sessionActive: session?.active === true,
      pageOwnBundleScript: [...document.scripts].some((node) => /dist\\/uploadfit/.test(node.src)),
      controllerReady: Boolean(controller),
      task,
      internal: internal ? {
        original: internal.originalFile ? { type: internal.originalFile.type, bytes: internal.originalFile.size } : null,
        processed: internal.processedFile ? { type: internal.processedFile.type, bytes: internal.processedFile.size } : null,
        finalFileEqualsProcessedFile: Boolean(inputFile && internal.processedFile && inputFile === internal.processedFile),
        businessClickCount: internal.businessClickCount,
        objectUrlCount: internal.objectUrls?.length ?? null,
        processingTaskPresent: Boolean(controller.processingTask),
        cleanup: internal.result?.cleanup ? {
          workerTerminated: internal.result.cleanup.workerTerminated === true,
          objectUrlRevoked: internal.result.cleanup.objectUrlRevoked === true,
          queueCleared: internal.result.cleanup.queueCleared === true,
          disposed: internal.result.cleanup.disposed === true
        } : null,
        history: (internal.stateHistory || []).map((item) => ({ to: item.to, time: item.time }))
      } : null,
      file: inputFile ? { type: inputFile.type, bytes: inputFile.size } : null,
      pageCounters: page ? {
        processingStarts: page.processingStarts,
        injectionStarts: page.injectionStarts,
        retryDispatches: page.retryDispatches,
        submitClicks: page.submitClicks,
        events: page.events.map((event) => ({ type: event.type, isTrusted: event.isTrusted }))
      } : null,
      outputBase64
    };
  })()`;
}

async function readAudioState(session, options = {}) {
  return session.evaluateValue(audioStateExpression(options), { timeoutMs: 120_000 });
}

function createWorkerTracker(cdp, pageTargetId) {
  const workerTargets = new Map();
  const created = [];
  const destroyed = [];
  const off = [
    cdp.on('Target.targetCreated', ({ targetInfo }) => {
      if (targetInfo?.type !== 'worker' || !String(targetInfo.url).startsWith('blob:')) return;
      if (targetInfo.openerId && targetInfo.openerId !== pageTargetId) return;
      workerTargets.set(targetInfo.targetId, true);
      created.push({ time: Date.now() });
    }),
    cdp.on('Target.targetDestroyed', ({ targetId }) => {
      if (!workerTargets.has(targetId)) return;
      workerTargets.delete(targetId);
      destroyed.push({ time: Date.now() });
    })
  ];
  return {
    created,
    destroyed,
    activeCount: () => workerTargets.size,
    stop() { for (const remove of off) remove(); }
  };
}

function startHeartbeat(session, intervalMs = 100) {
  let active = true;
  const gaps = [];
  let previous = Date.now();
  const promise = (async () => {
    while (active) {
      const cycleStarted = Date.now();
      try { await session.evaluateValue('performance.now()', { timeoutMs: 10_000 }); } catch {}
      const now = Date.now();
      gaps.push(now - previous);
      previous = now;
      const remaining = intervalMs - (Date.now() - cycleStarted);
      if (active && remaining > 0) await delay(remaining);
    }
  })();
  return {
    async stop() {
      active = false;
      await promise;
      return {
        samples: gaps.length,
        maxGapMs: gaps.length ? Math.max(...gaps) : null
      };
    }
  };
}

function stageTimings(history) {
  const firstTime = (state) => history.find((item) => item.to === state)?.time ?? null;
  const armed = firstTime('ARMED');
  const inspecting = firstTime('INSPECTING');
  const confirm = firstTime('NEEDS_CONFIRMATION');
  const processing = firstTime('PROCESSING');
  const injecting = firstTime('INJECTING');
  const success = firstTime('SUCCESS');
  const between = (from, to) => Number.isFinite(from) && Number.isFinite(to) ? to - from : null;
  return {
    selectToInspectMs: between(armed, inspecting),
    inspectMs: between(inspecting, confirm),
    confirmationMs: between(confirm, processing),
    processMs: between(processing, injecting ?? success),
    injectionMs: between(injecting, success),
    totalMs: between(armed, success)
  };
}

async function pollLr3(gate, read, accept, options) {
  try {
    return await poll(read, accept, options);
  } catch (error) {
    error.gate = gate;
    throw error;
  }
}

async function runLr3(fixtureArgument) {
  if (!fixtureArgument) {
    const error = new Error('LR3 fixture is required');
    error.code = 'LR3_FIXTURE_REQUIRED';
    throw error;
  }
  const fixturePath = path.resolve(fixtureArgument);
  const fixtureBytes = await readFile(fixturePath);
  const input = parsePcmWav(fixtureBytes);
  input.sha256 = sha256(fixtureBytes);
  const bundle = await loadBundle();
  const startedAt = new Date().toISOString();
  const runId = makeRunId().replace('s4a1-', 's4lr3-');
  const pageUrl = 'http://127.0.0.1:8765/test-pages/audio-s4-tabbit.html?scenario=B';
  let cdp = null;
  let target = null;
  let workerTracker = null;
  let heartbeat = null;
  try {
    ({ cdp } = await connectTabbit({ timeoutMs: 120_000 }));
    const version = await getBrowserVersion(cdp);
    const existingTargets = await getTargets(cdp);
    const editorTarget = existingTargets.find(isOfficialEditorTarget);
    if (!editorTarget) {
      const error = new Error('Official Tabbit editor target not found');
      error.code = 'EDITOR_NOT_FOUND';
      throw error;
    }
    target = await instrumentTarget(cdp, editorTarget.targetId, pageUrl, {
      ownsTarget: false,
      restoreUrl: editorTarget.url
    });
    try {
      await waitForProductionSession(target.session);
    } catch (error) {
      error.gate = 'AUTO_RUN';
      throw error;
    }
    await pollLr3(
      'CONTROLLER_READY',
      () => readAudioState(target.session),
      (state) => state?.controllerReady === true
        && state.hostCount === 1
        && state.pageOwnBundleScript === false,
      { timeoutMs: 60_000, intervalMs: 100 }
    );

    const storageBeforeRaw = await target.session.evaluateValue(storageExpression(), { timeoutMs: 30_000 });
    await cdp.send('Target.setDiscoverTargets', { discover: true });
    workerTracker = createWorkerTracker(cdp, target.targetId);
    heartbeat = startHeartbeat(target.session);

    const selectionStartedAt = Date.now();
    await setFileInput(target.session, fixturePath);
    let state = await pollLr3(
      'WAIT_CONFIRMATION',
      () => readAudioState(target.session),
      (current) => current?.task?.status === 'NEEDS_CONFIRMATION'
        || current?.task?.status === 'STOPPED',
      { timeoutMs: 60_000, intervalMs: 50 }
    );
    if (state.task.status === 'STOPPED') {
      const error = new Error(`LR3 stopped before confirmation: ${state.task.errorCode}`);
      error.code = state.task.errorCode || 'LR3_PRECHECK_STOPPED';
      throw error;
    }

    const confirmations = [];
    for (let index = 0; index < 2 && state.task?.status === 'NEEDS_CONFIRMATION'; index += 1) {
      const pending = state.task.plan?.confirmations?.find((item) => item.required && !item.resolved);
      if (!pending) {
        const error = new Error('LR3 confirmation state has no pending item');
        error.code = 'LR3_CONFIRMATION_MISSING';
        throw error;
      }
      confirmations.push({
        type: pending.type,
        clickedViaClosedShadowDom: true,
        activation: 'CDP_DOM_RESOLVED_ELEMENT_CLICK',
        trustedInputEventClaimed: false
      });
      await clickShadowAction(target.session, 'confirm-audio');
      const previousType = pending.type;
      state = await pollLr3(
        'AFTER_UI_CONFIRMATION',
        () => readAudioState(target.session),
        (current) => current?.task?.status !== 'NEEDS_CONFIRMATION'
          || current.task.plan?.confirmations?.some((item) => item.required
            && !item.resolved && item.type !== previousType),
        { timeoutMs: 30_000, intervalMs: 50 }
      );
    }

    const progressSamples = [];
    let lastProgressKey = null;
    const processDeadline = Date.now() + 180_000;
    while (Date.now() < processDeadline) {
      state = await readAudioState(target.session);
      const progress = state.task?.progress;
      if (progress) {
        const key = `${progress.phase}:${progress.ratio}`;
        if (key !== lastProgressKey) {
          progressSamples.push({
            atMs: Date.now() - selectionStartedAt,
            phase: progress.phase,
            ratio: progress.ratio
          });
          lastProgressKey = key;
        }
      }
      if (state.task?.status === 'SUCCESS') break;
      if (state.task?.status === 'STOPPED') {
        const error = new Error(`LR3 processing stopped: ${state.task.errorCode}`);
        error.code = state.task.errorCode || 'LR3_PROCESSING_STOPPED';
        throw error;
      }
      await delay(50);
    }
    if (state.task?.status !== 'SUCCESS') {
      const error = new Error('LR3 processing did not complete');
      error.code = 'LR3_PROCESSING_TIMEOUT';
      throw error;
    }

    const heartbeatResult = await heartbeat.stop();
    heartbeat = null;
    await pollLr3(
      'WORKER_CLEANUP',
      async () => workerTracker.activeCount(),
      (count) => count === 0,
      { timeoutMs: 10_000, intervalMs: 50 }
    );
    const finalState = await readAudioState(target.session, { includeOutput: true });
    const outputBytes = Buffer.from(finalState.outputBase64, 'base64');
    const output = parseMp3Independently(outputBytes);
    output.sha256 = sha256(outputBytes);
    output.mime = finalState.file?.type ?? null;
    const durationToleranceMs = Math.max(250, input.durationMs * 0.02);
    output.durationDeltaMs = Math.abs(output.durationMs - input.durationMs);
    output.durationToleranceMs = durationToleranceMs;
    output.durationWithinTolerance = output.durationDeltaMs <= durationToleranceMs;

    const storageAfterRaw = await target.session.evaluateValue(storageExpression(), { timeoutMs: 30_000 });
    const storageBefore = summarizeStorage(storageBeforeRaw);
    const storageAfter = summarizeStorage(storageAfterRaw);
    const storageUnchanged = JSON.stringify(storageBeforeRaw) === JSON.stringify(storageAfterRaw);
    const network = summarizeTelemetry(target.telemetry);
    const sensitiveRequestMarkers = target.telemetry.requests.some((request) => request.sensitivePayloadMarkers);

    const assertions = {
      outputMimeMp3: output.mime === 'audio/mpeg',
      outputWithinPageLimit: output.bytes <= 250_000,
      durationWithinTolerance: output.durationWithinTolerance,
      workerUsed: finalState.task?.result?.workerUsed === true,
      encodePassesBounded: finalState.task?.result?.encodePasses <= 2,
      activeWorkersZero: workerTracker.activeCount() === 0,
      finalFileEqualsProcessedFile: finalState.internal?.finalFileEqualsProcessedFile === true,
      injectionObserved: finalState.pageCounters?.injectionStarts >= 1,
      submitClicksZero: finalState.pageCounters?.submitClicks === 0,
      controllerBusinessClicksZero: finalState.internal?.businessClickCount === 0,
      uploadFitExternalRequestsZero: network.externalRequests === 0,
      sensitiveRequestMarkersZero: sensitiveRequestMarkers === false,
      storageUnchanged,
      storageAudioMarkersZero: storageAfter.sensitiveAudioMarkers === false,
      runtimeErrorsZero: target.telemetry.errors.length === 0
    };
    const supplementalObservations = {
      workerTargetObserved: workerTracker.created.length >= 1,
      workerTargetObservationNote:
        'CDP may not expose a short-lived blob Worker target; product workerUsed and cleanup remain mandatory assertions.'
    };
    const pass = Object.values(assertions).every(Boolean);
    if (!pass) {
      const error = new Error('LR3 final assertions failed');
      error.code = 'LR3_ASSERTION_FAILED';
      error.assertions = assertions;
      error.summary = {
        output: {
          mime: output.mime,
          bytes: output.bytes,
          frames: output.frames,
          durationDeltaMs: output.durationDeltaMs,
          durationToleranceMs: output.durationToleranceMs
        },
        workerTargetsCreated: workerTracker.created.length,
        workerTargetsDestroyed: workerTracker.destroyed.length,
        activeWorkersAfter: workerTracker.activeCount(),
        taskResult: finalState.task?.result ?? null,
        dataTransfer: {
          finalFileEqualsProcessedFile: finalState.internal?.finalFileEqualsProcessedFile,
          injectionStarts: finalState.pageCounters?.injectionStarts,
          submitClicks: finalState.pageCounters?.submitClicks,
          businessClickCount: finalState.internal?.businessClickCount
        },
        network: {
          byKind: network.byKind,
          externalRequests: network.externalRequests,
          sensitiveRequestMarkers
        },
        storage: { before: storageBefore, after: storageAfter, unchanged: storageUnchanged },
        runtimeErrors: target.telemetry.errors
      };
      throw error;
    }

    const history = finalState.internal?.history ?? [];
    const result = {
      stage: 'V2-S4',
      phase: 'PHASE_2A1',
      check: 'LR3',
      status: 'PASS',
      runId,
      startedAt,
      completedAt: new Date().toISOString(),
      browser: {
        product: version.product,
        protocolVersion: version.protocolVersion,
        connection: 'TABBIT_REMOTE_CDP_DEVTOOLS_ACTIVE_PORT'
      },
      officialPrivateScript: {
        autoRun: true,
        directBundleInjectionIntoAudioPage: false,
        pageOwnBundleScript: false,
        bundleBytes: bundle.bytes.length,
        bundleSha256: bundle.sha256
      },
      input: {
        ...input,
        semanticContent: 'synthetic-only',
        selectedVia: 'CDP_DOM_SET_FILE_INPUT_FILES',
        filenameRecorded: false,
        pathRecorded: false
      },
      confirmations: {
        count: confirmations.length,
        items: confirmations,
        realClosedShadowUiClicks: confirmations.length
      },
      processing: {
        workerTargetsCreated: workerTracker.created.length,
        workerTargetsDestroyed: workerTracker.destroyed.length,
        workerTargetObserved: supplementalObservations.workerTargetObserved,
        workerTargetObservationNote: supplementalObservations.workerTargetObservationNote,
        activeWorkersAfter: workerTracker.activeCount(),
        workerUsed: finalState.task.result.workerUsed,
        encodePasses: finalState.task.result.encodePasses,
        peakBufferedBytes: finalState.task.result.peakBufferedBytes,
        progressSamples,
        heartbeat: heartbeatResult,
        stagesMs: stageTimings(history)
      },
      output,
      dataTransfer: {
        finalFileEqualsProcessedFile: finalState.internal.finalFileEqualsProcessedFile,
        injectionStarts: finalState.pageCounters.injectionStarts,
        finalMime: finalState.file.type,
        finalBytes: finalState.file.bytes,
        originalRetainedByTask: finalState.internal.original?.type === 'audio/wav',
        businessSubmitClicks: finalState.pageCounters.submitClicks,
        controllerBusinessClickCount: finalState.internal.businessClickCount
      },
      network: {
        ...network,
        anySensitiveAudioPayloadMarkers: sensitiveRequestMarkers,
        uploadFitExternalRequests: network.externalRequests
      },
      storage: {
        before: storageBefore,
        after: storageAfter,
        unchanged: storageUnchanged,
        audioPersisted: false
      },
      runtimeErrors: target.telemetry.errors,
      privacy: {
        audioBytesRecordedInEvidence: false,
        outputBase64RecordedInEvidence: false,
        filenameRecorded: false,
        localAbsolutePathRecorded: false,
        privateScriptIdRecorded: false
      },
      cleanup: {
        workerRuntime: finalState.internal.cleanup,
        activeWorkersAfter: workerTracker.activeCount(),
        objectUrlsOnTaskAfter: finalState.internal.objectUrlCount,
        fixtureCleanupRequiredByCaller: true,
        testPageRestoredToOfficialEditor: false,
        browserClosed: false
      }
    };

    await target.session.evaluateValue('globalThis.__uploadfit_session__?.cleanup?.(); true');
    await pollLr3(
      'SESSION_CLEANUP',
      () => readAudioState(target.session),
      (current) => current?.hostCount === 0 && current.sessionActive === false,
      { timeoutMs: 10_000, intervalMs: 50 }
    );
    workerTracker.stop();
    workerTracker = null;
    await cdp.send('Target.setDiscoverTargets', { discover: false });
    const restored = await closeInstrumentedTarget(cdp, target);
    target = null;
    result.cleanup.testPageRestoredToOfficialEditor = restored;
    return result;
  } finally {
    if (heartbeat) {
      try { await heartbeat.stop(); } catch {}
    }
    if (workerTracker) workerTracker.stop();
    if (target && cdp) {
      try { await closeInstrumentedTarget(cdp, target); } catch {}
    }
    if (cdp) {
      try { await cdp.send('Target.setDiscoverTargets', { discover: false }); } catch {}
      await cdp.close();
    }
  }
}

function safeErrorCode(error) {
  if (error?.code === 'CDP_TIMEOUT') return 'CDP_TIMEOUT';
  const message = String(error?.message || '');
  if (/DevToolsActivePort|CDP open/i.test(message)) return 'TABBIT_CONNECTION_UNAVAILABLE';
  if (/official Tabbit editor target/i.test(message)) return 'EDITOR_NOT_FOUND';
  if (/Runtime\.evaluate/i.test(message)) return 'EDITOR_EVALUATION_FAILED';
  if (error?.code === 'SCRIPT_TOO_SHORT') return 'SCRIPT_TOO_SHORT';
  if (typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)) return error.code;
  return 'PROBE_FAILED';
}

function safeDiagnosticMessage(error) {
  return String(error?.message ?? 'Unknown error')
    .replace(/[A-Za-z]:[\\/][^\r\n]*/g, '[LOCAL_PATH_REDACTED]')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[UUID_REDACTED]')
    .slice(0, 240);
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

async function runCompare() {
  const bundle = await loadBundle();
  let cdp = null;
  let session = null;
  try {
    ({ cdp } = await connectTabbit({ timeoutMs: 120_000 }));
    const targets = await getTargets(cdp);
    const editor = targets.find(isOfficialEditorTarget);
    if (!editor) {
      const error = new Error('Official Tabbit editor target not found');
      error.code = 'EDITOR_NOT_FOUND';
      throw error;
    }
    session = await attachTarget(cdp, editor.targetId);
    const current = await readPersistedEditor(session, { includeScript: true });
    const saved = current.scriptValue;
    const savedBytes = Buffer.from(saved, 'utf8');
    let prefix = 0;
    while (prefix < bundle.text.length && prefix < saved.length
      && bundle.text.charCodeAt(prefix) === saved.charCodeAt(prefix)) prefix += 1;
    let suffix = 0;
    while (suffix < bundle.text.length - prefix && suffix < saved.length - prefix
      && bundle.text.charCodeAt(bundle.text.length - 1 - suffix)
        === saved.charCodeAt(saved.length - 1 - suffix)) suffix += 1;
    return {
      ok: true,
      mode: 'READ_ONLY_BUNDLE_COMPARISON',
      bundle: {
        characters: bundle.text.length,
        utf8Bytes: bundle.bytes.length,
        sha256: bundle.sha256,
        endsWithLf: bundle.text.endsWith('\n'),
        endsWithCrLf: bundle.text.endsWith('\r\n')
      },
      saved: {
        characters: saved.length,
        utf8Bytes: savedBytes.length,
        sha256: sha256(savedBytes),
        endsWithLf: saved.endsWith('\n'),
        endsWithCrLf: saved.endsWith('\r\n')
      },
      difference: {
        commonPrefixCharacters: prefix,
        commonSuffixCharacters: suffix,
        bundleCodePointAtFirstDifference: prefix < bundle.text.length
          ? bundle.text.codePointAt(prefix)
          : null,
        savedCodePointAtFirstDifference: prefix < saved.length
          ? saved.codePointAt(prefix)
          : null,
        exact: bundle.text === saved
      },
      form: {
        nameExact: current.name === TARGET_NAME,
        descriptionExact: current.description === TARGET_DESCRIPTION,
        matchPatternExact: current.matchUrl === EXPECTED_MATCH_PATTERN,
        autoRun: current.autoRun
      },
      sensitiveContentRecorded: false
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
  const mode = args[0];
  const fixture = args.find((argument) => argument.startsWith('--fixture='))?.slice('--fixture='.length);
  const supported = ['--dry-run', '--install', '--compare', '--lr1', '--lr3'];
  const valid = supported.includes(mode)
    && (mode === '--lr3' ? Boolean(fixture) && args.length === 2 : args.length === 1);
  if (!valid) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      mode: 'V2_S4_TABBIT_A1',
      error: 'USAGE',
      allowed: ['--dry-run', '--install', '--compare', '--lr1', '--lr3 --fixture=<temporary-wav>']
    })}\n`);
    process.exitCode = 2;
    return;
  }

  try {
    const result = mode === '--install'
      ? await runInstall()
      : mode === '--lr1'
        ? await runLr1()
      : mode === '--lr3'
        ? await runLr3(fixture)
      : mode === '--compare'
        ? await runCompare()
        : await runDryRun();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const failure = {
      ok: false,
      mode: mode === '--install'
        ? 'INSTALL'
        : mode === '--lr1'
          ? 'LR1'
        : mode === '--lr3'
          ? 'LR3'
        : mode === '--compare'
          ? 'READ_ONLY_BUNDLE_COMPARISON'
          : 'DRY_RUN_READ_ONLY',
      error: safeErrorCode(error)
    };
    if (mode === '--lr1' && error?.last && typeof error.last === 'object') {
      failure.lastPageState = sanitizePageState(error.last);
    }
    if (mode === '--lr1' && typeof error?.gate === 'string') {
      failure.gate = error.gate;
    }
    if (mode === '--lr1' && error?.network) {
      failure.network = error.network;
    }
    if (mode === '--lr3') failure.diagnostic = safeDiagnosticMessage(error);
    if (mode === '--lr3' && typeof error?.gate === 'string') failure.gate = error.gate;
    if (mode === '--lr3' && error?.assertions) failure.assertions = error.assertions;
    if (mode === '--lr3' && error?.summary) failure.summary = error.summary;
    process.stdout.write(`${JSON.stringify(failure)}\n`);
    process.exitCode = 1;
  }
}

await main();
