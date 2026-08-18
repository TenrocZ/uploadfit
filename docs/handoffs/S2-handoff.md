# S2 图像处理引擎返工交接

- 交接日期：2026-08-18
- 工程目录：`C:\Users\蔡天乐\Desktop\黑客松\main`
- 对应任务书：`30-S2-图像处理引擎.md`
- 返工单：`docs/handoffs/S2-acceptance-rework-order.md`
- Status：`READY_FOR_REACCEPTANCE`
- 核心门禁：`AUTOMATION_PASS / ACCEPTANCE_PENDING`
- 基线提交：`463bab7`（S2 初次实现）
- 首次返工提交：`30795a5`
- 二次返工提交：`4dabd84`（canonical plan、自然编码 fixture、Q-S2-014～017）
- Agent：`Codex / UploadFit S2 Agent`
- 环境：Windows；Node `v22.20.0`；npm `10.9.3`；Playwright Chromium `1.62.1`
- 生产产物：`dist/uploadfit.js`
- 产物 bytes：`86213`
- SHA-256：`F511425408A38D0D96AD931CF9FE8E7D32CA122297B3172B8594CFF9FA1AA62D`

> 本文只表示返工已完成并具备独立复验入口，不表示用户或独立验收方已经验收通过。S2 返工完成后仍停留在 S2，不启动 S3/S4。

## 1. 阶段结论

R1～R6 及二次复验追加问题均已 `fixed + verified`。Q-S2-001～Q-S2-017 均已存在并通过；fixture 以自然编码进入目标容差、目标 JPEG APP1=0，并真实驱动全部规定处理/失败路径；Worker 与主线程均有性能 heartbeat 证据。

二次返工权威证据：`docs/evidence/S2/second-rework-result.json`。首次返工快照保留在 `rework-result.json`。

## 2. D1-D8 交付与返工关闭

| 问题 | 修改摘要 | 代码/证据 | 回归 | 结果 |
|---|---|---|---|---|
| R1 | `processImage` 入口重新 inspect；逐类型绑定 CROP/FLATTEN/UPSCALE 执行字段；跨类型借权被拒绝；只执行重新构造的 canonical plan | `src/image/canvas-pipeline.js`；`docs/evidence/S2/planner-result.json` | Q-S2-001/014 | fixed + verified |
| R2 | 抽取 DOM-free `searchLossy`；明确 qMax/qMin 端点状态；端点跨越时继续搜索中间区间，最多 8 步，保留最高合法质量；每轮只 release 一次 | `src/image/lossy-search.js`、`src/image/size-optimizer.js` | Q-S2-002 | fixed + verified |
| R3 | Worker 注入同一纯搜索函数源码，移除最低质量提前返回；每个 resize round 清理 OffscreenCanvas；Worker/main 输出等价 | `src/image/worker-runtime.js`；`docs/evidence/S2/worker-fallback-result.json` | Q-S2-003/004 | fixed + verified |
| R4 | primary resource error 在 RuleSet 有效后立即短路；不可解码不再叠加格式/尺寸修复；`ImageProcessingError` 与 `asImageProcessingError` 使用稳定错误码白名单 | `src/image/metadata.js`、`src/image/errors.js` | Q-S2-005/006/007 | fixed + verified |
| R5 | 删除 APP1 补体积；以确定性图案熵/quality 自然编码；目标 JPEG APP1=0；8 个 generated fixture 真实驱动转换、压缩、最小值失败、扁平化、方向、损坏、WebP、缩放 | `tests/fixtures/*`、`tests/integration/s2-rework.test.js` | Q-S2-008/009/015/016 | fixed + verified |
| R6 | `AbortSignal`、Worker error/timeout/abort、HTML fallback、80MP、Worker heartbeat 和主线程 fallback heartbeat 均自动覆盖 | `src/image/**`、`tests/integration/s2-rework.test.js` | Q-S2-010/011/012/013/017 | fixed + verified |

