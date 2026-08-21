# V2-S2 Handoff：音频规划、流式处理与复检

- Status: `ACCEPTED`（第三轮返修与复验完成）
- Date: 2026-08-21
- Start commit: `31d3d2b669ab5bf390cdd6a84b153e802811fb1f`
- End code commit: `3967a45`（第三轮修复 canonical stop 完整性、active dispose 生命周期与 PCM 真实覆盖；第二轮 E2E harness 基线 `ab6a765` 保留）
- Rework orders: `docs/handoffs/V2-S2-acceptance-rework-order.md`; `docs/handoffs/V2-S2-reacceptance-rework-order.md`; `docs/handoffs/V2-S2-third-acceptance-rework-order.md`
- Final rework report: `docs/handoffs/V2-S2-third-rework-report.md`
- Prerequisites: V2-S0 `ACCEPTED`、V2-S1 `ACCEPTED`（用户已确认）
- Scope: 独立 audio MediaHandler；没有接入正式 upload intercept、DOM/controller、DataTransfer 或确认 UI

## 交付路径

```text
src/audio/encoder-contract.js
src/audio/confirmation.js
src/audio/planner.js
src/audio/worker-runtime.js
src/audio/pipeline.js
src/audio/handler.js
src/audio/errors.js
src/audio/validators.js
src/core/media-handlers.js
tests/unit/audio-planner.test.js
tests/unit/audio-output-validation.test.js
tests/integration/audio-pipeline.test.js
tests/integration/audio-worker.test.js
tests/integration/audio-handler.test.js
docs/evidence/V2-S2/
```

S0 的 `lamejs@1.2.1`、LGPL/NOTICE 和重建方式继续由 `docs/evidence/V2-S0/` 冻结。S2 runtime 接收构建 harness 注入的 worker implementation source，并在 `encoder-contract.js` 校验包版本/API；缺少 worker/编码器时返回 `AUDIO_WORKER_UNAVAILABLE`，不会退回主线程或换用远程/其他 codec。

## Handler 注册示例（harness only）

```js
import { createAudioHandler } from './src/audio/handler.js';
import { createMediaHandlerRegistry } from './src/core/media-handlers.js';

const audio = createAudioHandler({ workerSource }); // workerSource 来自 S0 冻结构建
const registry = createMediaHandlerRegistry({ audioHandler: audio });
const handler = registry.resolve('audio', file, {
  mediaKind: 'audio', multiple: false, acceptTokens: ['audio/*']
});
const metadata = await handler.inspect(file);
const validation = handler.validate(metadata, rules);
const plan = handler.plan(metadata, rules, { targetChannels: 2 });
const accepted = handler.resolveConfirmation(plan, {
  ...plan.confirmations[0], accepted: true
});
const result = await handler.process(file, accepted, { rules, signal });
const outputValidation = handler.validateOutput(
  result.metadata, rules, accepted, metadata
);
```

`registry.get('video')` 返回 unsupported adapter；不会把未知 kind 猜成 image/audio。`multiple === true` 和 image/audio mixed accept 均不支持自动处理。

## 安全 snapshot

计划/结果交给 UI 或日志时只允许投影数值与稳定码：

```js
{
  mediaKind: 'audio', targetMime: 'audio/mpeg', targetMaxBytes: 100000000,
  safeTargetBytes: 95000000, targetBitrateKbps: 128,
  targetSampleRate: 44100, targetChannels: 2,
  operations: ['TRANSCODE_AUDIO'], encodePassLimit: 2,
  executable: true, passthrough: false, warnings: []
}
```

```js
{
  mediaKind: 'audio', mime: 'audio/mpeg', container: 'mp3', codec: 'mp3',
  size: 1234567, durationMs: 120000, sampleRate: 44100, channels: 2,
  progress: 1, errorCode: null
}
```

不序列化 `File`/`Blob`、文件名、tags、PCM、Base64、帧数据或原始异常。

## 处理与清理时序

```text
inspect (bounded) → validate → plan → resolve confirmation
  → START(taskId)
  → READY → read/demux/decode/downmix/resample/encode/finalize
  → RESULT → independent inspect + output validation
  → (safe margin warning | one lower ladder retry)
  → new File(audio/mpeg) → DISPOSE → terminate + revoke URL
```

Abort 发送 `CANCEL(taskId)`；收到 `CANCELLED` 或 1,000ms 截止后统一 terminate/revoke/clear queue，并返回 `AUDIO_PROCESSING_CANCELLED`。active `dispose()` 不等待默认 timeout：立即结算同一 Promise、清 timer/listener、terminate、revoke URL 并清 active；迟到 RESULT 被忽略，重复 dispose 幂等。pipeline/handler 均持有自建 runtime 生命周期。taskId 不匹配的 Worker 消息全部忽略。失败、取消和复检失败均不回填半成品。

## 错误码与用户动作

