await page.goto('http://127.0.0.1:8765/test-pages/probe.html', { waitUntil: 'domcontentloaded' });

return await page.evaluate(async () => {
  const source = `
self.onmessage = async () => {
  const decoder = typeof AudioDecoder === 'function';
  const encoder = typeof AudioEncoder === 'function';
  const supported = async (kind, config) => {
    try {
      const api = kind === 'decoder' ? AudioDecoder : AudioEncoder;
      const result = await api.isConfigSupported(config);
      return { supported: Boolean(result && result.supported), config: result && result.config ? {
        codec: result.config.codec,
        sampleRate: result.config.sampleRate,
        numberOfChannels: result.config.numberOfChannels,
        bitrate: result.config.bitrate || null
      } : null };
    } catch (error) {
      return { supported: false, errorName: error && error.name || 'Error' };
    }
  };
  self.postMessage({
    worker: true,
    decoder,
    encoder,
    mp3Decode: decoder ? await supported('decoder', {
      codec: 'mp3', sampleRate: 48000, numberOfChannels: 2
    }) : null,
    aacDecode: decoder ? await supported('decoder', {
      codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 1,
      description: new Uint8Array([0x11, 0x88])
    }) : null,
    aacEncode: encoder ? await supported('encoder', {
      codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 1, bitrate: 128000
    }) : null
  });
};`;
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  const result = await new Promise((resolve, reject) => {
    const worker = new Worker(url);
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('WORKER_PREFLIGHT_TIMEOUT'));
    }, 5000);
    worker.onmessage = (event) => {
      clearTimeout(timeout);
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = () => {
      clearTimeout(timeout);
      worker.terminate();
      reject(new Error('WORKER_PREFLIGHT_ERROR'));
    };
    worker.postMessage({ type: 'RUN' });
  }).finally(() => URL.revokeObjectURL(url));

  return {
    ...result,
    mediaRecorder: typeof MediaRecorder === 'function' ? {
      mp4: MediaRecorder.isTypeSupported('audio/mp4'),
      aacLc: MediaRecorder.isTypeSupported('audio/mp4;codecs=mp4a.40.2'),
      webmOpus: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    } : null,
    userAgent: navigator.userAgent
  };
});
