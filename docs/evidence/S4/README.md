# S4 最终验收证据

状态：`ACCEPTED`（2026-08-19）。S5 已放行。历史否决与施工要求保留在 `S4-acceptance-review.md` 和 `S4-acceptance-rework-order.md`，最终结论以 `rework-result.json` 与 `S4-final-acceptance.md` 为准。

## 最终交付

| 项目 | 结果 | 证据 |
|---|---|---|
| R1 真实公开页 | PASS | `s4-cnipa-live.png`；最终 bundle 得到 ready/actionable、JPG、30–120KB、390×567、无诊断 |
| R2/A11 Tabbit AI | PASS | `tabbit-ai-result.json`、`s4-tabbit-ai-live.png`；官方 Bridge 调用 0→1，Schema/evidence 校验通过 |
| R3 体积策略 | PASS（产品裁决） | 169,536 bytes 与 SHA 已记录；无固定字节门禁；Tabbit 成功保存/运行 172,028-byte 验收脚本 |
| R4 AI 输出安全 | PASS | 完整 token、类型化字节来源、比例上下文、内部一致性、未知嵌套字段及容差对抗测试 |
| R5 裁剪契约 | PASS | normalized intent → controller 权威校验 → canonical pixel pipeline |
| R6 规则证据 | PASS | snapshot 有界脱敏 evidence，UI 用 `textContent` 展示来源 |
| R7 可访问性/生命周期 | PASS | 同级按钮、live/alert、Escape 作用域和 dispose 清理 |
| R8 视觉/交互 | PASS | U09/U12、200% 等效视口、reduced motion、真实 pointer drag 与截图 |

## 最终产物与门禁

- `dist/uploadfit.js`：169,536 bytes。
- SHA-256：`67879C73748432DEAF7526ED645842575EAE36AD710313082BCF38B2003AE840`。
- `npm run check`：18 个 Vitest 文件、148 个用例通过；static security check 通过。
- `npm run test:e2e -- --reporter=line --workers=1`：90/90 通过。
- 构建仍为单个 minified IIFE，无 ESM、source map、CDN 或运行时远程依赖。

体积策略已由用户全量放行并同步 PRD/任务书：只记录 raw bytes、SHA-256 和构建差异，不设置固定 KB/bytes 阻断阈值。可直接粘贴保存运行、安全检查和无运行时远程依赖仍是硬门禁。

## 视觉证据来源

- `s4-tabbit-ai-live.png`：Tabbit 1.10.16.0 官方私有脚本在匹配页实际运行，页面可见 A11 PASS 与脱敏结果。
- `s4-cnipa-live.png`：最终生产 bundle 在真实 CNIPA 公开页等待 Vue 内容后产生准备卡。
- 其余 `s4-*.png`：本地 Playwright 使用无敏感合成 fixture 生成，用于确认卡、裁剪、成功/失败和响应式行为。

临时 Tabbit 验收妙招已删除，本地 8766 测试服务已停止。
