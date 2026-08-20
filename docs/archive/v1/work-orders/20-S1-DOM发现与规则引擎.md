# 20 S1：DOM发现与规则引擎

## 1. 阶段使命

把网页上传区域和相关说明转换为可信的结构化 `RuleSet`。本阶段只读 DOM、解析和裁决规则，不读图片像素、不处理文件、不回填、不调用 AI。

S1 与 S2 可并行，但必须以 S0 已通过核心闸门和共享契约未变为前提。

## 2. 前置条件

- S0 状态为 `READY_FOR_ACCEPTANCE`，且 `docs/tabbit-capabilities.md` 已确认基础 DOM/脚本生命周期。
- `npm ci`、现有单测和构建为绿色。
- 已阅读共享契约的 `UploaderContext`、`ContextBundle`、`RuleCandidate`、`RuleSet`。

## 3. 文件范围

- `src/dom/input-discovery.js`。
- `src/dom/context-extractor.js`。
- `src/dom/spa-observer.js`。
- `src/rules/schema.js`、`normalizer.js`、`deterministic-parser.js`、`resolver.js`、`validators.js`。
- `src/adapters/generic.js`。
- `src/utils/text.js`。
- `tests/unit/input-discovery.test.js`。
- `tests/unit/context-extractor.test.js`。
- `tests/unit/rule-parser.test.js`。
- `tests/unit/rule-resolver.test.js`。
- `docs/handoffs/S1-handoff.md`、`docs/evidence/S1/*`。

`src/dom/rejection-observer.js` 属于 S3；本阶段只提供可复用的纯文本解析/分类能力。

## 4. 交付物

| ID | 交付物 | 通过标准 |
|---|---|---|
| S1-D1 | 上传器发现 | 普通、动态、open shadow 输入框可发现且不重复 |
| S1-D2 | 上下文提取 | 只取允许范围，6000字符封顶，敏感/无关内容排除 |
| S1-D3 | 确定性解析器 | 格式、大小、宽高、比例、单文件和语义提示 |
| S1-D4 | 规则归一化 | MIME、扩展名、全角字符、单位与比例统一 |
| S1-D5 | 来源合并 | 固定优先级、证据、置信度、冲突显式化 |
| S1-D6 | 安全分类 | 建议不当强制；模糊/网络/官方工具语义不执行 |
| S1-D7 | 测试 | 至少 30 条中文变体及 DOM 边界测试全部通过 |

## 5. 上传器发现

### 5.1 识别条件

以 `input[type="file"]` 为候选，满足任一条件才标记为图片上传器：

- `accept` 含 `image/*`。
- `accept` 含 `.jpg/.jpeg/.png/.webp` 或对应 MIME。
- 关联文本含图片、照片、证件照、头像、封面、扫描件。
- 后续用户选择的文件 MIME 为 `image/*`；该条件由 S3 在事件时补充，S1 暴露升级上下文的方法。

`multiple=true` 仍可发现，但上下文必须标记 multiple；一次多文件由 S3 停止处理。

### 5.2 动态 DOM

- 初始只扫描一次。
- MutationObserver 只扫描新增节点/受影响子树，不在每次 mutation 重扫 body。
- 已注册 input 用 `WeakSet`。
- 提供订阅式回调给 bootstrap/core，不直接开始业务任务。
- SPA 路由变化做去抖重新扫描；不得改写 history 方法，优先监听平台可用事件和 DOM 变化。
- cleanup 后 observer 必须 disconnect。

### 5.3 Shadow DOM 与 iframe

- 递归扫描已经存在的 open shadow roots。
- 通过 `composedPath()` 允许后续发现事件路径中的 open shadow input。
- closed shadow root 明确返回不支持，不尝试突破。
- 同源 iframe 为 Should：可安全访问时扫描；跨域访问异常必须捕获并只报告受保护区域。

## 6. 上下文提取

围绕单个 input，按以下顺序收集并去重：

1. `accept`、`multiple`、`required`、`aria-label`、`aria-describedby`、`title`。
2. `label[for]` 和 input 所在 label。
3. 最多向上四层祖先容器的可见文本。
4. 前后相邻的说明节点。
5. input 附近错误节点。
6. `role=alert`、`aria-live` 的当前提示。
7. 用户运行脚本前主动选中的文字。
8. 页面标题和无查询参数的页面定位信息仅供适配器，不并入 AI 文本。

过滤：

- `script`、`style`、`noscript`、导航、页脚版权、隐藏元素和重复文本。
- 密码/验证码字段及其值、其他 input/textarea/select 的值。
- Cookie、Token 样式字符串、URL 查询参数。
- 与上传任务无关键词且无数字/单位的远距离正文。

字符预算：

- 确定性解析总文本 ≤6000。
- 提供 `selectAiRelevantText(bundle)`，只保留含数字、单位、格式、尺寸、错误语义的句子并去重，输出 ≤2000；S1 不调用 AI。
- 使用稳定顺序裁剪，便于测试复现。

## 7. 规则解析

### 7.1 归一化

- Unicode NFKC；全角数字、冒号、乘号、ＫＢ/ＭＢ 转半角。
- 统一大小写、连续空白、破折号、`×/*/x` 和 `：/:`。
- JPG/JPEG → `image/jpeg` + `jpg/jpeg`；PNG → `image/png`；WebP → `image/webp`。
- 原证据保留，归一化字符串仅用于匹配。
- 不从文件扩展名推断网页强制规则。

