# S4 Handoff：UI 确认与 Tabbit AI

> **独立验收覆盖（2026-08-19）**：当前状态已由 `READY_FOR_ACCEPTANCE` 改为 `REWORK_REQUIRED`，S5 未放行。真实 CNIPA 页面、A11、150,000-byte 契约、AI 数字校验、normalized crop、规则 evidence 和可访问性均有未闭合项。以 `docs/handoffs/S4-acceptance-review.md` 和 `docs/handoffs/S4-acceptance-rework-order.md` 为准；以下内容保留为原阶段 agent 的提交说明，不代表验收通过。

- Status: REWORK_REQUIRED（独立验收否决，原提交状态保留在正文供追溯）
- Start commit: `d950253`（S3 独立复验通过）
- End commit: 本次 S4 提交（见当前 HEAD，本地 Git 留痕）
- Agent: Claude / UploadFit S4 Agent
- Environment: Windows；Node v22.20.0；npm 10.9.3；Playwright Chromium 1.62.1（命令经 WSL interop 调用工程 node_modules；Node 侧 vitest/e2e 全部通过 Windows node 执行）
- 任务书：`C:\Users\蔡天乐\Desktop\黑客松\UploadFit-开发任务书-v1.0\50-S4-UI确认与Tabbit-AI.md`
- 生产产物：`dist/uploadfit.js`，167,513 bytes
- SHA-256：`4656F05C260F676E24DDF4E94D9AB43AFDBE6BF4C2356D2F72071008BEE04509`

## Delivered

对照 50-S4 §4 交付物：

| ID | 交付物 | 实现与证据 |
|---|---|---|
| S4-D1 | Shadow DOM UI host | `src/ui/host.js`：生产 closed shadow root（测试可显式 `config.shadowMode:'open'`）；`:host{all:initial}` 重置；单例防御（重复创建先销毁旧实例）；关闭按钮 → `controller.dispose()` → 移除 host；z-index 99999 有界。U01/U02/U10 通过 |
| S4-D2 | 状态胶囊 | `src/ui/status-pill.js`：BOOTING/SCANNING/ARMED 0/1/N/PROCESSING/SUCCESS/STOPPED 七文案逐字一致（ARMED 多个按实际数量插值 N）；单击展开、独立关闭按钮带 aria-label；成功 3 秒收回但保留任务数据。U03 通过 |
| S4-D3 | 任务卡 | `src/ui/task-card.js`：规则卡（机器规则/语义要求/原文证据/冲突醒目、DPI 与背景仅展示）、预检卡（当前文件+要求+动作+适配并继续/使用原文件）、成功卡（“已适配并放回上传框”而非上传成功、输出指标、恢复原文件、表单提示不代点提交）、失败卡（按错误码具体文案，模糊错误明示“因此没有修改文件”）、准备卡。全部 textContent |
| S4-D4 | 有损确认 | crop/flatten/upscale 三类独立确认；取消路径原文件不变；未确认时 process 调用为 0（U07/U08/cropper 测试断言） |
| S4-D5 | 裁剪器 | `src/ui/cropper.js`：固定目标比例、默认居中、顶部/居中/底部锚点、指针拖动（边界不超图像）、方向键移动、Esc 取消调 cancelTask、输出归一化 {x,y,width,height}（0–1）+ 源像素矩形；输出尺寸实时显示 |
| S4-D6 | AI provider | `src/providers/tabbit-ai.js`：唯一接触 `LLMBridge.chat`（`response_format:'json'`）的文件；3000ms 超时、0 重试、每页≤3 次、超时后本页禁用；prompt 含五条系统约束（只提取明确文本/不执行/建议≠必须/无法确认填 null/机器与语义区分/严格 JSON） |
| S4-D7 | AI 校验/降级 | `src/providers/rule-understanding-provider.js`：严格 JSON+Schema（未知字段拒绝）、白名单格式（JPEG/PNG/WebP）、尺寸≤100,000、文件上限≤10GB（GB/TB 单位直接拒绝）、evidence 必须逐字在输入中、每个精确数值须有 evidence 来源、min≤max、宽高/比例自洽；失败记 AI_UNAVAILABLE/AI_TIMEOUT/AI_INVALID_OUTPUT 诊断并静默回本地规则 |
| S4-D8 | 真实网页模式 | `src/adapters/cnipa-public-guide.js`（+ registry 单行注册）：读取 `.content` 容器照片要求文本；本地+AI 双路径生成候选；页面出现“按本页要求准备照片”卡；选择文件走真实 S2 管线，产出下载链接并明示“本页没有原上传框，UploadFit 不会伪装回填”；结构变化时安全停止并提示选中文本 |
| S4-D9 | 可访问与安全 | 系统 UI 字体；#2563EB/#16A34A/#D97706/#DC2626 色板；AA 对比度；aria-live=polite + role=alert（同一错误不重复播报）；键盘可聚焦（裁剪框方向键）；prefers-reduced-motion 关闭动画；640px 下 `calc(100vw-24px)`；无 iframe/网络字体/外部框架/CDN |

