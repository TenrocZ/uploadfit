/**
 * Detect browser capabilities without touching a page-owned form control.
 * @param {Document} documentRef
 * @returns {Record<string, unknown>}
 */
export function detectCapabilities(documentRef = globalThis.document) {
  const capabilities = {
    file: typeof globalThis.File === 'function',
    blob: typeof globalThis.Blob === 'function',
    dataTransfer: typeof globalThis.DataTransfer === 'function',
    inputFilesAssignable: false,
    canvasToBlob: false,
    createImageBitmap: typeof globalThis.createImageBitmap === 'function',
    worker: typeof globalThis.Worker === 'function',
    offscreenCanvas: typeof globalThis.OffscreenCanvas === 'function',
    blobWorkerAllowed: false,
    tabbitAi: {
      available: false,
      officialApi: null,
      notes: 'Official Tabbit AI provider path has not been confirmed.'
    }
  };

  if (!documentRef?.createElement) return capabilities;

  const input = documentRef.createElement('input');
  input.type = 'file';
  input.hidden = true;
  const mountPoint = documentRef.body ?? documentRef.documentElement;
  mountPoint?.append(input);

  try {
    const canvas = documentRef.createElement('canvas');
    capabilities.canvasToBlob = typeof canvas.toBlob === 'function';

    if (capabilities.dataTransfer && capabilities.file && input.files) {
      const dataTransfer = new globalThis.DataTransfer();
      const probeFile = new globalThis.File(
        ['UploadFit capability probe'],
        'uploadfit-capability-probe.bin',
        { type: 'application/octet-stream', lastModified: 0 }
      );
      dataTransfer.items.add(probeFile);
      input.files = dataTransfer.files;
      capabilities.inputFilesAssignable = input.files.length === 1;
    }

    if (
      capabilities.worker &&
      capabilities.blob &&
      typeof globalThis.URL?.createObjectURL === 'function'
    ) {
      const workerBlob = new globalThis.Blob(['self.close()'], {
        type: 'text/javascript'
      });
      const workerUrl = globalThis.URL.createObjectURL(workerBlob);
      try {
        const worker = new globalThis.Worker(workerUrl);
        worker.terminate();
        capabilities.blobWorkerAllowed = true;
      } finally {
        globalThis.URL.revokeObjectURL(workerUrl);
      }
    }
  } catch (error) {
    capabilities.probeErrorCode = error?.name ?? 'CAPABILITY_PROBE_FAILED';
  } finally {
    input.remove();
  }

  return capabilities;
}

