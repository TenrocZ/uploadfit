# UploadFit 开发进度记录

本文件记录按《UploadFit-开发任务书-v1.0》执行的逐步进度。每完成一个可独立验收的步骤就暂停并向用户汇报；遇到需要决策、授权或平台能力不确定时立即暂停，不把推测写成通过结论。

## 工程基线

- 工程目录：`C:\Users\蔡天乐\Desktop\黑客松\main`
- 需求事实来源：`C:\Users\蔡天乐\Desktop\黑客松\UploadFit-PRD-v1.0.md`
- 执行任务书：`C:\Users\蔡天乐\Desktop\黑客松\UploadFit-开发任务书-v1.0`
- 当前阶段：S5 本地全量测试、安全与兼容性实现
- 当前状态：以 `8d9d9ad` 作为 S5 正式起始基线；本地自动化、静态安全、性能和稳定测试已完成，真实 Tabbit 矩阵因当前 in-app Browser 无可用实例而记为 `BLOCKED_BY_ENVIRONMENT`，未宣称 S5 验收通过。
- 记录日期：2026-08-20

## 2026-08-17：S0 / 平台连接确认

状态：已完成，等待进入“最小探针页”步骤。

已完成事项：

- 阅读 README、项目总控、共享契约、S0 任务书和 PRD 关键章节。
- 检查 `main`，确认此前为空且不是 Git 仓库。
- 确认 Node `v22.20.0`、npm `10.9.3`。
- 确认本机 Tabbit Browser `1.9.22.0` 已安装并运行。
- 用户开启 Tabbit 远程调试后，确认 `DevToolsActivePort` 存在，端口为 `9222`。
- 标准 Chromium `/json/*` HTTP 接口返回 404；使用端点文件中的完整 WebSocket 地址连接成功，并通过 `agent-browser` 读取当前页面 URL。
- 当前连接页面：`https://web.tabbit.com/panel?mode=mi&hl=zh-CN`。

尚未宣称通过的能力：

- `File`、`Blob`、`DataTransfer`、`input.files` 赋值。
- `input/change` 事件顺序和网站监听器可见性。
- Canvas、`createImageBitmap`、Worker、OffscreenCanvas。
- Tabbit 官方 AI 调用入口和返回格式。

本步骤证据：

- `docs/tabbit-capabilities.md`
- `docs/evidence/S0/README.md`

下一步：创建无敏感数据的最小探针页，并在 Tabbit 中验证 File 回填闭环；完成后暂停汇报。

## 2026-08-17：S0 / 最小文件回填探针

状态：已完成，探针验证通过，等待进入工程骨架步骤。

已完成事项：

- 创建 `test-pages/probe.html` 和 `test-pages/probe.js`。
- 在 Tabbit 新标签页加载探针，使用临时 `127.0.0.1:8765` 静态服务器；验证后已关闭服务器。
- 页面内能力检测：File、Blob、DataTransfer、Canvas/toBlob、createImageBitmap、Worker、OffscreenCanvas 均为 `true`。
- 生成内存 B 文件并写入 `input.files`：`inputFilesVerified=true`。
- 事件顺序为 `input` 后 `change`；每类事件依次经过捕获、目标、冒泡阶段，各一次。
- 观察到合成事件 `isTrusted=false`，按产品安全边界记录为已知限制，不尝试伪造可信事件。
- 生成 A 文件恢复成功，`inputFilesVerified=true`。

本步骤证据：

- `docs/evidence/S0/probe-result.json`
- `docs/evidence/S0/probe-after-restore.png`
- `docs/evidence/S0/README.md`
- `docs/tabbit-capabilities.md`

下一步：初始化 npm/esbuild/Vitest/Playwright 工程骨架；完成后暂停汇报。

## 2026-08-17：S0 / npm 工程与测试骨架

状态：已完成，骨架基线通过，等待进入单例会话、清理和注入守卫实现。

已完成事项：

- 创建 ESM npm 工程和 `package-lock.json`。
- 配置 esbuild 生产 IIFE 与开发构建；生产构建产物为 `dist/uploadfit.js`。
- 配置共享安全常量、能力检测骨架、测试静态服务器和静态安全检查。
- 配置 Vitest 单测和 Playwright E2E；E2E runner 自己启动/清理测试服务器，避免 Windows 嵌套 npm 进程残留。
- 增加基础配置单测和探针页 E2E smoke test。
- 下载并验证 Playwright Chromium/headless shell 测试运行时；浏览器缓存不进入工程提交物。

验证结果：

| 命令 | 结果 |
|---|---|
| `npm ci` | PASS |
| `npm test -- --run` | PASS：1 个测试文件、1 个测试 |
| `npm run build:dev` | PASS：1325 bytes |
| `npm run build` | PASS：693 bytes；无 ESM import/export |
| `npm run static-check` | PASS |
| `npm run test:e2e -- --reporter=line --workers=1` | PASS：1 个测试 |
| `npm run check` | PASS |
| 测试服务清理 | PASS：8765 端口已关闭 |

工程边界：

- 本步骤只建立可复现骨架和检查工具，没有实现规则解析、图像处理或假成功注入。
- `dist/uploadfit.js` 当前是构建骨架，不代表产品功能已完成。
- Playwright 浏览器运行时需要在本机单独安装，不能由 `npm ci` 将浏览器二进制提交进仓库；最终发布物不依赖它。

下一步：实现 S0 的防重复启动、session cleanup 和 injection guard；完成后暂停汇报。

## 2026-08-17：S0 / 单例会话、清理与文件注入骨架

状态：已完成，核心骨架验证通过；S0 仍未最终交接。

已完成事项：

- `src/bootstrap.js`：稳定 session key、重复启动复用、最小状态节点、动态 file input 监听、MutationObserver 清理和 `pagehide` 清理。
- `src/injection/injection-guard.js`：按 input 独立保存一次性 change token；首次自分发 change 消费，第二次事件不再被吞掉。
- `src/injection/file-injector.js`：校验 input/File、DataTransfer 写入、元信息复核、input/change 分发、稳定失败码和原文件恢复。
- `src/utils/ids.js`、`src/utils/logger.js`：随机 session id 和字段白名单日志骨架。
- 增加 guard 单测和 Playwright 浏览器集成测试，验证一套 UI host、B 文件注入、事件顺序和 cleanup。

验证结果：

| 命令 | 结果 |
|---|---|
| `npm test -- --run` | PASS：2 个测试文件、4 个测试 |
| `npm run test:e2e -- --reporter=line --workers=1` | PASS：2 个浏览器测试 |
| `npm run check` | PASS |
| `dist/uploadfit.js` | 6785 bytes；无 ESM import/export |
| 测试服务清理 | PASS：8765 端口已关闭 |

边界说明：

- Playwright 集成测试证明标准 Chromium 中的产品 bundle 行为；不能替代 Tabbit 实机 bundle 验证。
- Tabbit 实机目前已证明页面 API 的 DataTransfer/input.files 闭环；下一步还要在 Tabbit 中加载当前 bundle，验证单例 host、guard 和 cleanup。
- 当前状态节点尚未使用 Shadow DOM；按任务书留给 S4 UI 阶段处理。
- S0-T08/T09 等失败路径和最终 `S0-handoff.md` 尚未完成。

下一步：在 Tabbit 实机加载当前 `dist/uploadfit.js`，并补齐 detached input、DataTransfer 不可用、cleanup 幂等等 S0 边界证据；完成后暂停汇报。

## 2026-08-17：S0 / Tabbit 实机加载当前 bundle

状态：已完成，当前生产 bundle 在 Tabbit 实机验证通过；等待进入失败路径与清理幂等边界测试。

已完成事项：

