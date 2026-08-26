export const CONTEXT_TEXT_LIMIT = 6000;
export const AI_TEXT_LIMIT = 2000;
export const AI_TIMEOUT_MS = 3000;
export const AI_CALL_LIMIT_PER_PAGE = 3;
export const REJECTION_WINDOW_MS = 30000;
export const DOM_DEBOUNCE_MS = 100;
export const AUTO_RULE_CONFIDENCE = 0.90;
export const CONFIRM_RULE_CONFIDENCE = 0.75;
export const ASPECT_RATIO_TOLERANCE = 0.015;
export const MAX_AUTO_RETRIES = 1;
export const MAX_INPUT_BYTES = 50 * 1024 * 1024;
// Audio pages commonly publish 100–200 MB limits; this is a parsing ceiling,
// not permission to load that amount into memory.
export const AUDIO_MAX_RULE_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_DECODE_PIXELS = 80_000_000;
export const MAX_DIMENSION = 20_000;
export const ENCODE_QUALITY_MIN = 0.45;
export const ENCODE_QUALITY_MAX = 0.95;
export const ENCODE_SEARCH_STEPS = 8;
export const RESIZE_RETRY_LIMIT = 3;
export const TARGET_MAX_RATIO = 0.90;

// V2 audio discovery/metadata limits.  The processing pipeline is intentionally
// owned by the later S2 stage; S1 only uses the bounded inspection contract.
export const AUDIO_METADATA_READ_LIMIT = 1 * 1024 * 1024;
export const AUDIO_INPUT_CHUNK_BYTES = 4 * 1024 * 1024;
export const AUDIO_PCM_BUFFER_BUDGET = 32 * 1024 * 1024;
export const AUDIO_SAFE_TARGET_RATIO = 0.95;
export const AUDIO_CONTAINER_RESERVE_BYTES = 64 * 1024;
export const AUDIO_MIN_BITRATE_KBPS = 48;
export const AUDIO_ENCODE_PASS_LIMIT = 2;
export const AUDIO_PROGRESS_INTERVAL_MS = 100;
export const AUDIO_CANCEL_DEADLINE_MS = 1000;
// Long speech recordings can legitimately require several minutes of local
// decode/re-encode work. Cancellation remains bounded separately at 1 second;
// this ceiling only prevents a healthy long task from being killed at 2 min.
export const AUDIO_PROCESS_TIMEOUT_MS = 15 * 60 * 1000;
export const AUDIO_BITRATE_LADDER_KBPS = Object.freeze([
  320, 256, 224, 192, 160, 128, 112, 96, 80, 64, 56, 48
]);
