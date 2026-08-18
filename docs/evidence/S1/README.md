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
- 2026-08-18：S1-D7 全量自动验证完成，阶段状态为 `READY_FOR_ACCEPTANCE`；交接见 `docs/handoffs/S1-handoff.md`。
- 证据只保存结构化测试结果和脱敏摘要，不保存完整页面文本、Cookie、Token、文件名或文件内容。

## S1-D1：上传器发现与动态生命周期

- 普通 `input[type=file]` 和 open Shadow DOM 输入可发现；无图片 accept/关联语义的裸 file input 不进入图片上传器集合。
- 重复扫描使用 WeakSet 去重；动态新增子树只扫描新增节点；路由事件使用 `popstate`/`hashchange` 去抖，不改写 history。
- `composedPath()` 可定位 open Shadow DOM 事件中的 file input；同源 iframe 可递归扫描；跨域/受保护 iframe 捕获异常并报告，不绕过访问控制。
- cleanup 会断开 MutationObserver、移除 SPA 监听和清理订阅状态。
- 最终回归：8 个单测文件、60 个单测、14 个浏览器测试通过；当前 IIFE 31929 bytes，SHA-256 见 `input-discovery-result.json`。

## S1-D2：上下文提取与文本预算

- `extractRelevantContext(input)` 只围绕单个 input 读取属性、关联 label、最多四层祖先、相邻说明、局部错误节点和当前提示；页面标题/URL不并入 ContextBundle。
- 过滤 script/style/noscript/nav/footer、隐藏节点、其他表单控件及其值；URL、Cookie/Token/密码/验证码样式值脱敏或移除。
- `normalizedText` 固定上限 6000 字符；`selectAiRelevantText()` 只筛选规则相关句子并固定上限 2000 字符。S1 不调用 AI。
- DOM 集成测试覆盖两个 uploader 的上下文隔离、隐藏/脚本/样式伪造文本、敏感值和稳定截断。

## S1-D3/D4：确定性解析与归一化

- R01–R30 全部通过；覆盖字节大小、格式、精确/范围宽高、比例、数量、DPI、背景和命名语义。
- Unicode NFKC、全角单位/数字/标点、破折号、乘号、大小写和 MIME/扩展名归一化均由本地规则完成。
- JPG/JPEG 归一化为 `image/jpeg` 与 `jpg/jpeg`；不读取 File、不从文件扩展名生成网页强制规则。
- 建议/推荐只保留 `advisoryOnly`，不参与执行；模糊文案不产生可执行规则。

## S1-D5/D6：来源合并、冲突与安全分类

- 来源优先级固定为 `adapter 700 > rejection 600 > html-attribute 500 > nearby-text 400 > selected-text 300 > ai 200 > weak-page-text 100`。
- 高优先级覆盖低优先级时保留可回溯 conflict；同优先级 exact/min/max 冲突、反转范围、精确尺寸与比例矛盾均为不可解冲突。
- `confidence` 采用有效执行候选中的最低值，不用平均数掩盖低可信来源；建议候选不进入执行 confidence。
- 网络、超时、权限、登录、审核不通过、系统繁忙和官方工具语义会留下 `safetyFlags`/人工检查冲突，`actionable=false`。

## S1-D7：自动验证与边界

- 单测：8 个测试文件、60 个用例通过。
- 浏览器集成：14 个测试通过，包含普通/动态/open Shadow DOM、动态 open Shadow host、同源/受保护 iframe、composedPath、cleanup、上下文安全边界和既有 S0 回归。
- 构建：生产 IIFE 31929 bytes，低于 150000 bytes；静态检查通过；测试服务端口 8765 已关闭。
- 代码边界：`src` 不包含 AI 调用、图片像素读取、文件处理、UI/controller、`src/dom/rejection-observer.js` 或跨域/closed Shadow DOM 绕过。