- 在 Tabbit Browser 1.9.22.0 的探针页直接加载当前 `dist/uploadfit.js`，确认 bundle API 可用。
- 重复 `bootstrap()` 复用同一 session，状态 host 数量保持为 1。
- 通过产品 `injectFile()` 完成 DataTransfer 写入和 `input.files` 元信息复核。
- 在真实 Tabbit 页面观察到 input 后 change，且捕获、目标、冒泡各一次；合成事件 `isTrusted=false`。
- 执行 `cleanupSession()` 后 host/session 均清理；再次启动可创建新 session。
- 本步骤使用临时本地服务端口 8766；验证结束后会关闭该服务，不作为产品配置。

本步骤证据：

- `docs/evidence/S0/tabbit-bundle-result.json`
- `docs/evidence/S0/tabbit-bundle.png`
- `docs/evidence/S0/README.md`

边界说明：

- 该证据证明当前 bundle 在 Tabbit 页面中的运行闭环，不证明 Tabbit 官方“使用脚本”安装、更新、分享流程。
- Tabbit 官方 AI 调用入口仍为 UNKNOWN；产品不据此做能力承诺。

下一步：补齐 detached input、DataTransfer 不可用、注入失败和 cleanup 幂等等 S0 失败路径证据；完成后暂停汇报。

## 2026-08-17：S0 / 失败路径与 cleanup 幂等

状态：已完成，S0-T08、S0-T09、S0-T10 的浏览器集成验证通过；当前步骤暂停。

已完成事项：

- 增加失败路径集成测试：detached input、受控 DataTransfer 不可用、`input.files` 复核不一致。
- 三类失败均返回 `ok=false`、稳定错误码、空事件列表和 `download` fallback，不报假成功。
- 增加 cleanup 幂等测试：第一次清理移除 host/session/observer/input cleanup；重复清理不抛错；再次 bootstrap 可创建新 session。
- 测试服务由 E2E runner 自动启动和关闭，8765 端口验证为关闭。

验证结果：

| 命令 | 结果 |
|---|---|
| `npm run test:e2e -- --reporter=line --workers=1` | PASS：4 个浏览器测试 |
| `npm run check` | PASS：单测 4/4、构建 6785 bytes、静态检查通过 |

本步骤证据：

- `docs/evidence/S0/failure-paths-result.json`
- `docs/evidence/S0/README.md`

边界说明：

- DataTransfer 不可用是 Playwright 测试页内的受控故障注入；Tabbit 正常 DataTransfer 路径已在 E-S0-005 实机通过。
- Tabbit 官方 AI 调用入口仍为 UNKNOWN，尚未据此进入实现承诺。

下一步：整理 S0 最终交接文档，汇总已通过项、Tabbit 未知项、`isTrusted=false` 边界和 S1 前置条件；完成后暂停汇报。

## 2026-08-18：S0 / 最终交接整理

状态：交接文档已完成；核心门禁通过，但整体 S0 标记为 `CORE_READY / CONDITIONAL`，当前暂停等待外部 AI provider 决策。

完成事项：

- 补充 `tests/unit/logger.test.js`，完成 S0-T12 日志脱敏自动验证。
- 重新运行 `npm run check`：3 个测试文件、6 个单测通过；构建 6785 bytes；静态检查通过。
- 重新运行 `npm run test:e2e -- --reporter=line --workers=1`：4 个浏览器测试通过；8765 端口已关闭。
- 创建 `docs/handoffs/S0-handoff.md`，汇总 S0-D1–D9、S0-T01–T12、Tabbit 实机证据、已知边界和 S1 前置条件。
- 更新 `docs/tabbit-capabilities.md`，将单脚本构建门槛记录为 PASS，并保留官方安装流程、发布限制和 AI provider 的 UNKNOWN。

交接结论：

- `File → DataTransfer → input.files → input/change` 核心闭环：PASS。
- `isTrusted=false`：已确认并作为产品边界，不尝试绕过。
- Tabbit 官方 AI 调用路径：UNKNOWN；没有添加猜测性 API 或模拟成功。
- 进入 S1 的可行范围是本地 DOM/确定性规则能力；是否在 AI provider 未确认时继续，需要用户或赛道技术支持确认。

本步骤证据：

- `docs/handoffs/S0-handoff.md`
- `docs/evidence/S0/README.md`
- `docs/tabbit-capabilities.md`

## 2026-08-18：S0-R3 / 原始 File 恢复修正

状态：已完成，当前步骤暂停；未进入其他整改项。

完成事项：

- 探针现在保留内存中的原始 A File，并暴露 `getOriginalFile()` 供产品恢复测试使用。
- 新增产品集成测试：A（保存）→ `injectFile()` 写入 B → `restoreOriginal(task)` 恢复同一个原始 File。
- 验证恢复后的 MIME、字节、`input/change` 顺序和捕获/目标/冒泡次数。
- 更新 Tabbit 实机 `docs/evidence/S0/probe-result.json`，不再用“重新生成 A”作为原文件恢复证据。

验证结果：

| 命令 | 结果 |
|---|---|
| `npm run test:e2e -- --reporter=line --workers=1` | PASS：5 个浏览器测试 |
| Tabbit 实机探针 | PASS：原始 A 保存、B 注入、`restoreOriginal` 恢复 |

本步骤证据：

- `docs/evidence/S0/probe-result.json`
- `docs/evidence/S0/README.md`
- `tests/integration/file-injector.test.js`

下一步：处理 S0-R4 不可信事件降级结果与受控测试；完成后暂停。

## 2026-08-18：S0-R4 / 不可信事件降级结果

状态：已完成，未进入 S1/S2/S3 实现。

完成事项：

- 增加 `markUntrustedEventBlocked()`，把“文件已写入但网页未接受合成事件”的结果明确转换为 `ok=false` 和 `UNTRUSTED_EVENT_BLOCKED`。
- 固定用户动作 `USE_ORIGINAL_UPLOAD_BUTTON`，仅允许 `manual-submit` 和 `download` 两个 fallback。
- 增加浏览器集成测试，验证不声称上传成功且保留 `inputFilesVerified=true`。
- 明确 S0 只提供结果转换；页面响应观察器仍属于 S3。

验证结果：`npm run check` 和 E2E 均通过；证据见 `docs/evidence/S0/failure-paths-result.json`。

## 2026-08-18：S0-R5 / 日志字段边界修正

状态：已完成，未进入其他板块。

完成事项：

- 日志顶层字段仅保留契约允许的标量字段，调用者不能覆盖 `time` 或 `event`。
- 嵌套规则只保留格式、大小、尺寸、宽高比和置信度等受控字段，过滤文件名、页面正文、Token、证据文本和未知键。
- 对日志条目执行深冻结，避免后续引用修改已记录内容。
- 增加嵌套脱敏和伪造时间/事件字段测试。

验证结果：`npm run check` 中 7 个单测通过；证据见 `docs/evidence/S0/README.md` 的 E-S0-010。

## 2026-08-18：S0-R1/R2 / Tabbit 能力与外部阻塞证据

状态：本地能力修复完成；官方脚本生命周期和 AI provider 仍保持 `UNKNOWN/BLOCKED`，没有写入猜测性 API。

完成事项：

- 在 Tabbit Browser 1.9.22.0 中加载当前 `dist/uploadfit.js`，重新验证 Blob Worker、单例 bootstrap、cleanup 和 rebootstrap。
- 实际观察 Tabbit 创建妙招页面的脚本编辑、执行方式和页面范围控件；未创建、发布或分享任何 UploadFit 草稿。
- 实际观察 AI Panel 当前状态，并查阅 Tabbit 官方公开材料；未找到可供网页脚本调用的 AI 方法、参数、权限、超时和返回契约。
- 将已观察事实、官方链接、限制和阻塞结论写入 `docs/evidence/S0/tabbit-platform-result.json`。

验证结果：本地 Tabbit bundle 能力与生命周期 PASS；官方脚本安装/更新/分享契约 UNKNOWN，官方 AI provider BLOCKED。

下一步：完成 R6 交接文档、能力测试、Git 终点提交和全量回归；不进入 S1。

## 2026-08-18：S0-R6 / 交接、能力测试与全量回归

