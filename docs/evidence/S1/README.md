# S1 证据目录

本目录记录 S1 DOM 发现、上下文提取和确定性规则引擎的可复查证据。S1 只读 DOM 和文本，不读取图片像素、不处理文件、不回填、不调用 AI。

## 证据规划

- 上传器发现：普通 input、动态节点、重复注册、open Shadow DOM、同源/跨域 iframe 边界。
- 上下文提取：允许来源、隐藏/脚本/样式过滤、敏感字段过滤、6000/2000 字符预算、多个 uploader 不串线。
- 规则解析：R01–R30 中文变体、全角字符和单位归一化、强制/建议分类、冲突与来源优先级。
- 安全边界：不读取其他表单值、不解析 script/style 伪造文本、不访问 closed Shadow DOM、不改写 history、不触发业务副作用。

## 当前状态

- 2026-08-18：S1 启动登记完成。
- 2026-08-18：S1-D1 上传器发现与动态生命周期完成；最终回归证据见 `input-discovery-result.json`。
- 2026-08-18：S1-D2～D6 上下文、确定性规则解析、归一化、来源合并和安全分类完成；汇总证据见 `context-and-rules-result.json`。
- 2026-08-18：独立验收质检提出 R1–R8；返工已完成并通过复验，阶段状态恢复为 `READY_FOR_ACCEPTANCE`；交接见 `docs/handoffs/S1-handoff.md`。
- 证据只保存结构化测试结果和脱敏摘要，不保存完整页面文本、Cookie、Token、文件名或文件内容。

## S1-D1：上传器发现与动态生命周期

- 普通 `input[type=file]` 和 open Shadow DOM 输入可发现；无图片 accept/关联语义的裸 file input 不进入图片上传器集合。
- 重复扫描使用 WeakSet 去重；动态新增子树只扫描新增节点；路由事件使用 `popstate`/`hashchange` 去抖，不改写 history。
- `composedPath()` 可定位 open Shadow DOM 事件中的 file input；延迟创建的 open shadow root 在首次相关 composed event 时补发现；同源 iframe 初始、动态加载和导航替换均有真实浏览器测试。
- 裸 file input 不在初始扫描中发现，只能由调用方传入已验证的 `image/*` MIME 通过 `upgradeFromMime()` 升级；非 image、detached 和 cleanup 后调用均拒绝。
- cleanup 会断开 MutationObserver、移除 SPA 监听和清理订阅状态。
- 返工后回归：9 个单测文件、71 个单测、19 个浏览器测试通过；当前 IIFE 40270 bytes，SHA-256 见 `input-discovery-result.json`。

## S1-D2：上下文提取与文本预算

- `extractRelevantContext(input)` 只围绕单个 input 读取属性、关联 label、最多四层祖先、相邻说明、局部错误节点和当前提示；页面标题/URL不并入 ContextBundle。
- 过滤 script/style/noscript/nav/footer、隐藏节点、其他表单控件及其值；URL、Cookie/Token/密码/验证码样式值脱敏或移除。
- ContextBundle 的 source arrays 与 `normalizedText` 共享稳定的 6000 字符总预算；`selectAiRelevantText()` 只读取预算后的 `normalizedText`，固定上限 2000 字符。S1 不调用 AI。
- 同一 form 下多个 uploader 按局部 uploader scope 隔离祖先文本和错误节点；明确共享说明仍可进入双方上下文。
- DOM 集成测试覆盖两个 uploader 的上下文隔离、隐藏/脚本/样式伪造文本、敏感值和稳定截断。

## S1-D3/D4：确定性解析与归一化

- R01–R30 全部通过；覆盖字节大小、格式、精确/范围宽高、比例、数量、DPI、背景和命名语义。
- Unicode NFKC、全角单位/数字/标点、破折号、乘号、大小写和 MIME/扩展名归一化均由本地规则完成。
- JPG/JPEG 归一化为 `image/jpeg` 与 `jpg/jpeg`；不读取 File、不从文件扩展名生成网页强制规则。
- 建议/推荐只保留 `advisoryOnly`，不参与执行；模糊文案不产生可执行规则；文件名、示例、路径、URL 扩展名不生成格式规则，否定格式不被加入允许集合。
- `RuleCandidate`/`RuleSet` 对格式、扩展名、数量、DPI、比例、背景、语义、evidence 和 safety flags 做运行时校验；非法候选保留脱敏的不可解冲突。

## S1-D5/D6：来源合并、冲突与安全分类

- 来源优先级固定为 `adapter 700 > rejection 600 > html-attribute 500 > nearby-text 400 > selected-text 300 > ai 200 > weak-page-text 100`。
- 高优先级覆盖低优先级时保留可回溯 conflict；同优先级 exact/min/max 冲突、反转范围、精确尺寸与比例矛盾均为不可解冲突。
- `confidence` 采用有效执行候选中的最低值，不用平均数掩盖低可信来源；建议候选不进入执行 confidence。
- 网络、超时、权限、登录、审核不通过、系统繁忙和官方工具语义会留下 `safetyFlags`/人工检查冲突，`actionable=false`。

## S1-D7：自动验证与边界

- 单测：9 个测试文件、71 个用例通过。
- 浏览器集成：19 个测试通过，包含普通/动态/open Shadow DOM、延迟 open Shadow host、裸 input MIME 升级、真实同源 iframe 初始/动态/导航、受保护 iframe、composedPath、cleanup、上下文安全边界和既有 S0 回归。
- 构建：生产 IIFE 40270 bytes，低于 150000 bytes；静态检查通过；测试服务端口 8765 已关闭。
- 代码边界：`src` 不包含 AI 调用、图片像素读取、文件处理、UI/controller、`src/dom/rejection-observer.js` 或跨域/closed Shadow DOM 绕过。

## R1–R8 返工复验

- R1：同 form 多 uploader 的祖先文本、错误节点和 generic adapter 已按局部 scope 隔离；Q-S1-001～003 通过。
- R2：ContextBundle source arrays、确定性 parser 和 AI 摘要均受单一 6000/2000 预算约束；Q-S1-004～006 通过。
- R3：候选和最终 RuleSet 完整运行时校验，非法候选按稳定顺序形成脱敏冲突；Q-S1-007～010 通过。
- R4：`createUploaderDiscovery().upgradeFromMime(input, mime)` 只接受 caller 提供的 image MIME；Q-S1-011～013 通过。
- R5：文件名/路径/URL 示例与否定格式不生成允许规则；Q-S1-014～017 通过。
- R6：真实同源 iframe 生命周期和延迟 open Shadow DOM composed event 已覆盖；Q-S1-018～022 通过。
- R7：支持 `*` 尺寸分隔符，比例 `/` 不混淆，evidence 保留脱敏后的原始显示文本；Q-S1-023～026 通过。
- R8：本 README、结构化 evidence、S1 handoff 和 progress 已按返工后真实结果更新；未把“代码路径实现”写成未覆盖的实测结论。
