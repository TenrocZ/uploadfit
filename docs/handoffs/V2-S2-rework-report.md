# V2-S2 返工报告（第 1 轮）

- 日期：2026-08-21
- 返工单：`docs/handoffs/V2-S2-acceptance-rework-order.md`
- 申请：S2 复验（`READY_FOR_ACCEPTANCE`）；S3 继续 HOLD

## 1. 返工项完成表

| 返工项 | 级别 | 状态 | 证据 |
|---|---|---|---|
| R2-1 集成测试 Must 未落实 | BLOCKER | ✅ 已修复 | `tests/integration/audio-real-encoder.test.js`（6 用例，真实 lamejs Worker）；pipeline/worker harness 各补 7/6 用例；E2E 141 通过 |
| R2-2 200MB 门禁未执行且无入口 | BLOCKER | ✅ 已修复 | `scripts/audio-probe/run-s2-gate.mjs` + `npm run audio:s2:gate`；`docs/evidence/V2-S2/audio-200-to-100.json` |
| R2-3 handoff 慢速命令与脚本不匹配 | HIGH | ✅ 已修复 | handoff“大文件慢速门禁”段改为可照抄执行的 `npm run audio:s2:gate`，并说明 `capture-tabbit.mjs` 的真实用途（S0 Tabbit CDP 探针） |
| R2-4 超限 MP3/M4A 转码超出冻结能力 | HIGH（裁决） | ✅ 按裁决执行 | planner/validator 停止为 `AUDIO_CODEC_UNSUPPORTED`；`audio-validation.test.js` 同步；ADR-005 条件 4 解码验证留待后续 ADR |
| R2-5 pipeline dispose 调用方 runtime | MEDIUM | ✅ 已修复 | `pipeline.js` ownsRuntime；`reuses a caller-provided runtime across sequential tasks` 回归用例 |
| R2-6 单元测试边界缺口 | MEDIUM | ✅ 已修复 | `audio-planner.test.js` 13 用例（+8）：精确阶梯档位、48 分界、MiB/decimal、reserve 交叉点、duration 异常、decline、过期重放、冻结门控、采样率承诺 |
| R2-7 `skipPlanIdentity` 死口子 | LOW | ✅ 已删除 | `pipeline.js` 无该选项 |
| R2-8 确认跨 plan 重放窗口 | LOW | ✅ 已收敛 | planner/validator 共用 `src/audio/confirmation.js`；confirmation id 绑定 `type + payload` 稳定 JSON 双轮 FNV-1a 哈希；参数变化即拒绝；参数全同的重放窗口移交 S3 controller（handoff 已记录） |
| R2-9 记录性偏差 | LOW | ✅ 已留痕（历史聚合提交） | passthrough `workerUsed:false/encodePasses:0` 批准偏差；本轮 S2 代码修复已形成聚焦提交 `a289226`。历史 S0/S1/S2 聚合基线 `07d25a4` 不做破坏性重写，S0/S1 的阶段拆分偏差保留审计记录 |
| R2-10（返工中新发现）Worker 模板作用域 bug | BLOCKER（已修复） | ✅ 已修复 | 见下节 |

## 2. 返工中新发现的缺陷（R2-10）

`src/audio/worker-runtime.js` 的 Worker 源码模板自带 bug：`emitProgress` 定义在 `runTask()` 函数作用域内，但 START 消息处理器在**外层作用域**对它发起 finalize 调用 —— 真实 Worker 里抛 `ReferenceError: emitProgress is not defined`，被稳定码映射吞成 `AUDIO_ENCODE_FAILED`。

此前所有测试用 FakeWorker 在**主线程**模拟协议，从未执行模板源码，因此 S2 交付的"真实 Worker 路径"实际上从未跑通——只有真实 lamejs Worker 集成测试（R2-1）把它暴露出来。修复：finalize 进度改为 `runTask` 内部、return 前发送；START 处理器中的越域调用删除。

这同时解释了为什么原交付"不可能通过第 6 节门禁"：任何真实 Worker 编码都会在 RESULT 组装前失败。

## 3. 编码器行为实证（冻结采样率表）

R2-1 的真实编码测试暴露第二个行为事实：冻结 lamejs 在低码率自动降采样（44.1kHz stereo@64kbps→24kHz），导致 plan 承诺的 `targetSampleRate` 必然复检失败。处理方式：