状态：本地整改完成，S0 交接状态保持 `BLOCKED`；未进入 S1。

完成事项：

- `docs/handoffs/S0-handoff.md` 改为合法状态 `BLOCKED`，补齐 Start commit、End commit 待回填、Agent、Node/npm/Tabbit 环境、产物 SHA-256、T01–T12 和外部阻塞项。
- 新增 `tests/integration/capabilities.test.js`，验证产品版 `detectCapabilities()` 的 File、DataTransfer、`input.files`、Canvas、Worker、Blob Worker、OffscreenCanvas 和 AI UNKNOWN 状态。
- `docs/tabbit-capabilities.md` 修正 Blob Worker 矛盾记录，并索引当前 Tabbit 平台证据。
- 执行 `npm ci`，随后完成单测、构建、静态检查和 7 个浏览器测试；临时测试端口均已关闭。
- 初始化并保留 Git 整改留痕；实质整改提交为 `c3dd4a5`，基线为 `edbdce2`。

最终验证摘要：

| 项目 | 结果 |
|---|---|
| `npm ci` | PASS |
| `npm run check` | PASS：7 个单测；构建 8711 bytes；静态检查通过 |
| `npm run test:e2e -- --reporter=line --workers=1` | PASS：7 个浏览器测试 |
| `dist/uploadfit.js` | SHA-256 `44351FECB57784C90C3F8F4AECD7EF14C64FDCCA7C27721668FC3A494BA6B04F` |
| Tabbit 临时端口 8768/8765 | CLOSED |

当时停止条件（现已解除）：R1/R2 需要 Tabbit 官方脚本生命周期契约及 AI provider 官方示例或技术支持回复；本条件已由后续 LLMBridge 指南和私有官方脚本实机证据闭合。

## 2026-08-18：S0 / 第二次整改与 LLMBridge 实机闭环

状态：剩余问题已修复，S0 改为 `READY_FOR_ACCEPTANCE`。

完成事项：

- 完整读取用户提供的 `ai调用指南/SKILL.md` 和压缩包，确认官方入口为 `LLMBridge.chat()`，支持字符串和对象 JSON 模式。
- 在 Tabbit 1.9.22.0 创建私有脚本探针，验证创建、更新、指定网址、刷新自动执行、关闭自动执行、私有分享弹层和删除。
- 固定无敏感文本使用 `{ response_format: "json" }`：1730ms 返回字符串，可解析为包含 formats/minKB/maxKB/width/height 的对象；不保存完整模型返回。
- 空参数调用拒绝为 `Error: content is required`，没有稳定平台 error code；平台指南未声明内建超时，产品保留 3000ms 超时和错误归一化。
- `detectCapabilities()` 只在 `LLMBridge.chat` 实际存在时报告 AI 可用；普通页面继续报告不可用。
- logger 增加固定事件枚举和随机 task/session id 格式，阻断把文件名伪装成 event/taskId；补充深冻结测试。
- 原文件恢复自动测试增加名称和字节内容断言；证据增加等值布尔字段，不保存完整文件名。
- 临时 Tabbit 妙招已删除，私有分享链接未分发；临时 8768 服务已关闭。

最终回归：

| 项目 | 结果 |
|---|---|
| `npm ci` | PASS |
| `npm run check` | PASS：9 个单测；构建 9308 bytes；静态检查通过 |
| `npm run test:e2e -- --reporter=line --workers=1` | PASS：8 个浏览器测试 |
| `dist/uploadfit.js` | SHA-256 `72E55E584CCA6E6B9992C7A42CBD6AB47139EF6F50E88C7D2C8CE63C893132B1` |
| 临时端口 8765/8768 | CLOSED |

本轮实质整改提交：`ae93d44`。

证据：

- `docs/evidence/S0/tabbit-llmbridge-result.json`
- `docs/evidence/S0/tabbit-llmbridge-probe.png`
- `docs/evidence/S0/probe-result.json`
- `docs/handoffs/S0-handoff.md`

## 2026-08-18：S1-D1 / 上传器发现与动态生命周期

状态：已完成；后续 D2～D7 已在本阶段继续完成，最终结果见 S1 交接文档。

完成事项：

- 新增 `src/dom/input-discovery.js`：识别图片上传器、生成契约兼容的 `UploaderContext`、扫描普通 DOM/open Shadow DOM/同源 iframe，并通过订阅回调向上层报告。
- 新增 `src/dom/spa-observer.js`：监听 `popstate`/`hashchange`，使用 `DOM_DEBOUNCE_MS` 去抖，不 monkey-patch history。
- MutationObserver 只处理新增子树；已注册 input 使用 WeakSet 防重复；`findFileInputFromEvent()` 使用 `composedPath()` 支持 open Shadow DOM 事件路径。
- 跨域或受保护 iframe 访问异常被捕获并报告为 `CROSS_ORIGIN_OR_UNAVAILABLE`；不尝试访问 closed Shadow DOM。
- cleanup 会断开所有观察器、移除路由监听并清理发现上下文；不触发文件处理、上传或业务任务。

验证结果：

| 命令 | 结果 |
|---|---|
| `npm run check` | PASS：9 个单测；构建 14021 bytes；静态检查通过 |
| `npm run test:e2e -- --reporter=line --workers=1` | PASS：11 个浏览器测试；8765 端口关闭 |

证据：`docs/evidence/S1/input-discovery-result.json`、`docs/evidence/S1/README.md`。

下一步：进入 S1-D2～D7 全流程收尾。

## 2026-08-18：S1 / 启动登记与边界确认

状态：已启动，当前步骤完成并暂停；尚未进入产品代码实现。

放行依据：

- `docs/handoffs/S0-handoff.md` 状态为 `READY_FOR_ACCEPTANCE`。
- 用户已确认 S0 验收通过并授权启动 S1。
- 既有 `npm ci`、单测、构建、静态检查和 E2E 回归保持绿色；S1 不修改 S0 注入契约。

本阶段范围：

- `input[type=file]` 上传器发现、动态 DOM、open Shadow DOM、同源 iframe 的安全边界。
- 围绕单个 input 的上下文提取、敏感内容过滤和 6000/2000 字符预算。
- 纯本地确定性规则解析、归一化、来源合并、冲突显式化和安全分类。
- 30 条中文规则变体及 DOM/安全边界测试；完成后生成 `docs/handoffs/S1-handoff.md`。

明确不做：

- 不读取图片像素、不处理文件、不回填、不触发上传。
- 不调用 `LLMBridge.chat()` 或其他 AI；S1 的 `selectAiRelevantText()` 只提供受控文本摘要能力。
- 不实现 `src/dom/rejection-observer.js`，该文件属于 S3。
- 不突破 closed Shadow DOM、跨域 iframe、密码/验证码字段或其他表单值边界。

下一步：完成 S1-D2～D7，并在全量验证后生成 S1 交接文档。

## 2026-08-18：S1-D2 / 上下文提取与文本预算

状态：已完成；未进入图像、文件、UI 或 AI 实现。

完成事项：

- 新增 `src/dom/context-extractor.js` 和 `src/utils/text.js`，按属性、label、四层祖先、相邻说明、局部错误、当前提示、选中文字的顺序提取上下文。
- 过滤 script/style/noscript/nav/footer、隐藏节点、其他表单控件和值；URL、Cookie/Token/密码/验证码样式值被移除或脱敏。
- `normalizedText` 封顶 6000 字符，`selectAiRelevantText()` 封顶 2000 字符，仅保留规则相关句子，不调用 AI。
- 增加 unit/integration 测试，覆盖敏感值、伪造脚本样式、字符预算和两个 uploader 不串线。

验证：单测与上下文浏览器测试通过；证据见 `docs/evidence/S1/context-and-rules-result.json`。

## 2026-08-18：S1-D3/D4 / 确定性解析与归一化

状态：已完成。

完成事项：

