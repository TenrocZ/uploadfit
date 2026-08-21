import { test, expect } from '@playwright/test';
import { createAudioHandler } from '../../src/audio/handler.js';
import { createMediaHandlerRegistry } from '../../src/core/media-handlers.js';

test.describe('S2 audio MediaHandler boundary', () => {
  test('exposes the ordered S2 methods without controller/UI registration', () => {
    const handler = createAudioHandler();
    expect(handler.kind).toBe('audio');
    expect(handler.supports(new File([new Uint8Array([1])], 'voice.mp3', { type: 'audio/mpeg' }), {
      mediaKind: 'audio', multiple: false
    })).toBe(true);
    expect(handler.supports(new File([new Uint8Array([1])], 'voice.mp3', { type: 'audio/mpeg' }), {
      mediaKind: 'image', multiple: false
    })).toBe(false);
    expect(typeof handler.inspect).toBe('function');
    expect(typeof handler.validate).toBe('function');
    expect(typeof handler.plan).toBe('function');
    expect(typeof handler.resolveConfirmation).toBe('function');
    expect(typeof handler.process).toBe('function');
    expect(typeof handler.validateOutput).toBe('function');
    handler.dispose();
  });

  test('registers image and audio adapters and rejects unknown kinds', () => {
    const registry = createMediaHandlerRegistry({ audioHandler: createAudioHandler() });
    expect(registry.kinds()).toEqual(['image', 'audio']);
    expect(registry.get('audio').kind).toBe('audio');
    expect(registry.get('video').supports()).toBe(false);
    registry.dispose();
  });
});