- 实测全部 48 组合（44.1/48kHz × stereo/mono × 12 档码率）的输出采样率，冻结为 `src/audio/encoder-contract.js` 的 `AUDIO_ENCODER_OUTPUT_SAMPLE_RATES`；
- planner 在需要转码时按表承诺编码器实际输出率，低于源率时加 `RESAMPLE_AUDIO`；
- pipeline 第二遍降档后按新码率重预测；
- 表外组合不预测，独立输出复检兜底。

## 4. 修改文件清单

| 文件 | 目的 | 越界说明 |
|---|---|---|
| `src/audio/worker-runtime.js` | R2-10 模板作用域修复 | 阶段内 |
| `src/audio/pipeline.js` | R2-5 ownsRuntime；R2-7 删除 skipPlanIdentity；降档采样率重预测；unfixable 停止码映射 | 阶段内 |
| `src/audio/planner.js` | R2-4 冻结门控；R2-8 id 绑定；冻结采样率承诺 | 阶段内 |
| `src/audio/confirmation.js` | planner/validator 共用稳定 JSON + 双轮 FNV-1a confirmation 身份 | 阶段内 |
| `src/audio/validators.js` | R2-4 同步门控 | 阶段内 |
| `src/audio/encoder-contract.js` | 48 组合实证采样率表 + 查询函数 | 阶段内（S0 冻结编码器的行为契约补充，不改字段语义；建议 ADR-005 附注此表） |
| `scripts/audio-probe/encoder.js` | `bitrateKbps` 覆盖（planner 权威）+ `inputBytesRead` 统计 + `enforceMaxBytes:false` adapter 选项 | **跨阶段**：S0 探针文件；默认行为不变（未传 bitrate 时走原 choosePlan，默认仍执行上限检查） |
| `scripts/audio-probe/s2-worker-adapter.js`（新） | `__uploadfitAudioEncode` 协议适配 | 新增 harness |
| `scripts/audio-probe/build-s2-adapter.mjs`（新） | 复用 S0 lamejs inline 插件构建 adapter 源码 | 新增 harness |
| `scripts/audio-probe/run-s2-gate.mjs`（新） | production-equivalent 200MB 门禁 | 新增 harness |
| `package.json` | `audio:s2:adapter`、`audio:s2:gate` scripts | 阶段内 |
| `tests/unit/audio-planner.test.js` | R2-6 | 阶段内 |
| `tests/unit/audio-validation.test.js` | R2-4 同步断言 | **跨阶段**：S1 测试文件；仅更新受裁决影响的一条用例 |
| `tests/unit/audio-output-validation.test.js` | errorCode/时长负例 | 阶段内 |
| `tests/integration/audio-pipeline.test.js` | R2-1/R2-5 | 阶段内 |
| `tests/integration/audio-worker.test.js` | R2-1 | 阶段内 |
| `tests/integration/audio-real-encoder.test.js`（新） | R2-1 真实编码器 | 阶段内 |
| `docs/evidence/V2-S2/*`、`docs/handoffs/V2-S2-handoff.md`、`90-需求追踪矩阵.md` | R2-F 证据与文档 | 阶段内 |

## 5. 验证结果（本轮实测输出）

| 命令 | 结果 |
|---|---|
| `npm test -- --run` | 25 文件 / 227 用例全部通过 |
| `npm run test:e2e -- --reporter=line --workers=1` | 141/141 通过（含 6 真实 lamejs Worker 用例） |
| `npm run build` | 185,068 bytes（与返工前逐字节一致；音频引擎未进生产包） |
| `npm run static-check` | PASS；SHA-256 `8BBBD1CB9564E2A6D01E53ABEC71B8B6D46AABB765FA90C16C3C7960E7EE404E` 不变 |
| `git diff --check` | 干净 |
| `npm run audio:s2:gate` | PASS（200,000,044→20,834,880 bytes；40,327ms；心跳 113.2ms；取消 1ms；复用正常；输出 SHA `9394F96A5CDBD87823BB3223F584BB844471A74C6AA73DAB2B0EB44C39F16FBC`） |

## 6. 已知限制（移交）

1. MP3 超限重编码、M4A 转码停止为 `AUDIO_CODEC_UNSUPPORTED`；解禁需按 ADR-005 条件 4 验证解码路径并走新 ADR。
2. 参数完全相同的跨文件确认重放由 S3 controller 按任务维度拦截。
3. passthrough 结果统计字段偏差已批准（R2-9）。
4. 真实 Tabbit 200MB 门禁归 V2-S4；`capture-tabbit.mjs`（S0 探针，`--cdp=` 参数）届时复用。

## 7. 申请顺序

仅申请 S2 复验；S3 在 S2 独立通过前继续 HOLD。
