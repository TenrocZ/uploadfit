import { describe, expect, it } from 'vitest';
import { createLogger } from '../../src/utils/logger.js';

describe('diagnostic logger', () => {
  it('keeps only the approved top-level fields', () => {
    const logger = createLogger({ enabled: true });
    logger.emit('FILE_VALID', {
      taskId: 'task-1',
      mime: 'image/jpeg',
      bytes: 120,
      width: 390,
      height: 567,
      durationMs: 12,
      errorCode: null,
      rules: { formats: ['jpg'], maxBytes: 120 },
      fileName: 'private-id-card.jpg',
      content: 'base64-or-pixels',
      pageText: 'full page text with private information',
      token: 'secret-token'
    });

    const [entry] = logger.getEntries();
    expect(entry).toMatchObject({
      event: 'FILE_VALID',
      taskId: 'task-1',
      mime: 'image/jpeg',
      bytes: 120,
      width: 390,
      height: 567,
      durationMs: 12,
      errorCode: null,
      rules: { formats: ['jpg'], maxBytes: 120 }
    });
    expect(entry.time).toEqual(expect.any(Number));
    expect(entry).not.toHaveProperty('fileName');
    expect(entry).not.toHaveProperty('content');
    expect(entry).not.toHaveProperty('pageText');
    expect(entry).not.toHaveProperty('token');
    expect(JSON.stringify(entry)).not.toContain('private-id-card.jpg');
    expect(JSON.stringify(entry)).not.toContain('base64-or-pixels');
    expect(JSON.stringify(entry)).not.toContain('secret-token');
  });

  it('does not emit entries by default', () => {
    const logger = createLogger();
    logger.emit('SESSION_STARTED', { taskId: 'task-2' });
    expect(logger.getEntries()).toEqual([]);
  });
});
