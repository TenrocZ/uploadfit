# S1 验收整改单

- 验收日期：2026-08-18
- 验收范围：S1 DOM 发现、上下文提取、确定性规则解析、规则归一化、来源裁决与安全分类
- 返工前验收基线：`780af95`（S1 交接元数据）；实质实现提交 `b9ab7ef`
- 当前结论：`READY_FOR_REVIEW`
- 核心门禁：返工后门禁 `PASS`，等待用户复验
- 施工对象：本轮返工 Agent

## 1. 返工前基线已通过项

- Git 工作区在质检开始时干净，S1 交付文件和交接材料齐全。
- `npm run check` 通过：8 个测试文件、60 个测试通过；生产构建和静态检查通过。
- `npm run test:e2e -- --reporter=line --workers=1` 通过：14 个浏览器测试通过。
- `dist/uploadfit.js` 为 31929 bytes，SHA-256 为 `7E3E73B9C0E64FA9FA5B7CDF33C1A99AF173E330882DE611F9152BAB726D7161`。
- R01–R30 现有基线用例全部通过。
- S1 没有调用 AI、读取图片像素、处理 File 内容、回填上传框或触发网页业务操作。

以下 R1–R8 问题曾由代码审查和独立定向探针确认；返工后均已补成自动测试并复验，原问题清单保留用于审计追踪。

## 2. 必须整改

### S1-R1：修复多上传框上下文和错误节点串线

#### 已确认问题

`src/dom/context-extractor.js` 会把最多四层祖先的整个可见子树加入当前上传框上下文；`getAlertTexts()` 和 `src/adapters/generic.js` 也会查询共享祖先下的全部错误节点。

当两个上传框位于同一个 `form` 时，独立探针稳定得到：

```text
context A contains B's “最大500KB” = true
context B contains A's “最大100KB” = true
```

这违反 S1 “两个 uploader 的上下文不串线”要求，并可能造成同优先级冲突或把其他上传框的限制错误用于当前文件。

#### 修改要求

- 为每个 input 确定最近的上传器局部容器；向上读取祖先时不得无条件读取包含其他 file input 的完整祖先子树。
- 若候选祖先包含其他上传器，应排除其他上传器所在分支，只保留当前 input 分支和可证明为共享说明的节点。
- 错误节点优先按 `aria-describedby`、当前局部容器和 DOM 距离关联；不能把共享 form 下全部 `.error/[role=alert]` 分配给每个 uploader。
- `genericAdapter.findErrorNodes()` 必须使用与 ContextBundle 一致的隔离策略，不能保留第二套宽松逻辑。
- 不得通过读取完整 `body`、序列化 DOM 或读取其他表单值解决关联问题。

#### 必补测试

- `Q-S1-001`：同一 form 下两个 uploader 分别为 100KB/500KB，双方 ContextBundle 均不包含对方规则。
- `Q-S1-002`：同一 form 下两个错误节点分别关联两个 uploader，不串线。
- `Q-S1-003`：确属共享说明的格式规则可以稳定进入两个上下文，并提供明确关联证据。

### S1-R2：让 6000 字符确定性解析预算真实生效

#### 已确认问题

`extractRelevantContext()` 只限制 `normalizedText`，但返回的 `nearbyTexts`、`alertTexts` 和 `selectedText` 未受同一总预算约束。`parseRulesDeterministically()` 又优先解析这些原始字段，而不是受限的 `normalizedText`。

独立探针传入约 10000 字符的 nearby text 后，候选 evidence 长度为 10012，证明确定性解析绕过了 6000 字符上限。

#### 修改要求

- 对 ContextBundle 的可解析文本建立单一、稳定、可测试的 6000 字符总预算。
- 属性、label、described-by、祖先、相邻说明、alert 和 selected text 的裁剪顺序必须固定。
- `parseRulesDeterministically()` 只能读取经过预算处理的来源文本；不能在已有 `normalizedText` 被截断后继续解析未截断数组。
- 仍需保留 `rejection/selected-text/nearby-text` 来源类型；不得为了限长把所有来源降成一个不可追踪字符串。
- `selectAiRelevantText()` 继续保持 2000 字符上限，且不得从未受限字段重新取文本。

#### 必补测试

- `Q-S1-004`：nearby、alert、selected 分别输入 20000 字符，实际进入解析器的总字符数不超过 6000。
- `Q-S1-005`：裁剪顺序稳定，重复执行结果完全一致。
- `Q-S1-006`：AI 摘要不超过 2000，且不包含被 6000 预算排除的尾部文本。

### S1-R3：补齐 RuleCandidate 和 RuleSet 的运行时校验

