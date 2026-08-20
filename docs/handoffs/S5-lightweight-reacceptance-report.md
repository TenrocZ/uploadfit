# S5 轻量验收补验报告

- 日期：2026-08-20
- 轻量验收基线：`9ed5839`
- S5 实现提交：`dcd5c1a`
- 当前状态：`READY_FOR_REACCEPTANCE`
- S6 状态：`HOLD`
- 当前生产包：`dist/uploadfit.js`，175,868 bytes
- 当前 SHA-256：`29C5613CD5F9C71EBBD9E88754097B18435A4FA8508D0E2612D160233D79FD8F`

## 结论

用户授权后已切回 Tabbit 远程端口调试。当前 bundle 在 Tabbit Browser 1.10.16.0 的官方私有脚本运行环境中完成 LR1–LR5；LR6 文档一致性也已完成。所有证据均为脱敏摘要，不保存完整 prompt、完整模型响应、图片内容、文件名、账号或脚本 ID。

| 返工项 | 结果 | 关键观察 | 证据 |
|---|---|---|---|
| LR1 当前 bundle 安装/保存/指定网址/刷新 | `PASS` | 官方脚本保存；匹配 `127.0.0.1:8765/test-pages/*`；不带产品 bundle 的 probe 页首次与刷新均为 1 host、session active | [`s5-tabbit-install-refresh.json`](../evidence/S5/s5-tabbit-install-refresh.json)、截图 |
| LR2 场景 A 预检适配/真实回填 | `PASS` | 输出 `image/jpeg`、106,855 bytes、390×567；页面业务 change=1、提交 click=0；外部请求=0，仅观察到本地 blob worker | [`s5-tabbit-scenario-a.json`](../evidence/S5/s5-tabbit-scenario-a.json)、截图 |
| LR3 场景 B 明确拒收/只重试一次 | `PASS` | `source=rejection`、`retryCount=1`、最终 JPEG 89,412 bytes；页面拒收=1、业务 change=3、提交 click=0 | [`s5-tabbit-scenario-b.json`](../evidence/S5/s5-tabbit-scenario-b.json)、截图 |
| LR4 真实 AI Bridge/敏感边界 | `PASS` | 当前生产 provider 真实调用 `LLMBridge.chat` 一次；`callCount 0→1`、诊断 `ok=true`、本地 validator=PASS；未发送 File/文件名/Base64/表单值 | [`s5-tabbit-ai-redacted.json`](../evidence/S5/s5-tabbit-ai-redacted.json)、截图 |
| LR5 关闭/刷新/再次运行清理 | `PASS` | 关闭后 host=0、session=false；同页刷新保持停止；新 Tabbit 标签页重新运行得到 1 host、全新 active session | [`s5-tabbit-close-rerun.json`](../evidence/S5/s5-tabbit-close-rerun.json)、关闭/重跑截图 |
| LR6 文档一致性 | `PASS` | handoff/performance/result 的 heartbeat、bytes、SHA、测试数量一致 | [`S5-handoff.md`](S5-handoff.md)、[`performance.md`](../performance.md)、[`s5-result.json`](../evidence/S5/s5-result.json) |

因此本报告申请 `READY_FOR_REACCEPTANCE`，不自行把 S5 改成 `ACCEPTED`；独立验收方仍需结合轻量范围裁决，S6 在此前继续 HOLD。

## Tabbit 运行与安装留痕

- 连接：Tabbit remote CDP `9222`；in-app Browser 别名仍为 `Browser is not available: iab`，但不再作为本轮阻塞，因为用户已明确授权远程端口调试。
- 运行版本：Tabbit Browser 1.10.16.0。
- 官方妙招：使用当前 `dist/uploadfit.js`，私有、部分网址匹配、仅覆盖本地测试页；保存时自动运行打开，证据完成后关闭自动运行并保存为 `false`。
- 当前 bundle SHA/bytes 与 `s5-result.json`、handoff、静态检查一致；没有沿用 S4 旧产物。
- 安装/刷新证据使用 `test-pages/probe.html`：该页自身没有产品 bundle script，首次和刷新均观察到一个 host 与 active session，排除了页面自带 script 对 LR1 的掩盖。
- 未公开分享临时妙招；验收匹配页签和临时编辑页签已关闭。

