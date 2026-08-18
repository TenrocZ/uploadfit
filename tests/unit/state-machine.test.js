import { describe, expect, it } from 'vitest';
import {
  canTransition,
  createStateMachine
} from '../../src/core/state-machine.js';

describe('S3 state machine', () => {
  it('keeps the contractual main path and rejects illegal transitions', () => {
    const invalid = [];
    const machine = createStateMachine({
      onInvalid: (diagnostic) => invalid.push(diagnostic)
    });

    expect(machine.transition('SCANNING')).toBe(true);
    expect(machine.transition('ARMED')).toBe(true);
    expect(machine.transition('PROCESSING')).toBe(false);
    expect(machine.state).toBe('ARMED');
    expect(invalid[0]).toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
      from: 'ARMED',
      to: 'PROCESSING'
    });
    expect(canTransition('INSPECTING', 'NEEDS_CONFIRMATION')).toBe(true);
    expect(canTransition('DISPOSED', 'ARMED')).toBe(false);
  });

  it('does not run a transition after disposal', () => {
    const machine = createStateMachine({ initial: 'ARMED' });
    expect(machine.transition('DISPOSED')).toBe(true);
    expect(machine.transition('ARMED')).toBe(false);
    expect(machine.state).toBe('DISPOSED');
  });
});

