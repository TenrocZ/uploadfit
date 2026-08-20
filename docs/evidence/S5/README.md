# S5 证据索引

状态：`BLOCKED_BY_ENVIRONMENT`。

S5 正式起始基线为 `8d9d9ad`。本目录只保存本地自动化、静态安全、性能和平台阻塞记录；不保存图片 base64、用户文件或完整 AI 返回。

## 本地证据

- [`s5-result.json`](s5-result.json)：结构化结果、产物 SHA、测试数量、性能摘要和阻塞状态。
- [`tabbit-matrix.json`](tabbit-matrix.json)：Tabbit 安装、A–F、AI、关闭、DataTransfer 的人工矩阵；当前均为 `MANUAL_REQUIRED`。
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

## 平台边界

本会话尝试使用 in-app Browser 时返回 `Browser is not available: iab`，`agent.browsers.list()` 为空。没有用 mock、Playwright 或历史 S4 Tabbit 截图冒充当前 S5 实机矩阵。恢复实例后，应按 `tabbit-matrix.json` 逐项补录并由独立验收重新判定 S5。
