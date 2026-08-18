# S0 证据目录

## 已有证据

### E-S0-001：Tabbit 连接确认

- 日期：2026-08-17
- Tabbit 版本：1.9.22.0
- 远程调试端口：9222
- 连接方式：`DevToolsActivePort` 提供的完整 WebSocket 地址
- 验证结果：`agent-browser` 成功读取当前页面 URL
- 当前页面：`https://web.tabbit.com/panel?mode=mi&hl=zh-CN`
- 结论：平台连接可用；尚未证明页面文件回填能力。

### E-S0-002：最小文件回填探针

- 页面：`test-pages/probe.html`
- 结果：File、Blob、DataTransfer、Canvas/toBlob、createImageBitmap、Worker、OffscreenCanvas 能力摘要为 true。
- B 文件回填：`input.files` 元信息复核通过。
- 当前修正版的 A 恢复：先在内存中保存原始 A File，再通过产品 `restoreOriginal(task)` 恢复；`input.files` 元信息复核通过。
- 事件：`input` 在 `change` 之前；捕获、目标、冒泡各观察一次。
- 可信边界：合成事件 `isTrusted=false`。
- 证据：`probe-result.json`、`probe-after-restore.png`

### E-S0-008：原始 File 恢复修正

- 日期：2026-08-18
- 环境：Tabbit Browser 1.9.22.0；`test-pages/probe.html`；本地临时服务端口 8767。
- 步骤：保存原始 A File → 产品 `injectFile()` 写入 B → 产品 `restoreOriginal({ inputElement, originalFile })` 恢复保存的 A。
- 结果：恢复后的 MIME/字节与保存的原始 A 一致；restore 也按 input 后 change 顺序分发事件，捕获/目标/冒泡各一次。
- 自动测试：Playwright 集成测试新增“restores the saved original File through the product API”；5 个浏览器测试全部通过。
- 证据：已更新 `probe-result.json`；产品测试见 `tests/integration/file-injector.test.js`。
- 限制：证据只记录 MIME/字节，不保存完整文件名或文件内容。

### E-S0-003：工程骨架基线

- `npm ci`：PASS
- `npm test -- --run`：PASS
- `npm run build`：PASS，693 bytes
- `npm run static-check`：PASS
- `npm run test:e2e`：PASS，1 个 smoke test
- 测试服务清理：PASS，验证 8765 端口关闭

### E-S0-004：注入器与会话集成测试

- 测试环境：Playwright Chromium，不是 Tabbit 实机。
- 验证：重复 `bootstrap()` 复用同一 session 和一个 host；B 文件写入并复检；事件顺序为 input 后 change；cleanup 后 host 移除。
- 结果：2 个浏览器测试通过。
- 代码：`src/bootstrap.js`、`src/injection/injection-guard.js`、`src/injection/file-injector.js`
- 限制：该证据不能替代 Tabbit 实机加载当前 `dist/uploadfit.js` 的验证。

### E-S0-005：Tabbit 实机加载当前 bundle

- 日期：2026-08-17
- 环境：Tabbit Browser 1.9.22.0；`test-pages/probe.html`；本地临时服务端口 8766。
- 加载：当前生产产物 `dist/uploadfit.js` 加载成功，并暴露产品调试 API。
- 单例：重复 `bootstrap()` 复用同一 session，页面只保留一个状态 host。
- 注入：DataTransfer 写入、`input.files` 元信息复核和 `input/change` 事件链均通过；事件顺序为 input 后 change，捕获/目标/冒泡各一次。
- 清理：`cleanupSession()` 后 host 移除且 session 清除；再次 `bootstrap()` 能创建新 session。
- 可信边界：合成事件 `isTrusted=false`，与最小探针结论一致。
- 证据：`tabbit-bundle-result.json`、`tabbit-bundle.png`
- 限制：这是连接到 Tabbit 页面后的实机 bundle 验证，不等同于 Tabbit 官方“使用脚本”安装/分发流程。

### E-S0-006：失败路径与 cleanup 幂等

- 日期：2026-08-17
- 测试：Playwright Chromium 加载生产 IIFE bundle；4 个浏览器测试全部通过。
- detached input：返回 `INPUT_DETACHED`，不抛未处理异常。
- 受控 DataTransfer 不可用：返回 `DATATRANSFER_UNAVAILABLE`，`ok=false` 且 fallback 为 `download`。
- `input.files` 复核不一致：返回 `INJECTION_FAILED`，不声称注入成功。
- cleanup：首次清理后 host/session/observer/input cleanup 均移除；重复 cleanup 不抛错；再次 bootstrap 创建新 session 和一个 host。
- 证据：`failure-paths-result.json`
- 限制：DataTransfer 不可用是测试页内的受控故障注入，用于验证错误分支，不代表 Tabbit 实机当前缺少该 API；Tabbit 正常路径见 E-S0-005。

### E-S0-007：日志脱敏单测

- 日期：2026-08-18
- 验证：日志默认关闭；启用诊断时只保留允许的顶层字段，文件名、内容、页面正文和 Token 字段不会进入日志条目。
- 结果：`npm run check` 中 7 个单测全部通过。
- 代码：`src/utils/logger.js`、`tests/unit/logger.test.js`

### E-S0-009：Tabbit 当前 bundle 能力与生命周期

- 日期：2026-08-18
- 环境：Tabbit Browser 1.9.22.0；`test-pages/probe.html`；本地临时服务端口 8768。
- 当前 `dist/uploadfit.js` 加载成功；File、Blob、DataTransfer、`input.files`、Canvas/toBlob、createImageBitmap、Worker、Blob Worker、OffscreenCanvas 均为 `true`。
- 重复 `bootstrap()` 复用同一 session 和一个 host；cleanup 后 host/session 清除；再次 bootstrap 创建新 session。
- Tabbit “创建妙招”页面实际展示了脚本编辑、手动/自动执行选项和全部/部分网页范围选项；本次未创建或发布草稿。
- 证据：`tabbit-platform-result.json`。
- 限制：上述 UI 观察不能替代官方安装、更新、分享、发布生命周期契约；这些项仍为 `UNKNOWN`。

### E-S0-010：不可信事件降级与日志嵌套脱敏

- 日期：2026-08-18
- `injectFile()` 成功但进入不可信事件边界后，产品结果改为 `ok=false`、`errorCode=UNTRUSTED_EVENT_BLOCKED`，同时保留 `inputFilesVerified=true`，并给出 `USE_ORIGINAL_UPLOAD_BUTTON` 操作提示；`manual-submit` 与 `download` 两种 fallback 均受控。
- `markUntrustedEventBlocked()` 只负责 S0 结果转换；页面响应观察器仍留给 S3，不在 S0 扩展实现。
- 日志现在同时约束顶层字段和嵌套规则字段，调用者不能覆盖 `time`/`event`；测试覆盖敏感文件名、页面正文、Token、规则证据和伪造时间/事件字段。
- 证据：`failure-paths-result.json`、`tests/integration/failure-paths.test.js`、`tests/unit/logger.test.js`。

## 待补证据

- Tabbit 官方 AI 调用路径的正式示例或技术支持结论；当前阻塞证据见 `tabbit-platform-result.json`。

不在仓库中保存真实照片、完整文件名、Base64、Cookie、Token 或敏感网页文本。
