# V2-S0 Handoff

- Status: `ACCEPTED`（2026-08-21 二次返工补全后独立复验通过）
- Start commit: `31d3d2b669ab5bf390cdd6a84b153e802811fb1f`
- End commit: `WORKTREE`（本次交付尚未创建提交）
- Agent: `Codex`
- Date: `2026-08-21`
- Real environment: Tabbit `1.10.16.0`; large gate CDP `9222`; isolated final-banner/capability/cancel capture CDP `9333`
- ADR: `docs/decisions/ADR-005-V2-S0-音频编解码方案.md` → `ACCEPTED`

## Exit evidence

| Gate | Result | Evidence |
|---|---|---|
| Encoder/version/license/relink contract | exact `lamejs@1.2.1`; full texts, provenance, NOTICE and executable replacement/rebuild instructions | `docs/evidence/V2-S0/capability-matrix.json`, `licenses/` |
| Three candidate classes | native WebCodecs, pure-JS lamejs and `wasm-media-encoders@0.7.0` compared; full ffmpeg core retained only as rejection reference | `ADR-005`, `capability-matrix.json` |
| Final single IIFE | 353,484 bytes, SHA `878ABD08E561E627E9C3024C367ADA4036F9C481AC304FE8617DC2D9C0B4EAED`; 220-byte prominent notice; executable payload SHA equals accepted large-run payload; no forbidden matches/remote runtime | `result.json` |
| Real Tabbit capability | API, Blob Worker, WASM and decoder matrix recorded | `capability-matrix.json` |
| Actual >200MB input | 200,000,044-byte synthetic PCM32 WAV | `audio-200-to-100.json`, `fixture-manifest.json` |
| ≤100MB MP3 and independent verification | 20,834,880 bytes, `audio/mpeg`, first-frame AudioDecoder decode and full frame scan pass | `audio-200-to-100.json` |
| Worker/bounded memory/heartbeat | Worker used, selected 256KiB input chunks, peak PCM 327,680 bytes, measured encode buffer 21,162,560 bytes, conservative verification/hash-inclusive upper bound 62,832,320 bytes, max heartbeat 189ms | `resource-profile.json` |
| Cancel/cleanup | immediate large-run cancel retained; final banner build also cancelled after first Worker progress, with no later progress/result, Worker terminated, URL revoked, no partial output | `cleanup.json`, `tabbit-capability-safe-snapshot.json` |
| Privacy | external audio requests 0, persistent audio 0, synthetic-only fixture | `cleanup.json`, `result.json` |

## Implementation boundary

- `scripts/audio-probe/encoder.js` and `worker-entry.js` implement only the isolated probe path: bounded WAV reads, PCM conversion, streaming LAME output, bounded independent verification and cancellation.
- `scripts/audio-probe/build.mjs` embeds the selected upstream minified module and emits one temporary IIFE; no CDN, dynamic import, remote Worker, Node ffmpeg or WASM fetch.
- `test-pages/audio-probe.html` exposes capability/smoke/file/cancel controls for real Tabbit evidence only.
- `src/audio/capabilities.js` remains the shared resource/capability contract. No production controller, formal pipeline, confirmation UI or injection path was added.
- `scripts/audio-probe/generate-fixture.mjs` now supports `--bit-depth=16|24|32` for synthetic gate fixtures; generated files stay in the ignored temp directory and are deleted after capture.

## Bytes and regression context

- Production `dist/uploadfit.js` remains 185,068 bytes, SHA `8BBBD1CB9564E2A6D01E53ABEC71B8B6D46AABB765FA90C16C3C7960E7EE404E`.
- Probe build: `npm run audio:probe:build` → 353,484 bytes, SHA `878ABD08E561E627E9C3024C367ADA4036F9C481AC304FE8617DC2D9C0B4EAED`; stripping the 220-byte notice yields the exact already-tested 353,264-byte payload SHA `342F301006D05FD5950EB4CD8ED1F66EEC9E7E8C56280D211616B3995E3AD4C8`.
- Targeted S0/S1 rework tests: 5 files, 48 tests passed. Final `npm run check` and `git diff --check` are recorded in the rework report after execution.

## Final acceptance

二次返工 R2-1～R2-4 已关闭，复验与门禁见 `docs/handoffs/V2-S0-S1-final-acceptance.md`。S0/S1 均为 `ACCEPTED`，V2-S2 可开工；S5 仍须把稳定公开源码/许可证位置作为候选包发布门禁。辅助 Chromium 与小文件烟测没有替代真实 Tabbit/200MB 核心证据。