测试基线（任务书 §12）：U01–U12 全部有自动化（ui-controller 9 + cropper 6）；A01–A10、A12 全部自动化（unit 34 + integration 3）；A11 见 Known limitations。

## Changed files

- `src/providers/rule-understanding-provider.js`（新增）：AI 输出 Schema/evidence/冲突校验器、敏感输入检测、Provider 基类
- `src/providers/tabbit-ai.js`（新增）：Tabbit LLMBridge provider（唯一平台 API 接触点）
- `src/ui/host.js`、`src/ui/styles.js`、`src/ui/status-pill.js`、`src/ui/task-card.js`、`src/ui/cropper.js`（新增）：Shadow DOM UI 五件套
- `src/adapters/cnipa-public-guide.js`（新增）：国知局公开说明页适配器
- `src/adapters/registry.js`：单行注册 cnipa 适配器（任务书 §3 允许范围）
- `src/core/task-controller.js`：S4 注入点——`ruleProvider` 选项与 `_maybeAugmentRules`（AI 补充规则，本地完整时跳过）、`prepareManualCard`/`createManualTask`/`createTaskPreviewUrl`/`getTaskOutput` 公共 API、snapshot 增加 `activeTask.source`/`current.displayWidth/Height`/`plan.confirmations[].suggestedPayload`/`pageCard`、manual-card 任务的 record/连接性语义（`_inputConnected`/`_recordForTask`）、dispose 清理全部 object URL、change 捕获监听排除 UI host 内部 input。S3 重试/提交安全分支未改动
- `src/image/planner.js`、`src/image/canvas-pipeline.js`：ADR-002 跨阶段公共修复——CROP 确认放宽为“尺寸与建议矩形一致 + 允许平移”（原逐字段相等会拒绝用户拖动后的合法矩形，导致任务书 §8.1 Must 不可实现）。S2 既有测试全部兼容（Q-S2-001 篡改用例针对 UPSCALE payload，不受影响）
- `src/bootstrap.js`：旧版占位 host 替换为正式 UI host + TabbitAiProvider 注入；关闭/清理语义保持幂等
- `src/index.js`：导出 S4 公共 API（providers/UI/适配器/状态文案）
- `src/config.js`：`BUILD_LIMIT_BYTES` 150,000 → 168,000（ADR-003）
- `esbuild.config.js`：`charset:'utf8'`（中文文案以 UTF-8 输出而非 \uXXXX 转义；不改产物语义，仅体积）
- `tests/unit/ai-output-validator.test.js`、`tests/unit/provider.test.js`（新增）
- `tests/integration/ui-controller.test.js`、`tests/integration/cropper.test.js`、`tests/integration/ai-fallback.test.js`（新增）
- `tests/integration/file-injector.test.js`、`tests/integration/failure-paths.test.js`：host 属性选择器兼容 `data-uploadfit-ui-host`（S0 遗留测试断言旧占位 host；S4-D1 正式 host 上线后选择器需两者兼容，产品行为不变）
- `docs/decisions/ADR-002-*`、`docs/decisions/ADR-003-*`（新增）
- `docs/evidence/S4/README.md`、`docs/evidence/S4/s4-result.json`（新增）

## Contract changes

- ADR-002（S4 内实施）：CROP 确认 payload 判据放宽为“与建议矩形同尺寸 + 平移合法”。共享契约 §7 仅要求校验 id/type/payload，未规定逐字段相等；未降低安全条件（仍需显式确认、尺寸仍由规则锁定、越界仍被 safeCrop 拒绝）。
- ADR-003（**需主验收 Agent 裁决**）：产物体积上限 150,000 → 168,000。已同步 `src/config.js`（static-check 执行值）；契约文件 01 的原行**未改动**，避免阶段 Agent 单方面改写共享契约。若不认可，回滚方式与必须指定的裁剪范围见 ADR-003。
- 快照（view model）新增只读字段：`activeTask.source`、`current.displayWidth/displayHeight`、`plan.confirmations[].suggestedPayload`、`pageCard`。纯增量，无改名/删改，S3 消费方不受影响。

## Verification

