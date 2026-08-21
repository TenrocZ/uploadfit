# V2-S0 / V2-S1 返工报告

> 历史施工报告：后续二次返工已经关闭；最终状态以 `V2-S0-S1-second-rework-report.md` 与 `V2-S0-S1-final-acceptance.md` 为准。

- 日期：2026-08-21
- 施工状态：S0、S1 均 `READY_FOR_ACCEPTANCE`（不是 `ACCEPTED`）
- 申请顺序：先独立验收 S0，再独立验收 S1；S2–S5 继续 `HOLD`
- 起始历史提交：`31d3d2b669ab5bf390cdd6a84b153e802811fb1f`

## 逐项完成表

| 返工项 | 结果 | 证据 |
|---|---|---|
| R0-1 S0 核心门禁 | 完成：真实 Tabbit 能力、唯一编码器、200MB→100MB、Worker/内存/heartbeat/取消/清理和单 IIFE 证据均已记录 | `docs/evidence/V2-S0/`、`docs/handoffs/V2-S0-handoff.md` |
| R1-1 大 WAV header-only 解析 | 完成：`data` header 先记录声明长度，不要求 payload 驻留；仍拒绝 forged/truncated/zero/inconsistent PCM | `src/audio/signatures.js`、`tests/unit/audio-metadata.test.js`、`tests/unit/audio-signatures.test.js` |
| R1-2 顺序与文档一致性 | 完成：S0 handoff/ADR 已存在并标出真实状态；S1 不再写 absent，追踪矩阵顺序改为先 S0 后 S1 | 本报告、S0/S1 handoff、ADR-004/005、矩阵 |

## S0 编码器与真实 Tabbit结果

唯一探针编码器为 `lamejs@1.2.1`，来源 <https://github.com/zhuker/lamejs>，SPDX `LGPL-3.0`，上游 minified 156,043 bytes。许可原文、传递依赖和 NOTICE 位于 `docs/evidence/V2-S0/licenses/`。构建后的单 IIFE 为 353,264 bytes，SHA-256 `342F301006D05FD5950EB4CD8ED1F66EEC9E7E8C56280D211616B3995E3AD4C8`；无 runtime CDN/fetch/remote Worker，production bundle 未改动（185,068 bytes，SHA `8BBBD1CB9564E2A6D01E53ABEC71B8B6D46AABB765FA90C16C3C7960E7EE404E`）。

真实 Tabbit `1.10.16.0`（remote CDP `9222`）用最终 IIFE 实测：

- 输入：200,000,044-byte PCM32 WAV，SHA `95EA0CA61446C35ADE49C625007D41D937D59C3C3CA1DF97C76C82517AC789D9`，合成、无版权风险，取证后删除。
- 计划：320kbps、mono、safe target 95,000,000 bytes。
- 输出：20,834,880 bytes，`audio/mpeg`，SHA `5309D8402414D6B2FC42B246FC007296B8CC0F0DDFDE27BD37E8D90D18163685`，小于 100,000,000。
- 验证：完整 MP3 frame scan 21,703 帧、duration 520,868.8ms 未裁剪；独立 `AudioDecoder` 首帧样本解码 1,152 frames 通过。
- 资源：Worker=true，选定 256KiB 输入块，peak PCM 327,680 bytes，编码阶段 peak buffered 21,162,560 bytes；考虑复检与 SHA-256 输出缓冲的保守上界 62,832,320 bytes，单遍，max heartbeat gap 189ms。
- 取消：同一真实 Tabbit 启动后立即取消，0.09999990463256836ms；Worker terminated、object URL revoked、无半成品。
- 隐私：外部音频请求 0、持久化音频 0、无用户录音。

独立解码有意只解码首帧样本，并对全输出做帧头/时长扫描；这是为避免大流 `AudioDecoder.flush()` 阻塞 Tabbit renderer，限制已在 ADR-005 和 S0 README 明确，不得扩大为全流音乐质量承诺。

## R1 修复前后复现

修复前，合法 48kHz/16-bit/双声道 WAV 的 `data` chunk 大于 1MiB 时，`parseWavChunks()` 在记录 data 声明前 `break`，返回 `AUDIO_METADATA_INVALID`。修复后，2,400,044-byte fixture（data 2,400,000 bytes，SHA `434F51A25785D7DB10E8284C2B9F95D5A35E6F4341A4C374BD385AAEEE6F6D3F`）返回 `audio/wav`/`pcm`、48kHz、双声道、16-bit、12,500ms，`inspectedBytes <= 1,048,576`；没有读取完整 PCM。forged dataEnd、zero data、blockAlign/byteRate 不一致、truncated fmt 负例继续失败。

## 修改范围与越界说明

- S1：`src/audio/signatures.js`、S1 单元测试及对应 evidence/handoff/ADR。
- S0：`scripts/audio-probe/*`、`test-pages/audio-probe.*`、S0 capability/evidence/handoff/ADR、`package.json`/`package-lock.json` 仅用于锁定 `lamejs`。
- 生成器增加 `--bit-depth=16|24|32` 仅用于临时 synthetic fixture。
- 未修改 production controller/UI/formal pipeline/injection；production `dist/uploadfit.js` bytes/SHA 保持不变；未使用 Node ffmpeg、远程 API 或真实用户音频。

## 测试与回归

- 定向返工：5 个文件、48 个测试通过。
- 辅助 Chromium：能力与 1 秒 Worker smoke 通过，但仅作 `AUXILIARY_ONLY`。
- 真实 Tabbit：小烟测、200MB 成功、立即取消均通过。
- 全量 unit：23 个文件、209 个测试通过；`npm run check` 通过；`git diff --check` 通过（仅有既有 LF/CRLF 提示）。既有全量 E2E 118/118 和 S1 discovery 2/2 通过，收尾的 8765 端口占用是既有 harness 告警，不影响断言。

## 申请状态

S0 handoff 申请 `READY_FOR_ACCEPTANCE`，ADR-005 为 `PROPOSED_FOR_ACCEPTANCE`；主验收方必须先独立决定 S0 是否 `ACCEPTED`，随后才复验 S1。S1 handoff 同样只申请 `READY_FOR_ACCEPTANCE`，不自行批准。两阶段独立通过前，不进入 S2 planner、正式 pipeline、确认 UI、回填或 S3–S5。
