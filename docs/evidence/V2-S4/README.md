# V2-S4 证据索引（Phase 1）

当前状态：`IN_PROGRESS`。本目录记录 V2-S4 Phase 1 的自动化 QA、安全、格式对抗和快速性能施工；200MB 慢门禁与 Tabbit LR1–LR10 属于 Phase 2，当前全部保持未运行，不得据此写成通过或验收。

## 候选产物与环境

- 基线 commit：`e9fea4c06f9602125df7434434fc6bbc1fd9f7c4`（开工前工作区 clean）。
- 当前 production `dist/uploadfit.js`：421,348 bytes，SHA-256 `ABFA41EBB606CA0E7ED84F8DEE2F17783CAF0BDFA11CE777FB1BAEFBD173D18A`。
- Windows，Node `v22.20.0`，npm `10.9.3`；本地测试服务 `http://127.0.0.1:8765`。
- `npm run check` 的 production build/static-check 使用上述产物；没有修改 decoder、远程 runtime 依赖、第二 controller 或音频范围。
- 新增的四个 Phase 1 浏览器文件通过 `dist/uploadfit.test.js` 的公开 debug harness 做确定性 API/Worker 对抗断言；这不是 production bundle 证据。production IIFE 的真实 controller、注入、业务提交为 0、拒收 retry 和图片回归仍由既有生产页 E2E 纳入 `npm run test:e2e`，不把 debug harness 冒充 Tabbit 实机。

## Phase 1 执行结果

| 命令 | 结果 |
|---|---|
| 开工基线 `npm ci` | PASS（基线已执行，本 Phase 不重复） |
| `npm run check` | PASS：25 个 Vitest 文件，229/229；production build 421,348 bytes；static-check PASS；SHA 同上 |
| `node scripts/run-e2e.js tests/e2e/v2-audio-scenarios.spec.js tests/e2e/v2-audio-security.spec.js tests/e2e/v2-audio-performance.spec.js tests/integration/v2-media-regression.test.js --reporter=line --workers=1` | PASS：24/24，1 worker |
| `npm run test:e2e` | PASS：186/186，8 workers，50.1s；包含新增 24 项及既有 production/image regression |
| `git diff --check` | Phase 1 closeout PASS |

## A01–A18 精确映射

新文件的 runner 是 Playwright，经 `scripts/run-e2e.js` 启动本地服务；表中“debug”只说明确定性 harness，不改变冻结生产能力。括号中的“production”等价覆盖来自既有生产页 E2E。

