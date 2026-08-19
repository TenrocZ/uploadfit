/**
 * S3 session/task state machine.
 *
 * The table is deliberately explicit. A caller that attempts an unlisted
 * transition receives a diagnostic and no state change.
 */
export const SESSION_STATES = Object.freeze([
  'BOOTING',
  'SCANNING',
  'ARMED',
  'INSPECTING',
  'PASSTHROUGH',
  'WAITING_REJECTION',
  'NEEDS_CONFIRMATION',
  'PROCESSING',
  'INJECTING',
  'RETRYING',
  'SUCCESS',
  'STOPPED',
  'DISPOSED'
]);

export const STATE_TRANSITIONS = Object.freeze({
  BOOTING: Object.freeze(['SCANNING', 'STOPPED', 'DISPOSED']),
  SCANNING: Object.freeze(['ARMED', 'STOPPED', 'DISPOSED']),
  ARMED: Object.freeze(['INSPECTING', 'STOPPED', 'DISPOSED']),
  INSPECTING: Object.freeze([
    'PASSTHROUGH',
    'WAITING_REJECTION',
    'NEEDS_CONFIRMATION',
    'PROCESSING',
    'STOPPED',
    'DISPOSED'
  ]),
  PASSTHROUGH: Object.freeze(['ARMED', 'STOPPED', 'DISPOSED']),
  WAITING_REJECTION: Object.freeze(['INSPECTING', 'STOPPED', 'DISPOSED']),
  NEEDS_CONFIRMATION: Object.freeze(['PASSTHROUGH', 'PROCESSING', 'STOPPED', 'DISPOSED']),
  PROCESSING: Object.freeze(['INJECTING', 'SUCCESS', 'STOPPED', 'DISPOSED']),
  INJECTING: Object.freeze(['RETRYING', 'SUCCESS', 'STOPPED', 'DISPOSED']),
  RETRYING: Object.freeze(['SUCCESS', 'STOPPED', 'DISPOSED']),
  SUCCESS: Object.freeze(['ARMED', 'INSPECTING', 'RETRYING', 'STOPPED', 'DISPOSED']),
  STOPPED: Object.freeze(['ARMED', 'DISPOSED']),
  DISPOSED: Object.freeze([])
});

export function isState(value) {
  return SESSION_STATES.includes(value);
}

export function canTransition(from, to) {
  if (!isState(from) || !isState(to)) return false;
  if (from === to) return true;
  return STATE_TRANSITIONS[from].includes(to);
}

function diagnostic(from, to, details = {}) {
  return Object.freeze({
    code: 'INVALID_STATE_TRANSITION',
    from,
    to,
    details: { ...details }
  });
}

/**
 * @param {{initial?: string, onTransition?: Function, onInvalid?: Function}} options
 */
export function createStateMachine({
  initial = 'BOOTING',
  onTransition = () => {},
  onInvalid = () => {}
} = {}) {
  if (!isState(initial)) throw new TypeError('Unknown initial state: ' + initial);

  let current = initial;
  let lastDiagnostic = null;
  const history = [{
    from: null,
    to: initial,
    time: Date.now(),
    details: {}
  }];

  const machine = {
    get state() {
      return current;
    },

    get history() {
      return history.slice();
    },

    get lastDiagnostic() {
      return lastDiagnostic;
    },

    canTransition(next) {
      return canTransition(current, next);
    },

    transition(next, details = {}) {
      if (current === next) return true;
      if (!canTransition(current, next)) {
        lastDiagnostic = diagnostic(current, next, details);
        onInvalid(lastDiagnostic);
        return false;
      }

      const previous = current;
      current = next;
      const entry = Object.freeze({
        from: previous,
        to: next,
        time: Date.now(),
        details: { ...details }
      });
      history.push(entry);
      onTransition(entry);
      return true;
    },

    transitionOrThrow(next, details = {}) {
      if (machine.transition(next, details)) return true;
      const error = new Error('Illegal state transition: ' + current + ' -> ' + next);
      error.code = lastDiagnostic?.code ?? 'INVALID_STATE_TRANSITION';
      error.diagnostic = lastDiagnostic;
      throw error;
    }
  };

  return machine;
}