### 7.2 支持规则

- 最大、最小、区间文件字节。
- 允许格式。
- 精确宽高、最小宽高、最大宽高。
- 明确比例。
- 单文件数量。
- DPI、背景、近期、免冠、不得拉伸、官方工具等只作为展示语义。

### 7.3 强制与建议

“必须、仅、只、不得、不能、至少、最多、不超过、不低于”等为强制证据；“建议、推荐、最好、尽量”不得升级为强制。

“图片不要太大、标准证件照、适当压缩、尺寸合适、上传失败、文件不合法”等不能单独产生可执行规则。

含“系统繁忙、网络、超时、权限、登录、审核不通过、官方工具”等停止语义时，即使同句出现数字，也必须产生冲突/人工检查标记，不能自动执行。

### 7.4 来源与冲突

- 严格使用共享契约的来源优先级。
- 高优先级覆盖低优先级时仍记录 conflict，UI以后要能展示。
- 同优先级两个不同 exact/max/min 值不得选“最后一个”，应 `actionable=false`。
- exact 与 min/max 同时存在时 exact 优先，但若 exact 本身违反 min/max，视为不可解冲突。
- `minBytes > maxBytes`、宽高范围反转、比例与精确尺寸明显不一致均不执行。
- 合并后的 confidence 不得简单取平均掩盖低可信冲突。

## 8. 规则测试基线

至少实现下列 30 条；可增加，不得删减。

| ID | 输入 | 预期核心结果 |
|---|---|---|
| R01 | 不超过100KB | maxBytes=100000 |
| R02 | 大于30KB | minBytes=30720 |
| R03 | 30KB—120KB | min=30720,max=120000 |
| R04 | 仅支持JPG/JPEG | jpeg |
| R05 | 支持jpg、png格式 | jpeg,png |
| R06 | 390×567像素 | exact 390×567 |
| R07 | 宽390像素，高567像素 | exact 390×567 |
| R08 | 不低于295×413 | min 295×413 |
| R09 | 比例3:4 | ratio=0.75 |
| R10 | 图片不要太大 | 无可执行规则 |
| R11 | 上传失败 | 无可执行规则 |
| R12 | 系统繁忙，图片最大100KB | max 可提取但 actionable=false |
| R13 | 建议小于2MB | advisory，不作为 max 强制 |
| R14 | 必须小于2MB | maxBytes=2000000 |
| R15 | 100ＫＢ（全角） | 正确归一化 |
| R16 | 最多1M | maxBytes=1000000 |
| R17 | 宽度≤1920，高度≤1080 | max 1920×1080 |
| R18 | 300dpi | 只展示 DPI |
| R19 | 蓝底免冠 | 只展示语义 |
| R20 | 必须用官方工具处理 | OFFICIAL_TOOL_REQUIRED，不执行 |
| R21 | JPEG，大小不得高于1.5MB | jpeg,max=1500000 |
| R22 | 至少50KB，最多2MB | min=51200,max=2000000 |
| R23 | 宽高比4：3 | ratio=4/3 |
| R24 | 宽300至600，高400至800像素 | width/height min+max |
| R25 | 只可上传一张PNG图片 | png,count.max=1 |
| R26 | JPG或WebP，≤500 KB | jpeg,webp,max=500000 |
| R27 | 建议JPG，必须小于1MB | format advisory；max 强制 |
| R28 | 最大100KB；最大200KB | conflict，actionable=false |
| R29 | 不低于800×600且不超过1920×1080 | min/max尺寸 |
| R30 | 文件名须含姓名和身份证号 | 只展示命名语义，不读取字段值 |

另加 DOM/安全用例：

- accept 属性优先于低优先级附近文字。
- 明确拒收候选可覆盖 accept，但保留冲突。
- 隐藏导航中的“2MB”不能被收集。
- script/style 中伪造规则不能被解析。
- 其他表单的姓名、身份证号、密码值不出现在 ContextBundle。
- 6000/2000 字符预算稳定截断。
- 两个 uploader 的上下文不串线。
- 动态节点只注册一次，cleanup 后不再回调。

## 9. 阶段退出标准

- `discoverUploaders`、`extractRelevantContext`、`parseRulesDeterministically`、`resolveRules` 符合共享契约。
- 30 条规则基线与 DOM/安全测试 100% 通过。
- 明确规则样例得到：

```text
JPG｜30–120KB｜390×567｜confidence ≥ 0.90｜actionable=true
```

- “上传失败/系统繁忙/文件不合法”不触发可执行规则。
- 来源、证据和冲突可回溯，规则结果与 DOM 遍历顺序无关。
- 没有 AI、image、UI、controller 依赖。
- 构建和全部既有测试保持绿色。
- `docs/handoffs/S1-handoff.md` 含测试命令、覆盖数量和代表性输出。

## 10. 禁止事项

- 不读取完整 body 文本或序列化 DOM。
- 不读取其他表单字段的值。
- 不为提高演示成功率把建议变成必须。
- 不让 AI 参与本阶段或返回假 AI 候选。
- 不在解析器中触发文件处理、UI 或 DOM 写操作。
- 不对 closed shadow/cross-origin iframe 做绕过。
