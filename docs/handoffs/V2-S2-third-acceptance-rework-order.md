# V2-S2 第三轮独立验收返工单

- 验收日期：2026-08-21
- 验收对象：`docs/handoffs/V2-S2-handoff.md`、`docs/evidence/V2-S2/`、提交 `ab6a765` 及后续证据提交
- 返工状态：`CLOSED`（完成报告：`docs/handoffs/V2-S2-third-rework-report.md`）
- V2-S2：`ACCEPTED`（最终代码提交 `3967a45`）
- V2-S3：`READY_TO_START`
- 原则：只修复计划完整性、dispose 生命周期和冻结 WAV 子集覆盖；不更换编码器、不接入 controller/UI/DataTransfer、不扩大到真实 Tabbit S4 门禁

## 1. 验收摘要

### 已通过，可直接保留

| 项目 | 独立复验结果 |
|---|---|
| 工作区与提交 | PASS；验收开始时工作区 clean，HEAD `abacc38` |
| 全量 Node/Vitest | PASS；`npm run check` 为 25 files / 227 tests，production build 与 static-check 通过 |
| Production bundle | PASS；185,068 bytes，SHA-256 `8BBBD1CB9564E2A6D01E53ABEC71B8B6D46AABB765FA90C16C3C7960E7EE404E` |
| S2 targeted E2E | PASS；23/23，无 `EADDRINUSE` 或未捕获 child error，测试服务正常回收 |
| 冻结编码器 adapter | PASS；166,483 bytes，`lamejs@1.2.1`，定义 `__uploadfitAudioEncode`，forbidden matches 为空 |
| Planner 数学与两遍控制 | 自动化 PASS；safe target、离散阶梯、48kbps 底线、确认、单/双遍分支已有覆盖 |
| 真实编码器基本链路 | PASS；PCM16 WAV→MP3、低码率档位、MP3 passthrough、共享 runtime 顺序任务、真实取消已有 E2E |
| S2 200MB production-equivalent 证据 | 结构化证据完整且与当前正常成功路径一致；200,000,044→20,834,880 bytes，processing elapsed 35,204ms |
| JSON / whitespace | PASS；V2-S2 JSON 均可解析，`git diff --check` 通过 |

### 当前阻断项

以下三项已由 `3967a45` 修复并通过定向复验：

1. 篡改 plan 的 `executable/unfixable` 无法绕过 canonical safety stop，runtime 调用数保持 0。
2. runtime/pipeline/handler active dispose 立即结算并清理，迟到结果与重复 dispose 均有测试。
3. 真实 S2 Worker 快速套件已覆盖 PCM16/24/32-bit × mono/stereo 六组合。

## 2. R4-1：canonical safety stop 可被 plan 篡改绕过

- 严重级别：`BLOCKER / SAFETY`
- 代码位置：`src/audio/planner.js:441`、`src/audio/pipeline.js:107`

### 事实

`isAudioPlanExecutable()` 只信任传入 plan 的 `executable === true`，没有要求 `unfixable` 为空。`validatePlanAgainstMetadata()` 虽然重新计算 canonical plan，但 authority 字段没有包含 canonical `executable`、`unfixable` 或停止原因。

因此，页面规则明确含 `OFFICIAL_TOOL_REQUIRED` 时，canonical plan 正确返回：

```json
{
  "executable": false,
  "unfixable": ["OFFICIAL_TOOL_REQUIRED"]
}
```

只把外部 plan 改成：

```js
{ ...canonical, executable: true, unfixable: [] }
```

便能通过 `processAudio()` 的完整性检查。

### 独立复现结果

本轮以内存 `File`、合法 WAV 安全元数据和计数 fake runtime 调用 `processAudio()`，没有修改项目文件：

```json
{
  "canonicalExecutable": false,
  "canonicalUnfixable": ["OFFICIAL_TOOL_REQUIRED"],
  "forgedResult": { "state": "resolved" },
  "runtimeRuns": 1
}
```

