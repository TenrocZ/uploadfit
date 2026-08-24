#!/usr/bin/env node

/**
 * Native raw-CDP transport for the V2-S4 Tabbit gate.
 *
 * Tabbit's DevToolsActivePort file is the only discovery mechanism used here.
 * The file is read for every connection, so a browser restart cannot leave a
 * run attached to a stale endpoint.  No Playwright and no /json endpoint are
 * involved.
 */

import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_ACTIVE_PORT_PATH = path.join(
  os.homedir(),
  'AppData',
  'Local',
  'Tabbit Browser',
  'User Data',
  'DevToolsActivePort'
);

function cdpTimeout(method, timeoutMs) {
  const error = new Error(`CDP ${method} timed out after ${timeoutMs}ms`);
  error.code = 'CDP_TIMEOUT';
  return error;
}

export async function readDevToolsActivePort(filePath = DEFAULT_ACTIVE_PORT_PATH) {
  const contents = await readFile(filePath, 'utf8');
  const [portText, websocketPath] = contents.split(/\r?\n/).map((line) => line.trim());
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid DevToolsActivePort port: ${filePath}`);
  }
  if (!websocketPath?.startsWith('/')) {
    throw new Error(`Invalid DevToolsActivePort websocket path: ${filePath}`);
  }
  return {
    path: filePath,
    port,
    websocketPath,
    endpoint: `ws://127.0.0.1:${port}${websocketPath}`
  };
}

export class RawCdp {
  constructor(socket, { timeoutMs = 15_000 } = {}) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    this.nextId = 0;
    this.pending = new Map();
    this.eventListeners = new Map();
    this.closed = false;
    socket.addEventListener('message', (event) => this.#message(event.data));
    socket.addEventListener('close', () => this.#closed(new Error('CDP websocket closed')));
    socket.addEventListener('error', () => this.#closed(new Error('CDP websocket error')));
  }

  static async connect(endpoint, options = {}) {
    const socket = new WebSocket(endpoint);
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`CDP open timed out: ${endpoint}`)),
          options.connectTimeoutMs ?? 10_000);
        socket.addEventListener('open', () => {
          clearTimeout(timeout);
          resolve();
        }, { once: true });
        socket.addEventListener('error', () => {
          clearTimeout(timeout);
          reject(new Error(`CDP open failed: ${endpoint}`));
        }, { once: true });
      });
    } catch (error) {
      try { socket.close(); } catch {}
      throw error;
    }
    return new RawCdp(socket, options);
  }

  send(method, params = {}, { sessionId, timeoutMs = this.timeoutMs } = {}) {
    if (this.closed) return Promise.reject(new Error('CDP websocket is closed'));
    const id = ++this.nextId;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(cdpTimeout(method, timeoutMs));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        this.socket.send(JSON.stringify(message));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  on(method, listener) {
    const listeners = this.eventListeners.get(method) ?? new Set();
    listeners.add(listener);
    this.eventListeners.set(method, listeners);
    return () => listeners.delete(listener);
  }

  async close() {
    if (this.closed) return;
    this.#closed(new Error('CDP websocket closed by caller'));
    try { this.socket.close(); } catch {}
  }

  #message(raw) {
    let message;
    try { message = JSON.parse(typeof raw === 'string' ? raw : String(raw)); } catch { return; }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        const error = new Error(`${pending.method}: ${message.error.message ?? 'CDP error'}`);
        error.code = message.error.code;
        error.data = message.error.data;
        pending.reject(error);
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }
    for (const listener of this.eventListeners.get(message.method) ?? []) {
      try { listener(message.params ?? {}, message); } catch {}
    }
  }

  #closed(error) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export class RawCdpSession {
  constructor(cdp, sessionId, targetId) {
    this.cdp = cdp;
    this.sessionId = sessionId;
    this.targetId = targetId;
    this.detached = false;
  }

  send(method, params = {}, options = {}) {
    return this.cdp.send(method, params, { ...options, sessionId: this.sessionId });
  }

  evaluate(expression, options = {}) {
    return this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: options.userGesture ?? false,
      ...options.runtime
    }, options);
  }

  async evaluateValue(expression, options = {}) {
    const result = await this.evaluate(expression, options);
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description
        ?? result.exceptionDetails.text
        ?? 'Runtime.evaluate failed');
    }
    return result.result?.value;
  }

  insertText(text) {
    return this.send('Input.insertText', { text });
  }

  dispatchKeyEvent(params) {
    return this.send('Input.dispatchKeyEvent', params);
  }

  /** Click a DOM node through a trusted CDP mouse sequence. */
  async click({ x, y, button = 'left', clickCount = 1 }) {
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x, y, button: 'none', clickCount: 0
    });
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button, clickCount, buttons: 1
    });
    return this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button, clickCount, buttons: 0
    });
  }
}

export async function connectTabbit(options = {}) {
  const activePort = await readDevToolsActivePort(options.activePortPath ?? DEFAULT_ACTIVE_PORT_PATH);
  const cdp = await RawCdp.connect(activePort.endpoint, options);
  return { activePort, cdp };
}

export async function getBrowserVersion(cdp) {
  return cdp.send('Browser.getVersion');
}

export async function getTargets(cdp) {
  return (await cdp.send('Target.getTargets')).targetInfos ?? [];
}

export async function attachTarget(cdp, targetId, options = {}) {
  const { sessionId } = await cdp.send('Target.attachToTarget', {
    targetId,
    flatten: true
  }, options);
  return new RawCdpSession(cdp, sessionId, targetId);
}

export async function detachTarget(cdp, session) {
  if (!session || session.detached) return;
  session.detached = true;
  await cdp.send('Target.detachFromTarget', { sessionId: session.sessionId });
}

export function redactTarget(target) {
  const url = typeof target.url === 'string' ? target.url : '';
  const redactedUrl = url.replace(
    /^(https:\/\/web\.tabbit\.com\/skill\/)[^/?#]+(.*)$/i,
    '$1[REDACTED]$2'
  );
  return {
    type: target.type,
    title: target.title,
    url: redactedUrl,
    attached: Boolean(target.attached)
  };
}

async function inspect() {
  const { cdp } = await connectTabbit();
  try {
    const version = await getBrowserVersion(cdp);
    const targets = await getTargets(cdp);
    process.stdout.write(`${JSON.stringify({
      browserVersion: version.product,
      pageTargets: targets.filter((target) => target.type === 'page').map(redactTarget)
    }, null, 2)}\n`);
  } finally {
    await cdp.close();
  }
}

if (process.argv.includes('--inspect')) {
  inspect().catch((error) => {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  });
}
