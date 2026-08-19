# S3 任务编排与上传闭环验收返工施工单

- 施工单日期：2026-08-19
- 工程目录：`C:\Users\蔡天乐\Desktop\黑客松\main`
- 对应任务书：`40-S3-任务编排与上传闭环.md`
- 共享契约：`01-共享契约与接口基线.md`
- 返工基线：`ce0cb3f`
- 当前状态：`BLOCKED_REWORK`
- 执行对象：外部开发 Agent
- 验收报告：`docs/handoffs/S3-acceptance-review.md`

## 1. 施工目标

关闭验收报告中的 R1～R4，使文件选择事件、规则确认、图像确认、FIFO 队列、会话状态和证据重新形成可审计闭环。

返工期间不得启动 S4，不得用删除规则、跳过 S2 权威计划校验、放宽最终复检、吞掉非法状态诊断或减少事件断言换取绿灯。每个问题先增加返工前可失败的正式回归测试，再修改生产代码。

## 2. 问题总表

| 编号 | 级别 | 问题 | 关闭条件 |
|---|---|---|---|
| R1 | P0 | 异步尺寸/比例/透明度违规在确认前泄露给页面 | 页面业务监听器在控制器决策前收到 0 次；最终只收到符合决策的 1 次事件 |
| R2 | P0 | `RULE_CONFIDENCE` 接受后与 S2 权威计划冲突 | 接受后合法直通或继续处理；拒绝停止；与各有损确认相互独立 |
| R3 | P1 | 双 uploader FIFO 产生非法 session 迁移 | 并发上限 1、FIFO 正确、诊断为空、session 轨迹全部合法 |
| R4 | P1 | 关键回归与截图/录屏缺失 | Q-S3-001～008 全绿，结构化证据与测试页视觉证据齐全 |

## 3. R1：修复原始 change 的异步决策泄露

### 当前根因

`src/core/task-controller.js` 的同步 `quickViolations()` 只检查 MIME、minBytes、maxBytes。对于 width、height、aspectRatio、background/alpha 等异步字段，`handleFileChange()` 在 `await inspectImage()` 前未停止原事件，页面监听器会立刻消费原文件。

### 必须修改

1. 在事件捕获阶段、任何 `await` 之前确定“是否需要异步决策”。只要高/中置信可执行规则包含无法从 `File.type/size` 同步判定的强约束，就先阻断原始事件。
2. 阻断必须发生在原事件对象上，调用 `stopImmediatePropagation()`；必要时同时 `preventDefault()`。不得等 metadata 返回后再调用。
3. 异步检查确认文件合规时，不编码、不替换 File；向页面释放原始 File，页面业务监听器最终只收到一次可消费的 `change`。释放事件必须使用一次性 guard，不能生成第二个 Task。
4. 异步检查确认存在安全自动修复时，只允许处理后文件进入页面；原始文件事件计数必须为 0，处理后页面事件计数为 1。
5. 需要 CROP/FLATTEN/UPSCALE 等确认时，在用户决定前页面业务监听器事件计数保持 0。用户拒绝后转 `STOPPED` 并保留原 File，不自动点击或提交。
6. 规则不足或置信度低于 0.75 时仍按任务书透传并进入 `WAITING_REJECTION`，不能把所有文件选择无条件吞掉。
7. `multiple && files.length > 1` 继续原样透传，不得因本修复创建任务或重放事件。
8. 把事件时间线作为结构化证据：原始捕获时间、页面业务监听时间、metadata 完成时间、确认时间、释放/注入时间、任务状态；不得记录文件名或二进制。

### 必补测试

- `Q-S3-001`：390×567 规则 + 1000×1000 JPEG；控制器最终进入 `NEEDS_CONFIRMATION/CROP`，确认前页面 change 次数为 0。
- `Q-S3-002`：同类异步尺寸规则 + 实际合规 JPEG；不调用 `processImage/injectFile`，页面最终只收到原 File 一次，控制器不递归创建任务。
- `Q-S3-003`：异步尺寸不合规但只需安全 RESIZE；页面从未收到原文件，只收到最终复检合格的处理文件一次。
- 保留 C01～C06、L01、L08、L09，并增加事件先后顺序断言。

## 4. R2：把规则置信确认与 S2 图像计划确认分层

### 当前根因

`addRuleConfidenceConfirmation()` 把控制器策略确认插入 `ProcessingPlan.confirmations`。S2 的 `processImage()` 会从 metadata + rules 重算权威计划；该计划不会生成 `RULE_CONFIDENCE`，所以确认集合长度/身份校验失败。

### 必须修改