这意味着安全停止不是 defense-in-depth：一旦 S3 状态对象过期、被错误合并或被调用方篡改，官方工具/原始录音/无损要求可能被绕过。

### 必须修复

1. `isAudioPlanExecutable(plan)` 必须至少要求：
   - `Array.isArray(plan.unfixable)`；
   - `plan.unfixable.length === 0`；
   - 不允许只靠外部 `executable:true` 覆盖停止状态。
2. `validatePlanAgainstMetadata()` 必须以重新计算的 canonical plan 为权威：
   - canonical `executable` 必须为 true；
   - canonical `unfixable` 必须为空；
   - 传入 plan 的 `unfixable`、关键停止状态必须与 canonical 一致；
   - canonical 已停止时，在创建 runtime 之前立即拒绝。
3. 返回的错误码不得把 `OFFICIAL_TOOL_REQUIRED` 误报为 `AUDIO_CONFIRMATION_REQUIRED`。可将已有共享安全停止码纳入稳定映射，或统一映射到不会诱导用户继续确认的稳定 stop code；必须保留具体停止原因供 S3 展示。
4. 不得通过删除 `safetyFlags`、放宽 semantic stop、跳过 canonical 计算或在测试中绕开 plan identity 来修复。

### 必须新增测试

- `isAudioPlanExecutable()` 对 `executable:true + unfixable非空` 返回 false。
- `OFFICIAL_TOOL_REQUIRED` canonical plan 被篡改后，`processAudio()` 拒绝，runtime 调用数为 0。
- 同样覆盖 `AUDIO_ORIGINAL_REQUIRED`、`AUDIO_LOSSLESS_REQUIRED`、`AUDIO_DURATION_LIMIT_UNFIXABLE` 至少各一例。
- 伪造删除 `AUDIO_CODEC_UNSUPPORTED`、`AUDIO_TARGET_UNSAFE` 也不得执行。
- 正常已确认 WAV plan 继续成功，避免把所有处理误杀。

## 3. R4-2：处理中 dispose 不结算任务且延迟释放 Blob URL

- 严重级别：`BLOCKER / LIFECYCLE`
- 代码位置：`src/audio/worker-runtime.js:215-252`、`src/audio/worker-runtime.js:350-366`、`src/audio/pipeline.js:418-430`、`src/audio/handler.js:30-69`

### 事实

`createAudioWorkerRuntime().dispose()` 在活跃任务中只执行：

```text
post DISPOSE → terminate Worker → active = null
```

它没有调用 promise executor 内部的 `finish()`，因此没有：

- 立即 reject/resolve 活跃 Promise；
- clear timeout/cancel timer；
- detach AbortSignal listener；
- revoke 当前 object URL；
- 将 cleanup 结果随错误返回。

Promise 只能等默认 120,000ms timeout 后才由旧 closure 清理。`createAudioPipeline().dispose()` 会触发该问题；而 handler 按 handoff 示例仅传 `workerSource` 时，runtime 在 `processAudio()` 内部临时创建，`handler.dispose()` 根本拿不到它，处理中 dispose 可能继续编码到完成。

### 独立复现结果

使用 silent fake Worker，启动 `runtime.run()` 后立刻 `runtime.dispose()`；为避免验收命令等待生产默认 120 秒，复现将 `timeoutMs` 缩短到 200ms：

```json
{
  "early": { "state": "pending" },
  "urlsBeforeTimeout": 1,
  "eventual": {
    "state": "rejected",
    "code": "AUDIO_WORKER_UNAVAILABLE",
    "cleanup": {
      "workerTerminated": true,
      "objectUrlRevoked": true,
      "queueCleared": true,
      "disposed": true
    }
  },
  "urlsAfterTimeout": 0
}
```

期望应是 dispose 当下立即稳定结束，而不是依赖 timeout 兜底。

### 必须修复