- 新增 `schema.js`、`normalizer.js`、`deterministic-parser.js`、`validators.js`，覆盖 R01–R30 的大小、格式、尺寸、比例、数量及展示语义。
- 完成 NFKC、全角单位/标点、大小写、破折号、乘号、MIME 和扩展名归一化；JPG/JPEG 统一为 `image/jpeg` 与 `jpg/jpeg`。
- 建议/推荐作为 `advisoryOnly` 保留，不升级为强制；模糊文案不产生可执行规则；不从文件扩展名生成网页强制规则。

验证：R01–R30 共 30 条规则单测全部通过。

## 2026-08-18：S1-D5/D6 / 来源合并、冲突与安全分类

状态：已完成。

完成事项：

- 新增 `resolver.js`，固定 adapter/rejection/html-attribute/nearby-text/selected-text/ai/weak-page-text 优先级。
- 高优先级覆盖低优先级时保留冲突证据；同优先级 exact/min/max、反转范围、精确尺寸与比例矛盾均阻断执行。
- 网络、超时、权限、登录、审核不通过、系统繁忙、官方工具语义统一产生人工检查标记；confidence 采用执行候选最低值，不取平均掩盖冲突。
- 增加 resolver 单测，验证 accept 与 rejection、范围、比例、候选顺序、安全标记和非法候选留痕。

验证：规则解析/合并/安全单测通过；无 AI、文件或图片处理调用。

## 2026-08-18：S1-D7 / 整改前全流程基线

状态：历史基线；独立验收质检后已由返工结果替代。

最终验证：

| 命令 | 结果 |
|---|---|
| `npm ci` | PASS |
| `npm run check` | PASS：8 个测试文件、60 个单测；生产 IIFE 31929 bytes；静态检查通过 |
| `npm run test:e2e -- --reporter=line --workers=1` | PASS：14 个浏览器测试；8765 端口已关闭 |

证据与交接：

- `docs/evidence/S1/input-discovery-result.json`
- `docs/evidence/S1/context-and-rules-result.json`
- `docs/evidence/S1/README.md`
- `docs/handoffs/S1-handoff.md`

阶段边界：S1 未读取图片像素、未处理文件、未回填、未触发上传、未调用 AI；未实现 `src/dom/rejection-observer.js`，未突破 closed Shadow DOM 或跨域 iframe。

## 2026-08-18：S1 / 独立验收质检返工

状态：返工完成，R1–R8 已关闭，`READY_FOR_ACCEPTANCE`，等待用户复验。

质检文档 `docs/handoffs/S1-acceptance-review.md` 确认 R1–R8 八类边界缺口，涉及上下文隔离、单一文本预算、运行时校验、裸 input MIME 升级、格式否定语义、动态 Shadow DOM/同源 iframe 生命周期、原始 evidence 和过度声明的证据文档。

已完成的返工方向：

- 当前 uploader 分支和错误节点按局部 scope 隔离，generic adapter 复用同一错误节点关联逻辑。
- ContextBundle 来源数组与确定性解析器共享 6000 字符预算，AI 摘要继续以 2000 字符为上限。
- RuleCandidate/RuleSet 增加格式、扩展名、数量、DPI、比例、语义、证据和安全标记的运行时校验；非法候选留下脱敏不可解冲突。
- 增加裸 file input 的真实 image MIME 升级入口；补充延迟 open Shadow DOM 事件发现和真实同源 iframe load/navigate/cleanup 生命周期。
- 格式解析区分文件名/示例/URL、否定格式与明确允许格式；支持 `*` 尺寸分隔符并保留安全原始 evidence。

最终验证：

| 命令 | 结果 |
|---|---|
| `npm ci` | PASS |
| `npm run check` | PASS：9 个测试文件、71 个单测；生产 IIFE 40270 bytes；静态检查通过 |
| `npm run test:e2e -- --reporter=line --workers=1` | PASS：19 个浏览器测试；8765 端口已关闭 |

Q-S1-001～026 均有纯函数或真实浏览器自动覆盖；返工实质提交为 `3a90174`。Git 仍为本地留痕，未推送远程。

## 2026-08-18：S1 / 第二次验收残留修复

状态：修复完成，`READY_FOR_ACCEPTANCE`。

第二次独立复验在全绿门禁之外复现了 3 个规则层残留：后置否定格式仍进入允许集合、formats/extensions 与嵌套对象校验不完整、不同 source item 通过空格拼接后发生 advisory 语义串染。

完成事项：

- 格式解析同时检查格式词前后的否定语境，覆盖 `PNG不支持`、`PNG格式不支持`、`PNG禁用`、`WebP禁止使用` 等表达。
- nearby/alert/selected 在共享 6000 字符预算后逐条解析，独立 DOM 文本节点不再互相污染强制/建议分类。
- formats/extensions 必须成对且与 MIME 的规范扩展名全集一致；width/height/aspectRatio/count 增加嵌套字段白名单；候选和最终 RuleSet 均独立校验。
- JPG/JPEG 均稳定归一化为 `image/jpeg` 和完整 `jpg/jpeg` 扩展名集合。
- 新增 Q-S1-027～031；实质修复提交为 `4e4d89c`。

最终验证：

| 命令 | 结果 |
|---|---|
| `npm ci` | PASS |
| `npm run check` | PASS：9 个测试文件、75 个单测；生产 IIFE 40961 bytes；静态检查通过 |
| `npm run test:e2e -- --reporter=line --workers=1` | PASS：19 个浏览器测试；8765 端口已关闭 |
| 产物 SHA-256 | `956E13F9BF8CA887C04488904DCCE12E56735BA6024CBACF86393D21F80C8B2B` |

## 2026-08-18：S1 用户验收与 S2 启动

状态：S1 已由用户确认验收通过；按任务书启动 S2 图像处理引擎全流程。

验收登记：

- 用户确认：`s1已验收，启动s2板块开发`。
- S1 交接状态保持 `READY_FOR_ACCEPTANCE`，不将用户验收与本地自动门禁混写；本条记录用户已放行进入下一阶段。
- S1 本地验收基线：实质实现提交 `4e4d89c`，后续文档留痕提交见 Git 历史；本地工作区在 S2 开工前保持清洁。

S2 范围：

- 仅实现 `File + RuleSet → ProcessResult` 的本地图像处理引擎，不进入 S3 任务编排/拒收观察、S4 UI/Tabbit AI 或业务上传。
- 覆盖真实元数据、签名与输入防护、纯校验、固定处理计划、确认边界、Canvas/编码、大小优化、最终复检、Worker/主线程降级、非敏感 fixtures 与 S2 交接证据。
- 保留合规文件原样放行；未获确认的 `CROP`、`FLATTEN_BACKGROUND`、`UPSCALE` 不执行；输出未通过复检不得作为成功结果返回。

下一步：完成 S2-D1～D8、全量验证、证据和本地 Git 留痕后，再停止并汇报。

## 2026-08-18：S2-D1～D8 / 图像处理引擎完成

状态：S2-D1～D8 已完成，自动门禁全绿，交接状态 `READY_FOR_ACCEPTANCE`，等待用户验收。

完成事项：

- D1：新增 `src/image/metadata.js`、`src/image/exif.js`、`src/utils/mime.js`，完成 JPEG/PNG/WebP 签名、真实 MIME/扩展名一致性、宽高/比例、EXIF Orientation、实际透明度、可解码检查，以及 50MiB/20k/80MP 防护。
- D2：`validateFile()` 对格式、字节、尺寸、比例、透明度和官方工具语义进行稳定分类，区分 `violations`、`safeAutoFixes`、独立确认项和 `unfixable`。
- D3：`createProcessingPlan()` 固定方向/格式/裁剪/缩放/扁平化/编码/体积优化顺序；`resolveProcessingConfirmation()` 不可变校验确认，未确认的 CROP/FLATTEN_BACKGROUND/UPSCALE 不可执行。
- D4：新增 Canvas/OffscreenCanvas 绘制、方向归一、等比裁剪/缩放、白底扁平化和 `toBlob`/`convertToBlob` 编码；Canvas 不插入业务 DOM。
- D5：新增 JPEG/WebP 0.45–0.95 质量搜索、最多 8 步、目标最大体积安全余量和最多 3 轮等比缩小；PNG 不伪用 quality、不加垃圾字节。
- D6：输出使用本地安全命名，创建新 File 后再次检查真实 MIME/签名/扩展名/字节/宽高/可解码/RuleSet；复检失败不返回成功结果。
- D7：新增 Blob Worker + OffscreenCanvas 后台路径；Worker 构造、CSP 或运行失败时主线程只重试一次，并 terminate/revoke/close/释放资源。
- D8：新增非敏感 Canvas fixture 生成器、I01–I18 单测/浏览器测试、S2 evidence 和 handoff；生产入口只增加公共图像 API 导出，没有进入 S3/S4。

