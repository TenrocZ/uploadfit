# S3 任务编排与上传闭环独立验收报告

- 验收日期：2026-08-19
- 工程目录：`C:\Users\蔡天乐\Desktop\黑客松\main`
- 任务书：`40-S3-任务编排与上传闭环.md`
- 共享契约：`01-共享契约与接口基线.md`
- S3 开发基线：`1e2d0d9`
- 被验收提交：`ce0cb3f`
- 验收结论：`REWORK_REQUIRED`
- 自动门禁：`PASS`
- 独立验收：`FAIL`
- 后续阶段：S4 暂不放行
- 返工施工单：`docs/handoffs/S3-acceptance-rework-order.md`
- 结构化证据：`docs/evidence/S3/acceptance-review-result.json`

## 1. 结论

S3 当前不能通过验收。既有 103 个 Vitest 用例、49 个 Chromium 用例、构建和静态检查全部通过，但独立对抗性复现确认 2 个 P0 功能/安全阻塞项和 1 个 P1 并发状态缺口；同时，任务书要求的 S3 测试页截图或录屏尚未交付。

在返工单 R1～R4 全部关闭并重新独立验收前，不得把 S3 标记为 `ACCEPTED`，也不得据此启动 S4 实质开发。

## 2. 验收方法与实测基线

本轮按任务书 D1～D9、C01～C12、L01～L12 和退出标准复核提交范围、生产实现、现有测试、结构化证据，并额外运行 3 个临时 Chromium 对抗性探针。临时探针只用于复现，完成后已从工作区移除；返工时需把等价场景固化为正式回归测试。

| 检查 | 实测结果 |
|---|---|
| `npm run check` | PASS：15 个 Vitest 文件、103 个测试；build/static-check 通过 |
| `npm run test:e2e` | PASS：49 个 Chromium 测试 |
| 独立对抗性探针 | 3/3 成功复现缺陷 |
| `dist/uploadfit.js` | 119062 bytes，小于 150000 bytes |
| SHA-256 | `7F0DEDA9CE989911A5D24D1BFA0A73B55D0B8ACDEF8B9B272B8A79E2BBBAC514` |
| 禁止能力扫描 | 未发现生产代码发起网络请求、点击业务按钮、调用真实 AI、`eval` 或 `new Function` |
| 测试服务 | 8765 端口已关闭 |

自动门禁通过只证明现有断言成立，不覆盖本报告的缺失场景，不能替代独立验收结论。

## 3. 阻塞问题

### R1 / P0：异步才能识别的违规文件先泄露给页面业务监听器

对应要求：D4、C05、C06，以及“明确不合规或需要有损确认时先阻断原始事件”。

根因位于 `src/core/task-controller.js`：`handleFileChange()` 只通过 `quickViolations()` 同步判断 MIME 和字节数。宽高、比例、透明度等必须在 `await inspectImage()` 后才能确认，但原始 `change` 在函数第一次异步让出时已经继续传播。

独立 Chromium 复现：页面规则为 JPEG、390×567、10KB～600KB；选择 1000×1000 JPEG。文件 MIME/字节同步合法，随后异步计划要求 `CROP` 确认。实际观测为：

```json
{
  "businessEvents": [
    { "name": "square.jpg", "type": "image/jpeg", "defaultPrevented": false }
  ],
  "taskStatus": "NEEDS_CONFIRMATION",
  "confirmations": ["CROP"]
}
```

即页面业务侧已收到原文件，之后控制器才进入确认态。自动上传页面可能已经上传未经适配的原图；用户即使拒绝裁剪，也无法撤销已发生的业务副作用。现有 C05/C06 只检查任务状态和文件保留，没有断言页面监听器是否在确认前收到事件。

### R2 / P0：0.75～0.89 规则确认“接受”路径不可执行

对应要求：D4 的中置信规则独立确认，以及确认后继续校验/处理的完整闭环。

根因是控制器把 `RULE_CONFIDENCE` 直接插入 S2 处理计划。`src/image/planner.js` 可以解析该确认，但 `src/image/canvas-pipeline.js` 会根据 metadata + rules 重建权威 S2 计划；权威计划不含 `RULE_CONFIDENCE`，且执行入口只允许 `CROP`、`FLATTEN_BACKGROUND`、`UPSCALE`。因此用户接受规则后，确认集合必然与权威计划不一致。

