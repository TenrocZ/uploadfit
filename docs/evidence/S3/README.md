# S3 任务编排与拒收观察证据

> 2026-08-19 独立验收结论为 `REWORK_REQUIRED`。本文件原 PASS 映射只代表提交 `ce0cb3f` 的既有自动化结果，已由 `acceptance-review-result.json` 与 `docs/handoffs/S3-acceptance-review.md` 覆盖；返工入口为 `docs/handoffs/S3-acceptance-rework-order.md`。

状态：`REWORK_REQUIRED`。提交 `ce0cb3f` 的自动化门禁通过，但独立验收失败；以下原始映射保留作历史基线，不表示当前可验收。

任务书：C:\Users\蔡天乐\Desktop\黑客松\UploadFit-开发任务书-v1.0\40-S3-任务编排与上传闭环.md
共享契约：C:\Users\蔡天乐\Desktop\黑客松\UploadFit-开发任务书-v1.0\01-共享契约与接口基线.md
基线提交：1e2d0d9
工程目录：C:\Users\蔡天乐\Desktop\黑客松\main

## 交付矩阵

| 交付物 | 实现/证据 | 结果 |
|---|---|---|
| S3-D1 Session/状态机 | src/core/session.js、src/core/state-machine.js、tests/unit/state-machine.test.js | PASS：主路径、非法转移诊断、DISPOSED 终态 |
| S3-D2 上传器注册 | src/core/task-controller.js、src/adapters/registry.js | PASS：每个 input 独立上下文，重复注册不重复监听 |
| S3-D3 文件任务队列 | src/core/task-controller.js | PASS：crypto 随机 taskId，单一 processingTask，FIFO 等待 |
| S3-D4 预检分流 | task-controller.test.js | PASS：合规透传、明确不合规拦截、低置信确认、规则不足等待 |
| S3-D5 拒收观察 | src/dom/rejection-observer.js、src/dom/rejection-classifier.js、rejection-observer.test.js、upload-loop.test.js | PASS：30 秒窗口、100ms 合并、DOM 关联、明确/模糊分类、歧义停止 |
| S3-D6 回填闭环 | src/core/task-controller.js、S0 injectFile/guard、task-controller.test.js | PASS：最终复检通过才注入、注入 guard、防递归、恢复原文件 |
| S3-D7 一次重试 | upload-loop.test.js | PASS：仅 input/change，retryCount 最大 1，第二次拒收 STOPPED，零业务 click |
| S3-D8 清理 | src/core/cleanup.js、controller dispose/pagehide、cleanup.test.js | PASS：Observer、监听器、任务、AbortSignal 和页面生命周期均可清理 |
| S3-D9 集成测试 | tests/integration/task-controller.test.js、upload-loop.test.js、rejection-observer.test.js、cleanup.test.js | PASS：预检、拒收、模糊失败、队列、恢复和清理主链路 |

## C/L 用例覆盖

| 用例 | 自动化证据 |
|---|---|
| C01-C12 | state-machine.test.js、task-controller.test.js、rejection-observer.test.js；C08 断言输出复检失败不注入，C10/C11 断言移除/dispose 后无异步回填 |
| L01-L12 | task-controller.test.js、upload-loop.test.js、rejection-observer.test.js；包含双 uploader 隔离、快速二选一、multiple、fallback、恢复和 pagehide |

关键行为断言：

- 完全合规文件保持原事件路径，未编码、未重新注入。
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
| npm run build | PASS：单个纯 JavaScript IIFE，119062 bytes |
| npm run static-check | PASS：无 eval、new Function、请求拦截、innerHTML |
| npm run test:e2e -- --reporter=line --workers=1 | PASS：49 个 Chromium 测试，测试服务自动关闭 |
| git diff --check | PASS |

产物：dist/uploadfit.js
SHA-256：7F0DEDA9CE989911A5D24D1BFA0A73B55D0B8ACDEF8B9B272B8A79E2BBBAC514
构建上限：150000 bytes

## 范围与限制

- 本阶段只实现 S3 任务编排、拒收观察、适配器注册、回填闭环、一次重试和清理。
- 没有实现 S4 正式 UI、裁剪器视觉、真实 Tabbit AI provider、发布或远程推送。
- 不 monkey-patch 网络请求，不读取请求/响应，不点击最终业务按钮，不替换原 input 节点。
- 合成事件仍为 isTrusted=false；网站不响应时只保留 manual-submit/download fallback 语义。
- 证据只记录结构化状态、稳定错误码、MIME、字节、宽高和事件计数，不记录用户文件内容或敏感文本。
