# V2-S2 验收返工单

- 下单日期：2026-08-21
- 验收结论：`REJECTED_FOR_REWORK`
- S2 状态：`REJECTED`，引擎实现可保留后返工
- S3–S5：`HOLD`
- 施工基线：当前未提交工作区；起始历史提交 `31d3d2b`
- 返工原则：只补任务书硬性 Must、已复现缺陷和诚实性缺口，不扩展产品范围、不更换编码器、不接入 controller/UI

## 1. 返工目标

本轮完成四件事：

1. 用 S0 冻结的 `lamejs@1.2.1` 真实 Worker 编码路径补齐第 5 节集成测试 Must 的可执行部分；
2. 提供并执行一次 production-equivalent 200MB→100MB 门禁，保存结构化结果（真实 Tabbit 门禁仍归 S4）；
3. 修复验收发现的确定性缺陷（共享 runtime 提前 dispose、确认重放窗口、`skipPlanIdentity` 死口子）；
4. 修正 handoff 命令错误、证据缺口，并按总控第 13 节补阶段提交。

完成后 S2 重新申请 `READY_FOR_ACCEPTANCE`；S3 在 S2 独立通过前继续 HOLD。

## 2. 当前可保留成果

以下内容无需推倒重做：

- `src/audio/planner.js` 的 95%/64KiB 安全目标、有限数学、离散阶梯、passthrough 和两类不可变 confirmation；
- `src/audio/worker-runtime.js` 的 START/CANCEL/DISPOSE 协议、严格 taskId、进度节流和统一清理；
- `src/audio/pipeline.js` 的两遍上限、有界运行参数、独立输出复检和并发保护；
- `src/audio/validators.js` 的 MP3 容器/MIME/帧/时长/声道复检；
- `src/audio/handler.js`、`src/core/media-handlers.js` 的 handler/registry 边界；
- 已通过的 25 文件 / 218 用例 Vitest 与 124 项 Playwright 回归；
- 诚实标注 `PENDING_INDEPENDENT_ACCEPTANCE` 的证据姿态（未冒充实机结果）。

不得用重写 planner、替换 Worker 协议或放松断言完成返工。

## 3. 验收发现

### R2-1：第 5 节集成测试 Must 未落实

严重级别：`BLOCKER`

现状证据：

- `tests/integration/audio-pipeline.test.js`、`audio-worker.test.js`、`audio-handler.test.js` 共 6 个用例，全部使用 fake runtime + 全零字节 fake Blob；
- 真实 `lamejs` 编码路径（含 `scripts/audio-probe/encoder.js` 已验收的流式实现）在 S2 测试中零覆盖；
- 以下 Must 无任何测试：
  - S0 支持输入子集到 MP3 的小 fixture 真实成功；
  - 第一遍在 max 内成功（单遍）；两遍仍失败返回 `AUDIO_OUTPUT_TOO_LARGE`；
  - Worker 初始化失败、解码失败、编码失败、输出复检失败四条错误路径；
  - progress 单调、0–1、有节流的断言；
  - processing 中 abort 在 1 秒内结束的时间断言；
  - 同一 input 重复处理、共享 runtime 第二任务不继承状态。

退出标准 3“S0 选定的 MP3/WAV/M4A 子集均可处理”因此无证据。

### R2-2：第 6 节 200MB production-equivalent 门禁未执行且无可执行入口

严重级别：`BLOCKER`

现状证据：

- `docs/evidence/V2-S2/result.json` 的 `realTabbitGate` 各字段全部为 null；
- 仓库中不存在用 S2 handler（`pipeline.js` + `worker-runtime.js`）处理 200MB 输入的任何 harness、脚本或页面；S0 证据使用的是 S0 probe encoder（`uploadFitAudioS0Encoder`），不是 S2 处理链；
- 任务书第 5 节末尾要求“阶段验收必须执行一次并保存结构化结果”，第 6 节要求“实际 200MB fixture 使用 production-equivalent worker handler 处理”。