| ID | 精确自动化映射 | 关键证据字段/边界 |
|---|---|---|
| A01 | `v2-audio-scenarios.spec.js`：`A01 compliant MP3 is passthrough with identity and no Worker`；production 等价：`v2-audio-s3.spec.js` passthrough 用例 | 原 File identity，Worker/process/injection/submit=0 |
| A02 | `v2-audio-scenarios.spec.js`：A02/A04 规划循环；`v2-media-regression.test.js` A01/A03/A04；production：S3 C | 超限 MP3 稳定 `AUDIO_CODEC_UNSUPPORTED`，process/Worker/injection=0，原 File 保留 |
| A03 | `v2-audio-scenarios.spec.js`：六组合 PCM16/24/32 × mono/stereo；production：S3 PCM confirmation→Worker→validation→injection | 输出 `audio/mpeg`，Worker/process=1，`workerUsed=true`，`encodePasses≤2`；生产页另断言 injection=1、submit=0 |
| A04 | `v2-audio-scenarios.spec.js` A02/A04；`v2-media-regression.test.js`；production：S3 C M4A/AAC-LC | M4A/AAC 稳定 `AUDIO_CODEC_UNSUPPORTED`，process/Worker/injection=0 |
| A05 | `v2-audio-scenarios.spec.js` A05–A08；`v2-media-regression.test.js` A05–A10 | 缺 maxBytes 不形成 executable plan，Worker/process/injection=0 |
| A06 | 同上 | MP3 未允许时 `AUDIO_OUTPUT_FORMAT_NOT_ALLOWED`，不处理 |
| A07 | 同上 | duration-only 为 `AUDIO_DURATION_LIMIT_UNFIXABLE`，不裁剪/分段 |
| A08 | 同上 | 低于最低码率安全目标为 `AUDIO_TARGET_UNSAFE`，不启动 Worker |
| A09 | `v2-audio-scenarios.spec.js` A09/A10 | lossy confirmation decline：原 File 保留，Worker/process/injection=0 |
| A10 | 同上；`v2-media-regression.test.js` confirmationTypes | mono 为独立 confirmation；拒绝不处理，未伪造声道参数 |
| A11 | `v2-audio-scenarios.spec.js` A11/A12；`v2-audio-performance.spec.js` P02；production：S3 G | cancel ≤1,000ms，无迟到事件/注入；Worker/object URL cleanup 断言 |
| A12 | `v2-audio-scenarios.spec.js` A11/A12；production：S3 G detach | input detach 为 `INPUT_DETACHED`，原 File 保留、abort+cleanup、injection=0 |
| A13 | `v2-audio-scenarios.spec.js` A13/A14；`v2-media-regression.test.js` A13/A14 | 首次超限只 lower-rate 一次，`encodePasses=2`，输出通过则回填路径可继续 |
| A14 | 同上 | 第二次仍超限为 `AUDIO_OUTPUT_TOO_LARGE`，`encodePasses=2`，不回填 |
| A15 | `v2-audio-scenarios.spec.js` A15；production 等价：`v2-audio-s3-controller.spec.js` `stricter rejection retries once...` | 只有更严格规则可 retry；生产 controller `retryCount=1`、process=2、`RETRY_TRIGGERED=1`，第二次拒收不再 process，submit=0 |
| A16 | `v2-audio-scenarios.spec.js` A15/A16；`v2-media-regression.test.js` A15/A16；production：S3 no-MP3/duration/original/lossless | 模糊/网络/权限/官方工具/混合/multiple/video 不进入 audio process/Worker |
| A17 | `v2-audio-scenarios.spec.js` A17/A18；`v2-media-regression.test.js` 格式对抗；production：S3 controller rollback | DataTransfer 失败返回 download fallback，原 File/list 恢复，injection 不声称成功 |
| A18 | `v2-audio-scenarios.spec.js` A17/A18；`v2-media-regression.test.js` A18；production full E2E cleanup/rebootstrap | dispose 幂等；无重复 host/session/Worker；production artifact 为单 IIFE、无 ESM import/export |

## 安全、格式与快速性能

- `v2-audio-security.spec.js` S01–S06：运行时 fetch/XHR/WebSocket/EventSource/sendBeacon/storage 计数为 0；恶意标签只作数据；伪 Worker taskId 被忽略；异常 WAV/MP4 读取有界且稳定失败；AI 敏感输入在 bridge 前返回 `AI_SENSITIVE_INPUT`；Worker/CSP 不可用返回 `AUDIO_WORKER_UNAVAILABLE`。
- `v2-media-regression.test.js` 覆盖伪扩展名/签名冲突、格式边界、registry image/audio 隔离和 production IIFE 形态。
- `v2-audio-performance.spec.js` P01–P03：progress 单调、≤10/s，heartbeat ≤500ms，cancel ≤1,000ms，Worker/URL 清理，连续第二任务无 stale state。
- 本阶段未执行 `>200000000` bytes 可解码合成音频；不得引用 S0/S2 历史结果作为本阶段 200MB 结果。

## 遗留项

`v2-s4-result.json` 记录本阶段实际测试计数、bundle 摘要和未运行门禁；`tabbit-matrix.json` 将 LR1–LR10 全部标为 `NOT_RUN_PHASE_2`。Phase 2 必须先证明 Tabbit 官方私有脚本上下文，再用同一 production SHA 完成 200MB 成功/取消和 LR 证据；不得用 Playwright、mock、debug bundle、旧截图或历史证据替代。
