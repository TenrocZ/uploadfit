# V2-S2 Handoff：音频规划、流式处理与复检

- Status: `READY_FOR_ACCEPTANCE`（返工第 1 轮完成，申请复验）
- Date: 2026-08-21
- Start commit: `31d3d2b669ab5bf390cdd6a84b153e802811fb1f`
- End commit: `c58805b`（本轮 S2 复验修复、processing 取消清理与非 WAV 停止回归的聚焦提交；历史 V2-S0..S2 聚合基线为 `07d25a4`，未对已验收历史做破坏性重写）
- Rework order: `docs/handoffs/V2-S2-acceptance-rework-order.md`
- Rework report: `docs/handoffs/V2-S2-rework-report.md`
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

Abort 发送 `CANCEL(taskId)`；收到 `CANCELLED` 或 1,000ms 截止后统一 terminate/revoke/clear queue，并返回 `AUDIO_PROCESSING_CANCELLED`。taskId 不匹配的 Worker 消息全部忽略。失败、取消和复检失败均不回填半成品。

## 错误码与用户动作

| 错误码 | 动作 |
|---|---|
| `AUDIO_TARGET_UNSAFE` | 停止，提示页面上限低于 48kbps 安全底线 |
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

返工第 1 轮（2026-08-21）实测：25 个 Node/Vitest 测试文件、227 个测试通过；`npm run test:e2e -- --reporter=line --workers=1` 141/141 通过（含 6 个真实 lamejs Worker 集成用例）；production bundle 185,068 bytes，SHA-256 `8BBBD1CB9564E2A6D01E53ABEC71B8B6D46AABB765FA90C16C3C7960E7EE404E`，与返工前逐字节一致（音频引擎未进生产入口，S3/S4 接线）。

## 大文件慢速门禁（已执行一次）

```powershell
npm run audio:s2:gate
```

语义：本地 Playwright Chromium 运行真实 S2 handler 链（planner → 确认 → processAudio → 独立复检）与冻结 lamejs Worker；生成 200,000,044-byte PCM32 WAV 至系统临时目录，取证后删除。本次执行结果：输出 20,834,880-byte `audio/mpeg`（SHA-256 `9394F96A5CDBD87823BB3223F584BB844471A74C6AA73DAB2B0EB44C39F16FBC`），处理 35,204ms，主线程心跳最大 112.1ms，峰值缓冲 26,825,856 bytes，首中尾帧复检 `203/valid`，processing 中取消延迟 9.7ms，取消清理完整，取消后小文件复用正常。结构化结果：`docs/evidence/V2-S2/audio-200-to-100.json`。

说明：`capture-tabbit.mjs` 是 S0 的真实 Tabbit CDP 探针（参数 `--cdp=http://127.0.0.1:<port>`），真实 Tabbit 200MB 门禁按总控第 5 节归 V2-S4 执行；S2 阶段以 production-equivalent 门禁为准。

## 已知限制

- **冻结子集**：ADR-005 冻结的 `lamejs@1.2.1` 只编码（PCM WAV→MP3）。超限 MP3 重编码与 M4A/AAC 转码需要未验证的解码路径，planner/validator 停止为 `AUDIO_CODEC_UNSUPPORTED`，不产出虚假可执行计划（返工单 R2-4 裁决；解禁按 ADR-005 条件 4 验证后走新 ADR）。
- **低码率采样率**：冻结 lamejs 在低码率自动降采样（如 44.1kHz stereo@64kbps→24kHz）。48 组合实证表冻结在 `encoder-contract.js`，planner 承诺编码器实际输出率并加 `RESAMPLE_AUDIO`。
- **确认重放**：confirmation id 绑定 `type + suggestedPayload` 哈希，参数变化即失配；参数完全相同的跨文件重放由 S3 controller 按任务维度拦截（引擎层无文件身份）。
- **passthrough 统计偏差**：passthrough 结果 `workerUsed: false / encodePasses: 0`（无处理发生，不谎报 worker 使用），已批准偏差（返工单 R2-9）。
- **共享 runtime 生命周期**：pipeline 只 dispose 自建 runtime；调用方传入的 runtime 由调用方负责。

## 交给 S3

- handler/registry 注册边界和安全 snapshot：本文件示例
- progress 事件：`PROGRESS`，ratio 单调且不快于 100ms
- 取消调用：`AbortController.abort()` 或 runtime `cancel()`
- 错误码到用户动作：上表
- 处理/清理时序：上图
- fixture policy：`docs/evidence/V2-S2/fixture-manifest.json`
