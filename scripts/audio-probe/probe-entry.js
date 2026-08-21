import { probeAudioCapabilities } from '../../src/audio/capabilities.js';
import {
  MP3_ENCODER_DESCRIPTOR,
  createSyntheticWav,
  encodeWavToMp3InWorker
} from './encoder.js';

const AUDIO_WORKER_SOURCE = __AUDIO_WORKER_SOURCE__;

const output = document.getElementById('audio-s0-capability-output');
const status = document.getElementById('audio-s0-status');
const runButton = document.getElementById('audio-s0-run');
const encodeButton = document.getElementById('audio-s0-encode-small');
const cancelButton = document.getElementById('audio-s0-cancel');
const encodeOutput = document.getElementById('audio-s0-encode-output');
const fileInput = document.getElementById('audio-s0-file');
let activeController = null;
let cancelRequestedAt = null;

function render(value) {
  if (output) output.textContent = JSON.stringify(value, null, 2);
  window.uploadFitAudioS0ProbeResult = value;
}

async function run() {
  if (runButton) runButton.disabled = true;
  if (status) status.textContent = '探针运行中（只检查 API，不读取用户文件）…';
  try {
    const result = await probeAudioCapabilities(globalThis);
    render(result);
    if (status) status.textContent = '能力探针完成；200MB→100MB 仍需真实 Tabbit 探针。';
    return result;
  } catch (error) {
    const result = { status: 'ERROR', errorName: error?.name ?? 'Error' };
    render(result);
    if (status) status.textContent = '能力探针失败';
    return result;
  } finally {
    if (runButton) runButton.disabled = false;
  }
}

async function encodeFile(file, options = {}) {
  const controller = options.signal ? null : new AbortController();
  const signal = options.signal ?? controller.signal;
  if (controller) activeController = controller;
  try {
    const result = await encodeWavToMp3InWorker(file, {
      ...options,
      signal,
      globalRef: globalThis,
      workerSource: AUDIO_WORKER_SOURCE
    });
    const safeResult = {
      inputBytes: file.size,
      plan: result.plan,
      outputBytes: result.outputBytes,
      outputSha256: result.outputSha256,
      workerUsed: result.workerUsed,
      maxHeartbeatGapMs: result.maxHeartbeatGapMs ?? null,
      peakBufferedBytes: result.peakBufferedBytes,
      peakPcmBytes: result.peakPcmBytes,
      encodePasses: result.encodePasses,
      verification: result.verification,
      cleanup: result.cleanup
    };
    window.uploadFitAudioS0LastEncoding = safeResult;
    if (encodeOutput) encodeOutput.textContent = JSON.stringify(safeResult, null, 2);
    return safeResult;
  } finally {
    if (controller && activeController === controller) activeController = null;
  }
}

function renderEncodeError(error, fallbackStatus) {
  const cancelled = error?.code === 'AUDIO_PROCESSING_CANCELLED' || error?.name === 'AbortError';
  const result = {
    status: cancelled ? 'CANCELLED' : 'ERROR',
    errorName: error?.name ?? 'Error',
    errorCode: error?.code ?? null,
    message: error?.message ?? null,
    cancelLatencyMs: cancelled
      ? (Number.isFinite(error?.cancelLatencyMs)
        ? error.cancelLatencyMs
        : (Number.isFinite(cancelRequestedAt) ? Math.max(0, performance.now() - cancelRequestedAt) : null))
      : null,
    cleanup: cancelled ? (error.cleanup ?? { workerTerminated: true, objectUrlRevoked: true }) : null
  };
  cancelRequestedAt = null;
  window.uploadFitAudioS0LastEncoding = result;
  if (encodeOutput) encodeOutput.textContent = JSON.stringify(result, null, 2);
  if (status) status.textContent = cancelled ? '已取消，Worker 与对象 URL 已清理。' : fallbackStatus;
  return result;
}

async function runSmallSyntheticEncode() {
  if (encodeButton) encodeButton.disabled = true;
  if (status) status.textContent = '正在 Worker 中编码 1 秒合成 WAV（不读取用户文件）…';
  try {
    const result = await encodeFile(createSyntheticWav({ durationMs: 1000 }));
    if (status) status.textContent = result.verification?.decodable
      ? '合成 Worker 编码与独立 MP3 解码通过。'
      : '合成编码完成，但独立解码未通过。';
    return result;
  } catch (error) {
    return renderEncodeError(error, '合成 Worker 编码失败');
  } finally {
    if (encodeButton) encodeButton.disabled = false;
  }
}

window.uploadFitAudioS0Probe = Object.freeze({ run });
window.uploadFitAudioS0Encoder = Object.freeze({
  descriptor: MP3_ENCODER_DESCRIPTOR,
  encodeFile,
  runSmallSyntheticEncode,
  cancel: () => {
    if (!activeController) return false;
    cancelRequestedAt = performance.now();
    activeController.abort();
    return true;
  }
});
runButton?.addEventListener('click', run);
encodeButton?.addEventListener('click', runSmallSyntheticEncode);
cancelButton?.addEventListener('click', () => {
  if (!window.uploadFitAudioS0Encoder.cancel()) {
    if (status) status.textContent = '当前没有运行中的编码任务。';
  }
});
fileInput?.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  if (status) status.textContent = `正在 Worker 中处理本地 WAV（${file.size} bytes）…`;
  try {
    const result = await encodeFile(file);
    if (status) status.textContent = result.verification?.decodable
      ? '真实文件编码与独立 MP3 解码通过。'
      : '编码完成，但独立解码未通过。';
  } catch (error) {
    renderEncodeError(error, '真实文件编码失败');
  }
});
run();