1. runtime 的 active state 必须持有统一的 settle/cleanup 能力；`dispose()` 对活跃任务必须幂等地：
   - 发出 DISPOSE/CANCEL（尽力而为）；
   - 立即 terminate；
   - clear 所有 timer；
   - detach AbortSignal listener；
   - revoke object URL；
   - clear queue/active；
   - 以稳定 `AUDIO_PROCESSING_CANCELLED`（或已文档化的 dispose 专用稳定码）拒绝 Promise。
2. 不允许 `dispose()` 后仍收到 RESULT 并返回成功；重复 dispose 不抛错、不重复结算。
3. `createAudioPipeline()` 必须能够追踪自己创建的 runtime；`pipeline.dispose()` 在 active/idle 两种状态都完整生效。
4. `createAudioHandler()` 应持有可处置的 pipeline/runtime 生命周期；按 handoff 的 `createAudioHandler({ workerSource })` 用法，处理中 `handler.dispose()` 也必须取消并结算任务。
5. 保持现有 AbortSignal 1 秒强制终止契约；dispose 可以更快，但不得把普通 cancel 改成等待 120 秒。

### 必须新增测试

- silent Worker 活跃时 `runtime.dispose()`：Promise 在短时限内拒绝，URL 数为 0，Worker terminated，timer/listener 清理。
- active `pipeline.dispose()`：任务稳定取消、无半成品、不会等默认 timeout。
- active `handler.dispose()`，包括只传 `workerSource`、未显式传 `workerRuntime` 的常规用法。
- dispose 后的迟到 RESULT 被忽略；重复 dispose 幂等；dispose 后新任务返回稳定 unavailable/disposed 错误。
- 正常完成、AbortSignal cancel、强制 terminate、共享 runtime 第二任务的既有测试继续通过。

## 4. R4-3：冻结 PCM WAV 子集的真实 Worker 覆盖不完整

- 严重级别：`MEDIUM / EVIDENCE`
- 相关文件：`tests/integration/audio-real-encoder.test.js`、`docs/evidence/V2-S2/result.json`

### 事实

当前真实 Worker 快速套件的 WAV 生成器固定写 PCM16；调用全部使用 stereo。200MB 门禁证明了 PCM32 stereo，但没有快速回归 PCM24，也没有真实 mono 输入。与此同时 S2 handoff/result 明确声称：

```text
transcodable: PCM WAV (16/24/32-bit)
target/source channels: mono or stereo
```

任务书要求对冻结输入子集提供真实小 fixture 成功证据，不能只依靠 parser 单测或实现代码推断。

### 必须补齐

1. 将真实编码器测试的确定性 WAV helper 扩展为 16/24/32-bit 与 1/2 channels。
2. 至少用一个参数化真实 Blob Worker 用例覆盖六种组合：
   - PCM16 mono / stereo；
   - PCM24 mono / stereo；
   - PCM32 mono / stereo。
3. 每种组合断言输出 MIME/签名、size、duration、sampleRate、channels、frame validation、`workerUsed:true`、`encodePasses:1` 与 cleanup。
4. fixture 仅在内存生成并释放，不提交音频文件。
5. 若某组合由冻结 `lamejs@1.2.1` 实测失败，应收缩 handoff/result 的支持声明并更新 ADR/追踪矩阵，不能保留虚假支持。

## 5. R4-4：证据与提交指针收口

- 严重级别：`LOW / TRACEABILITY`

返工后必须同步：

- `docs/evidence/V2-S2/result.json`：新测试数量、正常/安全拒绝/dispose 结果、最终代码提交；
- `docs/evidence/V2-S2/README.md`：补 safety-plan integrity 与 active dispose 证据；
- `docs/evidence/V2-S2/fixture-manifest.json`：补 PCM 16/24/32 × mono/stereo 内存 fixture；
- `docs/handoffs/V2-S2-handoff.md`：更新 End commit、已知限制和验证数字；
- `docs/v2/work-orders/90-需求追踪矩阵.md`：V2-FR-016、017、021、023 的代码/测试/证据指针；
- 新增 `docs/handoffs/V2-S2-third-rework-report.md`，逐项回答 R4-1～R4-4。