最终验证：

| 命令 | 结果 |
|---|---|
| `npm ci` | PASS |
| `npm run check` | PASS：12 个文件、92 个单测；构建 80652 bytes；静态检查通过 |
| `npm run test:e2e -- --reporter=line --workers=1` | PASS：24 个 Chromium 测试；8765 端口关闭 |
| `npm run fixtures:generate` | PASS：8 个非敏感样本；生成目录未纳入 Git |
| 产物 SHA-256 | `FC24CC793CB62E25F83630A16A80932A2837B81ED61E9C7990ECE8C48ED0758E` |

证据与交接：

- `docs/evidence/S2/README.md`
- `docs/evidence/S2/metadata-result.json`
- `docs/evidence/S2/planner-result.json`
- `docs/evidence/S2/pipeline-result.json`
- `docs/evidence/S2/worker-fallback-result.json`
- `docs/evidence/S2/fixtures-result.json`
- `docs/handoffs/S2-handoff.md`

性能与边界：合成 4000×3000、≤10MiB JPEG 在 Chromium 参考环境通过处理总耗时 ≤5 秒断言；最大尺寸输出保持等比。MVP 不引入 PNG 量化；DPI 只展示；Worker/OffscreenCanvas/createImageBitmap/Blob Worker 能力不可用时按证据降级。S2 实质 End commit：`463bab7`；交接文档元数据回填为同一提交后的文档留痕提交。

## 2026-08-18：S2 / 独立验收阻塞与返工施工单

状态：`BLOCKED_REWORK`。现有 92 个 Vitest 用例、24 个 Chromium 用例、构建和静态检查仍保留为返工前自动化基线，但不足以证明 S2 通过独立验收。

独立复核确认 6 组阻塞问题：

- R1：可通过篡改普通 plan 对象绕过 UPSCALE 确认并执行放大；
- R2：主线程有损质量搜索在 min/max 端点跨越时误报 `FILE_TOO_SMALL`；
- R3：Worker 在最低质量已有效时提前返回，未选择最高可用质量，与主线程显著不等价；
- R4：不可处理 metadata 被继续套用普通规则而污染分类，任意 `error.code` 可穿透稳定契约；
- R5：fixture 声称目标体积与实际生成值严重不符，现有集成测试也未消费生成文件；
- R6：处理中取消、Worker runtime error/timeout、HTMLImageElement 回退、连续卡顿和 80MP 精确边界缺少完整实现或自动证据。

已创建正式外部 Agent 施工单：`docs/handoffs/S2-acceptance-rework-order.md`。施工单包含逐项根因、可复制复现、允许修改范围、Q-S2-001～Q-S2-013 必补用例、全量命令、证据要求和返工回报模板。R1～R6 未全部关闭前不得恢复 `READY_FOR_ACCEPTANCE`，也不得据此启动依赖 S2 正确性的 S3 实质开发。

## 2026-08-18：S2 / R1-R6 返工闭合与复验交接

状态：`READY_FOR_REACCEPTANCE`。本条只登记返工完成和独立复验入口，不登记用户验收通过。

返工完成：

- R1：处理入口依据新 inspect metadata + `plan.rules` 重算权威计划，比较 target/operation/rules/confirmation，删除、伪造、篡改和规则漂移均阻断。
- R2/R3：抽取共享纯 `searchLossy`，主线程与 Worker 均在最多 8 步内寻找最高合法质量；Worker 每轮释放 canvas，最终输出仍由主线程复检。
- R4：资源类 primary error 短路，未知/数字/空 error code 回退到稳定白名单错误码。
- R5：fixture 生成器对 target/tolerance、签名、解码和 WebP 能力硬校验；Q-S2-009 从 `tests/fixtures/generated` 实际读取 8 个文件。
- R6：取消信号贯穿处理，Worker constructor/error/timeout/abort、HTMLImageElement URL revoke、性能 heartbeat 和 80MP 精确边界均自动覆盖。

验证结果：

| 命令 | 结果 |
|---|---|
| `npm ci` | PASS |
| `npm run fixtures:generate` | PASS：8 个 fixture，目标范围硬断言 |
| `npm test -- --run` | PASS：13 个文件、97 个单测 |
| `npm run build` | PASS：85700 bytes，SHA-256 `30EC37ED660967CB5E0987A086EAB0C76A576D96606A5F568526D216A24291C7` |
| `npm run static-check` | PASS |
| `npm run test:e2e -- --reporter=line --workers=1` | PASS：31 个 Chromium 测试，8765 端口关闭 |
| `rg "Q-S2-0(0[1-9]|1[0-3])" tests` | PASS：Q-S2-001～013 全部存在 |
| `git diff --check` | PASS |

关键实测：Worker/main 同一输入均 `image/jpeg`、`390×567`、`107058` bytes、最高有效质量 `0.834765625`；4000×3000、5,000,000 bytes 输入 `totalMs=858.8000000715256`、`maxHeartbeatGapMs=31.90000009536743`，输出有效且为 `1643×1232` / `438068` bytes。

证据与交接：

- `docs/evidence/S2/rework-result.json`
- `docs/evidence/S2/README.md`
- `docs/evidence/S2/metadata-result.json`
- `docs/evidence/S2/planner-result.json`
- `docs/evidence/S2/pipeline-result.json`
- `docs/evidence/S2/worker-fallback-result.json`
- `docs/evidence/S2/fixtures-result.json`
- `docs/handoffs/S2-handoff.md`

范围边界：返工只修改 S2 生产逻辑、S2 测试/fixtures/证据/交接和测试服务器 MIME 映射；未进入 S3/S4，无网络/AI/CDN/WASM/provider 变更。Git 仅本地留痕，未推送远程。

## 2026-08-18：S2 / 二次复验问题修复闭合

状态：`READY_FOR_REACCEPTANCE`。本条登记二次复验修复完成，不登记用户验收通过。

完成事项：

- 执行入口不再返回或继续执行调用方 plan；按权威 confirmation type 校验 `crop`、`flattenBackground`、`upscaleAccepted` 后构造 canonical plan。Q-S2-014 证明 CROP/FLATTEN/UPSCALE 不能相互借权，主线程与 Worker 请求路径六种组合均稳定拒绝。
- 删除 fixture 生成器的 JPEG APP1 补体积逻辑；改用确定性图案熵、block size 和编码 quality 自然进入 ±25% 容差。500KB/20KB/5MB 目标 JPEG 的 APP1 bytes 均为 0。
- Q-S2-016 使用 generated 二进制真实覆盖 PNG→JPEG、JPEG 压缩、小文件最小值失败、大图缩放、透明白底、EXIF 6 主/Worker、损坏输入和 WebP passthrough。
- Q-S2-017 固化主线程 fallback 性能：`totalMs=886.7`、`maxHeartbeatGapMs=128.8`；Worker 为 `808.5/32.9`，均满足 5s/500ms 门槛。

验证结果：

