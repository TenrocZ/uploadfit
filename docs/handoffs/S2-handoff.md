# S2 图像处理引擎返工交接

- 交接日期：2026-08-18
- 工程目录：`C:\Users\蔡天乐\Desktop\黑客松\main`
- 对应任务书：`30-S2-图像处理引擎.md`
- 返工单：`docs/handoffs/S2-acceptance-rework-order.md`
- Status：`READY_FOR_REACCEPTANCE`
- 核心门禁：`AUTOMATION_PASS / ACCEPTANCE_PENDING`
- 基线提交：`463bab7`（S2 初次实现）
- 返工提交：`30795a5`（生产逻辑、S2 测试和 fixture 生成器本地留痕）
- Agent：`Codex / UploadFit S2 Agent`
- 环境：Windows；Node `v22.20.0`；npm `10.9.3`；Playwright Chromium `1.62.1`
- 生产产物：`dist/uploadfit.js`
- 产物 bytes：`85700`
- SHA-256：`30EC37ED660967CB5E0987A086EAB0C76A576D96606A5F568526D216A24291C7`

> 本文只表示返工已完成并具备独立复验入口，不表示用户或独立验收方已经验收通过。S2 返工完成后仍停留在 S2，不启动 S3/S4。

## 1. 阶段结论

独立验收返工单提出的 R1～R6 已逐项 `fixed + verified`。Q-S2-001～Q-S2-013 均已存在并通过；fixture 已实际落盘并被集成测试从本地测试目录读取；Worker/main 等价、取消/超时/回退/HTMLImageElement 回退、真实性能与 80MP 边界均有自动证据。

结构化完整证据：`docs/evidence/S2/rework-result.json`。

## 2. D1-D8 交付与返工关闭

| 问题 | 修改摘要 | 代码/证据 | 回归 | 结果 |
|---|---|---|---|---|
| R1 | `processImage` 入口重新 inspect；依据实际 metadata + `plan.rules` 重算权威计划；逐项比较 target/operation/rules/confirmation；拒绝、删除、伪造、payload 篡改分别稳定失败 | `src/image/canvas-pipeline.js`；`docs/evidence/S2/planner-result.json` | Q-S2-001 | fixed + verified |
| R2 | 抽取 DOM-free `searchLossy`；明确 qMax/qMin 端点状态；端点跨越时继续搜索中间区间，最多 8 步，保留最高合法质量；每轮只 release 一次 | `src/image/lossy-search.js`、`src/image/size-optimizer.js` | Q-S2-002 | fixed + verified |
| R3 | Worker 注入同一纯搜索函数源码，移除最低质量提前返回；每个 resize round 清理 OffscreenCanvas；Worker/main 输出等价 | `src/image/worker-runtime.js`；`docs/evidence/S2/worker-fallback-result.json` | Q-S2-003/004 | fixed + verified |
| R4 | primary resource error 在 RuleSet 有效后立即短路；不可解码不再叠加格式/尺寸修复；`ImageProcessingError` 与 `asImageProcessingError` 使用稳定错误码白名单 | `src/image/metadata.js`、`src/image/errors.js` | Q-S2-005/006/007 | fixed + verified |
| R5 | fixture target/tolerance 硬断言；生成时校验签名、MIME、维度、浏览器解码；WebP 能力失败明确报错；集成测试直接读取 generated 文件 | `tests/fixtures/*`、`scripts/serve-test.js` | Q-S2-008/009 | fixed + verified |
| R6 | `AbortSignal` 贯穿解码/编码/缩放；Worker constructor/error/timeout/abort 有 bounded cleanup；HTMLImageElement fallback revoke URL；真实 heartbeat 与精确像素边界测试 | `src/image/metadata.js`、`src/image/canvas-pipeline.js`、`src/image/size-optimizer.js`、`src/image/worker-runtime.js` | Q-S2-010/011/012/013 | fixed + verified |

D1-D8 原有能力保持：真实 JPEG/PNG/WebP 签名和 metadata、纯校验、固定计划、显式 CROP/FLATTEN_BACKGROUND/UPSCALE 确认、Canvas/Worker 处理、最终输出复检和主线程降级。没有进入 S3 任务编排/拒收观察、S4 UI/Tabbit AI 或业务上传。

