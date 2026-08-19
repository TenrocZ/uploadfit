# S4 最终独立验收

- 日期：2026-08-19
- 结论：`ACCEPTED`
- S5：`RELEASED`
- 最终产物：`dist/uploadfit.js`，169,536 bytes
- SHA-256：`67879C73748432DEAF7526ED645842575EAE36AD710313082BCF38B2003AE840`

## 结论

S4 返工项 R1–R8 已全部闭合，且验收回扫发现的 AI 证据串用、比例容差放宽和 Tabbit Bridge 注入触发问题已由本轮直接修复。最终 bundle 同时通过自动化、真实 CNIPA 页面和 Tabbit 官方 `LLMBridge.chat()` 实机验证，可以进入 S5。

## 验收摘要

| 范围 | 结果 |
|---|---|
| 单元/集成 | 18 个 Vitest 文件、148 个用例全部通过 |
| Chromium E2E | 90/90 通过 |
| 构建/静态安全 | 单 minified IIFE；无禁止模式；体积仅记录 |
| 真实公开页 | CNIPA 页面规则 ready/actionable，JPG、30–120KB、390×567，diagnostics 为空 |
| Tabbit A11 | 官方私有脚本保存并运行；Bridge 可用；真实调用一次；本地 Schema/evidence 校验通过 |
| UI/裁剪/可访问性 | normalized crop、真实 pointer、U09/U11/U12、live/alert 与清理均通过 |

## 体积最终口径

用户已明确“体积问题全量放行”。PRD 和所有后续任务书不再设置固定 KB/bytes 门禁。后续每次构建必须继续记录 raw bytes 与 SHA-256，但不能单凭体积判失败；可粘贴保存运行、单 IIFE、无运行时远程依赖、安全与行为门禁保持不变。

## 证据

- `docs/evidence/S4/rework-result.json`
- `docs/evidence/S4/tabbit-ai-result.json`
- `docs/evidence/S4/s4-tabbit-ai-live.png`
- `docs/evidence/S4/s4-cnipa-live.png`
- `docs/evidence/S4/README.md`

临时 Tabbit 妙招与本地验收服务均已清理；未推送远程。