#### 已确认问题

`validateRuleCandidate()` 当前主要校验字节、宽高和宽高比值，没有完整校验格式、扩展名、数量、DPI、背景、语义数组、evidence 元素和 safety flags。

独立探针结果：

```text
candidate.rules.count.max = -5
validateRuleCandidate(...).valid = true
resolveRules(...).actionable = true
```

这违反共享契约“边界输入必须运行时校验”和“数字有限、为正、在防护范围内”的要求，也会污染后续 adapter、rejection 和 AI 候选接入。

#### 修改要求

- `formats` 只允许 `image/jpeg`、`image/png`、`image/webp`；必须是无重复字符串数组。
- `extensions` 只允许 `jpg/jpeg/png/webp`，并校验 formats/extensions 自洽。
- `count.max` 必须是有限正整数；缺失时为 null，非法值不得进入可执行 RuleSet。
- DPI、aspect ratio value/tolerance 必须是有限正数并设置合理上限。
- background、semanticRequirements、evidence、safetyFlags 必须校验类型、长度和允许值；未知或畸形字段不得静默进入执行结果。
- 对非法候选保留脱敏冲突摘要，最终 `actionable=false`。
- `validateRuleSet()` 必须独立复核最终结果，不能假定候选校验永远正确。

#### 必补测试

- `Q-S1-007`：负数、0、Infinity、NaN、字符串型 count 均无效。
- `Q-S1-008`：未知 MIME、扩展名不一致、非数组 formats/extensions 均无效。
- `Q-S1-009`：非法 tolerance、DPI、background、evidence/safetyFlags 均形成不可执行冲突。
- `Q-S1-010`：畸形候选顺序变化不影响最终 RuleSet。

### S1-R4：补齐裸 file input 的 image MIME 升级入口

#### 已确认问题

任务书要求无 image accept/关联文本的裸 file input 在后续选择 `image/*` 文件时可由 S3 升级上下文。当前 `registerInput()` 始终调用 `isImageUploader()`；`discoverFromEvent()` 也无法注册裸 input，且没有其他公开升级 API。

#### 修改要求

- 暴露一个供 S3 调用的最小升级方法，或为 discovery lifecycle 增加明确的 MIME 升级参数。
- 只根据调用方传入的真实 `File.type`/已验证 MIME 判断 `image/*`；本阶段不得读取文件内容或像素。
- 升级后复用该 input 的稳定 uploaderId/上下文，同一 input 只触发一次 `onDiscover`。
- 非 image MIME、空 MIME、detached input 和 cleanup 后调用都必须安全拒绝。
- 不得把所有裸 file input 在初始扫描时直接当成图片上传器。

#### 必补测试

- `Q-S1-011`：裸 input 初始不发现，传入 image MIME 后只升级一次。
- `Q-S1-012`：PDF/空 MIME 不升级。
- `Q-S1-013`：cleanup 后升级不回调；detached input 不进入活跃集合。

### S1-R5：修复文件名和否定格式语义误判

#### 已确认问题

独立探针稳定复现：

```text
“示例文件名 avatar.jpg” -> formats=[image/jpeg], actionable=true
“不支持PNG，只支持JPG” -> formats=[image/jpeg,image/png], actionable=true
```

前者违反“不从文件名推断网页强制规则”，后者把明确拒绝的 PNG 重新作为允许格式。

#### 修改要求

- 格式规则必须有允许/要求语境，例如“支持、允许、仅、只、格式为、请使用”；不能只因出现扩展名就生成强制规则。
- 文件名、示例文件、URL、下载链接和对话示例中的扩展名不得转成网页强制格式。
- 识别“不支持/禁止/不能使用/拒绝”等否定语境；被否定格式不得进入允许 formats。
- 若一句话只有否定格式而没有明确允许格式，安全结果应为不可执行或仅保留证据，不能猜测替代格式。
- “JPG 或 PNG”“仅支持 JPG/JPEG”等正向现有基线必须保持通过。

#### 必补测试

- `Q-S1-014`：示例文件名、路径和 URL 中的 `.jpg/.png` 不生成格式规则。
- `Q-S1-015`：`不支持PNG，只支持JPG` 只得到 JPEG。
- `Q-S1-016`：`禁止WebP` 不生成推测性的 JPEG/PNG。
- `Q-S1-017`：R04、R05、R21、R25、R26、R27 保持通过。

### S1-R6：补齐动态 open Shadow Root 和真实同源 iframe 生命周期

#### 已确认问题

独立浏览器探针结果：