ADR-005 对 S2 的绑定条件 5 也要求 production-equivalent 门禁记录真实 `processingElapsedMs`。

### R2-3：handoff 慢速门禁命令与脚本实际参数不匹配

严重级别：`HIGH`

现状证据：

- `docs/handoffs/V2-S2-handoff.md` 给出的命令为 `npm run audio:probe:tabbit-capture -- --fixture <TEMP_FIXTURE> --max-bytes 100000000`；
- `scripts/audio-probe/capture-tabbit.mjs` 只接受 `--cdp=http://127.0.0.1:<port>`，`--fixture`/`--max-bytes` 无人消费，照抄必抛 `Use --cdp=...` 错误；
- 任务书第 7 节要求 handoff 给出“大文件慢速测试的精确命令”。

### R2-4：任务书 §5“超限 MP3 重新编码；WAV/M4A 转码”超出 ADR-005 冻结能力

严重级别：`HIGH`（裁决项）

事实链：

- ADR-005 冻结编码器为 `lamejs@1.2.1`，仅具备 PCM→MP3 编码能力；仓库内无 MP3/AAC 解码器；
- `S0_AUDIO_INPUT_SUBSET`（`src/audio/capabilities.js`）冻结的输入子集为 MP3（直通/元数据）与 WAV PCM，不含 M4A/AAC 转码；
- ADR-005 对 S2 的绑定条件 4 明确“为 MP3/M4A 解码路径单独验证 demux/streaming，不把 `isConfigSupported` 当成完整转码证明”——该验证未做过；
- 当前 `planner.js` 对 MP3 超限输入计划 `REENCODE_AUDIO`、对 M4A 计划 `TRANSCODE_AUDIO` 并给出 `executable: true` 的计划，但真实 Worker 必然运行时失败——这是“承诺了做不到的处理”。

裁决（依据总控第 3 节优先级：已验收 ADR > 阶段任务书）：

- planner 与 validator 对**非 WAV PCM 编码源**（超限 MP3、M4A/AAC 等）必须诚实地停止为 `AUDIO_CODEC_UNSUPPORTED`，不得产出可执行的转码/重编码计划；
- 合规 MP3 的 passthrough 不受影响；
- MP3/M4A 解码路径在按 ADR-005 条件 4 完成单独验证并走新 ADR 之前，保持停止；
- 任务书 §5 对应两行按本裁决解释执行，不修改任务书原文。

### R2-5：pipeline 提前 dispose 调用方共享的 workerRuntime

严重级别：`MEDIUM`

现状证据：

- `src/audio/pipeline.js` 的 `finally` 无条件 `runtime?.dispose?.()`，包括 `options.workerRuntime` 传入的 runtime；
- `createAudioWorkerRuntime().dispose()` 是终态（`disposed = true`），同一 runtime 的第二次 `processAudio` 将得到 `AUDIO_WORKER_UNAVAILABLE`；
- 任务书 S2.7 要求“处理后运行第二个任务不继承首任务状态”，当前共享用法下不成立且无测试。

### R2-6：单元测试边界缺口（任务书 §4.1/§4.2）

严重级别：`MEDIUM`

现状证据（`tests/unit/audio-planner.test.js`）：

- duration 零/NaN/Infinity/负数、极短/极长时长无用例；
- 阶梯测试只断言 `>= 48` 且在阶梯内，未断言精确档位（构造 320kbps 的输入实际选中 256 仍通过）；
- 48kbps 可行/不可行分界、64KiB reserve 交叉点（`0.95·max == max−65536`）、decimal MB 与 MiB 字节无精确断言；
- 用户 decline（`accepted: false`）路径、跨 plan 的过期确认重放无用例。

### R2-7：`skipPlanIdentity` 是无调用方的绕过口子

严重级别：`LOW`

`src/audio/pipeline.js:117` 的 `options.skipPlanIdentity === true` 可跳过 plan 防篡改校验，生产与测试均无调用方。按总控第 9 节“不用测试专用分支进入 production bundle”，应删除。