1. `RULE_CONFIDENCE` 是 S3 对“是否采用本次规则”的策略确认，不是 S2 图像操作确认。将它保存为独立的 task/controller 字段，例如 `policyConfirmation`，不要伪装成 S2 canonical plan 项。
2. snapshot 可以展示该策略确认，但传给 `processImage()` 的 plan 必须保持 `createProcessingPlan(metadata, rules)` 的权威结构，只含 S2 认可的 CROP、FLATTEN_BACKGROUND、UPSCALE。
3. 用户拒绝 `RULE_CONFIDENCE`：不得进入 S2；若原事件已阻断，保留/恢复原 File，转 `STOPPED/USER_CANCELLED`，不自动提交。
4. 用户接受后重新根据已完成的 validation/权威 plan 路由：原文件合规则释放原 File 一次且不编码；只有安全修复则进入队列；仍有图像操作确认则逐项请求；unfixable/冲突/官方工具则安全停止。
5. 一个确认不能替另一个确认授权。接受 RULE_CONFIDENCE 后仍必须显式接受 CROP/FLATTEN/UPSCALE；接受 CROP 也不能反向视为规则已确认。
6. `confirmationResolver` 自动回调和外部 `confirmTask()` 手动调用都要覆盖；重复、错误 id/type、已解析确认必须稳定拒绝且不处理。

### 必补测试

- `Q-S3-004`：0.8 规则 + 需安全转换/缩放 PNG；接受 RULE_CONFIDENCE 后处理、复检、注入成功，不得以 `USER_CONFIRMATION_REQUIRED` 停止。
- `Q-S3-005`：0.8 规则 + 实际合规 JPEG；接受后原 File 直通一次，process/inject 均为 0；拒绝分支保持 `STOPPED/USER_CANCELLED`。
- `Q-S3-006`：同一任务同时需要 RULE_CONFIDENCE + CROP（另覆盖 FLATTEN/UPSCALE 中至少一个）；逐项确认，任一未接受时 process 调用为 0，全部接受后才执行。

## 5. R3：修复多任务聚合会话状态

### 当前根因

task machine 是每个 task 独立状态，但 session machine 是单一状态。第二个任务已在 FIFO 等待时，第一个任务把 session 留在 `SUCCESS`；队列随后直接请求 `PROCESSING/INJECTING`，产生合法工作流中的非法迁移诊断。

### 必须修改

1. 明确 session 状态代表“控制器聚合状态”，不要直接镜像任意 task 的每次变化。推荐从 `processingTask + queue + active tasks` 派生，或通过统一调度函数串行推进。
2. 当一个任务完成而队列仍非空时，进入下一个任务前走完整合法路径；不得用扩大状态表到任意状态互跳来掩盖问题。
3. 第一个任务处理期间，第二个 uploader 完成预检/入队不应强行把 session 从 PROCESSING 改回 INSPECTING，也不应记录诊断。
4. 任意时刻最多一个任务处于 PROCESSING 或 INJECTING；队列保持按进入顺序 FIFO。
5. 一个任务 STOPPED、取消、detached 或失败不能清空其他 uploader 的任务；处理器释放后必须继续 pump 下一项。
6. 合法并发场景 `getDiagnostics().diagnostics` 必须为空；真正非法的直接状态请求仍要被拒绝并保留 `INVALID_STATE_TRANSITION` 单测。

### 必补测试

- `Q-S3-007`：两个 uploader 同时进入可执行计划；延迟第一个 process，断言最大并发数为 1、开始/完成顺序为 A→B、两个任务结果正确、session 每条 history 都合法、diagnostics 为空。
- `Q-S3-008`：A 处理中取消/失败，B 已排队；A 不得注入，B 继续执行成功，且无非法迁移或 stale 回填。

## 6. R4：补齐测试与验收证据

1. Q-S3-001～008 必须进入 `tests/integration/**`，测试名保留编号，不能只写在 evidence 中。
2. 更新 `docs/evidence/S3/README.md` 和结构化 JSON，原 `PASS` 声明必须由新测试映射支持。
3. 结构化 evidence 至少包含 `eventTimelines`、`policyConfirmation`、`queue`、`artifact`、`cleanup`；多任务部分记录 FIFO、最大并发、task/session 轨迹和 diagnostics。
4. 增加至少一张 S3 测试页截图或一段录屏，清楚展示任务状态、确认前后和最终文件状态。只使用合成 fixture，不显示本地用户名、完整路径、真实网页数据或敏感内容。
5. 更新 `docs/handoffs/S3-handoff.md` 和 `docs/progress.md`。外部 Agent 只能标记 `READY_FOR_REACCEPTANCE`，不得自行写成用户已验收。

## 7. 允许修改范围

优先限定为：