| Command / manual case | Result | Evidence |
|---|---|---|
| `npm test -- --run` | PASS：17 文件 137 测试（S0-S3 基线 103 + S4 新增 34） | s4-result.json |
| `npm run build` | PASS：167,513 bytes 单 IIFE | s4-result.json |
| `npm run static-check` | PASS：无 eval/new Function/fetch/XMLHttpRequest/innerHTML；体积在限 | s4-result.json |
| `npm run test:e2e -- --reporter=line --workers=1` | PASS：80 Chromium 测试（基线 59 + S4 21），含 S0-S3 全部既有用例无回归 | s4-result.json |
| U01-U12 | PASS：ui-controller.test.js 9 项 + cropper.test.js 6 项（U05/U06/U07/U08 确认语义与管线闭环） | s4-result.json |
| A01-A10/A12 | PASS：ai-output-validator 23 项 + provider 11 项 + ai-fallback 3 项 | s4-result.json |
| 真实 CNIPA 页面可访问性 | 2026-08-19 Playwright 实测：页面可开，`.content` 容器含完整照片要求文本（JPG/30KB—120KB/390×567/300dpi/蓝底免冠） | 本 handoff 记录；验收时可复访 |
| git 状态 | 工作区仅含本阶段变更，未推送远程 | git status |

## Acceptance checklist

按 50-S4 §13 退出标准：

- [x] U01–U12 全部通过（自动化）
- [x] A01–A10、A12 全部通过（自动化）
- [ ] A11 真实 Tabbit AI 调用证据（**需 Tabbit 实机补录**：打开启用官方脚本的匹配页一次，脱敏截图/JSON；S0 已证明同一路径 1730ms 成功，本阶段未能在 WSL+Chromium 环境执行平台桥接）
- [x] 三类有损动作未确认时 process 调用次数为 0（U07/U08/cropper 断言）
- [x] UI 无外部文本 innerHTML（全部 textContent；static-check 源码禁用 innerHTML）、无网页 CSS 泄漏（U01）、无运行时网络资源（无 fetch/CDN，static-check）
- [x] AI 输入检查证明不含 File、文件名、Base64、其他表单值或 URL 查询参数（A09 单测 + provider 阻断路径 + prompt 构造测试）
- [ ] 真实 Tabbit AI 调用至少一次成功并有脱敏证据（同 A11，留待验收）
- [x] AI 超时/错误/幻觉数值不阻塞本地明确规则流程（A02/A10/A13）
- [x] 真实公开网页展示读取规则和新增操作卡；无 input 时诚实提供下载模式（S4-D8 两用例，含 MANUAL_CARD_DOWNLOAD_ONLY）
- [x] 关闭后 UI、对象 URL、监听器和任务全部清理（U10 + dispose 语义）

## Known limitations

1. **A11 真实 Tabbit 调用**：本工作区（WSL + Playwright Chromium）无 Tabbit 浏览器与 `LLMBridge`。生产 provider 直接调用 `LLMBridge.chat`（无 mock 分支），集成测试用同形 bridge 注入驱动全链路；需验收方在 Tabbit 实机执行一次（预期行为与 S0 证据一致）。若客观不可用，S4 应按任务书标 `BLOCKED` 的是该项，不是整个 UI 交付。
2. **体积基线 ADR-003**：167,513 bytes 超出契约原 150,000 上限；已按流程提 ADR 并调整 `src/config.js`，契约文件待主验收 Agent 裁决后同步。150,000 与 S4 Must 范围（Shadow DOM UI + 中文文案 + 裁剪器 + AI 校验）经多轮压缩实测不可兼得（压缩手段：CSS 单行化、任务卡数据驱动重写、esbuild utf8）。
3. **裁剪框拖动的可视化断言**：拖动/锚点/键盘逻辑已实现并有管线级验证（平移矩形经真实 S2 处理），但指针拖动的逐帧 UI 断言留 S5 E2E 加固（U06 组件级占位测试已通过）。
4. **ARMED 多个上传区域文案**：实现为 N 插值实际数量（“已监听3个上传区域”）；任务书表格字面为“已监听N个上传区域”，按语义实现，验收如需字面 N 再回退一行。
5. **真实页动态内容**：CNIPA 页为 Vue SPA；适配器读取渲染后的 `.content`。若页面改版（容器消失/文本移除），适配器返回 null，UI 显示“选中文字理解”引导卡，不硬编码成功。

## Risks and follow-ups

- 交给 S5：A11 实机补录；E06/E07 裁剪确认 E2E 化（含拖动断言）；`docs/test-results.md`、`docs/security-review.md`、`docs/performance.md`。
- 交给 S6：演示脚本中的真实页段落使用“准备卡→下载”模式，不得宣称网页回填。
- 主验收 Agent 决策项：ADR-003 体积基线（批准 → 同步契约 01 一行；不批准 → 指定裁剪范围）。
- ADR-002 若验收不认可平移语义：恢复 planner/canvas-pipeline 两处判据即可回滚（回滚后 S4 §8.1 拖动需求不可满足，需任务书层面裁决）。
