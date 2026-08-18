import { describe, expect, it } from 'vitest';
import { createLogger } from '../../src/utils/logger.js';

describe('diagnostic logger', () => {
  it('keeps only the approved top-level fields', () => {
    const logger = createLogger({ enabled: true });
    logger.emit('FILE_VALID', {
      taskId: 'task-00000000-0000-4000-8000-000000000001',
      mime: 'image/jpeg',
      bytes: 120,
      width: 390,
      height: 567,
      durationMs: 12,
      errorCode: null,
      rules: {
        formats: ['jpg', 'private-id-card.jpg'],
        minSize: { value: 30, unit: 'KB', evidence: 'full page text' },
        maxSize: { value: 120, unit: 'KB' },
        width: { exact: 390, note: 'private page text' },
        evidence: ['private page text'],
        pageText: 'full page text with private information',
        token: 'secret-token'
      },
      fileName: 'private-id-card.jpg',
      content: 'base64-or-pixels',
      pageText: 'full page text with private information',
      token: 'secret-token'
    });

    const [entry] = logger.getEntries();
    expect(entry).toMatchObject({
      event: 'FILE_VALID',
      taskId: 'task-00000000-0000-4000-8000-000000000001',
      mime: 'image/jpeg',
      bytes: 120,
      width: 390,
      height: 567,
      durationMs: 12,
      errorCode: null,
      rules: {
        formats: ['jpg'],
        minSize: { value: 30, unit: 'KB' },
        maxSize: { value: 120, unit: 'KB' },
        width: { exact: 390 }
      }
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
    logger.emit('SESSION_STARTED', {
      taskId: 'task-00000000-0000-4000-8000-000000000002'
    });
    expect(logger.getEntries()).toEqual([]);
  });

  it('does not allow callers to forge event or time fields', () => {
    const logger = createLogger({ enabled: true });
    logger.emit('FILE_VALID', {
      event: 'FORGED_EVENT',
      time: 0,
      taskId: 'task-00000000-0000-4000-8000-000000000003'
    });

    const [entry] = logger.getEntries();
    expect(entry.event).toBe('FILE_VALID');
    expect(entry.time).not.toBe(0);
    expect(entry.taskId).toBe('task-00000000-0000-4000-8000-000000000003');
  });

  it('drops unknown event names and values disguised as task identifiers', () => {
    const logger = createLogger({ enabled: true });

    expect(logger.emit('private-id-card.jpg')).toBe(false);
    expect(logger.emit('FILE_SELECTED', {
      taskId: 'private-id-card.jpg',
      fileName: 'private-id-card.jpg'
    })).toBe(true);

    const entries = logger.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).not.toHaveProperty('taskId');
    expect(JSON.stringify(entries)).not.toContain('private-id-card.jpg');
  });

  it('deep-freezes emitted entries and nested rule summaries', () => {
    const logger = createLogger({ enabled: true });
    logger.emit('RULES_PARSED_LOCAL', {
      taskId: 'task-00000000-0000-4000-8000-000000000004',
      rules: { formats: ['jpg'], width: { exact: 390 } }
    });

    const [entry] = logger.getEntries();
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.rules)).toBe(true);
    expect(Object.isFrozen(entry.rules.formats)).toBe(true);
    expect(Object.isFrozen(entry.rules.width)).toBe(true);
  });
});
