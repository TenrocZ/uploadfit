# S5 轻量验收补验报告

- 日期：2026-08-20
- 轻量验收基线：`9ed5839`
- S5 实现提交：`dcd5c1a`
- 当前状态：`BLOCKED_BY_ENVIRONMENT`
- S6 状态：`HOLD`
- 当前生产包：`dist/uploadfit.js`，175,868 bytes
- 当前 SHA-256：`29C5613CD5F9C71EBBD9E88754097B18435A4FA8508D0E2612D160233D79FD8F`

## 结论

本次返工已完成所有可在当前环境安全执行的工作，但没有把 Tabbit 实机阻塞写成通过：

| 返工项 | 结果 | 说明 |
|---|---|---|
| LR1 当前 bundle 安装/保存/刷新 | `BLOCKED_BY_ENVIRONMENT` | in-app Browser 不可用，未创建临时脚本 |
| LR2 场景 A 实机预检/回填 | `BLOCKED_BY_ENVIRONMENT` | 未使用 Chromium 冒充 Tabbit |
| LR3 场景 B 实机一次重试 | `BLOCKED_BY_ENVIRONMENT` | 未使用 mock 或旧实机证据 |
| LR4 真实 AI Bridge/敏感边界 | `BLOCKED_BY_ENVIRONMENT` | 未伪造 `LLMBridge.chat()` 调用 |
| LR5 关闭/刷新/再次运行清理 | `BLOCKED_BY_ENVIRONMENT` | 未伪造实机可见清理结果 |
| LR6 文档一致性 | `PASS` | handoff 性能数字与 performance/result 已统一为 353.1ms |

因此 S5 仍不可标记 `ACCEPTED`，S6 继续 `HOLD`。

## 真实环境尝试

按返工单要求重新连接当前 in-app Browser：

- 连接结果：`Browser is not available: iab`
- 浏览器实例列表：空列表
- 已读取连接故障排查说明并按要求检查实例列表；没有切换到其他浏览器控制面来绕过阻塞
- 未启动临时 Tabbit 脚本、未保存账号/脚本 ID/分享链接、未生成实机截图
- 用户委托再次重试时，本机可见 Tabbit Browser 进程，但 in-app Browser 仍返回空实例列表；已知的 `9222/9223` 监听端口未出现。进程存在不等于当前会话拥有可控页面，因此仍不能执行 LR1–LR5。

该结果与返工单的停止条件一致：环境不变时保持 `BLOCKED_BY_ENVIRONMENT`，不继续声称 LR1–LR5 通过。

## 轻量范围未重复项

场景 C/D/E/F 和 X01–X12 按批准的轻量范围不再逐项在 Tabbit 执行，统一记录为：

```text
NOT_REPEATED_BY_APPROVED_LIGHTWEIGHT_SCOPE
证据：S5 专属 Chromium 17/17 + 对应自动化用例
边界：未宣称本项在当前 Tabbit 版本逐项人工执行
```

本范围记录不覆盖 LR1–LR5；LR1–LR5 仍需当前 production bundle 的真实 Tabbit 证据。

## LR6 一致性核对

- `docs/handoffs/S5-handoff.md` 最大 heartbeat 间隔：353.1ms
- `docs/performance.md` 最大 heartbeat 间隔：353.1ms
- `docs/evidence/S5/s5-result.json` 最大 heartbeat 间隔：353.1ms
- 生产 bytes：175,868
- 生产 SHA-256：`29C5613CD5F9C71EBBD9E88754097B18435A4FA8508D0E2612D160233D79FD8F`
- Vitest：18 个文件 / 159 个测试
- 全量 Chromium E2E：116 个；S5 专属：17 个
- P0/P1/P2 未决：0/0/0（环境阻塞不伪装成缺陷修复）

## 已执行的本地回归

仅修改文档和证据后，按返工单执行：

```text
npm run check
npm run test:e2e -- tests/e2e/s5-stable-scenarios.spec.js tests/e2e/s5-security.spec.js tests/e2e/s5-performance.spec.js --reporter=line --workers=1
git diff --check
```

实测：159/159 Vitest、17/17 S5 专属 Chromium、构建/static-check 和 diff check 全部通过；产物 SHA 未变，仍为 `29C5613CD5F9C71EBBD9E88754097B18435A4FA8508D0E2612D160233D79FD8F`。

## 重新申请验收条件

恢复可用 Tabbit/in-app Browser 后，按 [`tabbit-matrix.json`](../evidence/S5/tabbit-matrix.json) 补录 LR1–LR5，保存脱敏截图和 JSON 摘要，清理临时脚本/服务，再由独立验收方决定 S5 是否放行。当前不启动 S6、不推送远程。
