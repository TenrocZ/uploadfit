import { describe, expect, it } from 'vitest';
import {
  findFileInputFromEvent,
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
});
