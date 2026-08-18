# S2 图像处理引擎证据

状态：`READY_FOR_REACCEPTANCE`。二次复验发现的跨类型确认注入、fixture 元数据填充、真实 fixture 处理覆盖和主线程 heartbeat 证据均已修复；这仍不等同于用户签字通过。

返工依据：`docs/handoffs/S2-acceptance-rework-order.md`。
首次返工汇总：`rework-result.json`。
二次返工权威汇总：`second-rework-result.json`。

## R1-R6 关闭情况

| 问题 | 状态 | 回归用例 |
|---|---|---|
| R1 确认边界可伪造/跨类型借权 | fixed + verified | Q-S2-001/014 |
| R2 主线程端点跨越误判 | fixed + verified | Q-S2-002 |
| R3 Worker 与主线程搜索不等价 | fixed + verified | Q-S2-003/004 |
| R4 输入错误污染与任意错误码 | fixed + verified | Q-S2-005/006/007 |
| R5 fixture 目标失真、元数据填充且处理覆盖不足 | fixed + verified | Q-S2-008/009/015/016 |
| R6 取消/降级/回退/Worker 与主线程性能/边界不完整 | fixed + verified | Q-S2-010/011/012/013/017 |

## 返工后门禁

| 命令 | 结果 |
|---|---|
| `npm ci` | PASS |
| `npm run fixtures:generate` | PASS：8 个自然编码文件；目标范围、签名/解码和目标 JPEG APP1=0 硬断言 |
| `npm test -- --run` | PASS：13 个 Vitest 文件、98 个测试 |
| `npm run build` | PASS：单个纯 JavaScript IIFE，86213 bytes |
| `npm run static-check` | PASS |
| `npm run test:e2e -- --reporter=line --workers=1` | PASS：34 个 Chromium 测试，8765 端口关闭 |
| `git diff --check` | PASS |

## 结构化证据

- `metadata-result.json`：R4/R6 的 primary error short-circuit、HTMLImageElement 回退和 80MP 边界。
- `planner-result.json`：R1 权威计划重算、逐类型执行字段校验、canonical plan 和 R2 入口约束。
- `pipeline-result.json`：R1/R2/R6 管线、Worker/主线程性能数值、真实 fixture 处理和最终复检。
- `worker-fallback-result.json`：R3 Worker/main 等价、error/timeout/abort 清理。
- `fixtures-result.json`：R5 target/tolerance/actual/pass、APP1=0、WebP 能力和真实处理清单。
- `rework-result.json`：首次 R1-R6 返工快照。
- `second-rework-result.json`：二次复验问题、Q-S2-014～017、自然编码 fixture、双路径性能和最终产物权威汇总。

关键实测：

- Worker/main 同一输入均为 `image/jpeg`、`390×567`、`107474` bytes、最高有效质量 `0.66484375`，target max `108000`。
- `4000×3000`、`4944335` bytes 输入：Worker `808.5ms / 32.9ms heartbeat`；主线程 `886.7ms / 128.8ms heartbeat`；两者输出均为 `1647×1235`、`440409` bytes、有效。
- 500KB/20KB/5MB 目标 JPEG 的 APP1 metadata bytes 均为 `0`；只有 Orientation 6 样本保留 36-byte 有意义 EXIF APP1。
- Q-S2-014 的六个跨类型借权组合均返回 `USER_CONFIRMATION_REQUIRED`。
- Worker error/timeout 均单次主线程回退；abort 返回 `USER_CANCELLED` / `PROCESS_ABORTED`，不回退；构造失败、运行时错误、超时、abort 的 URL/Worker 清理均有断言。

## 范围与隐私

图片只在本地页面/Worker 内存中处理；无外部网络、AI、CDN、WASM 或用户文件读取。fixture 由确定性 Canvas 自然编码生成，不填充垃圾字节或无意义元数据；生成目录被 `.gitignore` 排除。测试只记录尺寸、字节、MIME、哈希和稳定错误码，不记录二进制、Base64 或像素内容。

S2 返工没有进入 S3 任务编排/拒收观察、S4 UI/Tabbit AI 或业务上传。
