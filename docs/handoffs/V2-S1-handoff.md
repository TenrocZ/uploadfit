# V2-S1 Handoff

- Status: `ACCEPTED`（2026-08-21 独立复验通过）
- Start commit: `31d3d2b669ab5bf390cdd6a84b153e802811fb1f`
- End commit: `WORKTREE`（本次交付尚未创建提交）
- Agent: `Codex`
- Environment: Windows; Node `v22.20.0`; npm `10.9.3`; S1 tests in Playwright/Node; S0 real Tabbit evidence is `1.10.16.0` in the separate S0 handoff
- Production bundle: 见 `docs/evidence/V2-S1/result.json`，最终构建后回填 bytes/SHA

## Scope delivered

| Requirement | Result | Code | Test | Evidence |
|---|---|---|---|---|
| audio/image/mixed/video uploader 分类 | PASS | `src/dom/input-discovery.js`, `src/dom/context-extractor.js` | `tests/unit/input-discovery.test.js`, `tests/integration/audio-discovery.test.js` | `result.json` |
| 音频格式/大小规则归一与冲突 | PASS | `src/rules/normalizer.js`, `src/rules/deterministic-parser.js`, `src/rules/resolver.js`, `src/rules/schema.js`, `src/rules/validators.js` | `tests/unit/audio-rules.test.js` | `result.json` |
| MP3/WAV/AAC-LC M4A 签名 | PASS（冻结子集） | `src/audio/signatures.js` | `tests/unit/audio-signatures.test.js` | `fixture-manifest.json` |
| 有界元数据与取消 | PASS；真实 `data >1MiB` header-only 回归通过 | `src/audio/metadata.js`, `src/audio/errors.js`, `src/audio/signatures.js` | `tests/unit/audio-metadata.test.js` | `README.md`, `fixture-manifest.json` |
| S1 validation / stop conditions | PASS | `src/audio/validators.js` | `tests/unit/audio-validation.test.js` | `README.md` |
| core 防止 S1 音频误进图片管线 | PASS | `src/core/task-controller.js` | S1 discovery + V1 regression | `README.md` |

## Changed files

| Path | Purpose |
|---|---|
| `src/audio/*.js` | Audio errors, bounded metadata, signatures and validation |
| `src/dom/input-discovery.js` | Shared media classification and lifecycle |
| `src/dom/context-extractor.js` | `mediaKind` context field |
| `src/rules/*.js` | Audio MIME/extensions, duration/audio constraints and semantic stops |
| `src/core/task-controller.js` | Snapshot fields and S1 audio early stop |
| `src/index.js`, `src/config.js` | Public exports and bounded audio constants |
| `tests/unit/audio-*.test.js`, `tests/integration/audio-discovery.test.js` | S1 regression coverage |
| `docs/evidence/V2-S1/*`, this file | Evidence, fixture manifest and handoff |

## Dependency and license changes

- No codec dependency is imported by the S1 production path. The separate S0 probe locks `lamejs@1.2.1`; its license/NOTICE are recorded only under `docs/evidence/V2-S0/licenses/`.

## Contract and ADR changes

- Accepted ADR: `docs/decisions/ADR-004-V2-S1-音频契约增量.md` records the optional `RuleSet` fields, leading-dot audio extensions, bounded metadata contract and rollback boundary.
- Upstream V2-S0 handoff/ADR and real Tabbit evidence are `ACCEPTED`; the S1 dependency hold is closed.

## Verification

| Command / manual case | Result |
|---|---|
| `npm test -- --run` | PASS: 23 files, 209 tests |
| `npm run build` | PASS; bundle bytes/SHA recorded after final build |
| `npm run static-check` | PASS |
| S1 audio discovery Playwright grep | PASS: 2 tests; helper emitted a post-run `EADDRINUSE` warning on the already-used `127.0.0.1:8765` listener |
| Full Playwright regression | PASS: 118 tests; same post-run `EADDRINUSE` helper warning |
| `git diff --check` | PASS |

## Copyable contract examples for S2

Public imports:

```js
import { inspectAudio, audioMetadataSnapshot } from './src/audio/metadata.js';
import { validateAudioMetadata } from './src/audio/validators.js';
```

The following are bounded, JSON-safe examples (no `File`, name, tags or bytes):

```js
const mp3 = {
  mediaKind: 'audio', signatureMime: 'audio/mpeg', container: 'mp3', codec: 'mp3',
  size: 2_000_000, durationMs: 120_000, sampleRate: 44_100, channels: 1,
  bitDepth: null, averageBitrate: 128_000, variableBitrate: false,
  seekable: true, inspectedBytes: 2_000_000, errorCode: null, warnings: []
};
const page = {
  mediaKind: 'audio', formats: ['audio/mpeg'], extensions: ['.mp3'],
  minBytes: null, maxBytes: 3_000_000,
  duration: { exactMs: null, minMs: null, maxMs: null },
  audio: { sampleRates: [], channels: [], bitDepths: [] }
};
validateAudioMetadata(mp3, page).valid; // true; passthrough, no confirmation

validateAudioMetadata({ ...mp3, size: 200_000_000 }, { ...page, maxBytes: 100_000_000 });
// valid=false; AUDIO_FILE_TOO_LARGE + AUDIO_LOSSY_TRANSCODE confirmation

validateAudioMetadata({ ...mp3, signatureMime: 'audio/wav', container: 'wav', codec: 'pcm' }, page);
// valid=false; TRANSCODE_AUDIO + AUDIO_LOSSY_TRANSCODE confirmation

validateAudioMetadata(mp3, {
  ...page, formats: [], extensions: [], maxBytes: null,
  duration: { exactMs: null, minMs: null, maxMs: 7_200_000 }
});
// valid=false; RULES_INSUFFICIENT / AUDIO_DURATION_LIMIT_UNFIXABLE
```

| Input / codec | S1 result |
|---|---|
| MP3 / `audio/mpeg` | supported; passthrough when MP3 + maxBytes are explicit |
| PCM WAV / `audio/wav` | supported metadata; S1 only requests later MP3 confirmation |
| AAC-LC M4A / `audio/mp4` | supported metadata; S1 only requests later MP3 confirmation |
| WebM/Opus, raw AAC, compressed WAV, malformed/truncated input | stable unsupported/invalid stop |

`inspectAudio` enforces a maximum of `1_048_576` inspected bytes by default and
checks `AbortSignal` before and after each bounded read.

## Resource and privacy audit

- `inspectAudio` reads only bounded head/tail slices, default total `<= 1 MiB`; it never calls `file.arrayBuffer()`.
- No audio bytes, PCM, tags, filename or metadata are sent to AI/network or persisted.
- Abort is checked before/after each read; no Worker/object URL is created in S1.
- `audioMetadataSnapshot` exposes only the shared safe fields.

## Cross-stage changes

- `src/core/task-controller.js` only adds a guard so newly discovered audio inputs cannot enter the image processor before S2/S3; no audio processing behavior is implemented.

## Known limitations

- V2-S0 has been independently accepted; S1 uses the same frozen MP3/PCM WAV/AAC-LC M4A subset.
- WebM/Opus, raw AAC, compressed WAV and malformed/oversized metadata are stopped deterministically.
- No encoding, planner, Worker, confirmation UI, injection or retry behavior is part of S1.

## Final acceptance

- 已按 `docs/v2/work-orders/20-V2-S1-音频发现规则与元数据.md` 复验通过；结论见 `docs/handoffs/V2-S0-S1-final-acceptance.md`。V2-S2 可直接消费这里冻结的发现、规则、元数据与 stop contract。
