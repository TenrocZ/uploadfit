# V2-S2 第三轮返工完成报告

- 日期：2026-08-21
- 状态：`COMPLETED_AND_ACCEPTED`
- 对应返工单：`docs/handoffs/V2-S2-third-acceptance-rework-order.md`
- 最终代码提交：`3967a45`（`fix(audio): enforce plan safety and dispose lifecycle`）
- 证据提交：本报告及更新后的 evidence/handoff 所在提交；文档不自引用尚未生成的 commit hash
- 范围：只修 R4-1～R4-4，不改编码器版本、码率阶梯、两遍上限、生产 controller/UI/DataTransfer 或 Tabbit S4 门禁

## 1. 结论

R4-1、R4-2、R4-3 均已关闭。S2 定向 E2E 29/29、Node/Vitest 25 files / 228 tests、production build、static-check、adapter build 和 `git diff --check` 全部通过。V2-S2 本轮验收结论为 `ACCEPTED`，V2-S3 可以按总控顺序启动。

用户明确要求节约资源、不要重复已经通过且未受修复影响的作业。因此本轮没有重跑 141 项全量 E2E、200MB production-equivalent 门禁或真实 Tabbit；这些证据按第 6 节说明复用，不伪装成本轮新执行结果。

## 2. R4-1：canonical safety stop 防篡改

修改：

- `isAudioPlanExecutable()` 现在要求 `unfixable` 必须是空数组；外部仅改 `executable:true` 不再有效。
- `processAudio()` 在创建/调用 runtime 前重新计算 canonical plan，并以 canonical `unfixable` 为权威立即停止。
- `unfixable` 纳入 plan authority 比对；官方工具、原始录音、无损与规则不足等停止码纳入稳定音频错误映射。
- canonical stop 保留具体错误码，不再误报为 `AUDIO_CONFIRMATION_REQUIRED`。

新增验证：

- planner 单测覆盖 `executable:true + unfixable非空/null` 均不可执行。
- pipeline 参数化覆盖 `OFFICIAL_TOOL_REQUIRED`、`AUDIO_ORIGINAL_REQUIRED`、`AUDIO_LOSSLESS_REQUIRED`、`AUDIO_DURATION_LIMIT_UNFIXABLE`、`AUDIO_TARGET_UNSAFE`、`AUDIO_CODEC_UNSUPPORTED`。
- 六类 plan 均尝试清空 `unfixable` 并伪造可执行状态，结果全部返回原 canonical stop，runtime 总调用数为 0。

## 3. R4-2：active dispose 生命周期

修改：

- runtime active state 持有统一 settle/cleanup closure；active `dispose()` 立即以 `AUDIO_PROCESSING_CANCELLED` 拒绝 Promise。
- cleanup 幂等执行：清 timeout/cancel timer、解除 AbortSignal listener、清 Worker handler、尽力发送 DISPOSE、terminate、revoke object URL、清 active/queue。
- settled 后的迟到 `RESULT` 无法返回成功；重复 dispose 返回稳定结果且不会重复结算；dispose 后新任务返回 `AUDIO_WORKER_UNAVAILABLE`。
- `createAudioPipeline()` 懒创建并持有 runtime；`createAudioHandler()` 持有该 pipeline，因此只传 `workerSource/workerOptions` 的常规用法也能在处理中 dispose。

新增验证：

- silent Worker：runtime dispose 在 500ms 界限内结算，terminated 且 URL 计数归零。
- active pipeline dispose：自建 runtime 立即取消并清理。
- active handler dispose：自建 pipeline/runtime 立即取消并清理。
- late RESULT、重复 dispose、dispose 后新任务均有确定性断言。
- 原有 AbortSignal 1 秒强制终止、共享 runtime 第二任务和真实取消用例继续通过。

## 4. R4-3：冻结 PCM 子集真实覆盖

`tests/integration/audio-real-encoder.test.js` 的内存 WAV helper 已支持有符号 little-endian PCM16、PCM24 和 PCM32，分别生成 mono/stereo，共六种组合。每种组合都通过真实 `lamejs@1.2.1` Blob Worker，并断言：

- 输出 `audio/mpeg`、非零且不超上限；
- sampleRate 与 channels 正确；
- `workerUsed:true`、`encodePasses:1`；
- 独立 output validation 与代表帧 validation 通过；
- Worker terminated、object URL revoked、queue cleared、disposed 均为 true。

fixture 全部在浏览器内存中生成并释放，没有提交音频文件。

## 5. 本轮实际执行的门禁

| 命令 | 结果 |
|---|---|
| `npm test -- --run tests/unit/audio-planner.test.js tests/unit/audio-validation.test.js tests/unit/audio-output-validation.test.js` | 3 files / 23 tests PASS |
| `npm run test:e2e -- --grep "S2 audio" --reporter=line --workers=1` | 29/29 PASS；覆盖本轮所有 source 修改路径 |
| `npm run check` | 25 files / 228 tests；production build 与 static-check PASS |
| `npm run audio:s2:adapter` | PASS；166,929 bytes，冻结 `lamejs@1.2.1`，forbidden matches 为空 |
| `git diff --check` | PASS |

production bundle 仍为 185,068 bytes，SHA-256 `8BBBD1CB9564E2A6D01E53ABEC71B8B6D46AABB765FA90C16C3C7960E7EE404E`；S2 引擎仍未接入 production entry。定向 E2E 的 debug test bundle 为 244,703 bytes。

## 6. 复用而未重复执行的证据

| 既有证据 | 本轮策略 | 依据 |
|---|---|---|
| 全量 E2E 141/141 | 复用 | 本轮不改 production entry、V1 图片路径、E2E runner 或页面夹具；受影响的 S2 文件已由 29 项定向 E2E 覆盖 |
| 200MB→100MB production-equivalent | 复用 `docs/evidence/V2-S2/audio-200-to-100.json` | 冻结 encoder/adapter 和输出规划数学未改；本轮 runtime 正常完成/清理由六种真实 PCM 小样重新验证，修改重点是 process 前拒绝和 active dispose |
| 真实 Tabbit | 仍归 V2-S4 | 本轮没有正式 controller/UI/injection 接线，未扩大阶段范围 |

Git 对比确认 `scripts/audio-probe/s2-worker-adapter.js`、`scripts/audio-probe/encoder.js`、`scripts/audio-probe/build-s2-adapter.mjs` 相对返工基线无修改。以上复用遵循用户“已通过且修复过程不涉及的不要重复作业”的明确要求。

## 7. R4-4 留痕收口

已同步：

- `docs/evidence/V2-S2/result.json`
- `docs/evidence/V2-S2/README.md`
- `docs/evidence/V2-S2/fixture-manifest.json`
- `docs/handoffs/V2-S2-handoff.md`
- `docs/v2/work-orders/90-需求追踪矩阵.md`
- `docs/handoffs/V2-S2-third-acceptance-rework-order.md`

代码提交与证据提交分开记录：`3967a45` 是最终代码基线；本报告所在提交只做证据/状态收口，不声称改变代码基线。
