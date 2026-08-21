#!/usr/bin/env node

/*
 * V2-S2 production-equivalent 200MB -> 100MB gate.
 *
 * Runs the REAL S2 handler chain (planner -> confirmations -> processAudio ->
 * independent output validation) inside a local Playwright Chromium page with
 * the frozen lamejs Worker (ADR-005).  This is production-equivalent code-path
 * evidence; the real-Tabbit 200MB gate remains owned by V2-S4.
 *
 *   npm run audio:s2:gate
 *
 * The synthetic PCM fixture and every output are kept in a temp directory and
 * deleted on exit; only sizes/hashes/metrics are written to the evidence file.
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, mkdtemp, rm, writeFile, mkdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { buildS2WorkerImplementation } from './build-s2-adapter.mjs';

const rootDir = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

function argument(name, fallback = null) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((item) => item.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}
function numericArgument(name, fallback) {
  const raw = argument(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

const fixtureBytes = numericArgument('fixture-bytes', 200_000_044);
const bitDepth = numericArgument('bit-depth', 32);
const maxBytes = numericArgument('max-bytes', 100_000_000);
const keepFixture = process.argv.includes('--keep-fixture');
const outputFile = argument('out', path.join(rootDir, 'docs', 'evidence', 'V2-S2', 'audio-200-to-100.json'));

function mimeType(filePath) {
  return filePath.endsWith('.html') ? 'text/html; charset=utf-8'
    : filePath.endsWith('.js') || filePath.endsWith('.mjs') ? 'text/javascript; charset=utf-8'
      : 'text/plain; charset=utf-8';
}

async function serveDirectory() {
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    const filePath = path.resolve(rootDir, pathname.replace(/^\/+/, '') || 'test-pages/probe.html');
    if (!filePath.startsWith(rootDir) || !existsSync(filePath)) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, { 'content-type': mimeType(filePath) });
    response.end(await readFile(filePath));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

async function generateFixture(tempDir) {
  const fixturePath = path.join(tempDir, 'synthetic-200mb-pcm.wav');
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(rootDir, 'scripts', 'audio-probe', 'generate-fixture.mjs'),
      `--bytes=${fixtureBytes}`,
      `--bit-depth=${bitDepth}`,
      `--output=${fixturePath}`
    ], { cwd: rootDir, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(stderr || `fixture generator exited ${code}`))));
  });
  return fixturePath;
}

async function installHarness(page, implementationSource) {
  await page.evaluate(async (impl) => {
    const metadata = await import('/src/audio/metadata.js');
    const planner = await import('/src/audio/planner.js');
    const pipeline = await import('/src/audio/pipeline.js');
    const workerRuntime = await import('/src/audio/worker-runtime.js');
    const validators = await import('/src/audio/validators.js');
    window.__s2GateRuntime = workerRuntime.createAudioWorkerRuntime({ implementationSource: impl });
    window.__s2Wav = (seconds, sampleRate = 44100, channels = 2) => {
      const frames = Math.round(seconds * sampleRate);
      const dataBytes = frames * channels * 2;
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
      view.setUint16(22, channels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * channels * 2, true);
      view.setUint16(32, channels * 2, true);
      view.setUint16(34, 16, true);
      put(36, 'data');
      view.setUint32(40, dataBytes, true);
      for (let frame = 0; frame < frames; frame += 1) {
        const sample = Math.round(Math.sin((2 * Math.PI * 440 * frame) / sampleRate) * 12000);
        for (let channel = 0; channel < channels; channel += 1) {
          view.setInt16(44 + (frame * channels + channel) * 2, sample, true);
        }
      }
      return new File([bytes], 'voice.wav', { type: 'audio/wav' });
    };
    // Run one full S2 chain against a real File.  Only safe numbers/codes ever
    // leave the page: no PCM, frames, filenames or raw exceptions.
    window.__s2GateRun = async (file, runMaxBytes, opts = {}) => {
      const rules = { mediaKind: 'audio', formats: ['audio/mpeg'], extensions: ['.mp3'], maxBytes: runMaxBytes };
      const inspected = await metadata.inspectAudio(file);
      let plan = planner.createAudioProcessingPlan(inspected, rules);
      const confirmations = plan.confirmations.map((item) => ({ id: item.id, type: item.type }));
      for (const confirmation of plan.confirmations) {
        plan = planner.resolveAudioConfirmation(plan, { ...confirmation, accepted: true });
      }
      let maxHeartbeatGapMs = 0;
      let lastHeartbeat = performance.now();
      const heartbeat = setInterval(() => {
        const now = performance.now();
        maxHeartbeatGapMs = Math.max(maxHeartbeatGapMs, now - lastHeartbeat);
        lastHeartbeat = now;
      }, 100);
      const progress = { events: 0, maxRatioGap: 0, lastRatio: 0, nonMonotonic: 0 };
      const controller = new AbortController();
      let abortAt = null;
      const startedAt = performance.now();
      try {
        const result = await pipeline.processAudio(file, plan, {
          rules,
          metadata: inspected,
          signal: controller.signal,
          workerRuntime: window.__s2GateRuntime,
          timeoutMs: 900_000,
          onProgress: (event) => {
            progress.events += 1;
            progress.maxRatioGap = Math.max(progress.maxRatioGap, event.ratio - progress.lastRatio);
            if (event.ratio < progress.lastRatio) progress.nonMonotonic += 1;
            progress.lastRatio = event.ratio;
            if (opts.abortOnFirstProgress && progress.events === 1) {
              abortAt = performance.now();
              controller.abort();
            }
          }
        });
        clearInterval(heartbeat);
        const outputValidation = await validators.validateAudioOutputFile(result.file, rules, plan, inspected);
        let sha256 = null;
        if (typeof crypto?.subtle?.digest === 'function') {
          const digest = await crypto.subtle.digest('SHA-256', await result.file.arrayBuffer());
          sha256 = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase();
        }
        return {
          ok: true,
          plan: {
            targetBitrateKbps: plan.targetBitrateKbps,
            targetSampleRate: plan.targetSampleRate,
            targetChannels: plan.targetChannels,
            safeTargetBytes: plan.safeTargetBytes,
            confirmations: confirmations.map((item) => item.type)
          },
          inputBytesRead: result.inputBytesRead,
          outputBytes: result.outputBytes,
          outputType: result.file.type,
          outputSha256: sha256,
          outputDurationMs: result.metadata.durationMs,
          outputSampleRate: result.metadata.sampleRate,
          outputChannels: result.metadata.channels,
          processingElapsedMs: result.durationMs,
          encodePasses: result.encodePasses,
          workerUsed: result.workerUsed,
          passthrough: result.passthrough,
          peakBufferedBytes: result.peakBufferedBytes,
          maxHeartbeatGapMs,
          progress,
          outputValidationValid: outputValidation.valid,
          outputValidationViolations: outputValidation.violations.map((item) => item.code),
          warnings: result.warnings.map((item) => item.code),
          cleanup: result.cleanup ?? null
        };
      } catch (error) {
        clearInterval(heartbeat);
        return {
          ok: false,
          errorCode: error?.code ?? null,
          errorDetails: error?.details ?? null,
          planSnapshot: {
            executable: plan.executable,
            passthrough: plan.passthrough,
            unfixable: plan.unfixable,
            confirmations: plan.confirmations.map((item) => ({
              type: item.type, resolved: item.resolved, accepted: item.accepted
            }))
          },
          inspectedSnapshot: {
            signatureMime: inspected.signatureMime,
            container: inspected.container,
            codec: inspected.codec,
            durationMs: inspected.durationMs,
            sampleRate: inspected.sampleRate,
            channels: inspected.channels,
            errorCode: inspected.errorCode
          },
          maxHeartbeatGapMs,
          progress,
          cancelLatencyMs: abortAt === null ? null : performance.now() - abortAt
        };
      }
    };
  }, implementationSource);
}

async function main() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'uploadfit-s2-gate-'));
  const started = Date.now();
  const summary = { environment: null, fixture: null, success: null, cancel: null, reuse: null, cleanup: null };
  try {
    process.stdout.write(`[s2-gate] generating ${fixtureBytes}-byte PCM${bitDepth} WAV fixture ...\n`);
    const fixturePath = await generateFixture(tempDir);
    const fixtureStat = await stat(fixturePath);
    summary.fixture = {
      bytes: fixtureStat.size,
      source: `scripts/audio-probe/generate-fixture.mjs --bytes=${fixtureBytes} --bit-depth=${bitDepth}; synthetic-only; file removed after capture`
    };
    const implementationSource = await buildS2WorkerImplementation();
    const server = await serveDirectory();
    const port = server.address().port;
    let browser = null;
    try {
      browser = await chromium.launch();
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${port}/test-pages/probe.html`);
      await page.setContent(`
        <input id="file" type="file" />
      `);
      await installHarness(page, implementationSource);
      const input = page.locator('#file');
      await input.setInputFiles(fixturePath);

      process.stdout.write('[s2-gate] success case: 200MB WAV -> S2 chain ...\n');
      const success = await page.evaluate(async (gateMaxBytes) => {
        const file = document.querySelector('#file').files[0];
        return window.__s2GateRun(file, gateMaxBytes);
      }, maxBytes);
      summary.success = success;

      if (success?.ok) {
        process.stdout.write('[s2-gate] cancel case: re-run the same 200MB input, abort after first progress ...\n');
        await input.setInputFiles(fixturePath);
        const cancel = await page.evaluate(async (gateMaxBytes) => {
          const file = document.querySelector('#file').files[0];
          return window.__s2GateRun(file, gateMaxBytes, { abortOnFirstProgress: true });
        }, maxBytes);
        summary.cancel = cancel;
      } else {
        summary.cancel = { ok: false, errorCode: 'SKIPPED_AFTER_SUCCESS_FAILURE' };
      }

      process.stdout.write('[s2-gate] reuse case: small in-page WAV after cancel ...\n');
      const reuse = await page.evaluate(async () => {
        const small = window.__s2Wav(2);
        return window.__s2GateRun(small, 1_000_000);
      });
      summary.reuse = reuse;
    } finally {
      if (browser) await browser.close();
      server.close();
    }
    summary.environment = {
      runner: 'local Playwright Chromium (production-equivalent S2 handler + frozen lamejs Worker); real-Tabbit gate is owned by V2-S4',
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      startedAt: new Date(started).toISOString(),
      wallClockMs: Date.now() - started
    };
    summary.cleanup = { tempFixtureRemoved: !keepFixture, tempDir: keepFixture ? tempDir : null };
  } finally {
    if (!keepFixture) await rm(tempDir, { recursive: true, force: true });
  }

  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  const passed = Boolean(
    summary.success?.ok
    && summary.success.outputBytes > 0
    && summary.success.outputBytes <= maxBytes
    && summary.success.outputValidationValid === true
    && summary.success.workerUsed === true
    && summary.cancel?.ok === false
    && summary.cancel?.errorCode === 'AUDIO_PROCESSING_CANCELLED'
    && Number.isFinite(summary.cancel?.cancelLatencyMs)
    && summary.cancel.cancelLatencyMs <= 1000
    && summary.reuse?.ok === true
  );
  process.exitCode = passed ? 0 : 1;
}

await main();