## 3. fixture 实测

| fixture | target | tolerance | actual | result |
|---|---:|---:|---:|---|
| `png-1170x1701.png` | 2,000,000 | ±25% | 2,062,531 | PASS |
| `jpeg-390x567-medium.jpg` | 500,000 | ±25% | 500,000 | PASS |
| `jpeg-390x567-small.jpg` | 20,000 | ±25% | 20,000 | PASS |
| `jpeg-4000x3000.jpg` | 5,000,000 | ±25% | 5,000,000 | PASS |
| `transparent.png` | n/a | n/a | 118,929 | PASS；alpha |
| `jpeg-orientation-6.jpg` | n/a | n/a | 5,682 | PASS；EXIF 6 |
| `corrupt.png` | n/a | n/a | 11 | PASS；合法 PNG signature、不可解码 |
| `sample.webp` | n/a | n/a | 170,788 | PASS；非空、可解码 |

manifest 与哈希：`tests/fixtures/manifest.json`。generated 二进制目录被 `.gitignore` 排除，但每次 `npm run fixtures:generate` 会重新生成并硬校验。

## 4. Worker 等价性与性能

Worker/main 同一 `jpeg-390x567-medium.jpg` 输入：target `1..108000` bytes；两者均为 `image/jpeg`、`390×567`、`107058` bytes、`valid=true`，最高有效 quality 均为 `0.834765625`。Worker 标记 `workerUsed=true`，主线程标记 `workerUsed=false`。

性能实测环境：Windows、Node `22.20.0`、Playwright Chromium `1.62.1` headless；输入 `jpeg-4000x3000.jpg`，`4000×3000`、`5,000,000` bytes。`totalMs=858.8000000715256`，`maxHeartbeatGapMs=31.90000009536743`；输出 `1643×1232`、`438068` bytes、有效，均通过 `<=5000ms` / `<=500ms` 门槛。

清理证据：成功路径 `bitmap.close`、每轮 canvas release、`worker.terminate`、`URL.revokeObjectURL` 均断言；runtime error 和 timeout 各单次主线程回退且 `terminate=1/revoke=1`；abort 不回退，返回 `USER_CANCELLED` 且 details.reason=`PROCESS_ABORTED`，`terminate=1/revoke=1`；HTMLImageElement 成功路径 URL revoke 次数至少 3。

## 5. 全量验证

| 命令 | 结果 |
|---|---|
| `npm ci` | PASS |
| `npm run fixtures:generate` | PASS：8 个 fixture，目标硬断言、签名/解码检查 |
| `npm test -- --run` | PASS：13 个 Vitest 文件、97 个测试 |
| `npm run build` | PASS：单个纯 JavaScript IIFE，85700 bytes |
| `npm run static-check` | PASS |
| `npm run test:e2e -- --reporter=line --workers=1` | PASS：31 个 Chromium 测试；8765 端口关闭 |
| `rg "Q-S2-0(0[1-9]|1[0-3])" tests` | PASS：Q-S2-001～013 全部存在 |
| `git diff --check` | PASS |

## 6. 安全、隐私和边界

- 图片二进制/像素只在当前页面或 Worker 内存处理；无外部网络、AI、CDN、WASM 或运行时 provider。
- 不读取业务 DOM；Canvas 不插入业务 DOM；不记录二进制、Base64、像素、Cookie、Token、完整路径或用户文件。
- 50MiB 输入、20,000 单边、80MP 上限以及损坏/不支持格式均保持稳定错误边界。
- `CROP`、`FLATTEN_BACKGROUND`、`UPSCALE` 仍须各自显式确认；用户拒绝与处理中止均不被当作成功。
- Git 仅为本地版本留痕，未推送远程。

## 7. 复验入口

请独立验收方重新执行返工单第 12～15 节要求，并以 `docs/evidence/S2/rework-result.json`、本文件和最终 Git 提交核对。当前状态是 `READY_FOR_REACCEPTANCE`，不是 `ACCEPTED`。
