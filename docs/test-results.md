# UploadFit V2-S4 测试结果（Phase 1）

## 当前施工状态

本阶段状态为 `IN_PROGRESS`，不是 `READY_FOR_ACCEPTANCE` 或 `ACCEPTED`。Phase 1 定向音频/安全/快速性能 runner 通过 24/24；`npm run check` 通过 25 个 Vitest 文件、229/229，production `dist/uploadfit.js` 为 421,348 bytes，SHA-256 为 `ABFA41EBB606CA0E7ED84F8DEE2F17783CAF0BDFA11CE777FB1BAEFBD173D18A`。A01–A18、S01–S06、P01–P03 的精确映射和 debug/production 边界见 [`docs/evidence/V2-S4/README.md`](evidence/V2-S4/README.md)。

执行命令：

`node scripts/run-e2e.js tests/e2e/v2-audio-scenarios.spec.js tests/e2e/v2-audio-security.spec.js tests/e2e/v2-audio-performance.spec.js tests/integration/v2-media-regression.test.js --reporter=line --workers=1`

本阶段尚未执行实际 >200,000,000-byte 慢门禁，也尚未执行 Tabbit LR1–LR10；它们统一记录为 `NOT_RUN_PHASE_2`，不引用 S0/S2 历史结果，不以 Playwright/debug harness 冒充实机。

## 历史 S5 测试结果

## 结论

本地自动化结果为 `PASS`；用户授权切回 Tabbit remote CDP `9222` 后，轻量补验 LR1–LR5 均有当前 bundle 的 Tabbit 证据。S5 当前为 `READY_FOR_REACCEPTANCE`，等待独立验收方裁决，不在本文自行写成最终 `ACCEPTED`。

- S5 正式起始基线：`8d9d9ad`
- 工程：Windows，Node `v22.20.0`，npm `10.9.3`
- 浏览器自动化：Playwright Chromium `1.62.1`
- 测试服务：`http://127.0.0.1:8765`，测试结束由 runner 关闭
- 测试 fixture：`tests/fixtures/manifest.json`，确定性 canvas 生成，无用户文件、无网络

## 执行命令

| 命令 | 结果 |
|---|---|
| `npm ci` | PASS |
| `npm run check` | PASS：18 个 Vitest 文件、159 个测试；生产构建和静态检查通过 |
| `npm run test:e2e -- --reporter=line --workers=1` | PASS：116 个 Chromium 测试 |
| `git diff --check` | PASS（本轮代码与文档固化前后均检查） |

生产产物 `dist/uploadfit.js` 为单一 IIFE，最终本地构建为 175,868 bytes；bytes 仅留痕，不设固定体积门禁。SHA-256 见 [`s5-result.json`](evidence/S5/s5-result.json)。

## E01–E15 映射

| 编号 | 自动化覆盖 | 结果 |
|---|---|---|
| E01 | 稳定页 A：页面明确规则，页面显示规则和可观察状态 | PASS |
| E02 | 稳定页 A：合规输出/原流程继续语义，真实 input 事件可观察 | PASS |
| E03 | 稳定页 A：PNG 转真实 JPEG | PASS |
| E04 | 稳定页 A：输出低于安全上限 | PASS |
| E05 | 稳定页 A：输出精确 390×567 | PASS |
| E06 | 稳定页 C：真实文件选择后点击真实裁剪确认按钮，输出 390×520 | PASS |
| E07 | 稳定页 C：真实点击取消，原文件 MIME/字节不变 | PASS |
| E08 | 稳定页 B 与 [`upload-loop.test.js`](../tests/integration/upload-loop.test.js)：明确拒收后最多重试一次 | PASS |
| E09 | [`upload-loop.test.js`](../tests/integration/upload-loop.test.js)：第二次拒收后停止，不再重试 | PASS |
| E10 | 稳定页 D：模糊失败为 `PROCESSING_FAILED`，不处理、不重试 | PASS |
| E11 | 稳定页 E：处理后不自动点击业务提交按钮 | PASS |
| E12 | [`task-controller.test.js`](../tests/integration/task-controller.test.js) L10：DataTransfer 失败安全停止并给出 fallback | PASS |
| E13 | [`provider.test.js`](../tests/unit/provider.test.js)：AI timeout/error 回退本地明确规则 | PASS |
| E14 | [`ui-controller.test.js`](../tests/integration/ui-controller.test.js) U04：规则冲突不自动执行，展示冲突 | PASS |
| E15 | 稳定页 UI harness：真实点击“关闭 UploadFit”，移除 UI、监听和 controller 会话 | PASS |

此外，场景 F 独立验证 `OFFICIAL_TOOL_REQUIRED` 安全停止；它不是任务书 E15，避免编号混淆。E/X 的 PASS 均指 Chromium/自动化覆盖，不指当前 Tabbit 实机 PASS。

## X01–X12 映射

| 编号 | 覆盖位置 | 结果 |
|---|---|---|
| X01 | S5 稳定页动态新增 input | PASS |
| X02 | [`upload-loop.test.js`](../tests/integration/upload-loop.test.js) L07 两个上传器隔离 | PASS |
| X03/X04 | S5 稳定页 open/closed Shadow DOM | PASS：open 可发现，closed 诚实不支持且不崩溃 |
| X05/X06/X07 | [`input-discovery.test.js`](../tests/integration/input-discovery.test.js) 同源/跨域 iframe、SPA 替换 | PASS/按契约记录受保护边界 |
| X08 | S5 稳定页 multiple 两文件保持集合且不创建任务 | PASS |
| X09 | [`worker-fallback.test.js`](../tests/integration/worker-fallback.test.js) Worker/CSP 回退 | PASS |
| X10 | [`ui-controller.test.js`](../tests/integration/ui-controller.test.js) U01/U12 强 CSS、窄视口、200% 等效视口 | PASS |
| X11 | S5 稳定页快速连续选择 | PASS |
| X12 | S5 安全测试 dispose + 既有 pagehide/cleanup 测试 | PASS（Chromium）；Tabbit 实机待补 |

## 稳定测试页

人工或后续平台复验入口：

- `test-pages/index.html?scenario=A`
- `test-pages/index.html?scenario=B`
- `test-pages/index.html?scenario=C&variant=confirm`
- `test-pages/index.html?scenario=C&variant=cancel`
- `test-pages/index.html?scenario=D`
- `test-pages/index.html?scenario=E`
- `test-pages/index.html?scenario=F`

C 的确认/取消按钮自动化使用 [`ui-harness.html`](../test-pages/ui-harness.html)，该页仅为测试构建开放 Shadow DOM；不改变生产页的 closed Shadow DOM 形态。

## 未完成的真实平台项

本次轻量补验已在用户授权的 Tabbit remote CDP `9222` 中完成 LR1–LR5：当前 bundle 安装/刷新、场景 A、场景 B、真实 `LLMBridge.chat`、关闭和新 Tabbit 标签页重跑均有脱敏证据。场景 C/D/E/F 和 X01–X12 按批准范围不重复实机执行，统一记录为 `NOT_REPEATED_BY_APPROVED_LIGHTWEIGHT_SCOPE`。详见 [`S5-lightweight-reacceptance-report.md`](handoffs/S5-lightweight-reacceptance-report.md) 与 [`tabbit-matrix.json`](evidence/S5/tabbit-matrix.json)。
