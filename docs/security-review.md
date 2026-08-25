# UploadFit V2-S4 安全复核（Phase 1 + Phase 2A1）

## 当前施工状态

状态为 `CORE_FIX_PASS_OFFICIAL_REINSTALL_REQUIRED`。Phase 1 定向 runner `31/31`、最终全量 E2E `193/193`；Phase 2A1 的 Tabbit LR3 实测 UploadFit external requests=0、敏感 payload marker=0、business submit click=0、持久化前后无变化。2026-08-25 两项修复未增加网络 API：VocaText 只调整上传器分类，Zent 只让 multiple-capable input 的单文件进入既有 controller；实际多文件仍在 controller 前置停止。当前生产产物 bytes/SHA 为 421,333 / `98BD12C651C2801E2E2E8BC9C2A006057024AA26E2D916B33899487B9A0F1A68`。

新测试文件使用本地 `dist/uploadfit.test.js` debug harness 做确定性 API/Worker 断言，不能写成 Tabbit 或 production IIFE 实机证据；Tabbit 仅以 `phase2a1-lr1.json`/`phase2a1-lr3.json` 声明实测。实际 200MB 当前 handler/Worker 核心门禁已通过且临时音频已删除，但未冒充精确 Tabbit LR4。

## Phase 1 结论

当前本地静态/动态安全与格式对抗覆盖已通过；persistent 结论严格限定为 S01 的 local/session storage API scope，IndexedDB/cache、真实 Tabbit 网络和真实 LLMBridge 均为 `NOT_VERIFIED_PHASE_2`。S05 的 fake bridge 字段仅适用于 `NOT_APPLICABLE_FAKE_BRIDGE_HARNESS`，不代表真实 Tabbit 调用。Q-S4-P03/P05 的 A15/A17 现为真实 DOM observer 与真实 DataTransfer/injectFile controller 链。本页不把历史 S5 或旧 V1/S0/S2/S4 证据合并进 V2-S4。

## 历史 S5 安全复核（非 V2-S4 证据）

## 历史 S5 结论

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