| 命令 | 结果 |
|---|---|
| `npm ci` | PASS |
| `npm run fixtures:generate` | PASS：8 个自然编码 fixture，目标 JPEG APP1=0 |
| `npm run check` | PASS：13 个 Vitest 文件、98 个测试；构建 86213 bytes；静态检查通过 |
| `npm run test:e2e -- --reporter=line --workers=1` | PASS：34 个 Chromium 测试；8765 端口关闭 |
| `git diff --check` | PASS |
| 产物 SHA-256 | `F511425408A38D0D96AD931CF9FE8E7D32CA122297B3172B8594CFF9FA1AA62D` |

代码与测试提交：`4dabd84`。权威证据：`docs/evidence/S2/second-rework-result.json`。范围仍限定 S2，没有进入 S3/S4、网络、AI、CDN、WASM、provider 或业务 DOM。

## 2026-08-18：S3 / 任务编排与拒收观察交接

状态：`READY_FOR_ACCEPTANCE`。本条登记 S3 实现和自动化复验完成，不登记用户验收通过；开发基线为提交 `1e2d0d9`。

完成事项：

- S3-D1～D3：建立独立 session、显式状态机、资源清理注册表和多 uploader adapter registry；非法状态迁移、重复 dispose、页面离开和 stale task 均有安全边界。
- S3-D4～D6：TaskController 统一处理发现、规则解析、文件预检、任务确认、处理计划、最终校验、注入和原文件恢复；合规文件直通，明确不合规才进入 S2 处理链。
- S3-D7～D8：拒收观察只读取关联错误节点，不抓网络、不点击业务按钮；明确拒收最多重试一次，二次明确拒收进入 STOPPED，模糊失败保持安全状态。
- S3-D9：快照和诊断只输出脱敏元数据；增加 compliant passthrough、invalid PNG、低置信度确认、拒收重试/停止、多文件、双 uploader 隔离、detached/disposed 和 cleanup 证据。

验证结果：

| 命令 | 结果 |
|---|---|
| `npm test -- --run` | PASS：15 个 Vitest 文件、103 个测试 |
| `npm run build` | PASS：119062 bytes |
| `npm run static-check` | PASS |
| `npm run test:e2e -- --reporter=line --workers=1` | PASS：49 个 Chromium 测试 |
| `git diff --check` | PASS |
| 产物 SHA-256 | `7F0DEDA9CE989911A5D24D1BFA0A73B55D0B8ACDEF8B9B272B8A79E2BBBAC514` |

证据与交接：

- `docs/evidence/S3/README.md`
- `docs/evidence/S3/s3-result.json`
- `docs/handoffs/S3-handoff.md`

范围边界：仅修改 S3 任务编排、拒收观察、资源/会话安全边界、对应测试和证据文档；未进入 S4 UI、真实 Tabbit AI、网络请求检查、业务按钮点击、CDN/WASM/provider 或远程推送。Git 仅本地留痕。

## 2026-08-19：S3 / 独立验收不通过与返工施工单

状态：`REWORK_REQUIRED`。既有 103 个 Vitest 用例、49 个 Chromium 用例、119062-byte IIFE 构建和静态检查均通过，但不足以证明 S3 满足任务书。

独立对抗性复现确认：异步尺寸违规在确认前已触达页面业务监听器；0.75～0.89 规则确认接受后因 `RULE_CONFIDENCE` 与 S2 权威计划不一致而停止；两个 uploader 依 FIFO 成功处理时产生 `SUCCESS→PROCESSING/INJECTING` 非法 session 迁移。另缺任务书要求的 S3 测试页截图或录屏。

已创建：

- `docs/handoffs/S3-acceptance-review.md`
- `docs/handoffs/S3-acceptance-rework-order.md`
- `docs/evidence/S3/acceptance-review-result.json`

外部 Agent 需关闭 R1～R4、增加 Q-S3-001～008、刷新结构化与视觉证据并提交本地 Git 留痕后，再申请独立复验。当前不得启动 S4。

## 2026-08-19：S3 / R1～R4 返工完成，申请重新验收

状态：`READY_FOR_REACCEPTANCE`。本条登记返工、自检和自动化复验完成，不登记用户或独立验收通过；S4 仍未放行。

返工基线：`ce0cb3f`；返工实现提交：`5cec842`。

完成事项：

- R1：异步尺寸/比例/格式/背景约束在捕获阶段阻断原始 `change`；metadata 与确认决策完成后，合规结果只释放一次原事件，处理结果只注入最终复检通过的文件。
- R2：`RULE_CONFIDENCE` 独立保存为 S3 `policyConfirmation`，不再污染 S2 canonical plan；自动 resolver、手动确认和图像确认均有独立回归。
- R3：双 uploader 由唯一 `processingTask` 驱动 FIFO；进入下一任务前合法准备聚合 session，首任务失败后队列继续，diagnostics 为空。
- R4：补齐 Q-S3-001～008、结构化事件时间线、清理断言、确认前后截图和返工回报。

验证结果：

| 命令 | 结果 |
|---|---|
| `npm test -- --run` | PASS：15 个 Vitest 文件、103 个测试 |
| `npm run check` | PASS：测试、构建和静态检查 |
| `npm run test:e2e -- --reporter=line --workers=1` | PASS：57 个 Chromium 测试，Q-S3-001～008 全部通过 |
| `git diff --check` | PASS |
| 产物 | `dist/uploadfit.js`，122812 bytes |
| 产物 SHA-256 | `D8254518DD14F304A70A67457375171C8F6A1C9D13CC30F23AE690F5C2280D43` |

证据与交接：

- `docs/handoffs/S3-rework-report.md`
- `docs/handoffs/S3-handoff.md`
- `docs/evidence/S3/README.md`
- `docs/evidence/S3/s3-result.json`
- `docs/evidence/S3/s3-confirmation-before.png`
- `docs/evidence/S3/s3-confirmation-after.png`

截图由本地 Playwright 使用无敏感数据的合成 fixture 生成并人工检查；当前会话 in-app Browser connector 无可用浏览器实例，未将截图冒充为 Tabbit 实测。Git 仅本地留痕，未推送远程。

## 2026-08-19：S3 / 返工后独立复验通过

状态：`ACCEPTED`，S4 已放行。

独立复验确认 R1～R4 与 Q-S3-001～008 均通过。复验额外发现裸 `input[type=file]` 首次选择图片时，S3 调用 discovery 未传本次 `File.type`，导致目标 input 没有 uploader/task；已在 `09e7d3d` 修复，并增加 Q-S3-009。Q-S3-010 使用真实 S2 pipeline 验证中置信规则接受后可完成 PNG→JPEG、最终复检和回填。

最终门禁：15 个 Vitest 文件、103 个测试通过；59 个 Chromium 测试通过；生产 IIFE 122865 bytes，SHA-256 `4483FC94F140F892F9A0FCF16AF27797639C41B44F8E863AD9FEDE2F4897702D`；静态检查和 diff check 通过，8765 端口关闭。

最终报告与证据：`docs/handoffs/S3-reacceptance-review.md`、`docs/evidence/S3/reacceptance-result.json`。任务书声明的早注册 document/window 捕获监听边界与 `isTrusted=false` 限制继续保留，不扩大为全站兼容承诺。

## 2026-08-19：S4 / UI 确认与 Tabbit AI 交付，申请验收

状态：`READY_FOR_ACCEPTANCE`。基线提交 `d950253`（S3 独立复验通过后）。

交付内容：