```text
host 先插入、随后 attachShadow 并加入 input -> 未发现
iframe 插入、随后 srcdoc load 完成 -> 未发现
```

当前 MutationObserver 只处理 light DOM addedNodes。iframe 初次扫描可能观察的是导航前的 about:blank document，加载后的新 document 没有重新注册。现有证据声称浏览器测试覆盖同源 iframe，但测试代码只模拟了受保护 iframe 异常，没有真实同源 iframe 用例。

#### 修改要求

- 对动态 iframe 注册受控 `load` 监听；每次同源 document 可访问时重新扫描并观察新 document。
- iframe load listener 必须去重，并在 cleanup 中移除。
- 已存在和动态加载的 `srcdoc`/同源 iframe 均应发现 input；跨域异常继续只报告保护边界。
- 对 host 插入后才创建的 open shadow root，采用安全的事件路径补发现方案，或提供其他不 monkey-patch 浏览器原型的可清理机制。
- 不允许 patch `Element.prototype.attachShadow`，也不允许无界轮询整页。
- 若平台客观无法在交互前发现延迟创建的 shadow root，必须通过 `composedPath()` 在首次相关事件时注册，并在证据中准确写明边界。

#### 必补测试

- `Q-S1-018`：真实 `iframe.srcdoc` 在 discovery 启动前已加载，可以发现。
- `Q-S1-019`：discovery 启动后插入并加载的真实同源 iframe，可以发现且只回调一次。
- `Q-S1-020`：iframe 导航/重新加载后不保留旧 observer，不重复回调。
- `Q-S1-021`：host 插入后才 attach open shadow root，首次相关 composed event 可补发现。
- `Q-S1-022`：cleanup 后 iframe load、shadow event 都不再回调。

### S1-R7：补齐尺寸分隔符并保留原始证据

#### 已确认问题

- 任务书要求归一化 `×/*/x`，当前 `390*567像素` 无法解析。
- parser 把归一化后的 clause 直接写入 evidence；全角符号、大小写和原始标点丢失，不符合“原证据保留，归一化字符串仅用于匹配”。

#### 修改要求

- 支持 ASCII `*` 尺寸分隔符；如支持 `/`，必须依赖尺寸语境，不能破坏 `比例3/4`。
- 将“安全脱敏后的原始显示文本”和“用于匹配的 normalized 文本”分离。
- candidate evidence 保存脱敏后的原始文本；匹配过程使用 normalized 副本。
- evidence 仍须受字符预算和敏感信息过滤，不得为了保留原文泄露 Token、URL 查询参数或表单值。

#### 必补测试

- `Q-S1-023`：`390*567`、`390×567`、`390x567` 得到相同尺寸。
- `Q-S1-024`：尺寸 `/` 与比例 `/` 不混淆。
- `Q-S1-025`：全角原文在 evidence 中保持可核对形式，规则值正确归一化。
- `Q-S1-026`：原文中的 Token/URL 参数仍被脱敏或移除。

### S1-R8：修正测试证据和交接结论

- 在全部整改完成前，将 `docs/handoffs/S1-handoff.md` 状态改为 `BLOCKED` 或保留明确的待复验状态，不得继续声明已通过所有 S1 边界。
- 修正 `docs/evidence/S1/README.md`、`input-discovery-result.json`、`context-and-rules-result.json` 中对同源 iframe、上下文隔离和预算的过度声明。
- 新证据只记录结构化结果和脱敏摘要，不保存完整页面文本、文件名、Token、Cookie 或文件内容。
- 返工后更新实际测试文件数、用例数、产物 bytes、SHA-256、Start/End commit 和环境。
- 证据不得把“实现了代码路径”表述为“真实浏览器测试已覆盖”。

## 3. 复验门槛

整改完成后必须同时满足：

1. S1-R1 至 S1-R8 全部关闭，Q-S1-001 至 Q-S1-026 有自动测试或明确、可复查的等价覆盖；
2. `npm ci` 成功；
3. `npm test -- --run` 全部通过；
4. `npm run build` 成功，`dist/uploadfit.js` 为单个 minified IIFE、无 ESM import/export 且不超过 150000 bytes；
5. `npm run static-check` 成功；
6. `npm run test:e2e -- --reporter=line --workers=1` 全部通过，测试服务正常退出；
7. R01–R30 和所有 S0 回归保持绿色；
8. 多 uploader、6000/2000 预算、非法候选、裸 input 升级、否定格式、动态 iframe/shadow 边界全部有浏览器或纯函数证据；
9. `docs/handoffs/S1-handoff.md` 更新为真实提交信息和真实证据后，再申请复验；
10. Git 工作区只包含本轮必要改动，不覆盖用户或其他阶段的无关修改。