### R2-8：confirmation 跨 plan 重放窗口

严重级别：`LOW`

- confirmation id 为固定字符串 `confirmation-<type>`，与 plan 参数无关；
- 仅当调用方附带 `suggestedPayload` 时才做防篡改比对；只带 `{id, type, accepted}` 的旧 plan 已解决确认可以在参数不同的新 plan 上重放通过；
- S2.2 要求“拒绝伪造、重复、过期或 payload 改参数”。

修复方向：confirmation id 绑定 `type + suggestedPayload` 的稳定哈希，使参数变化后旧 id 不再匹配；参数完全相同的跨文件重放由 S3 controller 按任务维度拦截（引擎层无法区分文件身份，须在 handoff 说明）。

### R2-9：记录性偏差（不阻塞，须留痕）

- passthrough 结果返回 `workerUsed: false, encodePasses: 0`，与共享契约 §9 的 `workerUsed: true, encodePasses: 1|2` 类型不一致。裁决：passthrough 无处理发生，语义上不应谎报 worker 使用；作为**已批准的显式偏差**记录于 handoff 与返工报告，controller 不应为其调用 `process`；
- V2-S0/S1/S2 全部工作停留在未提交工作区，违反总控第 13 节“每阶段独立、聚焦的提交”。本轮返工完成后按 S0→S1→S2 分阶段补提交。

## 4. 允许修改范围

### S2 缺陷修复与测试

- `src/audio/planner.js`（冻结子集门控、confirmation id 绑定）
- `src/audio/validators.js`（非 WAV 编码源停止）
- `src/audio/pipeline.js`（ownsRuntime、删除 skipPlanIdentity）
- `src/audio/worker-runtime.js`（仅在手性测试暴露缺陷时）
- `tests/unit/audio-planner.test.js`、`tests/unit/audio-output-validation.test.js`、`tests/unit/audio-validation.test.js`（与 R2-4 裁决同步）
- `tests/integration/audio-pipeline.test.js`、`audio-worker.test.js`、`audio-handler.test.js`
- 新增 `tests/integration/audio-real-encoder.test.js`

### 真实编码器 harness 与 200MB 门禁

- `scripts/audio-probe/encoder.js`（增加 `bitrateKbps` 覆盖与 `inputBytesRead` 统计；不改变 S0 默认行为）
- 新增 `scripts/audio-probe/s2-worker-adapter.js`（定义 `self.__uploadfitAudioEncode`，映射 S2 plan 到冻结编码器）
- 新增 `scripts/audio-probe/build-s2-adapter.mjs`（复用 build.mjs 的 lamejs inline 插件产出 Worker 实现源码）
- 新增 `scripts/audio-probe/run-s2-gate.mjs`（production-equivalent 门禁）与 `package.json` 的 `audio:s2:gate`
- `test-pages/`（如需最小 harness 页面）

### 文档与证据

- `docs/handoffs/V2-S2-handoff.md`、`docs/handoffs/V2-S2-rework-report.md`（新增）
- `docs/evidence/V2-S2/*`
- `docs/v2/work-orders/90-需求追踪矩阵.md`

越界修改必须在返工报告逐文件说明。禁止接入正式 upload intercept、controller、UI 或 DataTransfer。

## 5. 施工步骤

### R2-A：真实编码器 harness 与集成测试

