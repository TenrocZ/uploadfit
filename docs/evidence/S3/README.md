# S3 任务编排与拒收观察证据

> 2026-08-19 返工后独立复验已通过；R1～R4 和复验新增残留均已关闭。历史首次验收报告继续保留，最终结论见 `docs/handoffs/S3-reacceptance-review.md`。

状态：`ACCEPTED`。返工基线：`ce0cb3f`；独立复验修复提交：`09e7d3d`；S4 已放行。

任务书：`docs/archive/v1/work-orders/40-S3-任务编排与上传闭环.md`
共享契约：`docs/archive/v1/work-orders/01-共享契约与接口基线.md`
基线提交：1e2d0d9
工程目录：C:\Users\蔡天乐\Desktop\黑客松\main

## 交付矩阵

| 交付物 | 实现/证据 | 结果 |
|---|---|---|
| S3-D1 Session/状态机 | src/core/session.js、src/core/state-machine.js、tests/unit/state-machine.test.js、s3-acceptance-rework.test.js | PASS：聚合状态、合法 FIFO 轨迹、非法转移诊断、DISPOSED 终态 |
| S3-D2 上传器注册 | src/core/task-controller.js、src/adapters/registry.js、s3-reacceptance-probe.test.js | PASS：每个 input 独立上下文；裸 input 首次图片选择可在同一捕获事件内升级 |
| S3-D3 文件任务队列 | src/core/task-controller.js、s3-acceptance-rework.test.js | PASS：crypto 随机 taskId，单一 processingTask，双 uploader FIFO、失败后继续 pump |
| S3-D4 预检分流 | task-controller.test.js、s3-acceptance-rework.test.js | PASS：异步约束先拦截、合规原文件释放、安全处理文件释放、低置信策略确认 |
| S3-D5 拒收观察 | src/dom/rejection-observer.js、src/dom/rejection-classifier.js、rejection-observer.test.js、upload-loop.test.js | PASS：30 秒窗口、100ms 合并、DOM 关联、明确/模糊分类、歧义停止 |
| S3-D6 回填闭环 | src/core/task-controller.js、S0 injectFile/guard、task-controller.test.js、s3-acceptance-rework.test.js | PASS：最终复检通过才注入、原事件释放 guard、防递归、恢复原文件 |
| S3-D7 一次重试 | upload-loop.test.js | PASS：仅 input/change，retryCount 最大 1，第二次拒收 STOPPED，零业务 click |
| S3-D8 清理 | src/core/cleanup.js、controller dispose/pagehide、cleanup.test.js | PASS：Observer、监听器、任务、AbortSignal 和页面生命周期均可清理 |
| S3-D9 集成测试 | task-controller.test.js、s3-acceptance-rework.test.js、s3-reacceptance-probe.test.js、upload-loop.test.js、rejection-observer.test.js、cleanup.test.js | PASS：R1～R4、复验残留和任务书主链路 |

## C/L 用例覆盖

| 用例 | 自动化证据 |
|---|---|
| C01-C12 | state-machine.test.js、task-controller.test.js、rejection-observer.test.js；C08 断言输出复检失败不注入，C10/C11 断言移除/dispose 后无异步回填 |
| L01-L12 | task-controller.test.js、upload-loop.test.js、rejection-observer.test.js；包含双 uploader 隔离、快速二选一、multiple、fallback、恢复和 pagehide |
| Q-S3-001～008 | s3-acceptance-rework.test.js；覆盖事件闭环、策略确认分层、双 uploader FIFO、失败后续跑 |
| Q-S3-009～010 | s3-reacceptance-probe.test.js；覆盖裸 input 首次 MIME 升级和真实 S2 中置信处理闭环 |

关键行为断言：

- 同步可判定合规文件保持原事件路径；含异步尺寸/比例等约束时先阻断，metadata 决策后仅释放一次原文件事件，未编码、未重新注入。
- 异步安全修复场景原始文件事件为 0，最终复检合格的处理文件事件为 1。
- RULE_CONFIDENCE 保存在 S3 policyConfirmation，S2 canonical plan 不含该策略确认；自动 resolver 和手动 confirmTask 均有回归。
- 双 uploader 合法 FIFO 的最大 PROCESSING/INJECTING 并发为 1，session diagnostics 为空；首任务失败后队列继续。
- 明确不合规 PNG 经过 inspect、plan、process、最终复检后才回填为合规 MIME/尺寸。
- 规则不足时原事件透传并进入 WAITING_REJECTION；模糊上传失败不改文件、不处理、不重试。
- 明确拒收规则按 rejection 来源合并，不直接执行“压缩”；重试前原子增加 retryCount。
- 重试只分发 input/change，不点击 button、submit、a 或业务按钮；测试记录业务 click 为 0。
- 第二次明确拒收立即 STOPPED，事件计数不再增加。
- snapshot 不暴露 File、input、完整文件名、像素、完整页面文本或 URL 查询参数。

## 自动化门禁

| 命令 | 结果 |
|---|---|
| npm test -- --run | PASS：15 个 Vitest 文件、103 个测试 |
| npm run build | PASS：单个纯 JavaScript IIFE，122865 bytes |
| npm run static-check | PASS：无 eval、new Function、请求拦截、innerHTML |
| npm run test:e2e -- --reporter=line --workers=1 | PASS：59 个 Chromium 测试，含 Q-S3-001～010，测试服务自动关闭 |
| git diff --check | PASS |

产物：dist/uploadfit.js
SHA-256：4483FC94F140F892F9A0FCF16AF27797639C41B44F8E863AD9FEDE2F4897702D
构建上限：150000 bytes

## R1～R4 返工闭环

返工基线为 `ce0cb3f`，以下结果仅表示开发方自检和自动化复验完成，等待独立重新验收：

| 返工项 | 修复与证据 | 结果 |
|---|---|---|
| R1 / P0 异步 change 泄漏 | 捕获阶段保存原始事件并阻断；metadata/策略决策后按结果单次释放或走处理注入；Q-S3-001～003 | PASS |
| R2 / P0 RULE_CONFIDENCE 污染 S2 plan | policyConfirmation 独立于 canonical plan；自动 resolver、手动确认、图像确认独立回归；Q-S3-004～006 | PASS |
| R3 / P1 双 uploader session 竞争 | 单一 processingTask、FIFO pump、下一任务前合法重置 session；Q-S3-007～008 | PASS |
| R4 / P1 验收证据不足 | 8 个正式 Q 用例、结构化 JSON、事件时间线、清理断言、前后视觉证据 | PASS |

详细回报：[S3-rework-report.md](../../handoffs/S3-rework-report.md)。

独立复验：[S3-reacceptance-review.md](../../handoffs/S3-reacceptance-review.md)、[reacceptance-result.json](reacceptance-result.json)。

视觉证据：[s3-confirmation-before.png](s3-confirmation-before.png)、[s3-confirmation-after.png](s3-confirmation-after.png)。

## 范围与限制

- 本阶段只实现 S3 任务编排、拒收观察、适配器注册、回填闭环、一次重试和清理。
- 没有实现 S4 正式 UI、裁剪器视觉、真实 Tabbit AI provider、发布或远程推送。
- 不 monkey-patch 网络请求，不读取请求/响应，不点击最终业务按钮，不替换原 input 节点。
- 合成事件仍为 isTrusted=false；网站不响应时只保留 manual-submit/download fallback 语义。
- 网站更早注册的 document/window 捕获监听器可能先看到原事件；按任务书不声称覆盖所有站点。
- 证据只记录结构化状态、稳定错误码、MIME、字节、宽高和事件计数，不记录用户文件内容或敏感文本。
