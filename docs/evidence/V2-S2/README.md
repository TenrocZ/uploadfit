# V2-S2 证据目录

状态：`READY_FOR_ACCEPTANCE`（返工第 2 轮完成，申请复验）。S0/S1 前置已由用户确认验收；本阶段只交付独立音频处理引擎，不接入正式上传拦截、controller 或 UI。返工单：`docs/handoffs/V2-S2-acceptance-rework-order.md`、`docs/handoffs/V2-S2-reacceptance-rework-order.md`；返工报告：`docs/handoffs/V2-S2-rework-report.md`。

## 已交付

- `src/audio/planner.js`：95%/64KiB 安全目标、有限数学、48kbps 离散阶梯、passthrough、payload 绑定的不可变 confirmation、两遍上限；低码率下承诺冻结编码器实际输出采样率（`encoder-contract.js` 的 48 组合实证表）；非 WAV 编码源停止为 `AUDIO_CODEC_UNSUPPORTED`。
- `src/audio/confirmation.js`：planner 与 validator 共用稳定 JSON + 双轮 FNV-1a confirmation 身份，参数变化即失配。
- `src/audio/worker-runtime.js`：Blob Worker 的 `START/CANCEL/DISPOSE`、严格 `taskId`、单任务、进度节流、稳定错误码和统一清理；finalize 进度在 runTask 作用域内发送（修复模板 ReferenceError）。
- `src/audio/pipeline.js`：有界运行参数、独立输出复检、硬上限内安全余量 warning、最多第二遍降一档、取消和并发保护；不 dispose 调用方 runtime；降档后按冻结表重预测输出采样率。
- `src/audio/validators.js`：MP3 容器/MIME/帧、大小、时长、sample rate、channels 和代表性首中尾帧复检；非 WAV 编码源不给不可执行的自动修复。
- `src/audio/handler.js`、`src/core/media-handlers.js`：audio MediaHandler 及 image/audio registry；未知 kind 不猜测。
- `src/audio/encoder-contract.js`：复用 S0 已验收的 `lamejs@1.2.1` streaming contract；Worker 实现源码由构建 harness 注入（`scripts/audio-probe/s2-worker-adapter.js` + `build-s2-adapter.mjs`），拒绝替换编码器。

## 自动化验证（本轮实测）

| 范围 | 命令 | 结果 |
|---|---|---|
| 全量 Node/Vitest | `npm test -- --run` | 25 个文件、227 个测试通过 |
| planner/confirmation | `tests/unit/audio-planner.test.js` | 安全目标、精确阶梯档位、48kbps 分界、MiB/decimal、reserve 交叉点、duration 异常、decline、过期重放、冻结子集门控、低码率采样率承诺 |
| output validator | `tests/unit/audio-output-validation.test.js` | MP3、MIME、伪帧、零字节、超限、时长、声道/采样率、errorCode 负例 |
| pipeline harness | `tests/integration/audio-pipeline.test.js` | 单遍成功、两遍降阶、两遍仍超限、并发拒绝、abort 原子失败、未确认/已拒绝不处理、解码/复检失败映射、进度单调节流、共享 runtime 复用 |
| worker harness | `tests/integration/audio-worker.test.js` | taskId 严格、READY/RESULT、CANCEL、1 秒截止强制终止、构造失败、ERROR 映射、terminate/revoke、顺序两任务 |
| 真实编码器 | `tests/integration/audio-real-encoder.test.js` | 真实 lamejs Worker：WAV→MP3 全链成功、64kbps 档位真实生效、合规 MP3 passthrough、共享 runtime 第二任务、M4A 停止、真实取消时延 |
| production/static | `npm run build`、`npm run static-check` | 通过；bundle 185,068 bytes，SHA-256 `8BBBD1CB9564E2A6D01E53ABEC71B8B6D46AABB765FA90C16C3C7960E7EE404E`（与返工前逐字节一致，音频引擎未进生产包） |
| V1/V2 Playwright regression | `npm run test:e2e -- --reporter=line --workers=1` | 141 个测试通过 |
| E2E runner 生命周期复验 | `npm run test:e2e -- --grep "S2 audio" --reporter=line --workers=1`（自启 + 复用） | 两次均 23/23；无 `EADDRINUSE`/未捕获 child error；自有服务结束后 8765 无残留监听 |

## production-equivalent 200MB→100MB 门禁（本轮已执行）

命令：`npm run audio:s2:gate`（本地 Playwright Chromium + S2 handler 链 + 冻结 lamejs Worker；真实 Tabbit 门禁归 V2-S4）。

- 输入：200,000,044-byte PCM32 WAV（48kHz、stereo、520,833.333ms），合成生成、取证后删除；
- 计划：320kbps、stereo、48kHz、safe target 95,000,000 bytes；1 个有损确认；
- 输出：20,834,880-byte `audio/mpeg`，SHA-256 `9394F96A5CDBD87823BB3223F584BB844471A74C6AA73DAB2B0EB44C39F16FBC`；独立复检通过（首中尾帧、时长 520,868.8ms 未截短）；
- 本条只证明 S2 production-equivalent handler，不宣称真实 Tabbit；真实 Tabbit 门禁归 S4；
- 处理墙钟 35,204ms；单遍；主线程心跳最大间隔 112.1ms（目标 ≤500ms）；
- 峰值缓冲实测 26,825,856 bytes；理论硬上界 137,748,736 bytes = 4MiB 输入块 + 32MiB PCM 预算 + 100,000,000-byte 输出聚合上限；
- progress 51 个事件、单调、终值 1；
- 取消用例：首个 encode progress 后 abort，`AUDIO_PROCESSING_CANCELLED`，延迟 9.7ms，无半成品；Worker terminated、object URL revoked、队列清空、disposed 均为 true；
- 首中尾 MP3 帧复检：203 个代表性帧，`valid=true`；
- 取消后再跑 2s 小文件成功，无 Worker/内存残留；
- Worker terminated、object URL revoked、队列清空；临时 fixture 已删除。

结构化结果：`audio-200-to-100.json`。

## 资源与隐私边界

- runtime 的 input chunk 上限 4MiB，PCM budget 32MiB；不调用完整 `decodeAudioData`，无主线程 fallback；
- Worker 只传稳定错误码和安全进度字段；不传文件名、原始异常、帧数据、PCM、网络或持久化句柄；
- 失败、取消或复检失败都不返回半成品 File；Blob URL、Worker 和输出队列统一清理。

## 已知限制（详见 handoff）

- 超限 MP3 重编码与 M4A 转码在冻结编码器下停止为 `AUDIO_CODEC_UNSUPPORTED`（返工单 R2-4 裁决；解禁需按 ADR-005 条件 4 验证解码路径并走新 ADR）；
- 参数完全相同的跨文件确认重放窗口移交 S3 controller 按任务维度拦截；
- passthrough 结果 `workerUsed: false / encodePasses: 0` 为已批准偏差（R2-9）；
- 真实 Tabbit 200MB 门禁归 V2-S4。
