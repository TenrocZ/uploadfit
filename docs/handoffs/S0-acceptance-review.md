# S0 验收整改单

- 验收日期：2026-08-18
- 验收范围：仅 S0 平台能力探针与工程骨架
- 当前结论：`BLOCKED`
- 核心门禁：`PASS`

## 1. 当前已通过

- `npm ci` 通过。
- `npm run check` 通过：3 个测试文件、6 个单测通过。
- `npm run build` 通过：`dist/uploadfit.js` 为单文件 IIFE，6785 bytes。
- `npm run test:e2e -- --reporter=line --workers=1` 通过：4 个浏览器测试通过。
- 已有 Tabbit 1.9.22.0 的 `DataTransfer → input.files → input/change` 实机证据。
- 已准确记录合成事件 `isTrusted=false`，未尝试绕过浏览器安全边界。

## 2. 必须整改

### S0-R1：补齐 Tabbit 平台探针

在真实 Tabbit 中验证并记录以下项目，不得继续保留无证据的 `UNKNOWN`：

- 脚本安装方式；
- 手动运行、重复运行、刷新和关闭后的生命周期；
- 页面匹配范围；
- 更新和分享方式；
- CSP/外部依赖限制；
- Blob Worker 实际创建结果。

更新 `docs/tabbit-capabilities.md`，证据放入 `docs/evidence/S0/`。不能验证的项目必须提供明确的外部阻塞依据，并保持 S0 为 `BLOCKED`。

### S0-R2：补齐 Tabbit AI 结论

二选一完成：

1. 使用官方示例验证 AI 调用入口、参数、权限、超时、返回和错误形态；或
2. 保存赛道技术支持/官方渠道给出的不可用或暂未开放结论，包含渠道、日期、问题和回复。

仅写“尚未确认”不构成阻塞证据。不得猜测 `window.tabbit` 等 API，也不得模拟 AI 成功。

### S0-R3：修正原文件恢复测试

当前探针的“恢复 A”会重新生成 A 文件，没有证明恢复原始 `File`。

- 探针应先保存原始 A，再注入 B，最后通过产品 `restoreOriginal(task)` 恢复保存的 A；
- 增加自动测试，验证恢复后的名称、MIME、字节、事件顺序和次数；
- 更新 `probe-result.json`，不得用旧证据继续声明 S0-T07 PASS。

### S0-R4：实现不可信事件降级记录

为“文件已写入，但网站不响应合成事件”的场景建立可观察路径：

- 使用稳定错误码 `UNTRUSTED_EVENT_BLOCKED`；
- fallback 为 `manual-submit` 或 `download`；
- 明确提示用户继续使用网页原按钮；
- 增加自动测试，不能把 `input.files` 写入成功表述为网站已上传成功。

### S0-R5：修复日志脱敏

`src/utils/logger.js` 目前只过滤顶层字段，`rules` 内仍可写入文件名和页面文本，并且传入字段可覆盖日志的 `time/event`。

- `time` 和 `event` 必须由 logger 生成，调用方不得覆盖；
- 对 `rules` 使用明确结构白名单或安全摘要，不保存 evidence 原文、文件名、页面正文、Token 等；
- 增加嵌套敏感字段、事件伪造和时间伪造测试；
- S0-T12 全部通过后再更新交接结论。

### S0-R6：修正交接与工程留痕

- `docs/handoffs/S0-handoff.md` 的状态只允许 `READY_FOR_ACCEPTANCE` 或 `BLOCKED`；
- 补齐 Start commit、End commit、Agent、Node/npm/Tabbit 环境；
- 建立可核验的 Git 提交留痕；
- 修正“Worker/Blob Worker PASS，但 Blob Worker 未验证”等互相矛盾的记录；
- 产品版 `detectCapabilities()` 增加自动测试和对应证据。

## 3. 复验门槛

整改完成后必须同时满足：

1. `npm ci` 成功；
2. `npm test -- --run` 全部通过；
3. `npm run build` 成功，产物无 ESM import/export 且不超过 150000 bytes；
4. `npm run test:e2e -- --reporter=line --workers=1` 全部通过；
5. S0-T01 至 S0-T12 均有可复查证据；
6. Tabbit 平台探针和 AI 项已确认，或具备正式外部阻塞证据；
7. `docs/handoffs/S0-handoff.md` 状态改为 `READY_FOR_ACCEPTANCE` 后提交重新验收。

## 4. 施工边界

本整改单只处理 S0。不要实现规则解析、图像处理、正式 UI 或其他后续阶段功能。
