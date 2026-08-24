# V2-S4 Phase 1 handoff

状态：`IN_PROGRESS`。本 handoff 交接 Phase 1 自动化 QA、安全、格式对抗、快速性能和证据收口；不申请 `READY_FOR_ACCEPTANCE`，不写 `ACCEPTED`，不启动 V2-S5（`HOLD`）。

## 基线、提交与产物

- 基线：`e9fea4c06f9602125df7434434fc6bbc1fd9f7c4`，开工前 clean。
- Phase 1 基线施工提交：`fbd67194409041c57e4b42d04bf91ef9e62df874`。
- 返工 Batch A：`2a26897`；Batch B：`de768db79b1d70661b017dad4b42ee5712297b46`；Batch C：`53bcc5b21879d640dee047677d2462704ed783cd`；Batch D1：`c6e8b3b1fbbee44dba061abab819a14b20fb7cf5`。
- Windows，Node `v22.20.0`，npm `10.9.3`。
- production `dist/uploadfit.js`：421,348 bytes，SHA-256 `ABFA41EBB606CA0E7ED84F8DEE2F17783CAF0BDFA11CE777FB1BAEFBD173D18A`；本批未修改生产源码，bundle 未漂移。
- 旧 V1 `docs/evidence/S4/s4-*.png` 仅由既有 `s4-rework-evidence.spec.js` 自动覆盖；最终全量后恢复基线，不纳入 V2-S4。

## 本轮施工

- `tests/e2e/v2-audio-scenarios.spec.js`：A03 六组合增加最终 signature/container/codec、独立 output validation/frame validation、duration tolerance、encodePasses；Q-S4-P03 通过真实 DOM rejection observer 关联错误节点，Q-S4-P05 通过真实 DataTransfer/injectFile 一次性失败和 restore；Batch A Q-S4-P01～P05 保留真实 controller/File/Worker 计数。
- `tests/e2e/v2-audio-security.spec.js`：S01 小 WAV 真实 Worker + 外联/storage before/after 测量；S03 forged taskId 窗口先于合法消息；S05 明确 `FAKE_BRIDGE_REDACTION_HARNESS`。
- `tests/e2e/v2-audio-performance.spec.js`：Q-S4-P06 五段阶段耗时；P03 sequential 明确为 cleanup harness；Q-S4-P07 同一页面/TaskController 两 uploader 排队，单 Worker 并发约束。
- `tests/integration/v2-media-regression.test.js`：MP3 CBR/VBR/ID3 small+large/truncated/pseudo extension，WAV unknown chunk/three channels/data pseudo-long，M4A moov layouts/non-AAC/truncated box，MIME-extension-signature conflicts，multiple/mixed/video-only boundary。
- `docs/evidence/V2-S4/{README.md,v2-s4-result.json,tabbit-matrix.json}`：runner provenance、真实测量来源、未覆盖矩阵和 Phase 2 状态。

## Runner 边界

`DEBUG_CONTROLLER_REAL_WORKER`/`DEBUG_CONTROLLER_REAL_FILE` 只表示本地 `dist/uploadfit.test.js` debug API 的真实 Worker/controller/File 路径；`DEBUG_DIRECT_PIPELINE_REAL_WORKER` 是直接 `processAudio` pipeline，不是 TaskController；`DEBUG_PURE_PLAN` 不推导 Worker=0；`DEBUG_FAKE_RUNTIME_BRANCH` 不证明真实 encoder/production；A18 使用 `PRODUCTION_IIFE_STATIC_ARTIFACT + DEBUG_REGISTRY`，仅静态检查 production artifact；`REAL_TABBIT_PRODUCTION` 与 `NOT_VERIFIED_PHASE_2` 当前没有可交接实测。

A01–A18、S01–S06、P01–P03/Q-S4-P06/P07 及格式 fixture 的逐项映射见 [`../evidence/V2-S4/README.md`](../evidence/V2-S4/README.md)。完整关闭/刷新/新标签生命周期（A18/LR1/LR9）、真实 AI MAIN-world（S05/LR8）、200MB 和所有 LR1–LR10 仍为 `NOT_VERIFIED_PHASE_2`。

## 执行记录

| 检查 | 结果 |
|---|---|
| `npm ci` | PASS（开工基线已执行） |
| 四文件定向 runner | PASS：31/31，workers=1 |
| `npm run check` | PASS：25 Vitest files / 229 tests；production build/static-check PASS |
| 一次全量 E2E | PASS：193/193，workers=1，约 142s；不复用旧 186/186，旧 V1 S4 截图已恢复 |
| `git diff --check` | closeout 后 PASS |

## 冻结范围与安全

- 合规 MP3 passthrough；PCM WAV 16/24/32-bit mono/stereo → MP3；超限 MP3 与 M4A/AAC 稳定 `AUDIO_CODEC_UNSUPPORTED`；无新增 decoder/远程依赖/第二 controller/音乐裁剪分段降噪。
- S01 的外联 0 和 local/session persistence false 均有实际测量来源；真实 Tabbit 网络/storage 未测量，不写成全平台结论。
- Q-S4-P03/P05/P07 的 submit=0 来自 logger/controller 事件和 business click counters；真实 Tabbit 仍未测量。

## Phase 2 交接条件

1. 先用 Tabbit Browser.getVersion/UA、官方私有脚本 MAIN-world、部分网址匹配确认 9222 实例，加载同一 production SHA。
2. 真实生成 `>200000000` bytes 可解码非敏感 WAV，在页面 max=`100000000` 下成功一次、处理中取消一次；记录输入/输出 bytes/SHA、codec、duration、bitrate、channels、耗时、encodePasses、heartbeat、peakBufferedBytes、external/persistence/submit、cleanup，并清理文件/profile。
3. LR1–LR10 按同一 SHA 形成脱敏 JSON/PNG；不记录脚本 ID、完整 prompt/response、文件名、路径、账号。
4. 若生产源码导致 bundle SHA 变化，必须重做受影响证据；主 Agent `/root` 独立复核后再决定阶段状态。