1. `encoder.js` 的 `encodeWavToMp3` 接受可选 `options.bitrateKbps`：给出时直接使用（planner 是码率权威），未给出时保持 S0 内部 `choosePlan` 行为；返回值补充 `inputBytesRead`。
2. `s2-worker-adapter.js` 以 ESM 编写、由 esbuild 打成自包含 IIFE 字符串：内部调用 `encodeWavToMp3`，把 `plan.targetBitrateKbps/targetChannels/targetMaxBytes` 与 `limits.inputChunkBytes` 映射为编码参数，把进度映射为 `{phase, ratio}`；**不在 Worker 侧执行 maxBytes 拒绝**（两遍决策归 pipeline），超限输出原样返回给主线程复检。
3. `tests/integration/audio-real-encoder.test.js` 在 Playwright 页面内动态 import `/src/audio/*`，以 Node 侧构建的 adapter 源码创建真实 Blob Worker，必须覆盖：
   - 小尺寸 PCM WAV（stereo）经完整 `plan → confirm → processAudio → validateOutput` 链成功：输出 `File.type === 'audio/mpeg'`、`0 < size ≤ maxBytes`、复检 valid、`encodePasses === 1`、`workerUsed === true`、progress 单调且终值 1；
   - 紧 maxBytes 逼出低码率档位且真实生效（输出码率符合计划档）；
   - 同一共享 runtime 顺序处理两个任务（第二任务不继承状态，回归 R2-5）；
   - 非 WAV 输入（伪 MP4 字节）经真实 adapter 得到稳定 `AUDIO_CODEC_UNSUPPORTED`；
   - 处理中 abort 以 `AUDIO_PROCESSING_CANCELLED` 结束且时延 ≤1 秒级别；
   - 合规 MP3（由第一用例真实输出回喂）passthrough 返回原文件。
4. fake-runtime 集成测试补齐：单遍成功、两遍仍超限 `AUDIO_OUTPUT_TOO_LARGE`（且 runtime 恰被调用两次）、declined plan 不产生 runtime 调用、runtime 抛 `AUDIO_DECODE_FAILED` 透传、`inspectOutput`/`validateOutput` 失败映射 `AUDIO_OUTPUT_VALIDATION_FAILED`、progress 节流与单调（突发倒退 ratio 被钳制）、Worker 构造失败 `AUDIO_WORKER_UNAVAILABLE`、taskId 不匹配消息被忽略、无视 CANCEL 的 Worker 在 1000ms 截止后被强制终止。

### R2-B：冻结子集门控（执行 R2-4 裁决）

1. `planner.js`：源为合规 MP3 时保持 passthrough；源为超限 MP3 或 MP4/AAC 等非 WAV PCM 时，`unfixable` 增加 `AUDIO_CODEC_UNSUPPORTED`，不产生 operations/confirmations，`executable` 与 `passthrough` 均为 false。
2. `validators.js` 的 `validateAudioMetadata` 同步：非 WAV 源的 `AUDIO_FILE_TOO_LARGE`/`AUDIO_FORMAT_NOT_ALLOWED` 不再给出 `REENCODE_AUDIO`/`TRANSCODE_AUDIO` 自动修复，改为 `unfixable: AUDIO_CODEC_UNSUPPORTED`；WAV 源行为不变。
3. 更新 `tests/unit/audio-validation.test.js` 中受影响断言，并在返工报告说明该跨阶段同步。
4. handoff 的“已知限制”写明：MP3 超限重编码与 M4A 转码在冻结编码器下不可执行，解禁需按 ADR-005 条件 4 验证解码路径并走新 ADR。

### R2-C：确定性缺陷修复

1. `pipeline.js`：记录 `ownsRuntime`，`finally` 只 dispose 自建 runtime；调用方传入的 runtime 生命周期归调用方。
2. 删除 `skipPlanIdentity` 分支。
3. `planner.js`：confirmation `id` 改为 `confirmation-<type>-<payloadHash>`（`suggestedPayload` 稳定 JSON 的 FNV-1a 双轮哈希）；`resolveAudioConfirmation` 其余校验不变。跨 plan 重放因 id 不匹配被拒绝；参数全同的重放窗口在 handoff 说明并移交 S3 controller 按任务拦截。
4. passthrough 的 `workerUsed: false / encodePasses: 0` 保持现状，按 R2-9 裁决留痕。

### R2-D：单元测试补齐（§4.1/§4.2）

`tests/unit/audio-planner.test.js` 增加：