当前 `result.json` / handoff 的 End commit 仍指向代码提交 `ab6a765`，而验收 HEAD 为 `abacc38`。返工报告要区分“最终代码提交”和“包含最终证据的阶段结束提交”，避免再次用文档提交回写旧代码 hash 造成循环歧义。

## 6. 允许修改范围

- `src/audio/planner.js`
- `src/audio/pipeline.js`
- `src/audio/worker-runtime.js`
- `src/audio/handler.js`
- `src/audio/errors.js`（仅稳定 stop/dispose 错误映射确有需要）
- `tests/unit/audio-planner.test.js`
- `tests/integration/audio-pipeline.test.js`
- `tests/integration/audio-worker.test.js`
- `tests/integration/audio-handler.test.js`
- `tests/integration/audio-real-encoder.test.js`
- 本单第 5 节列出的 S2 evidence/handoff/matrix 文件

禁止修改 S0/S1 已验收业务契约、编码器版本、码率阶梯、48kbps 底线、两遍上限、官方工具安全语义、正式 controller/UI/injection 或真实 Tabbit S4 门禁。

## 7. 最小施工顺序

1. 先为 R4-1 写失败测试，确认 runtime 调用数为 0，再修 canonical plan 完整性。
2. 为 runtime active dispose 写 silent Worker 失败测试，再统一 settle/cleanup；随后让 pipeline/handler 持有该生命周期。
3. 增加 PCM variant 参数化真实 Worker 测试。
4. 跑 S2 targeted E2E，并用六种真实 PCM 小样覆盖 runtime 正常完成与 cleanup。
5. 跑一次 `npm run check`、adapter build，更新 evidence/handoff/matrix 并提交聚焦返工提交。按用户节约资源要求，既有 200MB、141 项全量 E2E 和真实 Tabbit 证据复用。

## 8. 验收命令

```powershell
npm test -- --run tests/unit/audio-planner.test.js tests/unit/audio-validation.test.js tests/unit/audio-output-validation.test.js
npm run test:e2e -- --grep "S2 audio" --reporter=line --workers=1
npm run audio:s2:adapter
npm run audio:s2:gate
npm run check
npm run test:e2e -- --reporter=line --workers=1
git diff --check
```

不要求本轮运行真实 Tabbit 200MB；该门禁仍归 V2-S4。施工期间用户进一步明确“已通过且修复过程不涉及的不要重复作业”，因此最终以六种真实 PCM 小样验证正常 runtime cleanup，以 silent Worker 验证 active dispose；冻结编码器与输出数学未改，既有 S2 200MB 结构化结果直接复用。该裁决和实际执行范围已在返工报告中如实留痕。

## 9. 返工退出标准

- [x] 所有 canonical `unfixable` stop 无法被外部 plan 的 `executable/unfixable` 篡改绕过。
- [x] `OFFICIAL_TOOL_REQUIRED` 等安全停止在 process 入口拒绝，runtime 调用数为 0，错误码不误导为确认请求。
- [x] active runtime/pipeline/handler dispose 立即结算并完整清理，不依赖 120 秒 timeout。
- [x] dispose 迟到消息、重复调用、dispose 后新任务均有确定性测试。
- [x] PCM16/24/32 × mono/stereo 六组合真实 Blob Worker 快速测试通过。
- [x] 既有两遍、progress、真实 cancel、共享 runtime 和输出复检的 S2 定向测试无回归。
- [x] S2 production-equivalent 200MB 既有成功/取消/复用证据保留；本轮按用户节约资源裁决不重复执行。
- [x] `npm run check`、S2 targeted E2E、adapter build、`git diff --check` 全绿；全量 E2E 复用既有 141/141。
- [x] evidence/handoff/matrix/提交指针与最终代码一致，第三轮返工报告已新增。

完成上述项目后，V2-S2 才能重新申请独立验收；在此之前不得启动 V2-S3。
