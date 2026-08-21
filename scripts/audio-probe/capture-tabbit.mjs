#!/usr/bin/env node

/*
 * Connect to an explicitly launched, isolated Tabbit CDP endpoint and print a
 * JSON-safe capability/small-encode snapshot. This script does not create or
 * edit evidence files and never connects to the user's normal Tabbit profile.
 */

import { chromium } from '@playwright/test';

const endpointArg = process.argv.find((value) => value.startsWith('--cdp='));
const endpoint = endpointArg?.slice('--cdp='.length);

if (!endpoint || !/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint)) {
  throw new Error('Use --cdp=http://127.0.0.1:<isolated-port>');
}

const browser = await chromium.connectOverCDP(endpoint);
try {
  const pages = browser.contexts().flatMap((context) => context.pages());
  const page = pages.find((candidate) => candidate.url().includes('/test-pages/audio-probe.html'))
    ?? pages[0];
  if (!page) throw new Error('No Tabbit page is available on the isolated endpoint');
  await page.waitForFunction(() => Boolean(window.uploadFitAudioS0ProbeResult), null, { timeout: 10_000 });
  const captured = await page.evaluate(async () => {
    const smallEncode = await window.uploadFitAudioS0Encoder.runSmallSyntheticEncode();
    const frames = 48_000 * 15;
    const dataBytes = frames * 2 * 2;
    const bytes = new Uint8Array(44 + dataBytes);
    const view = new DataView(bytes.buffer);
    const put = (offset, value) => [...value].forEach((char, index) => {
      bytes[offset + index] = char.charCodeAt(0);
    });
    put(0, 'RIFF');
    view.setUint32(4, bytes.length - 8, true);
    put(8, 'WAVE');
    put(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 2, true);
    view.setUint32(24, 48_000, true);
    view.setUint32(28, 48_000 * 2 * 2, true);
    view.setUint16(32, 4, true);
    view.setUint16(34, 16, true);
    put(36, 'data');
    view.setUint32(40, dataBytes, true);
    const fixture = new Blob([bytes], { type: 'audio/wav' });
    const controller = new AbortController();
    let progressBeforeCancel = 0;
    let progressAfterCancel = 0;
    let cancelRequested = false;
    let cancelRequestedAt = null;
    let cancellation = null;
    try {
      await window.uploadFitAudioS0Encoder.encodeFile(fixture, {
        signal: controller.signal,
        onProgress: () => {
          if (!cancelRequested) {
            progressBeforeCancel += 1;
            cancelRequested = true;
            cancelRequestedAt = performance.now();
            controller.abort();
          } else {
            progressAfterCancel += 1;
          }
        }
      });
      cancellation = { status: 'UNEXPECTED_SUCCESS' };
    } catch (error) {
      const settledAt = performance.now();
      await new Promise((resolve) => setTimeout(resolve, 50));
      cancellation = {
        status: error?.code === 'AUDIO_PROCESSING_CANCELLED' ? 'CANCELLED' : 'ERROR',
        errorName: error?.name ?? null,
        errorCode: error?.code ?? null,
        inputBytes: fixture.size,
        progressBeforeCancel,
        progressAfterCancel,
        cancelLatencyMs: Number.isFinite(error?.cancelLatencyMs)
          ? error.cancelLatencyMs
          : (Number.isFinite(cancelRequestedAt) ? settledAt - cancelRequestedAt : null),
        cleanup: error?.cleanup ?? null,
        partialOutputPersisted: false
      };
    }
    return {
      userAgent: navigator.userAgent,
      capabilities: window.uploadFitAudioS0ProbeResult,
      smallEncode,
      cancellation
    };
  });
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    captureMode: 'ISOLATED_TABBIT_EXECUTABLE_CDP',
    endpointHost: '127.0.0.1',
    accountProfileUsed: false,
    userDataPersisted: false,
    ...captured
  }, null, 2)}\n`);
} finally {
  await browser.close();
}