D1-D8 原有能力保持：真实 JPEG/PNG/WebP 签名和 metadata、纯校验、固定计划、显式 CROP/FLATTEN_BACKGROUND/UPSCALE 确认、Canvas/Worker 处理、最终输出复检和主线程降级。没有进入 S3 任务编排/拒收观察、S4 UI/Tabbit AI 或业务上传。

## 3. fixture 实测

| fixture | target | tolerance | actual | result |
|---|---:|---:|---:|---|
| `png-1170x1701.png` | 2,000,000 | ±25% | 2,062,531 | PASS |
| `jpeg-390x567-medium.jpg` | 500,000 | ±25% | 555,011 | PASS；APP1=0 |
| `jpeg-390x567-small.jpg` | 20,000 | ±25% | 22,622 | PASS；APP1=0 |
| `jpeg-4000x3000.jpg` | 5,000,000 | ±25% | 4,944,335 | PASS；APP1=0 |
| `transparent.png` | n/a | n/a | 26,570 | PASS；大块 alpha 区域 |
| `jpeg-orientation-6.jpg` | n/a | n/a | 5,682 | PASS；EXIF 6 |
| `corrupt.png` | n/a | n/a | 11 | PASS；合法 PNG signature、不可解码 |
| `sample.webp` | n/a | n/a | 170,788 | PASS；非空、可解码 |

manifest 与哈希：`tests/fixtures/manifest.json`。generated 二进制目录被 `.gitignore` 排除；每次生成都会硬校验目标范围、签名/解码、编码候选和目标 JPEG APP1=0。

## 4. Worker 等价性与性能

Worker/main 同一 `jpeg-390x567-medium.jpg` 输入：target `1..108000` bytes；两者均为 `image/jpeg`、`390×567`、`107474` bytes、`valid=true`，最高有效 quality 均为 `0.66484375`。

性能实测环境：Windows、Node `22.20.0`、Playwright Chromium `1.62.1` headless；输入 `4000×3000`、`4,944,335` bytes。Worker 为 `808.5ms / 32.9ms heartbeat`，主线程 fallback 为 `886.7ms / 128.8ms heartbeat`；输出均为 `1647×1235`、`440409` bytes、有效。

清理证据：成功路径 `bitmap.close`、每轮 canvas release、`worker.terminate`、`URL.revokeObjectURL` 均断言；runtime error 和 timeout 各单次主线程回退且 `terminate=1/revoke=1`；abort 不回退，返回 `USER_CANCELLED` 且 details.reason=`PROCESS_ABORTED`，`terminate=1/revoke=1`；HTMLImageElement 成功路径 URL revoke 次数至少 3。

## 5. 全量验证

| 命令 | 结果 |
|---|---|
| `npm ci` | PASS |
| `npm run fixtures:generate` | PASS：8 个自然编码 fixture；目标、签名/解码、APP1=0 硬断言 |
| `npm test -- --run` | PASS：13 个 Vitest 文件、98 个测试 |
| `npm run build` | PASS：单个纯 JavaScript IIFE，86213 bytes |
| `npm run static-check` | PASS |
| `npm run test:e2e -- --reporter=line --workers=1` | PASS：34 个 Chromium 测试；8765 端口关闭 |
| `rg "Q-S2-0(0[1-9]|1[0-7])" tests` | PASS：Q-S2-001～017 全部存在 |
| `git diff --check` | PASS |

## 6. 安全、隐私和边界

- 图片二进制/像素只在当前页面或 Worker 内存处理；无外部网络、AI、CDN、WASM 或运行时 provider。
- 不读取业务 DOM；Canvas 不插入业务 DOM；不记录二进制、Base64、像素、Cookie、Token、完整路径或用户文件。
- 50MiB 输入、20,000 单边、80MP 上限以及损坏/不支持格式均保持稳定错误边界。
- `CROP`、`FLATTEN_BACKGROUND`、`UPSCALE` 仍须各自显式确认；用户拒绝与处理中止均不被当作成功。
- Git 仅为本地版本留痕，未推送远程。

## 7. 复验入口

请独立验收方以 `docs/evidence/S2/second-rework-result.json`、本文件和提交 `4dabd84` 核对。当前状态是 `READY_FOR_REACCEPTANCE`，不是 `ACCEPTED`。