## LR2/LR3 页面边界

- 只使用仓库内生成的非敏感 PNG fixture；结构化摘要仅留 MIME、字节、尺寸、事件计数、`isTrusted` 分类和业务 click 计数。
- LR2 的网页最终只收到处理后的 JPEG；没有代点网页提交按钮。
- LR3 首次页面明确拒收后只触发一次自动重试，第二次页面接受；没有出现循环重试。
- 普通图片流程请求记录没有外部网络请求；本地 blob worker 不属于外部数据外发。

## LR4 AI 脱敏摘要

- 触发文本是固定、非敏感的照片规则短句，仅用于让本地规则保持不完整并触发 provider；没有发送图片或表单字段。
- 真实成功记录：`callCount=1`、`providerDiagnosis.ok=true`、candidate `sourceType=ai`、confidence `0.95`，字段名和 evidence 数量见脱敏 JSON；完整 prompt/response 未保留。
- 另一次独立新页面观察到 `AI_TIMEOUT`，说明产品的 3 秒超时和本地降级路径确实生效；该失败没有被改写为成功，也不覆盖上面的成功调用证据。
- 生产 provider 只在 `src/providers/tabbit-ai.js` 接触 `LLMBridge.chat`；本轮没有加入 mock、没有修改源码绕过超时。

## LR5 清理边界

- Tabbit 自有关闭按钮点击后，页面 host 和 session 均消失，提交 click 仍为 0。
- 同一页面刷新后不复活已关闭会话；新建 Tabbit 页面上下文后，官方脚本再次得到一个 host 和一个新 active session。
- object URL、Worker、observer、listener 的内部数量不由生产页面暴露；本报告只记录可观察结果，内部不变量引用既有 S5 Chromium 自动化，不冒充 Tabbit 可见计数。
- 临时脚本最终自动运行关闭并保存，临时匹配页签关闭。

## 轻量范围未重复项

场景 C/D/E/F 和 X01–X12 按用户批准的轻量范围不再逐项在 Tabbit 执行，统一记录为：

```text
NOT_REPEATED_BY_APPROVED_LIGHTWEIGHT_SCOPE
证据：S5 专属 Chromium 17/17 + 对应自动化用例
边界：未宣称本项在当前 Tabbit 版本逐项人工执行
```

这不影响 LR1–LR5 的当前 bundle Tabbit 证据，也不意味着 S5 已完成独立验收。

## LR6 一致性核对

- `docs/handoffs/S5-handoff.md` 最大 heartbeat 间隔：353.1ms
- `docs/performance.md` 最大 heartbeat 间隔：353.1ms
- `docs/evidence/S5/s5-result.json` 最大 heartbeat 间隔：353.1ms
- 生产 bytes：175,868
- 生产 SHA-256：`29C5613CD5F9C71EBBD9E88754097B18435A4FA8508D0E2612D160233D79FD8F`
- Vitest：18 个文件 / 159 个测试
- 全量 Chromium E2E：116 个；S5 专属：17 个
- P0/P1/P2 未决：0/0/0

## 已执行的本地回归

本轮未修改 `src/`、构建脚本或测试逻辑；仅新增脱敏证据并更新文档。按返工单执行：

```text
npm run check
npm run test:e2e -- tests/e2e/s5-stable-scenarios.spec.js tests/e2e/s5-security.spec.js tests/e2e/s5-performance.spec.js --reporter=line --workers=1
git diff --check
```

预期/既有实测均为 159/159 Vitest、17/17 S5 专属 Chromium、构建/static-check 和 diff check 通过；本轮未改变生产 SHA。

## 重新申请验收条件

LR1–LR6 已完成，未重复项已按批准范围如实记录；请独立验收方裁决 S5 是否 `ACCEPTED`。在该裁决前不启动 S6、不推送远程。
