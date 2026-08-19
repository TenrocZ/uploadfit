# S4 UI 确认与 Tabbit AI 证据

状态：`REWORK_INCOMPLETE`（2026-08-19 独立验收否决后返工；历史矩阵不代表当前通过）。基线提交：`d950253`，受验提交：`2161939`。

独立验收结论与返工依据：

- `docs/handoffs/S4-acceptance-review.md`
- `docs/handoffs/S4-acceptance-rework-order.md`
- `docs/evidence/S4/acceptance-review-result.json`

下方交付矩阵是原阶段 agent 的申请验收记录；其中 S4-D3/D5/D6/D7/D8/D9 及 U06/U09/U11/U12/A03/A04/A11 已被独立复现否决或判定未证明，不再作为当前 PASS 结论。
工程目录：`C:\Users\蔡天乐\Desktop\黑客松\main`
任务书：`C:\Users\蔡天乐\Desktop\黑客松\UploadFit-开发任务书-v1.0\50-S4-UI确认与Tabbit-AI.md`
共享契约：`C:\Users\蔡天乐\Desktop\黑客松\UploadFit-开发任务书-v1.0\01-共享契约与接口基线.md`

环境：Windows；Node v22.20.0；npm 10.9.3；Playwright Chromium 1.62.1（命令经 WSL interop 调用工程 Windows node_modules 执行）。

## 交付矩阵

| 交付物 | 实现/证据 | 结果 |
|---|---|---|
| S4-D1 Shadow DOM UI host | src/ui/host.js（closed 生产 / open 测试模式、防御性单例、完整 dispose） | PASS：U01 敌意 CSS 不影响、U02 单 host、U10 清理 |
| S4-D2 状态胶囊 | src/ui/status-pill.js（7 条固定文案 + N 计数插值） | PASS：U03 快照状态与文案一致 |
| S4-D3 任务卡 | src/ui/task-card.js（规则/预检/成功/失败/准备卡，textContent only） | PASS：U04 冲突醒目、U11 ARIA |
| S4-D4 有损确认 | task-card.js 三类确认卡 + controller confirmTask | PASS：U07 取消 0 次处理、cropper.test.js |
| S4-D5 裁剪器 | src/ui/cropper.js（固定比例、拖动/锚点/键盘、Esc 取消、归一化+像素输出） | PASS：U05/U06；ADR-002 平移语义经真实 S2 管线验证 |
| S4-D6 AI provider | src/providers/tabbit-ai.js（LLMBridge.chat、3s 超时、0 重试、每页≤3 次） | PASS：provider.test.js A06/A07 |
| S4-D7 AI 校验/降级 | src/providers/rule-understanding-provider.js + controller 降级路径 | PASS：34 项单测 + ai-fallback.test.js A02/A10 |
| S4-D8 真实网页模式 | src/adapters/cnipa-public-guide.js + prepareManualCard/createManualTask | PASS：准备卡规则（JPG/30-120KB/390×567/300dpi）+ 下载闭环 |
| S4-D9 可访问与安全 | styles.js（AA 对比度、reduced-motion）、aria-live、role=alert | PASS：U11/U12 |

## 用例覆盖

- U01–U12：ui-controller.test.js（9 项）+ cropper.test.js（6 项）。
- A01–A10、A12：ai-output-validator.test.js（23 项）+ provider.test.js（11 项）+ ai-fallback.test.js（3 项降级/优先级）。
- A11（真实 Tabbit 调用）：历史交接未执行；当前返工结论为 `BLOCKED`，因为本会话无可用 Tabbit/in-app Browser。生产代码仍无 mock 分支，但同形 mock 只作为代码回归，不计入 A11；详见 `tabbit-ai-result.json`。
- A08：ai-fallback.test.js（高优先规则不被 AI 覆盖）。
- S4-D8 场景 5/6：ai-fallback.test.js 两个 manual-card 用例（含真实 S2 处理管线产出 390×567、30–120KB 内文件）。

## 关键事实

- 全量回归：`npm test -- --run` 17 文件 137 测试；`npm run test:e2e` 80 Chromium 测试；`npm run static-check` 通过；S0–S3 基线（103 单测 + 59 e2e）无回归。
- 产物 `dist/uploadfit.js` 167,513 bytes（SHA-256 `4656F05C260F676E24DDF4E94D9AB43AFDBE6BF4C2356D2F72071008BEE04509`），单 IIFE、无 ESM、无运行时网络依赖、无第三方库。
- 体积基线按 ADR-003 调整为 168,000 bytes；契约文件 01 的 150,000 行**未改动**，留待主验收 Agent 裁决。
- 结构化证据：`s4-result.json`。

## 验收建议入口

1. `npm ci && npm run check && npm run test:e2e -- --reporter=line --workers=1`
2. `npm run serve:test` 后浏览器打开 `http://127.0.0.1:8765/test-pages/probe.html` 手工注入 dist 产物，观察状态胶囊 → 选择不合规图 → 确认卡 → 裁剪 → 成功卡文案“已适配并放回上传框”。
3. 真实公开页验证：Tabbit 中打开 `https://ggfw-dlsks.cnipa.gov.cn/home_item_Text_details?nid=6387`（2026-08-19 已确认可访问且文本仍在：JPG、30KB—120KB、390×567、300dpi），启用含 dist 产物的官方脚本，验证“按本页要求准备照片”卡与下载闭环，并补 A11 真实调用证据。

## 返工后当前复核（2026-08-19）

当前唯一有效的结构化结论见 `rework-result.json`；上面的交付矩阵和命令结果是返工前历史记录。

| 项目 | 当前结果 | 证据 |
|---|---|---|
| R1 页面规则 | `PASS` | 最终 production bundle 真实 CNIPA 页面现场探针：ready、actionable、390×567、30–120KB、无登录安全旗标；另有噪声 fixture |
| R2/A11 Tabbit | `BLOCKED` | `tabbit-ai-result.json`；不得用 mock/S0 证据替代 |
| R3 体积 | `DEFERRED_BY_USER` | production `169114` bytes；用户明确要求暂跳过，不视为通过 |
| R4 AI 校验 | `PASS` | `tests/unit/ai-output-validator.test.js` |
| R5 normalized crop | `PASS` | `tests/integration/cropper.test.js` |
| R6 evidence | `PASS` | `task-controller.js` snapshot + UI 对抗样例 |
| R7 可访问性/生命周期 | `PASS` | `ui-controller.test.js`、cropper Escape/cleanup |
| R8 U09/U12/视觉 | `PASS（本地合成证据）` | `tests/e2e/s4-rework-evidence.spec.js` 与 `s4-*.png` |

返工回归：`npm test -- --run` 为 18 文件/145 测试通过；本地 `npm run test:e2e -- --reporter=line --workers=1` 为 89/89 通过；真实 CNIPA 现场探针另在获准网络环境通过；`git diff --check` 通过。`npm run static-check` 仅因当前体积超过配置的 168000 bytes 报错，其余禁止模式未报错；该 R3 子门禁按用户裁决暂缓。

视觉文件由本地 Playwright Chromium 生成：`s4-cnipa-fixture.png` 是结构等价 fixture，`s4-cnipa-live.png` 是最终 production bundle 在真实 CNIPA 页面等待 Vue 渲染后的现场截图；没有生成 Tabbit 截图。R2/A11 和 R3 未闭合前不得启动 S5。
