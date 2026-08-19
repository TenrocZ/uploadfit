# S4 返工最终回报

- 日期：2026-08-19
- 返工基线：`2161939`
- 最终状态：`ACCEPTED`
- S5：已放行
- Git：本地提交留痕，未推送远程

## 闭合结果

R1、R4–R8 的返工实现及行为证据均通过。复验另发现并直接修复三项残余问题：

1. AI 的 byte claim 可借用相同像素数字，ratio claim 可借用版本号；现改为类型化字节 evidence 和带比例上下文的 evidence。
2. AI 可通过对象输出把比例容差放宽到 1；现禁止未知嵌套字段并锁定不超过 0.015。
3. Tabbit 1.10.16.0 只在粘贴源码含字面量 `LLMBridge.` 时注入官方桥接；生产代码现显式保留该触发 token，并兼容作用域变量与 window 属性两种运行方式。

R2/A11 已由最终生产包在官方 Tabbit 私有脚本中通过：Bridge 可用、调用 0→1、732ms 返回，结构化规则和 evidence 通过本地校验。临时妙招取证后已删除。

R3 根据用户最终裁决改为“体积全量放行”：不设固定上限，当前 169,536 bytes 仅记录。PRD、共享契约、S5/S6 任务书、追踪矩阵、最终验收手册、static-check 与 ADR-003 已同步。单 IIFE、直接粘贴保存运行、无运行时远程依赖和静态安全仍为硬门禁。

## 最终验证

| 检查 | 结果 |
|---|---|
| `npm run check` | PASS：18 文件 / 148 测试；169,536 bytes；static-check PASS |
| `npm run test:e2e -- --reporter=line --workers=1` | PASS：90/90 |
| 真实 CNIPA 页 | PASS：ready/actionable、JPG、30–120KB、390×567、无诊断 |
| Tabbit A11 | PASS：最终 SHA `67879C...AE840`，真实调用与校验通过 |
| `git diff --check` | PASS |

详细结论：`docs/handoffs/S4-final-acceptance.md`。结构化证据：`docs/evidence/S4/rework-result.json`。