独立 Chromium 复现：置信度 0.8，选择需要安全转换/缩放的 PNG；接受 `RULE_CONFIDENCE` 并提交 `{allow:true}`。实际结果：

```json
{
  "status": "STOPPED",
  "errorCode": "USER_CONFIRMATION_REQUIRED",
  "hasResult": false
}
```

现有 D4 测试仅覆盖 `accepted:false`，所以未发现接受分支完全失效。若同时存在 `RULE_CONFIDENCE` 与 CROP/FLATTEN/UPSCALE，还必须保证各确认互不借权。

### R3 / P1：合法双上传器 FIFO 会产生非法会话状态迁移

对应要求：D2、D6、C12、L07。

任务状态是逐任务的，但 `sessionMachine` 是单一全局标量。第一个任务进入 `SUCCESS` 后，队列直接启动第二个已完成预检的任务；控制器尝试执行 `SUCCESS → PROCESSING → INJECTING`，均不在状态表中。处理结果虽然可能成功，但诊断已经表明编排状态与实际执行脱节。

独立 Chromium 复现两个 uploader 同时选择明确不合规文件，使用延迟处理器验证 FIFO。两个任务最终均为 `SUCCESS`，但诊断包含：

```json
[
  { "code": "INVALID_STATE_TRANSITION", "from": "SUCCESS", "to": "PROCESSING" },
  { "code": "INVALID_STATE_TRANSITION", "from": "SUCCESS", "to": "INJECTING" }
]
```

现有 L07 只覆盖两个 `WAITING_REJECTION` 任务的 DOM 隔离；没有覆盖两个 uploader 同时进入处理队列后的会话状态和 FIFO 轨迹。

### R4 / P1：退出证据和关键回归覆盖不足

任务书要求交接提供测试页截图或录屏、事件计数、状态轨迹和诊断 JSON。当前 `docs/evidence/S3` 只有 README 与 JSON，没有 S3 测试页截图或录屏。现有 JSON 声明 C01～C12、L01～L12 全部通过，但缺少 R1～R3 所述关键分支的持久测试，因而结论过度。

返工后必须提供可审计的事件时间线，至少区分“页面业务监听器收到的事件”和“控制器内部状态变化”；多任务证据还要包含 FIFO 顺序、最大并发数及空诊断断言。

## 4. D1～D9 复核结果

| 交付项 | 结果 | 说明 |
|---|---|---|
| D1 Session | PARTIAL | 生命周期与清理主体存在；多任务聚合状态不正确 |
| D2 状态机 | FAIL | 合法双 uploader 流程产生非法迁移诊断 |
| D3 TaskController | PARTIAL | 唯一编排入口已建立，但同步拦截策略不完整 |
| D4 预检决策 | FAIL | 异步违规泄露；中置信接受分支不可执行 |
| D5 拒收观察 | PASS（本轮范围内） | 明确/模糊分类与 30 秒观察的既有用例通过 |
| D6 队列 | PARTIAL | 单处理任务约束存在；跨 uploader 会话轨迹错误 |
| D7 最终复检/注入 | PASS（既有覆盖） | 复检失败不注入，页面 realm File 校验存在 |
| D8 恢复/清理 | PASS（既有覆盖） | restore、detached、dispose 主路径通过 |
| D9 集成测试 | FAIL | 缺 R1～R3 回归，且无任务书要求的截图/录屏 |

## 5. 已确认保留的能力

- 生产产物仍为单个可粘贴加载的纯 JavaScript IIFE，体积合格。
- 多文件选择保持原集合，不创建任务。
- 同一 input 快速二选一会取消旧任务，旧结果不会回填。
- 输出不是当前页面 `File` 或最终复检失败时不会注入。
- 明确拒收最多重试一次，重试只分发 `input/change`，不点击业务按钮。
- detached、dispose、pagehide 和注入失败的现有安全用例通过。
- 日志与 snapshot 没有输出文件二进制、Base64、页面全文或用户文件名。

## 6. 验收决定

状态固定为 `REWORK_REQUIRED`。外部 Agent 应按 `S3-acceptance-rework-order.md` 施工；只有 R1～R4 全部关闭、Q-S3-001～Q-S3-008 全绿、证据刷新并提交本地 Git 留痕后，才能申请 S3 重新验收。