## 4. 施工边界

- 本整改单只处理 S1；不要进入 S2 图像处理、S3 controller/rejection observer、S4 UI 或 Tabbit AI。
- 不改变 S0 的 `injectFile`、`restoreOriginal`、injection guard、日志安全和平台能力结论。
- 不读取 File 内容、图片像素、网络请求、其他表单值或完整 body 文本。
- 不 patch `fetch`、`XMLHttpRequest`、history 或 DOM 原型，不绕过 closed shadow/cross-origin iframe。
- 不通过放宽规则、吞掉冲突或删除既有测试让门禁变绿。
- 如确需修改共享契约，必须先新增 ADR 并同步所有调用方、测试、追踪矩阵和任务书；未经确认不得擅自改变安全语义。

## 5. 外部 Agent 返工回报格式

返工完成后，请在回复中提供：

1. S1-R1 至 S1-R8 的逐项处理结果；
2. 修改文件清单和关键设计说明；
3. 新增测试与 Q-S1 编号映射；
4. `npm ci`、单测、build、static-check、E2E 的完整摘要；
5. 新产物 bytes 和 SHA-256；
6. 未关闭限制或阻塞项；
7. 实质实现 End commit；
8. 更新后的 `docs/handoffs/S1-handoff.md` 和 `docs/evidence/S1/*`。

未满足复验门槛时，不要把状态改回 `READY_FOR_ACCEPTANCE`。

## 6. 返工复验记录（2026-08-18）

返工已按 R1–R8 完成，以下结论仅表示本地自动复验通过，不替代用户最终验收：

| 整改项 | 处理结果 | 自动覆盖 |
|---|---|---|
| R1 上下文/错误节点隔离 | 已关闭；祖先文本按局部 uploader scope 过滤，错误节点与 generic adapter 共用关联逻辑，明确共享说明可复用 | Q-S1-001～003，`tests/integration/context-extractor.test.js` |
| R2 单一文本预算 | 已关闭；source arrays、`normalizedText`、parser 共用 6000 预算，AI 摘要只读预算文本且 ≤2000 | Q-S1-004～006，`tests/unit/rule-parser.test.js`、上下文 E2E |
| R3 运行时校验 | 已关闭；格式/扩展名、数量、DPI、比例、背景、语义、evidence、safety flags、未知字段均校验，非法候选形成脱敏冲突 | Q-S1-007～010，`tests/unit/rule-validator.test.js` |
| R4 裸 input MIME 升级 | 已关闭；`upgradeFromMime(input, mime)` 只接受 caller 提供的 image MIME，detached/非 image/cleanup 拒绝且同一 input 只回调一次 | Q-S1-011～013，`tests/integration/input-discovery.test.js` |
| R5 文件名和否定格式 | 已关闭；示例/文件名/路径/URL不推断格式；不支持/禁止格式不进入允许集合 | Q-S1-014～017，`tests/unit/rule-parser.test.js` |
| R6 Shadow/iframe 生命周期 | 已关闭；延迟 open Shadow root 由首个 composed event 补发现；真实同源 iframe 初始、动态、导航和 cleanup 有浏览器测试 | Q-S1-018～022，`tests/integration/input-discovery.test.js` |
| R7 尺寸与 evidence | 已关闭；`*`/`×`/`x` 等价，比例 `/` 不当尺寸，evidence 保留脱敏原始显示文本 | Q-S1-023～026，`tests/unit/rule-parser.test.js` |
| R8 文档与证据 | 已关闭；本文件、S1 handoff、progress、S1 evidence 已改为返工后真实结果，未把实现路径冒充实测覆盖 | 本地文档审计 |

最终复验结果：

| 项目 | 结果 |
|---|---|
| `npm ci` | PASS |
| `npm run check` | PASS：9 个测试文件、71 个单测；构建 40270 bytes；静态检查通过 |
| `npm run test:e2e -- --reporter=line --workers=1` | PASS：19 个浏览器测试；测试服务退出后 8765 端口关闭 |
| 产物 SHA-256 | `8AC0AEF3342E0512360A8E88E666F0418AC9641FA96902DA4A2884D0E168F4F4` |
| 安全边界 | AI/图片像素/File内容/UI/controller/业务上传均未调用；closed Shadow/cross-origin 不绕过 |

保留限制：host 插入后再创建的 open shadow root 不做原型 patch 或轮询，只在首次相关 composed event 到达时补发现；在事件发生前不声称已发现。Git 仅做本地留痕，未推送远程。返工实质 End commit 待提交后回填。
