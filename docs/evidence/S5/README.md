# S5 证据索引

状态：`BLOCKED_BY_ENVIRONMENT`（轻量补验）。

S5 正式起始基线为 `8d9d9ad`。本目录只保存本地自动化、静态安全、性能和平台阻塞记录；不保存图片 base64、用户文件或完整 AI 返回。

## 本地证据

- [`s5-result.json`](s5-result.json)：结构化结果、产物 SHA、测试数量、性能摘要和阻塞状态。
- [`tabbit-matrix.json`](tabbit-matrix.json)：轻量补验 LR1–LR6 矩阵；LR1–LR5 因环境阻塞，LR6 文档一致性通过。
- [`../../handoffs/S5-lightweight-reacceptance-report.md`](../../handoffs/S5-lightweight-reacceptance-report.md)：本次轻量补验报告。
- [`../../test-results.md`](../../test-results.md)：命令、E01–E15 和 X01–X12 映射。
- [`../../security-review.md`](../../security-review.md)：静态/动态安全复核。
- [`../../performance.md`](../../performance.md)：六个 Worker/main 性能样本。

## 重现命令

在工程根目录执行：

```text
npm ci
npm run check
npm run test:e2e -- --reporter=line --workers=1
```

本地稳定页：`test-pages/index.html`；C 的真实确认/取消和 E15 关闭按钮使用 `test-pages/ui-harness.html`，它只为自动化显式开放 Shadow DOM，生产入口仍加载 closed Shadow DOM。

轻量验收未重复项：场景 C/D/E/F 和 X01–X12 记录为 `NOT_REPEATED_BY_APPROVED_LIGHTWEIGHT_SCOPE`，证据是 S5 专属 Chromium 17/17，不等同于 Tabbit 实测 PASS。

## 平台边界

本会话尝试使用 in-app Browser 时返回 `Browser is not available: iab`，`agent.browsers.list()` 为空。没有用 mock、Playwright 或历史 S4 Tabbit 截图冒充当前 S5 实机矩阵。恢复实例后，应按 `tabbit-matrix.json` 补录 LR1–LR5，并由独立验收重新判定 S5。