- `src/core/task-controller.js`
- `src/core/state-machine.js`
- 与 session 聚合状态直接相关的最小 S3 文件
- `tests/integration/task-controller.test.js`
- `tests/integration/upload-loop.test.js`
- 必要的新 S3 integration test 文件
- `docs/evidence/S3/**`
- `docs/handoffs/S3-handoff.md`
- `docs/progress.md`
- `dist/uploadfit.js`（构建产物）

只有在证明 S2 公共契约本身缺失时才允许修改 `src/image/**`。优先在 S3 分离策略确认，禁止削弱 S2 canonical plan 防篡改校验。

禁止越界：不实现 S4 正式 UI、视觉裁剪器或 AI provider；不发网络请求、不读请求/响应、不点击业务按钮；不突破 closed Shadow DOM 或跨域 iframe；不增加运行时 CDN/WASM/第三方依赖；不改变最终单个纯 JS IIFE、可粘贴加载方向；不推送远程，除非用户另行授权。

## 8. 建议施工顺序

1. 在基线 `ce0cb3f` 上先固化 Q-S3-001、004、007，证明旧代码会失败。
2. 实现 R1 的同步拦截/异步释放策略，跑 C01～C06 与 Q-S3-001～003。
3. 分离 policy confirmation 和 S2 plan，跑 Q-S3-004～006 及全部 S2 防篡改回归。
4. 修复 session 聚合状态，跑 Q-S3-007～008、L07/L08 和状态机单测。
5. 执行全量门禁，生成截图或录屏及结构化证据，更新 handoff/progress。
6. 提交本地 Git 留痕，并按第 11 节模板回报。

## 9. 必跑命令

```powershell
npm ci
npm test -- --run
npm run build
npm run static-check
npm run test:e2e -- --reporter=line --workers=1
rg "Q-S3-00[1-8]" tests
Get-Item dist\uploadfit.js | Select-Object Length
Get-FileHash dist\uploadfit.js -Algorithm SHA256
git diff --check
git status --short
```

门禁要求：所有既有 S0～S3 测试和 Q-S3-001～008 全部通过；合法多任务流程 diagnostics 为空；bundle 小于 150000 bytes 且仍为单个纯 JavaScript IIFE；static-check 通过；E2E 后 8765 端口关闭；最终工作区只包含已说明的返工文件，并有本地提交。

## 10. 不接受的假修复

- 对所有 change 无条件放行或无条件阻断；
- 删除异步尺寸/比例/透明度检查；
- 把 `RULE_CONFIDENCE` 加进 S2 白名单但不做权威来源绑定；
- 删除/放宽 S2 `validateResolvedPlan()`；
- 把状态机改成任意状态互跳，或捕获后丢弃非法迁移诊断；
- 让双 uploader 测试串行选择以回避并发队列；
- 只更新 JSON/README 的 PASS 字样而不增加自动回归；
- 用 mock 跳过真实事件传播、页面 realm File 或真实 S2 入口。

## 11. 外部 Agent 返工回报模板

```md
# S3 返工回报

- 状态：READY_FOR_REACCEPTANCE / BLOCKED
- 返工基线：ce0cb3f
- 返工提交：
- 产物 bytes：
- SHA-256：

| 问题 | 修改摘要 | 代码位置 | 回归用例 | 结果 |
|---|---|---|---|---|
| R1 |  |  | Q-S3-001～003 | PASS/FAIL |
| R2 |  |  | Q-S3-004～006 | PASS/FAIL |
| R3 |  |  | Q-S3-007～008 | PASS/FAIL |
| R4 |  |  | evidence/截图或录屏 | PASS/FAIL |

## 事件闭环
- 合规异步规则：页面 change 次数/文件身份/process/inject 次数：
- 需确认：确认前页面 change 次数；接受/拒绝后的次数与状态：
- 安全自动修复：原文件事件次数/处理文件事件次数：

## 多任务队列
- FIFO 顺序：
- 最大 PROCESSING/INJECTING 并发数：
- session history：
- diagnostics：

## 全量门禁
| 命令 | 结果 | 测试数/关键输出 |
|---|---|---|

## 修改文件
- ...

## 已知限制或阻塞
- 无 / ...
```

## 12. 重新验收入口条件

只有以下条件全部满足，才可申请重新验收：R1～R4 均 `fixed + verified`；Q-S3-001～008 持久存在且通过；既有 103/49 基线无回归；S2 canonical plan 防篡改测试保持通过；合法双 uploader 流程无诊断；事件计数、状态轨迹、诊断 JSON、截图或录屏齐全；新产物满足 IIFE、体积与静态安全边界；handoff/progress/evidence 与 Git 提交一致。
