import { describe, expect, it } from 'vitest';
import {
  classifyMediaKind,
  findFileInputFromEvent,
  isAudioUploader,
  isImageUploader
} from '../../src/dom/input-discovery.js';

function fakeInput({ accept = null, label = '', id = null } = {}) {
  const attributes = new Map();
  if (accept !== null) attributes.set('accept', accept);
  if (id !== null) attributes.set('id', id);
  return {
    nodeType: 1,
    multiple: false,
    matches: (selector) => selector === 'input[type="file"]',
    getAttribute: (name) => attributes.get(name) ?? null,
    labels: label ? [{ textContent: label }] : [],
    closest: () => null,
    ownerDocument: { querySelectorAll: () => [] }
  };
}

describe('uploader discovery pure boundaries', () => {
  it('accepts image formats and associated image labels only', () => {
    expect(isImageUploader(fakeInput({ accept: 'image/png' }))).toBe(true);
    expect(isImageUploader(fakeInput({ label: '证件照' }))).toBe(true);
    expect(isImageUploader(fakeInput({ accept: 'application/pdf' }))).toBe(false);
  });

  it('locates file input through composedPath without walking the DOM', () => {
    const input = fakeInput({ accept: 'image/jpeg' });
    const result = findFileInputFromEvent({ composedPath: () => [{}, input, {}] });
    expect(result).toBe(input);
  });

  it('classifies audio, mixed and weak contexts without stealing image inputs', () => {
    const audio = fakeInput({ accept: 'audio/*' });
    const explicit = fakeInput({ accept: '.mp3,.m4a,.wav', label: '上传录音文件' });
    const mixed = fakeInput({ accept: 'image/*,audio/*', label: '上传文件' });
    const video = fakeInput({ accept: 'video/mp4', label: '上传视频' });
    const bare = fakeInput({ label: '上传文件' });
    expect(isAudioUploader(audio)).toBe(true);
    expect(classifyMediaKind(audio)).toBe('audio');
    expect(classifyMediaKind(explicit)).toBe('audio');
    expect(classifyMediaKind(mixed)).toBe(null);
    expect(classifyMediaKind(video)).toBe(null);
    expect(classifyMediaKind(bare, 'audio/mpeg')).toBe(null);
    expect(isImageUploader(audio)).toBe(false);
  });
});
