# UploadFit V2-S4 安全复核（Phase 1）

## 当前施工状态

状态为 `IN_PROGRESS`。`npm run static-check` PASS；Phase 1 安全 runner `v2-audio-security.spec.js` S01–S06 与格式/registry 对抗共计在定向 24/24 中通过。浏览器拦截计数覆盖 fetch/XHR/WebSocket/EventSource/sendBeacon/storage，核心音频路径 external requests=0、persistent audio=0；AI 敏感模式在 bridge 前返回 `AI_SENSITIVE_INPUT`；伪 Worker taskId、异常长度/格式、CSP/Worker 不可用均稳定停止。生产产物 bytes/SHA 为 421,348 / `ABFA41EBB606CA0E7ED84F8DEE2F17783CAF0BDFA11CE777FB1BAEFBD173D18A`。

新测试文件使用本地 `dist/uploadfit.test.js` debug harness 做确定性 API/Worker 断言，不能写成 Tabbit 或 production IIFE 实机证据；既有生产页 E2E 和最终全量 E2E 负责 production controller/UI 回归。实际 200MB 与 Tabbit LR1–LR10 是 Phase 2，当前未运行。

## 历史 S5 安全复核

## 结论

本地静态和动态安全检查通过；S5 LR2/LR4 的真实 Tabbit 边界也已完成，未发现 P0/P1/P2 未决缺陷。C/D/E/F 和 X01–X12 按批准轻量范围不重复 Tabbit 实机，保留 `NOT_REPEATED_BY_APPROVED_LIGHTWEIGHT_SCOPE`，不以 Chromium 结果替代这些未重复项。

## 静态检查

`npm run static-check` 扫描 `src/**/*.js` 和生产 `dist/uploadfit.js`，本轮未报告违规。检查范围包括：

- `eval`、`new Function`、动态 HTML 注入（`innerHTML`、`outerHTML`、`insertAdjacentHTML`）；
- `fetch`、XHR、WebSocket、EventSource、`sendBeacon` 和远程脚本/资源 URL；
- cookie、storage、IndexedDB 以及凭据/secret 字面量；
- 业务代码对网页 `.click()` 的误用。

审查结果中的两个 `.click()` 均位于 UploadFit 自有 UI：`src/ui/host.js` 的下载锚点和 `src/ui/task-card.js` 的自有控件，不是业务提交按钮。S5 页面本身只使用本地相对资源和本地测试服务。

## 动态安全用例

| 用例 | 验证 | 结果 |
|---|---|---|
| 恶意 rule evidence | `<img onerror>` 和 `script` 字符串以文本显示；Shadow 内无可执行节点 | PASS |
| 普通本地处理 | 监控页面请求；仅允许本地页面和本地 blob URL，未发现外部请求 | PASS |
| 敏感 AI 输入 | 凭据/验证码文本在 bridge 调用前被阻断，bridge 调用次数为 0，返回 `AI_SENSITIVE_INPUT` | PASS |
| dispose/DOM 变更 | cleanup 后 host/session 移除，后续新增 input 不再注册 | PASS |

对应自动化文件：[`s5-security.spec.js`](../tests/e2e/s5-security.spec.js)。既有 S0–S4 安全回归也包含在最终 116 个 E2E 中，包括事件不可信降级、File 注入回滚、对象 URL/Worker 清理、跨域 iframe 边界、UI 文本注入和业务提交不代点。

## 数据边界

- fixture 是确定性 canvas 生成的非敏感文件；测试页面只记录 MIME、字节、尺寸、事件顺序、`isTrusted` 和计数，不上传图片内容。
- AI provider 只接收规则文本；敏感模式命中时不进入 bridge。
- 生产 bundle 不包含运行时网络通道；本地测试服务仅用于页面和 fixture 读取。
- 生产 UI 使用 closed Shadow DOM；S5 UI harness 显式 open 仅用于 Chromium 断言，且在文档中标明，不视为生产配置。

## 平台实机限制

当前 in-app Browser 别名仍不可用：调用返回 `Browser is not available: iab`，浏览器实例列表为空；用户授权后已使用 Tabbit remote CDP `9222` 完成 LR1–LR5。当前 Tabbit 证据覆盖安装/刷新、A/B 真实页面事件、一次真实 AI provider 调用、超时降级观察、关闭和新页面重跑；没有使用 mock、Playwright 或旧 S4 产物替代。轻量范围未重复的 C/D/E/F 与 X01–X12 记录为 `NOT_REPEATED_BY_APPROVED_LIGHTWEIGHT_SCOPE`，不写成 Tabbit 实测 PASS。证据见 [`tabbit-matrix.json`](evidence/S5/tabbit-matrix.json) 和 [`S5-lightweight-reacceptance-report.md`](handoffs/S5-lightweight-reacceptance-report.md)。
