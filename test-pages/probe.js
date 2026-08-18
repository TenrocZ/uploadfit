(function () {
  'use strict';

  const input = document.getElementById('probe-file');
  const currentFile = document.getElementById('current-file');
  const injectionCount = document.getElementById('injection-count');
  const verification = document.getElementById('verification');
  const eventLog = document.getElementById('event-log');
  const capabilitySummary = document.getElementById('capability-summary');
  const events = [];
  let sequence = 0;
  let injectionCalls = 0;
  let originalFile = null;

  function describeFile(file) {
    if (!(file instanceof File)) return null;
    return { name: file.name, type: file.type, size: file.size };
  }

  function renderCurrentFile() {
    const file = input.files && input.files[0];
    const description = describeFile(file);
    currentFile.textContent = description
      ? `${description.name} | ${description.type} | ${description.size} bytes`
      : '无';
  }

  function renderEvents() {
    eventLog.textContent = events.length
      ? JSON.stringify(events, null, 2)
      : '等待事件……';
  }

  function recordEvent(type, phase) {
    const file = input.files && input.files[0];
    events.push({
      sequence: ++sequence,
      type,
      phase,
      isTrusted: Boolean(window.event && window.event.isTrusted),
      file: describeFile(file)
    });
    renderCurrentFile();
    renderEvents();
  }

  function eventHandler(event) {
    const phase = event.eventPhase === Event.CAPTURING_PHASE
      ? 'capture'
      : event.eventPhase === Event.AT_TARGET
        ? 'target'
        : 'bubble';
    events.push({
      sequence: ++sequence,
      type: event.type,
      phase,
      isTrusted: event.isTrusted,
      file: describeFile(input.files && input.files[0])
    });
    renderCurrentFile();
    renderEvents();
  }

  document.addEventListener('input', eventHandler, true);
  document.addEventListener('change', eventHandler, true);
  input.addEventListener('input', eventHandler);
  input.addEventListener('change', eventHandler);
  document.addEventListener('input', eventHandler);
  document.addEventListener('change', eventHandler);

  function makeFile(name, type, text) {
    return new File([new Blob([text], { type })], name, { type, lastModified: 0 });
  }

  function assignFile(file, reason) {
    injectionCalls += 1;
    injectionCount.textContent = String(injectionCalls);
    if (!(file instanceof File)) {
      throw new TypeError('probe requires a File');
    }
    if (!input.isConnected) {
      return { ok: false, errorCode: 'INPUT_DETACHED' };
    }
    if (typeof DataTransfer !== 'function') {
      return { ok: false, errorCode: 'DATATRANSFER_UNAVAILABLE' };
    }

    try {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      input.files = dataTransfer.files;
      const actual = input.files && input.files[0];
      const verified = Boolean(
        actual &&
        actual.name === file.name &&
        actual.type === file.type &&
        actual.size === file.size
      );
      verification.textContent = verified
        ? `PASS (${reason})`
        : `FAIL (${reason})`;
      verification.className = `value ${verified ? 'ok' : 'warn'}`;
      renderCurrentFile();
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      return {
        ok: verified,
        inputFilesVerified: verified,
        eventsDispatched: ['input', 'change'],
        file: describeFile(actual),
        errorCode: verified ? null : 'INJECTION_FAILED'
      };
    } catch (error) {
      verification.textContent = `ERROR (${reason}): ${error.name}`;
      verification.className = 'value warn';
      return { ok: false, errorCode: 'INJECTION_FAILED', errorName: error.name };
    }
  }

  function generateA() {
    return makeFile('probe-a.png', 'image/png', 'UploadFit probe A');
  }

  function generateB() {
    return makeFile('probe-b.jpg', 'image/jpeg', 'UploadFit probe B');
  }

  function injectB() {
    if (!originalFile) {
      originalFile = generateA();
      assignFile(originalFile, 'original A');
    }
    return assignFile(generateB(), 'B');
  }

  function restoreA() {
    if (!originalFile) originalFile = generateA();
    return assignFile(originalFile, 'restore original A');
  }

  function setOriginalA() {
    originalFile = generateA();
    return assignFile(originalFile, 'original A');
  }

  function clearLog() {
    events.length = 0;
    sequence = 0;
    renderEvents();
  }

  function detectCapabilities() {
    const canvas = document.createElement('canvas');
    const summary = {
      file: typeof File === 'function',
      blob: typeof Blob === 'function',
      dataTransfer: typeof DataTransfer === 'function',
      inputFilesProperty: 'files' in input,
      inputFilesAssignable: null,
      canvas: typeof HTMLCanvasElement === 'function',
      canvasToBlob: typeof canvas.toBlob === 'function',
      createImageBitmap: typeof createImageBitmap === 'function',
      worker: typeof Worker === 'function',
      offscreenCanvas: typeof OffscreenCanvas === 'function'
    };
    if (summary.dataTransfer) {
      try {
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(generateA());
        input.files = dataTransfer.files;
        summary.inputFilesAssignable = input.files.length === 1;
        input.value = '';
      } catch (error) {
        summary.inputFilesAssignable = false;
        summary.inputFilesError = error.name;
      }
    }
    capabilitySummary.textContent = JSON.stringify(summary, null, 2);
    renderCurrentFile();
    return summary;
  }

  document.getElementById('inject-b').addEventListener('click', injectB);
  document.getElementById('restore-a').addEventListener('click', restoreA);
  document.getElementById('clear-log').addEventListener('click', clearLog);

  window.uploadFitS0Probe = {
    detectCapabilities,
    generateA,
    generateB,
    setOriginalA,
    injectB,
    restoreA,
    clearLog,
    getEvents: () => events.slice(),
    getCurrentFile: () => describeFile(input.files && input.files[0]),
    getOriginalFile: () => originalFile
  };

  detectCapabilities();
}());