- 阶梯精确断言：手算 `(maxBytes, durationMs) → 期望档位`，至少覆盖 320 封顶、档位精确命中（如 128）、档位间隙（如 raw 127 → 112）、48 可行分界与不可行停止；
- duration 为 0/负/NaN/Infinity → `AUDIO_METADATA_INVALID` 且不可执行；极长时长导致 raw < 48 → `AUDIO_TARGET_UNSAFE`；
- decimal MB（100,000,000 → 95,000,000）与 MiB（104,857,600 → 99,614,720）的 safe target 精确值；64KiB reserve 交叉点 `maxBytes = 1,310,720` 时两分支相等；
- decline：`accepted: false` → `resolved: true, accepted: false, executable: false`，且 pipeline 不发起处理；
- 跨 plan 过期确认重放（参数不同）被拒绝。

`tests/unit/audio-output-validation.test.js` 增加 `metadata.errorCode` 路径与时长缺失负例。

### R2-E：执行 production-equivalent 200MB 门禁（只执行一次）

1. `run-s2-gate.mjs`：构建 S2 harness（页面内加载 `src/audio/*` + adapter 源码），Playwright 启动本地 Chromium（明确标注“本地 Chromium、production-equivalent worker handler；真实 Tabbit 门禁归 S4”），生成 200,000,044-byte PCM32 WAV 至系统临时目录，经 file input 注入页面形成真实 File。
2. 成功用例：`maxBytes = 100,000,000`；完整链 `inspect → plan → resolve → processAudio → validateOutput`；记录输入/输出 bytes、输出 SHA-256、码率/声道/采样率、`processingElapsedMs`、`encodePasses`、progress 心跳最大间隔（100ms 采样）、`peakBufferedBytes`（或理论上界）、首中尾 MP3 帧复检结果、Worker terminated/URL revoked/队列清空。
3. 取消用例：启动后尽早 abort，断言 ≤1 秒级停止、无半成品、清理完整；随后再跑一个小文件任务证明无残留。
4. 结构化结果写 `docs/evidence/V2-S2/audio-200-to-100.json`；fixture 与输出在取证后删除，不入 Git；`.gitignore` 已有的 `audio-probe-output/` 覆盖中间产物。
5. 若本机环境无法运行（如 Playwright 浏览器缺失），如实记录 `BLOCKED_BY_ENVIRONMENT` 与原因，不得用小文件冒充。

### R2-F：文档、证据与矩阵修正

1. `V2-S2-handoff.md`：修正慢速门禁命令为 `npm run audio:s2:gate` 的真实用法；验证表更新为返工后实测数字；“已知限制”补 R2-4 裁决与 passthrough 偏差；结束状态仍为 `READY_FOR_ACCEPTANCE` 等待复验。
2. `docs/evidence/V2-S2/`：`result.json` 增加 `productionEquivalent200MBGate` 实测段（保留 `realTabbitGate` 为 S4 待办）、更新 tests 数字；`README.md` 映射返工项；`fixture-manifest.json` 登记 S2 门禁 fixture 参数。
3. `90-需求追踪矩阵.md`：更新 V2-FR-014/016/018/019/021/022/023 的证据指针；为“超限 MP3 重编码、M4A 转码”增加裁决备注（停止待 ADR）。
4. 新增 `docs/handoffs/V2-S2-rework-report.md`，逐项对应 R2-1…R2-9。

### R2-G：全量验证与阶段提交

1. 全量：`npm test -- --run`、`npm run build`（确认 production bundle 仍为 185,068 bytes / SHA 不变——音频引擎不进生产包）、`npm run static-check`、`npm run test:e2e -- --reporter=line --workers=1`、`git diff --check`。
2. 按总控第 13 节补提交：S0（探针/编码器/ADR-005/许可证/证据）、S1（元数据/签名/规则/DOM 分类/测试/证据）、S2（引擎/测试/证据/文档）分阶段聚焦提交；`dist/uploadfit.js` 随最终状态重建提交。

## 6. 必须更新的证据

