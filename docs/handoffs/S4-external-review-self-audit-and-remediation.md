# S4 外部代码评审自检与修复留痕

日期：2026-08-20
评审输入：`修复建议.md`
结论：`VALID_FINDINGS_FIXED / DISPUTED_ITEMS_RETAINED / REFACTOR_ITEMS_DEFERRED`

## 总结

外部评审提出的 P0/P1 共 12 项中，9 项成立并已修复，2 项部分成立并按实际语义修复，1 项属于保守安全策略而非缺陷；worker/main 双实现属于后续重构债务，不是当前功能不通过项。P2 中完成了 safety 单一事实来源、根 README、个人学习目录策略和静态外泄通道门禁，其余大规模重构不在本轮冒险实施。

## 逐项自检结论

| 项 | 判定 | 处理 |
| --- | --- | --- |
| P0-1 tasks/uploaders 无界增长 | 成立 | 同一上传器保留最近 2 项有界历史；更早任务释放 File/Blob、context、结果和 object URL；DOM 移除 input 后 discovery 回调 controller 反注册并移除监听。 |
| P0-2 物理尺寸当像素 | 成立 | 拒绝厘米/毫米/英寸等物理单位；无像素单位的配对必须具有明确尺寸/上下限上下文；显示最佳语义不再执行。 |
| P0-3 AI 数字不验角色 | 成立 | width/height 分别要求宽/高轴证据，或使用尺寸对中的第一/第二位置；KB 数字不能再给宽高借值。 |
| P0-4 注入失败不可靠回滚 | 部分成立 | `injectFile` 已改为事务式赋值，事件阶段失败会恢复之前完整 FileList；controller 检查二次恢复结果，真实丢失时使用稳定码 `RESTORE_FAILED`。`restoreTask()` 原本已检查结果，评审对此处的表述不准确。 |
| P1-5 WAITING_REJECTION 永久等待 | 成立，但建议终态不正确 | 超时表示 30 秒内未观察到拒收；原事件已放行时应落为 `PASSTHROUGH`，不能标成失败的 `STOPPED/REJECTION_TIMEOUT`。状态机已增加合法迁移并停止 observer。 |
| P1-6 KB 进制不对称 | 不接受为 bug | 这是未知网站采用 1000 还是 1024 时的安全交集：minimum 取较严格的 1024，maximum 取较严格的 1000。`95KB–96KB` 的安全交集为空，停止比猜一种进制并可能越界更符合产品安全边界。保留现状。 |
| P1-7 “等格式不支持”漏判 | 成立 | 增加“等/格式/否定”尾缀识别；示例只保留明确允许的 JPG。 |
| P1-8 STOP 等价类遗漏 | 部分成立 | parser 的确漏判，classifier 原本已将相关文本视为 ambiguous，评审称两者都漏判不准确。现已抽出统一 safety 模块并补齐审核未通过、图片模糊、网络连接失败等；“网络图片”仍是反例。 |
| P1-9 蓝底未接管线 | 成立 | metadata、planner、确认 UI 和实际 canvas 统一采用规则底色；透明 PNG → JPEG 的蓝底像素已用浏览器采样验证。 |
| P1-10 worker/main 双实现 | 架构债务，延期 | 当前契约是语义等价、同一约束区间和最终复检通过，不承诺压缩产物逐字节一致。强行重写 worker 会扩大已验收图像管线风险，留待独立重构。 |
| P1-11 observer 去重键失效 | 成立 | 改为 `WeakMap<Node, Set<text>>`，不同 DOM 节点的相同文本不再互相吞掉。 |
| P1-12 目标体积窗口坍缩 | 成立 | minimum 超过 90% 安全余量时，targetMax 放宽到网站 hard max，保留 `[min,max]` 可行区间与警告。 |
| P2-13 TaskController 瘦身 | 延期 | 本轮只做生命周期边界，不在缺陷修复中混入 1700 行编排器拆分。两条 passthrough 路径处于不同上下文，不直接合并。 |
| P2-14 单一事实来源 | 部分完成 | safety flag、匹配模式与错误优先级已集中到 `src/rules/safety-semantics.js`；其余低风险重复项留待重构。 |
| P2-15 死代码 | 延期/部分反驳 | `createSession` 仍由公共 barrel 导出，直接删除会改变 API；其余机械清理不影响本轮正确性。 |
| P2-16 图片管线宽度 | 延期 | 属于性能/兼容性专项，需单独基准和多浏览器证据；现有 50MB/80MP 边界仍有效。 |
| P2-17 缺专测 | 部分反驳并补强 | `rejection-classifier` 原本已有专测，并非无覆盖；本轮新增规则、AI、planner、状态机及浏览器集成回归。 |
| P2-18 工程流程 | 部分完成 | 增加根 README；`.learnings/` 明确加入 `.gitignore`；static-check 增加 WebSocket/EventSource/sendBeacon；生产 dist 继续作为可粘贴发布物。未擅自创建 Git commit，也未在修 bug 时引入 ESLint 新依赖。 |

## 关键行为变化

- Zent v7 原网址已进入自动化用例名称、最小 DOM 夹具和公开站点手测清单。
- “网络图片”不会再触发网络故障；“网络连接失败”仍会安全停机。
- “证件照尺寸 3.5×4.9 厘米”和“1920×1080 下显示最佳”不会生成像素 exact 规则。
- 规则要求蓝底时，确认文案、预览色和最终 JPEG 背景一致。
- 页面没有在拒收窗口内反馈时，任务从 `WAITING_REJECTION` 正常收口为 `PASSTHROUGH`。
- 页面移除上传框后，discovery 与 controller 的 uploader 数量都会收缩；连续选择只保留最近 2 个任务。
- processed File 写入后若事件分发失败，原 File 会在返回失败前恢复。

## 新增或扩展的回归入口

- `tests/e2e/zent-v7-upload.spec.js`
- `test-pages/zent-v7-upload-fixture.html`
- `tests/unit/rule-parser.test.js`
- `tests/unit/ai-output-validator.test.js`
- `tests/unit/planner.test.js`
- `tests/integration/file-injector.test.js`
- `tests/integration/image-pipeline.test.js`
- `tests/integration/input-discovery.test.js`
- `tests/integration/rejection-observer.test.js`
- `tests/integration/task-controller.test.js`

## 最终验证

| 命令 | 结果 |
| --- | --- |
| `npm run check` | PASS：18 个 Vitest 文件 / 157 项；生产构建和 static-check 通过 |
| `npm run test:e2e` | PASS：99/99 Chromium |
| `git diff --check` | PASS |
| `dist/uploadfit.js` | 175,631 bytes；SHA-256 `AA7584629AA4A596AC829A5986CFDB6D3E04581A88EB68268DEF90065700FE3E`（`check` 与 E2E 前置构建一致） |

结构化证据：`docs/evidence/S4/external-review-remediation-result.json`。本轮没有创建提交或推送远程；工作区 diff 保持可审查状态。