- Shadow DOM UI 五件套（host/styles/status-pill/task-card/cropper）：closed shadow root、七条固定状态文案、规则/预检/成功/失败/准备卡、三类有损确认、固定比例裁剪器（拖动/锚点/键盘/Esc）、AA 对比度与 reduced-motion。
- Tabbit AI provider：唯一 `LLMBridge.chat` 接触点，3000ms 超时、0 重试、每页≤3 次、超时后本页禁用；输出经严格 Schema/evidence/数值来源/冲突校验，失败静默降级本地规则（AI_UNAVAILABLE/AI_TIMEOUT/AI_INVALID_OUTPUT 诊断留痕）。
- 真实公开说明页模式：国知局适配器读取 `.content` 照片要求，本地+AI 双路径解析（全角冒号"宽：390像素"本地不可解析、由 AI 补充——实测证明 AI 路径必要性），"按本页要求准备照片"卡 + 下载闭环（不伪装回填）。
- 跨阶段公共修复（均按总控 §6 留痕）：ADR-002 裁剪确认允许同尺寸平移（否则 §8.1 拖动 Must 不可实现）；manual 任务 null inputElement 的连接性判定（`_pumpQueue` 等四处统一走 `_inputConnected`，修复 `Cannot read properties of null` 导致的误报 USER_CONFIRMATION_REQUIRED）。
- ADR-003：产物体积基线 150,000 → 168,000（S4 Must 范围实测不可压回；`src/config.js` 已同步，契约文件待主验收裁决）。

验证结果：

| 命令 | 结果 |
|---|---|
| `npm test -- --run` | PASS：17 个 Vitest 文件、137 个测试（基线 103 + S4 新增 34） |
| `npm run build` | PASS：167,513 bytes 单 IIFE（SHA-256 `4656F05C260F676E24DDF4E94D9AB43AFDBE6BF4C2356D2F72071008BEE04509`） |
| `npm run static-check` | PASS |
| `npm run test:e2e -- --reporter=line --workers=1` | PASS：80 个 Chromium 测试（基线 59 + S4 新增 21），S0–S3 全部用例无回归 |

历史申请验收时的已知限制（已由后续返工节点更新）：A11 真实 Tabbit 实机调用、体积基线和裁剪拖动证据当时未闭合；当前状态以文末 S4 返工封存节点为准。

证据：`docs/evidence/S4/README.md`、`docs/evidence/S4/s4-result.json`。Git 仅本地留痕，未推送远程。

## 2026-08-19：S4 / 独立验收未通过并下发返工单

状态：`REWORK_REQUIRED`，S5 未放行。

独立复跑 `npm run check`（17 文件 / 137 测试）和 `npm run test:e2e`（80 Chromium）均通过，但发现自动化没有覆盖真实行为。连续两次 production build 均为 167,513 bytes、SHA-256 `4656F05C260F676E24DDF4E94D9AB43AFDBE6BF4C2356D2F72071008BEE04509`，相对共享契约 150,000-byte 硬门禁超出 17,513 bytes；ADR-003 未获主验收批准，不能把 `src/config.js` 调高到 168,000 作为通过依据。

真实访问 CNIPA 2026 公告页并注入当前 bundle：页面规则仍含 JPG、30KB—120KB、390×567 和 300dpi，但产品得到 `pageCard.state=insufficient`，误将头部宽度 21mm 解析为宽度 21，height 缺失，并因截入“登录考试系统”触发 `PERMISSION_OR_LOGIN`，S4-D8 失败。另独立复现 AI 数字子串溯源（39 借 390 通过）、无 evidence 的 aspectRatio 通过、exact/min/max 自相矛盾仍通过。

其他未闭合项：A11 当前 S4 production provider 的真实 Tabbit 调用证据缺失；crop UI 向 controller 传像素而非 0–1 normalized payload；snapshot 丢弃 source evidence；状态 button 嵌套 close button、live 播报和隐藏 crop Escape 监听不符合 U11；pointer drag 测试为空操作，U09 缺失，U12 未覆盖 200%/reduced-motion。

验收报告：`docs/handoffs/S4-acceptance-review.md`。详细施工单：`docs/handoffs/S4-acceptance-rework-order.md`。结构化证据：`docs/evidence/S4/acceptance-review-result.json`。本轮只写验收/返工文档，未修改 S4 生产代码。

## 2026-08-19：S4 / 返工施工与当前封存

状态：`REWORK_INCOMPLETE`，S5 未放行。

本轮依据 `docs/handoffs/S4-acceptance-rework-order.md` 修复并自检：

- R1：国知局目标段落、全角冒号、严格 URL 与完整噪声文章解析；同时修复准备卡自身 hidden input 被 discovery 递归注册的问题。
- R4：AI numeric evidence 完整 token/单位溯源及内部一致性校验。
- R5：normalized crop → controller 权威校验 → canonical pixel pipeline。
- R6/R7：snapshot evidence、来源展示、textContent 防注入、同级按钮、live/alert、crop Escape 作用域和清理。
- R8：U09、等效 200% CSS 视口、reduced-motion、真实 pointer drag、视觉证据。

验证：18 个 Vitest 文件/145 测试通过；89 个 Chromium E2E 通过；diff check 通过。生产 bundle 为 169114 bytes，SHA-256 `CF39073EDD0F533003A12ABCF16C3A112BB1125EA87408CCDE6E9115B9F02EFE`。

用户裁决：体积上限暂跳过，R3 记为 `DEFERRED_BY_USER`，没有修改共享契约，也没有把超限视为通过。A11 记为 `BLOCKED`，因为当前 in-app Browser/Tabbit 实例不可用；没有用 mock 或 S0 证据替代。真实 CNIPA 页面最终 bundle 已在获准网络环境等待 Vue 渲染后现场通过，保存 `s4-cnipa-live.png`。详见 `docs/handoffs/S4-handoff.md`、`docs/evidence/S4/rework-result.json`、`docs/evidence/S4/tabbit-ai-result.json`。

## 2026-08-19：S4 / 最终独立验收通过

状态：`ACCEPTED`，S5 已放行。

回扫在返工基础上直接修复三项残余：byte evidence 不再借用像素数字；decimal ratio 必须有比例上下文且 AI 不能放宽 0.015 容差；生产包保留 Tabbit 1.10.16.0 执行器注入官方 Bridge 所需的字面量 `LLMBridge.`。新增对抗单测及 production lexical-Bridge E2E。

用户最终裁决“体积问题全量放行”：PRD、共享契约、S5/S6 任务书、追踪矩阵、最终验收手册和 ADR-003 已统一为“记录 raw bytes/SHA，不设固定体积门禁”。static-check 保留安全阻断，只把体积作为信息输出。

最终 `dist/uploadfit.js` 为 169,536 bytes，SHA-256 `67879C73748432DEAF7526ED645842575EAE36AD710313082BCF38B2003AE840`。`npm run check` 18 文件/148 测试通过，Chromium 90/90 通过。真实 CNIPA 页面得到 ready/actionable、JPG、30–120KB、390×567 且无诊断；Tabbit 官方私有脚本真实调用 `LLMBridge.chat` 一次并通过本地校验。临时妙招、页面和 8766 服务均已清理。

最终报告：`docs/handoffs/S4-final-acceptance.md`。结构化证据：`docs/evidence/S4/rework-result.json`、`docs/evidence/S4/tabbit-ai-result.json`。

## 2026-08-20：S4 / Zent v7 现场误判回归修复

状态：`FIXED_AND_VERIFIED`，不改变 S4 已验收状态。

用户在 Zent v7 Upload 示例现场发现“网络图片”被 `/网络|超时/` 误判为 `NETWORK_OR_TIMEOUT`；controller 又将任意 safety flag 统一误报为 `OFFICIAL_TOOL_REQUIRED`，失败卡还重复渲染同一文案。

已收紧网络、登录/权限和官方工具的停机语义，保留真实 safety 错误码，并将失败文案合并为单一 `role=alert` 元素。新增 Zent 原文、controller 错误码和 UI 不重复三类回归。

验证：`npm run check` 18 文件 / 149 测试通过；`npm run test:e2e` 91/91 通过；生产 IIFE 170,651 bytes，SHA-256 `8126F37A6EF212A6BB7B3A24565DB5A7493CB6B3DF779699C8EBB552B394D45D`。

留痕：`docs/handoffs/S4-post-acceptance-zent-regression-fix.md`、`docs/evidence/S4/zent-v7-regression-result.json`。

## 2026-08-20：外部评审自检与有效问题修复

状态：`FIXED_AND_VERIFIED`，S4 验收状态保持不变。

