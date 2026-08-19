# S4 返工回报

- 日期：2026-08-19
- 返工基线：`2161939`
- 当前状态：`REWORK_INCOMPLETE`
- S5：未放行
- Git：仅本地留痕，未推送远程

## 返工结果

| 项目 | 结果 | 说明 |
|---|---|---|
| R1 | `PASS` | 最终 production bundle 在真实 CNIPA 页面等待 Vue 渲染后现场通过 ready/actionable、390×567、30KB—120KB 和无登录安全旗标；同时通过噪声 fixture |
| R2/A11 | `BLOCKED` | 当前 in-app Browser 无可用 Tabbit 实例；没有用 mock 或旧证据替代，见 `docs/evidence/S4/tabbit-ai-result.json` |
| R3 | `DEFERRED_BY_USER` | 用户要求暂跳过体积上限；production 为 169114 bytes，未视为通过 |
| R4 | `PASS` | AI 完整 token/单位 evidence、aspect ratio 来源、exact/range/ratio 一致性已补齐 |
| R5 | `PASS` | normalized crop 由 controller 权威校验并转换为 canonical pixels |
| R6 | `PASS` | snapshot 保留有界脱敏 evidence，UI 显示来源和原文且使用 textContent |
| R7 | `PASS` | 按钮语义、live/alert、crop Escape 作用域、discovery 边界和清理已闭合 |
| R8 | `PASS_LOCAL_VISUAL_EVIDENCE` | U09/U12、pointer drag 和本地合成视觉证据已补齐 |

## 回归结果

- `npm test -- --run`：18 个文件、145 个测试通过。
- `npm run test:e2e -- --reporter=line --workers=1`：89 个 Chromium 测试通过。
- `npm run build`：`dist/uploadfit.js` 169114 bytes；SHA-256 `CF39073EDD0F533003A12ABCF16C3A112BB1125EA87408CCDE6E9115B9F02EFE`。
- `npm run static-check`：仅因体积子门禁报错；按用户裁决记录为延后，源码禁止模式未报错。
- `git diff --check`：通过。

## 视觉与平台证据

本地 Playwright 使用无敏感合成 fixture 生成：

- `docs/evidence/S4/s4-rule-evidence.png`
- `docs/evidence/S4/s4-crop-before.png`
- `docs/evidence/S4/s4-crop-after.png`
- `docs/evidence/S4/s4-flatten-confirmation.png`
- `docs/evidence/S4/s4-upscale-warning.png`
- `docs/evidence/S4/s4-success-form.png`
- `docs/evidence/S4/s4-failure-alert.png`
- `docs/evidence/S4/s4-cnipa-fixture.png`（结构等价 fixture，不是真实 CNIPA 页面）
- `docs/evidence/S4/s4-cnipa-live.png`（最终 production bundle 的真实 CNIPA 页面现场截图）

真实 Tabbit 截图未生成，因为官方运行时不可用；不得把普通 Chromium mock 或 S0 历史证据写成 A11 通过。共享契约仍保持 150,000 bytes，ADR-003 已记录否决和本轮用户暂缓裁决。R2/A11、R3 及真实公开页现场复测闭合前，不申请 S4 通过，也不启动 S5。

结构化明细：`docs/evidence/S4/rework-result.json`。
