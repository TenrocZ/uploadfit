# S5 证据索引

状态：`READY_FOR_REACCEPTANCE`（LR1–LR6 已完成，等待独立验收）。

S5 正式起始基线为 `8d9d9ad`。本目录只保存本地自动化、静态安全、性能和平台阻塞记录；不保存图片 base64、用户文件或完整 AI 返回。

## 本地证据

- [`s5-result.json`](s5-result.json)：结构化结果、产物 SHA、测试数量、性能摘要和轻量补验状态。
- [`tabbit-matrix.json`](tabbit-matrix.json)：轻量补验 LR1–LR6 矩阵；LR1–LR6 全部通过，未重复项仍按批准范围记录。
- [`s5-tabbit-install-refresh.json`](s5-tabbit-install-refresh.json)：当前 bundle 官方脚本保存、匹配页首次运行与刷新单实例证据。
- [`s5-tabbit-scenario-a.json`](s5-tabbit-scenario-a.json)：场景 A 脱敏结果和请求边界。
- [`s5-tabbit-scenario-b.json`](s5-tabbit-scenario-b.json)：场景 B 脱敏结果和一次重试计数。
- [`s5-tabbit-ai-redacted.json`](s5-tabbit-ai-redacted.json)：真实 `LLMBridge.chat` 调用的脱敏摘要；另记录一次超时降级观察。
- [`s5-tabbit-close-rerun.json`](s5-tabbit-close-rerun.json)：关闭、同页停止和新 Tabbit 标签页重跑证据。
- 截图：`s5-tabbit-install-refresh.png`、`s5-tabbit-scenario-a.png`、`s5-tabbit-scenario-b.png`、`s5-tabbit-ai-redacted.png`、`s5-tabbit-close-rerun.png`、`s5-tabbit-rerun.png`。
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

轻量验收未重复项：场景 C/D/E/F 和 X01–X12 记录为 `NOT_REPEATED_BY_APPROVED_LIGHTWEIGHT_SCOPE`，证据是 S5 专属 Chromium 17/17，不等同于 Tabbit 实测 PASS；LR1–LR5 已另有当前 bundle 的 Tabbit 远程端口证据。

## 平台边界

in-app Browser 别名仍返回 `Browser is not available: iab`，`agent.browsers.list()` 为空；本次在用户授权下切回 Tabbit 远程 CDP `9222`，连接到 Tabbit Browser 1.10.16.0，使用当前 `dist/uploadfit.js` 的官方私有脚本完成 LR1–LR5。没有用 mock、Playwright 或历史 S4 产物替代当前证据。临时脚本最终关闭自动运行并保存为 false，临时匹配页签已关闭。

LR1–LR5 结论为 `PASS`，但本文件不替代独立验收裁决；S5 当前只申请 `READY_FOR_REACCEPTANCE`，不得在独立验收前写成 `ACCEPTED`。