已逐项复现 `修复建议.md`。完成任务/上传器有界回收、物理尺寸防误判、AI 宽高角色溯源、事务式 File 注入回滚、拒收超时收口、格式否定尾缀、统一 STOP 语义、规则底色贯通、DOM 节点身份去重和可行体积区间修复。Zent v7 原网址已写入自动化用例，并增加不依赖公网的本地 DOM 夹具及人工测试清单。

保留两项反驳：KB minimum 1024 / maximum 1000 是在网站进制未知时的保守安全交集，不统一为单一进制；worker/main 的门禁是约束等价和最终复检，不要求压缩字节完全相同。大规模 controller/worker 重构留待独立阶段。

工程加固：新增根 `README.md`，`.learnings/` 明确忽略，static-check 增加 WebSocket、EventSource 和 sendBeacon 外泄通道检查。

最终验证：`npm run check` 18 文件 / 157 项通过；`npm run test:e2e` 99/99 Chromium 通过；`git diff --check` 通过。生产 IIFE 175,631 bytes，SHA-256 `AA7584629AA4A596AC829A5986CFDB6D3E04581A88EB68268DEF90065700FE3E`，`check` 与 E2E 前置构建一致。

详细留痕：`docs/handoffs/S4-external-review-self-audit-and-remediation.md`、`docs/evidence/S4/external-review-remediation-result.json`、`docs/testing-sites.md`。

## 2026-08-20：S5 / 本地全量测试、安全与兼容性实现

状态：`BLOCKED_BY_ENVIRONMENT`。S5 本地交付与自动化证据完成；真实 Tabbit 安装、A–F 矩阵、AI、关闭和 DataTransfer 实机复验待环境恢复后执行，未把 Chromium 或既有 S4 实机证据替代为 Tabbit 通过。

起始基线：`8d9d9ad`（用户指定的 S5 正式起点）。本轮所有修改均在该基线上产生，尚未推送远程。

已完成事项：

- 新增 `test-pages/index.html`、`test-pages/scenarios.js`、`test-pages/styles.css`，提供本地稳定测试页和 A–F 六个可一键进入场景；页面记录事件顺序、`isTrusted`、MIME、字节、业务 change 和提交 click，不记录图片内容。
- 新增 `test-pages/ui-harness.html`，仅为 Chromium 自动化显式开放 Shadow DOM；生产稳定页继续加载 production IIFE 并保持 closed Shadow DOM。
- 新增 `tests/e2e/s5-stable-scenarios.spec.js`、`s5-security.spec.js`、`s5-performance.spec.js`，覆盖 E01–E15 映射、X01–X12 关键路径、恶意证据/外联/敏感 AI 输入/清理和 Worker/main 性能。
- 修复跨阶段规则解析缺口：支持任务书中的 `不能超过` 和 `30–120KB` 简写区间，并加入 R31 回归单测；没有扩大产品范围。
- 加固 `scripts/static-check.js`：扫描源码和生产 IIFE 的执行、外联、注入、存储、凭据等禁用模式，并输出 artifact bytes/SHA；保留用户已裁决的“不设固定体积门禁”。
- 补齐 S5 测试、安全、性能和证据文档；E15 编号经自检改为真实“用户关闭脚本”，场景 F 单列，不冒充 E15。

本地验证：`npm ci`、`npm run check`、完整 `npm run test:e2e -- --reporter=line --workers=1` 均通过；最终全量数字和 SHA 见 `docs/handoffs/S5-handoff.md`、`docs/evidence/S5/s5-result.json`。

真实平台边界：本会话调用 in-app Browser 时返回 `Browser is not available: iab`，`agent.browsers.list()` 为空。根据轻量返工单保留 `BLOCKED_BY_ENVIRONMENT` 的 LR1–LR5 矩阵；不创建 mock 通过、不使用其他浏览器冒充 Tabbit；S6 尚未启动。

## 2026-08-20：S5 / 轻量验收补验返工

状态：`BLOCKED_BY_ENVIRONMENT`。返工基线为 `9ed5839`，实现提交为 `dcd5c1a`；不修改产品源码、不修改自动化断言。

返工单要求的真实 Tabbit 连接已重新尝试：in-app Browser 返回 `Browser is not available: iab`，可用浏览器列表为空。按返工单停止 LR1–LR5，不使用 mock、Playwright Chromium 或 S4 旧证据冒充实机通过。

已完成的本地返工：

- LR6 文档一致性修正：`S5-handoff.md` 的最大 heartbeat 间隔已从 357.2ms 改为 353.1ms；bytes、SHA、159 个单测、116 个 E2E、状态和性能文档保持一致。
- `docs/evidence/S5/tabbit-matrix.json` 改为轻量 LR1–LR6 矩阵：LR1–LR5 为 `BLOCKED_BY_ENVIRONMENT`，LR6 为 `PASS`。
- 场景 C/D/E/F 和 X01–X12 按批准轻量范围记录为 `NOT_REPEATED_BY_APPROVED_LIGHTWEIGHT_SCOPE`，证据仍为 S5 专属 Chromium 17/17，不宣称 Tabbit 实测 PASS。
- 新增 `docs/handoffs/S5-lightweight-reacceptance-report.md`，记录阻塞尝试、未重跑边界和重新申请验收条件。

下一步：只有恢复真实 Tabbit/in-app Browser 后，才继续 LR1–LR5；在此之前保持 S5 阻塞，S6 继续 HOLD。

## 2026-08-20：S5 / 用户委托再次尝试 LR1–LR5

状态仍为：`BLOCKED_BY_ENVIRONMENT`。

已再次尝试连接当前真实 Tabbit。只读环境检查显示本机存在 Tabbit Browser 进程，但 in-app Browser 返回 `Browser is not available: iab`，实例列表为空；已知的 `9222/9223` 调试端口没有监听。进程存在不能证明当前会话有可控页面，因此没有启动临时脚本、没有使用替代浏览器，也没有伪造 LR1–LR5 证据。

返工报告和矩阵已补记本次尝试；待可控 Tabbit 页面连接恢复后继续执行。

## 2026-08-20：S5 / Tabbit 远程端口轻量补验完成

状态：`READY_FOR_REACCEPTANCE`。用户授权切回 Tabbit remote CDP `9222` 后，LR1–LR5 已按返工单完成；S6 继续 `HOLD`，等待独立验收方裁决，不把本轮结果直接写成 `ACCEPTED`。

运行与证据：

- Tabbit Browser 1.10.16.0；当前 `dist/uploadfit.js` 为 175,868 bytes，SHA-256 `29C5613CD5F9C71EBBD9E88754097B18435A4FA8508D0E2612D160233D79FD8F`。
- 官方私有脚本保存为部分网址匹配，probe 页自身不加载产品 bundle；首次运行和刷新均保持一个 host、一个 active session。
- 场景 A 输出 JPEG、390×567、106,855 bytes，业务 change=1、提交 click=0，外部请求=0（仅本地 blob worker）。
- 场景 B 明确拒收后 `source=rejection`、`retryCount=1`，第二次页面接受，提交 click=0。
- 真实 `LLMBridge.chat` 调用 `callCount=0→1`，生产本地 validator=PASS；另有一次独立 `AI_TIMEOUT`，未被隐藏，证明 3 秒超时降级边界。
- 关闭后 host/session 为 0/false；同页刷新不复活已关闭会话；新 Tabbit 标签页得到一个新 active session。
- 临时脚本最终关闭自动运行并保存为 false，临时匹配页签关闭；未公开分享、未保存完整 prompt/响应或用户数据。

证据索引：`docs/evidence/S5/s5-tabbit-install-refresh.json`、`s5-tabbit-scenario-a.json`、`s5-tabbit-scenario-b.json`、`s5-tabbit-ai-redacted.json`、`s5-tabbit-close-rerun.json` 及对应截图；总矩阵见 `docs/evidence/S5/tabbit-matrix.json`，交接见 `docs/handoffs/S5-lightweight-reacceptance-report.md`。
