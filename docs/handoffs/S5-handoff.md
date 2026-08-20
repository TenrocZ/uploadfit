# S5 Handoff：全量测试、安全与兼容性

## 状态

- Status: `READY_FOR_REACCEPTANCE`
- Start commit: `8d9d9ad`（用户指定的 S5 正式起始基线）
- End commit: `dcd5c1a`（S5 实现提交）；本次 reacceptance 证据和文档另有后续本地提交，未推送远程
- Lightweight reacceptance baseline: `9ed5839`（返工单验收基线）
- Agent: Codex
- Environment: Windows；Node `v22.20.0`；npm `10.9.3`；Playwright Chromium `1.62.1`
- Task book: `docs/archive/v1/work-orders/60-S5-全量测试安全与兼容.md`
- Artifact: `dist/uploadfit.js`，175,868 bytes；SHA-256 `29C5613CD5F9C71EBBD9E88754097B18435A4FA8508D0E2612D160233D79FD8F`

此前的 `BLOCKED_BY_ENVIRONMENT` 只表示真实 Tabbit 矩阵尚未具备执行条件；本轮已通过远程 CDP 补齐 LR1–LR5。当前 handoff 申请 `READY_FOR_REACCEPTANCE`，仍不得在独立验收前把 S5 写成 `ACCEPTED`。

## 基线和范围

本阶段从 `8d9d9ad` 开始。交付范围严格限于：

- `test-pages/*` 稳定本地测试页和自动化 UI harness；
- `tests/e2e/s5-*.spec.js` 全量场景、安全、性能和兼容用例；
- S5 要求暴露出的规则解析回归（`不能超过`、`30–120KB`）及其单测；
- `scripts/static-check.js` 的 S5 静态安全扫描；
- `docs/test-results.md`、`docs/security-review.md`、`docs/performance.md`、`docs/evidence/S5/*`。

规则解析修正属于跨阶段公共缺口：任务书稳定场景使用了这两种自然语言，缺失会直接导致 S5 A/B 无法按契约执行；除该最小修正外没有扩展其他产品板块。

## 交付和本地验证

| S5 项 | 结果 | 证据 |
|---|---|---|
| D1 稳定测试页 A–F | PASS | [`test-results.md`](../test-results.md)、[`s5-stable-scenarios.spec.js`](../../tests/e2e/s5-stable-scenarios.spec.js) |
| D2 全量自动化 | PASS：18 个 Vitest 文件/159 测试；116 个 Chromium E2E | [`s5-result.json`](../evidence/S5/s5-result.json) |
| D3 Tabbit 轻量补验 | PASS：LR1–LR5 均有当前 bundle 的 Tabbit 远程端口证据 | [`tabbit-matrix.json`](../evidence/S5/tabbit-matrix.json) |
| D4 静态/动态安全 | PASS（Chromium/源码静态 + LR2/LR4 Tabbit 边界）；未重复项按轻量范围记录 | [`security-review.md`](../security-review.md) |
| D5 性能 | PASS：6 样本均 ≤5s，最大 heartbeat 间隔 353.1ms | [`performance.md`](../performance.md) |
| D6 报告和证据 | PASS | [`docs/evidence/S5/README.md`](../evidence/S5/README.md) |
| D7 P0/P1/P2 | 本地未决缺陷 0/0/0；平台项未测不计为缺陷通过 | [`s5-result.json`](../evidence/S5/s5-result.json) |

完整重现顺序：

```text
npm ci
npm run check
npm run test:e2e -- --reporter=line --workers=1
```

`npm run static-check` 保留 artifact bytes/SHA 信息输出，固定体积不作为门禁，符合用户在 S4 后的裁决及共享契约当前约定。

## E/X 覆盖

E01–E15 和 X01–X12 的映射、既有阶段回归引用、稳定页入口见 [`docs/test-results.md`](../test-results.md)。本轮自检修正了一个编号错误：场景 F 的官方工具安全停止是独立场景；E15 已由真实关闭按钮用例覆盖。C/D/E/F 和 X01–X12 按轻量范围记为 `NOT_REPEATED_BY_APPROVED_LIGHTWEIGHT_SCOPE`，证据仍为 S5 专属 Chromium 17/17，不写成 Tabbit 实测 PASS。

## Tabbit 轻量补验

in-app Browser 别名仍返回 `Browser is not available: iab`，`agent.browsers.list()` 为空；用户随后授权切回 Tabbit 远程 CDP `9222`，已连接 Tabbit Browser 1.10.16.0。当前 `dist/uploadfit.js` 通过官方私有脚本完成：

- LR1：脚本保存、部分网址匹配、probe 页首次运行与刷新均为一个 host/active session；
- LR2：场景 A 输出 JPEG 390×567、106,855 bytes，外部请求 0；
- LR3：场景 B 明确拒收后 `retryCount=1`，最终页面接受；
- LR4：当前 bundle 真实调用 `LLMBridge.chat` 一次并通过本地 validator；另有一次真实 `AI_TIMEOUT` 降级观察，未被隐藏；
- LR5：关闭后 host/session 消失，同页保持停止，新 Tabbit 标签页重新运行得到一个全新 session。

没有使用 mock、Playwright Chromium 或历史 S4 产物冒充当前 S5 实机结果。临时脚本最终关闭自动运行并保存为 false，临时页签关闭。LR1–LR6 现均为 PASS，但本 handoff 仅申请 `READY_FOR_REACCEPTANCE`，仍等待独立验收方裁决；S6 尚未启动。

## 下一步

1. 复核当前 Tabbit 轻量补验结果和 `NOT_REPEATED_BY_APPROVED_LIGHTWEIGHT_SCOPE` 范围。
2. 由独立验收方决定 S5 `ACCEPTED` 或继续返工。
3. 未经该复核不启动 S6。
