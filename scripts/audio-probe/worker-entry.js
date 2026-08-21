import { encodeWavToMp3 } from './encoder.js';

self.onmessage = async (event) => {
  try {
    const result = await encodeWavToMp3(event.data.file, {
      ...(event.data.options ?? {}),
      collectOutput: false,
      onChunk: (chunk) => {
        const transferable = chunk.byteOffset === 0 && chunk.byteLength === chunk.buffer.byteLength
          ? chunk.buffer
          : chunk.slice().buffer;
        self.postMessage({ type: 'chunk', buffer: transferable }, [transferable]);
      },
      onProgress: (progress) => {
        self.postMessage({ type: 'progress', progress, peakPcmBytes: progress.peakPcmBytes ?? 0 });
      }
    });
    self.postMessage({
      type: 'done',
      result: {
        plan: result.plan,
        outputBytes: result.outputBytes,
        peakBufferedBytes: result.peakBufferedBytes,
        peakPcmBytes: result.peakPcmBytes,
        encodePasses: result.encodePasses
      }
    });
  } catch (error) {
    self.postMessage({
      type: 'error',
      errorName: error?.name ?? 'Error',
      message: typeof error?.message === 'string' ? error.message.slice(0, 240) : 'AUDIO_WORKER_FAILED'
    });
  }
};