| 错误码 | 动作 |
|---|---|
| `AUDIO_TARGET_UNSAFE` | 停止，提示页面上限低于 48kbps 安全底线 |
| `OFFICIAL_TOOL_REQUIRED` | 停止，使用网页指定的官方工具 |
| `AUDIO_ORIGINAL_REQUIRED` / `AUDIO_LOSSLESS_REQUIRED` | 停止，保留原始/无损文件，不诱导继续确认 |
| `AUDIO_CONFIRMATION_REQUIRED` | 展示确认卡；未接受不调用 process |
| `AUDIO_PROCESSING_CANCELLED` | 保留原文件，可重新发起 |
| `AUDIO_OUTPUT_TOO_LARGE` | 两遍仍超限，保留原文件，不第三遍编码 |
| `AUDIO_OUTPUT_VALIDATION_FAILED` | 丢弃输出 Blob，提示复检失败 |
| `AUDIO_WORKER_UNAVAILABLE` | 不在主线程处理长文件，转人工/稍后重试 |
| `AUDIO_DECODE_FAILED` / `AUDIO_ENCODE_FAILED` | 原文件不变，提示文件损坏或处理失败 |

## 验证命令与结果

```powershell
npm test -- --run
npm run build
npm run static-check
npm run test:e2e -- --reporter=line --workers=1
git diff --check
```

返工第 1 轮（2026-08-21）实测：25 个 Node/Vitest 测试文件、227 个测试通过；`npm run test:e2e -- --reporter=line --workers=1` 141/141 通过（含真实 lamejs Worker 集成）；production bundle 185,068 bytes，SHA-256 `8BBBD1CB9564E2A6D01E53ABEC71B8B6D46AABB765FA90C16C3C7960E7EE404E`，与返工前逐字节一致（音频引擎未进生产入口，S3/S4 接线）。

返工第 2 轮（`ab6a765`）补齐 E2E harness 生命周期：runner 先识别 `x-uploadfit-test-server: 1` 再决定复用或自启；只回收自有 child，并等待退出。`S2 audio` targeted E2E 的自启与复用路径各为 23/23，通过后无 `EADDRINUSE`/未捕获 child error；全量回归为 141/141，且无该 warning；自有服务结束后 8765 无残留监听。详见 `docs/handoffs/V2-S2-reacceptance-rework-order.md`。

返工第 3 轮（`3967a45`）实测：`npm run check` 为 25 files / 228 tests，build/static-check 通过；`S2 audio` 定向 E2E 29/29，覆盖六类 canonical stop 防篡改、runtime/pipeline/handler active dispose、迟到结果与 PCM16/24/32 × mono/stereo 六组合真实 Worker。adapter build 166,929 bytes，冻结 `lamejs@1.2.1` 且 forbidden matches 为空。按用户节约资源要求，本轮不重复 141 项全量 E2E、200MB 或真实 Tabbit，复用理由见第三轮报告。

## 大文件慢速门禁（既有证据已执行一次，本轮复用）

```powershell
npm run audio:s2:gate
```

语义：本地 Playwright Chromium 运行真实 S2 handler 链（planner → 确认 → processAudio → 独立复检）与冻结 lamejs Worker；生成 200,000,044-byte PCM32 WAV 至系统临时目录，取证后删除。既有结果：输出 20,834,880-byte `audio/mpeg`（SHA-256 `9394F96A5CDBD87823BB3223F584BB844471A74C6AA73DAB2B0EB44C39F16FBC`），处理 35,204ms，主线程心跳最大 112.1ms，峰值缓冲 26,825,856 bytes，首中尾帧复检 `203/valid`，processing 中取消延迟 9.7ms，取消清理完整，取消后小文件复用正常。结构化结果：`docs/evidence/V2-S2/audio-200-to-100.json`。第三轮未改 encoder/adapter 或输出规划数学，normal completion 已由六组合真实 Worker 小样重验，因此按用户指令不重复慢速门禁。

说明：`capture-tabbit.mjs` 是 S0 的真实 Tabbit CDP 探针（参数 `--cdp=http://127.0.0.1:<port>`），真实 Tabbit 200MB 门禁按总控第 5 节归 V2-S4 执行；S2 阶段以 production-equivalent 门禁为准。

## 已知限制

- **冻结子集**：ADR-005 冻结的 `lamejs@1.2.1` 只编码（PCM WAV→MP3）。超限 MP3 重编码与 M4A/AAC 转码需要未验证的解码路径，planner/validator 停止为 `AUDIO_CODEC_UNSUPPORTED`，不产出虚假可执行计划（返工单 R2-4 裁决；解禁按 ADR-005 条件 4 验证后走新 ADR）。
- **低码率采样率**：冻结 lamejs 在低码率自动降采样（如 44.1kHz stereo@64kbps→24kHz）。48 组合实证表冻结在 `encoder-contract.js`，planner 承诺编码器实际输出率并加 `RESAMPLE_AUDIO`。
- **确认重放**：confirmation id 绑定 `type + suggestedPayload` 哈希，参数变化即失配；参数完全相同的跨文件重放由 S3 controller 按任务维度拦截（引擎层无文件身份）。
- **passthrough 统计偏差**：passthrough 结果 `workerUsed: false / encodePasses: 0`（无处理发生，不谎报 worker 使用），已批准偏差（返工单 R2-9）。
- **共享 runtime 生命周期**：独立 `processAudio()` 不自动 dispose 调用方 runtime；由 `createAudioPipeline()`/handler 显式绑定的 runtime 随其 dispose 生命周期处理。

## 交给 S3

- handler/registry 注册边界和安全 snapshot：本文件示例
- progress 事件：`PROGRESS`，ratio 单调且不快于 100ms
- 取消调用：`AbortController.abort()` 或 runtime `cancel()`
- 错误码到用户动作：上表
- 处理/清理时序：上图
- fixture policy：`docs/evidence/V2-S2/fixture-manifest.json`