- `docs/evidence/V2-S2/result.json`：tests/bundle 实测数字、`productionEquivalent200MBGate` 全字段非 null（环境阻塞除外）
- `docs/evidence/V2-S2/audio-200-to-100.json`（新增）：成功 + 取消两组结构化结果
- `docs/evidence/V2-S2/README.md`：逐条映射本单第 9 节退出标准
- `docs/evidence/V2-S2/fixture-manifest.json`：S2 门禁 fixture 记录
- `docs/handoffs/V2-S2-handoff.md` + `V2-S2-rework-report.md`

所有数字必须来自本轮实际输出，不得拼接旧轮次。

## 7. 轻量测试策略

每次修改先跑定向：

```powershell
npm test -- --run tests/unit/audio-planner.test.js tests/unit/audio-validation.test.js tests/unit/audio-output-validation.test.js
npm run test:e2e -- --grep "S2 audio" --reporter=line --workers=1
git diff --check
```

交验前只跑一次全量 `npm run check` + `npm run test:e2e` + 一次 `npm run audio:s2:gate`。

## 8. 禁止绕过

- 不得用 fake Blob/假 runtime 冒充真实编码覆盖。
- 不得引入 MP3/AAC 解码器或调用 WebCodecs 解码来“补齐”M4A/MP3 转码测试（须走新 ADR）。
- 不得把本地 Chromium 200MB 结果写成真实 Tabbit 结果；S4 门禁不动。
- 不得删除或放宽 48kbps 底线、100,000,000 硬上限、两遍上限、最终复检。
- 不得让 Worker 侧承担两遍决策或 maxBytes 拒绝。
- 不得提交 200MB fixture、输出 MP3 或临时产物。
- 不得修改 PRD/任务书原文使实现显得通过；本单第 R2-4 节是唯一裁决解释。
- 不得接入 S3 范围的 controller/UI/injection。

## 9. 返工退出标准

- [ ] 真实 lamejs Worker 路径有集成测试：WAV→MP3 成功、低码率档位生效、合规 MP3 passthrough。
- [ ] 非 WAV 编码源（超限 MP3、M4A）在 plan/validate 层停止为 `AUDIO_CODEC_UNSUPPORTED`，无虚假可执行计划。
- [ ] 单遍成功、两遍超限失败、四类错误路径、进度单调节流、abort 时限、taskId 忽略、强制终止全部有断言。
- [ ] 共享 runtime 顺序两任务成功；pipeline 不再 dispose 调用方 runtime；`skipPlanIdentity` 已删除。
- [ ] confirmation id 绑定 payload；过期/参数变更重放被拒绝；decline 不产生处理调用。
- [ ] 阶梯精确档位、duration 异常、MiB/decimal、reserve 交叉点、48 分界单测齐备。
- [ ] production-equivalent 200MB→100MB 成功 + 取消门禁执行一次并保存结构化结果；输出 ≤100,000,000 bytes；心跳与峰值缓冲有实测或理论上界。
- [ ] `npm test -- --run`、`npm run build`、`npm run static-check`、`npm run test:e2e`、`git diff --check` 全绿；production bundle bytes/SHA 与文档一致。
- [ ] handoff 命令可照抄执行；证据、矩阵、返工报告完整；V1 图片测试无回归。
- [ ] S0/S1/S2 按阶段聚焦提交完成。

## 10. 交接格式

返工完成后更新 `V2-S2-handoff.md`，并新增：

```text
docs/handoffs/V2-S2-rework-report.md
```

报告至少包含：

- R2-1…R2-9 逐项完成表（含未做项与原因）；
- 修改文件清单与越界说明（尤其 `encoder.js`、`audio-validation.test.js` 跨阶段同步）；
- 真实编码测试与 200MB 门禁的命令、耗时、输入/输出 bytes/SHA、心跳/峰值/取消时延；
- 最终 bundle bytes/SHA 与“音频未进生产包”的证明；
- 已知限制（MP3/M4A 停止待 ADR、确认重放窗口移交 S3、passthrough 统计偏差）；
- 申请顺序：仅 S2 复验；S3 继续 HOLD。
