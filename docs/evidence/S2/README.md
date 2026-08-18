# S2 图像处理引擎证据

状态：`READY_FOR_REACCEPTANCE`。这是返工完成后的自动证据，不等同于用户或独立验收方已签字通过。

返工依据：`docs/handoffs/S2-acceptance-rework-order.md`。
返工汇总：`rework-result.json`。

## R1-R6 关闭情况

| 问题 | 状态 | 回归用例 |
|---|---|---|
| R1 确认边界可伪造 | fixed + verified | Q-S2-001 |
| R2 主线程端点跨越误判 | fixed + verified | Q-S2-002 |
| R3 Worker 与主线程搜索不等价 | fixed + verified | Q-S2-003/004 |
| R4 输入错误污染与任意错误码 | fixed + verified | Q-S2-005/006/007 |
| R5 fixture 目标失真且未被集成消费 | fixed + verified | Q-S2-008/009 |
| R6 取消/降级/回退/性能/边界不完整 | fixed + verified | Q-S2-010/011/012/013 |

## 返工后门禁

| 命令 | 结果 |
|---|---|
| `npm ci` | PASS |
| `npm run fixtures:generate` | PASS：8 个文件，目标范围硬断言、签名/解码校验，WebP 非空生成 |
| `npm test -- --run` | PASS：13 个 Vitest 文件、97 个测试 |
| `npm run build` | PASS：单个纯 JavaScript IIFE，85700 bytes |
| `npm run static-check` | PASS |
| `npm run test:e2e -- --reporter=line --workers=1` | PASS：31 个 Chromium 测试，8765 端口关闭 |
| `git diff --check` | PASS |

## 结构化证据

- `metadata-result.json`：R4/R6 的 primary error short-circuit、HTMLImageElement 回退和 80MP 边界。
- `planner-result.json`：R1 权威计划重算、确认 payload 校验和 R2 入口约束。
- `pipeline-result.json`：R1/R2/R6 管线、真实性能数值和最终复检。
- `worker-fallback-result.json`：R3 Worker/main 等价、error/timeout/abort 清理。
- `fixtures-result.json`：R5 target/tolerance/actual/pass、WebP 能力和真实 fixture 清单。
- `rework-result.json`：R1-R6、Q-S2-001～013、fixture、Worker、性能、清理和产物汇总。

关键实测：

- Worker/main 同一输入均为 `image/jpeg`、`390×567`、`107058` bytes、最高有效质量 `0.834765625`，target max `108000`。
- `4000×3000`、`5000000` bytes 输入：`totalMs=858.8000000715256`，`maxHeartbeatGapMs=31.90000009536743`，输出 `1643×1232`、`438068` bytes、有效。
- Worker error/timeout 均单次主线程回退；abort 返回 `USER_CANCELLED` / `PROCESS_ABORTED`，不回退；构造失败、运行时错误、超时、abort 的 URL/Worker 清理均有断言。

## 范围与隐私

图片只在本地页面/Worker 内存中处理；无外部网络、AI、CDN、WASM 或用户文件读取。fixture 由确定性 Canvas 生成，生成目录被 `.gitignore` 排除；测试只记录尺寸、字节、MIME、哈希和稳定错误码，不记录二进制、Base64 或像素内容。

S2 返工没有进入 S3 任务编排/拒收观察、S4 UI/Tabbit AI 或业务上传。
