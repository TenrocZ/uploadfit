# S3 任务编排与上传闭环交接

- 交接日期：2026-08-19
- 工程目录：C:\Users\蔡天乐\Desktop\黑客松\main
- 对应任务书：40-S3-任务编排与上传闭环.md
- 共享契约：01-共享契约与接口基线.md
- Status：READY_FOR_REACCEPTANCE
- 核心门禁：AUTOMATION_PASS / REWORK_VERIFIED / ACCEPTANCE_PENDING
- 基线提交：1e2d0d9
- 返工基线：ce0cb3f
- 结束留痕：本次返工纳入本地 Git 提交，最终提交号见当前 HEAD
- Agent：Codex / UploadFit S3 Agent
- 环境：Windows；Node v22.20.0；npm 10.9.3；Playwright Chromium 1.62.1
- 生产产物：dist/uploadfit.js
- 产物 bytes：122812
- SHA-256：D8254518DD14F304A70A67457375171C8F6A1C9D13CC30F23AE690F5C2280D43

> 2026-08-19 独立验收发现的 R1～R4 已按返工单关闭，Q-S3-001～008 和视觉证据已补齐；当前仅申请独立重新验收，尚不表示 S3 已验收。正式历史结论见 `docs/handoffs/S3-acceptance-review.md`，施工边界见 `docs/handoffs/S3-acceptance-rework-order.md`，详细返工回报见 `docs/handoffs/S3-rework-report.md`。S4 暂不放行。

本文以下内容描述 `ce0cb3f` 基础上的 S3 交付；R1～R4 的返工变更和证据以 `docs/handoffs/S3-rework-report.md`、`docs/evidence/S3/README.md` 及当前 HEAD 为准。

## 1. 阶段结论

S3 已把 S0 注入器、S1 规则引擎和 S2 图像引擎接入唯一 TaskController。主路径为：

发现上传器 → 文件选择 → 预检/放行 → 本地处理 → 最终复检 → 回填 → 拒收观察 → 最多一次重试

合规文件不编码、不重新注入；规则不足时透传并等待 DOM 拒收；明确拒收才可形成 rejection 规则候选。模糊失败、冲突、官方工具、网络/权限/审核/清晰度语义均停止自动处理。

## 2. 代码交付

| 范围 | 交付内容 |
|---|---|
| Session/状态机 | src/core/session.js、src/core/state-machine.js |
| 唯一编排器 | src/core/task-controller.js |
| 资源清理 | src/core/cleanup.js |
| 拒收观察 | src/dom/rejection-observer.js、src/dom/rejection-classifier.js |
| 适配器 | src/adapters/registry.js |
| Bootstrap | src/bootstrap.js 最小接入，保留 S0 单例 host、guard 和 cleanup |
| 公共 API | src/index.js 导出 S3 controller、observer、state/adapter 工具 |

TaskController 是跨模块副作用唯一入口；view/测试只通过 start、registerUploader、handleFileChange、confirmTask、cancelTask、restoreTask、subscribe、getSnapshot、dispose 驱动。

## 3. 状态与安全语义

- 状态机显式列出合法转移；非法转移返回 false 并记录 INVALID_STATE_TRANSITION 诊断；DISPOSED 后不再更新 snapshot。
- 每个 input 有独立 uploader/context/task；同一 input 快速二选一会 abort 旧任务，旧结果不能覆盖新结果。
- 同时最多一个 PROCESSING/INJECTING，其他任务 FIFO 等待。
- 只在 result.file 为当前页面 File、result.validation.valid=true、最终复检通过后调用 S0 injectFile。
- 注入 change 使用一次性 guard 消费；不会产生递归任务。
- 拒收只观察 input 祖先、aria-describedby、错误容器、role=alert、aria-live 和新增/文本变化节点；不读取请求/响应。
- retryCount 在再次分发 input/change 前递增，最大值 1；不 click 业务按钮。
- snapshot 只保留可展示结构化数据，不暴露 File、input、像素、完整文件名和页面全文。

## 4. 自动化验证

| 命令 | 结果 |
|---|---|
| npm test -- --run | PASS：15 个 Vitest 文件、103 个测试 |
| npm run build | PASS：纯 JavaScript IIFE，122812 bytes |
| npm run static-check | PASS |
| npm run test:e2e -- --reporter=line --workers=1 | PASS：57 个 Chromium 测试，含 Q-S3-001～008，测试服务自动清理 |
| git diff --check | PASS |

专项测试文件：

- tests/unit/state-machine.test.js
- tests/unit/rejection-classifier.test.js
- tests/integration/task-controller.test.js
- tests/integration/upload-loop.test.js
- tests/integration/rejection-observer.test.js
- tests/integration/cleanup.test.js
- tests/integration/s3-acceptance-rework.test.js

权威结构化证据：docs/evidence/S3/s3-result.json。返工回报：docs/handoffs/S3-rework-report.md。

## 5. 范围排除

- 未实现 S4 正式 UI、视觉裁剪器或正式 view adapter。
- 未增加真实 Tabbit AI provider，不扩大 AI 权限和网络边界。
- 未点击保存、下一步、提交、发布、付款或其他最终业务按钮。
- 未 monkey-patch 请求 API、读取请求/响应、修改其他表单字段或替换原 input。
- 未推送远程；Git 仅保留本地开发留痕。

## 6. 验收入口

R1～R4 已完成返工并通过全量门禁，现以新 evidence 和本地 Git 留痕申请独立重新验收。当前 S3 状态为 `READY_FOR_REACCEPTANCE`；在独立验收结论返回前，S4 暂不放行。
