# 50 S4：UI确认与 Tabbit AI

## 1. 阶段使命

为 S3 的状态和用户意图提供轻量、可访问、与网页隔离的正式 UI，并接入至少一条真实 Tabbit AI 自然语言规则理解路径。AI 只产出候选规则，UI 只展示/收集意图，二者都没有直接执行图像或网页操作的权限。

## 2. 前置条件

- S3 闭环测试全部通过。
- S0 已记录真实 Tabbit AI 官方调用方式；若仍未知，本阶段先做 UI 与 provider 抽象，但最终状态必须 `BLOCKED`。
- TaskController 已提供 snapshot、subscribe 和用户意图方法。
- 共享契约、错误码和安全不变量无未决变更。

## 3. 文件范围

- `src/ui/host.js`、`styles.js`、`status-pill.js`、`task-card.js`、`cropper.js`。
- `src/providers/rule-understanding-provider.js`、`tabbit-ai.js`。
- 一个真实公开页面专用适配器文件，例如 `src/adapters/cnipa-public-guide.js`。
- `src/adapters/registry.js` 的单行注册改动。
- controller/bootstrap 的 UI/provider 注入接线。
- `tests/unit/ai-output-validator.test.js`、`provider.test.js`。
- `tests/integration/ui-controller.test.js`、`cropper.test.js`、`ai-fallback.test.js`。
- `docs/evidence/S4/*`、`docs/handoffs/S4-handoff.md`。

不得改变 S3 的重试/提交安全条件，不得在 UI 中复制业务决策。

## 4. 交付物

| ID | 交付物 | 通过标准 |
|---|---|---|
| S4-D1 | Shadow DOM UI host | 页面 CSS 不污染，关闭可完整移除 |
| S4-D2 | 状态胶囊 | BOOTING/SCANNING/ARMED/PROCESSING/SUCCESS/STOPPED 文案准确 |
| S4-D3 | 任务卡 | 规则、当前文件、处理计划、成功、失败、恢复/下载 |
| S4-D4 | 有损确认 | crop/flatten/upscale 均需明确确认，取消保持原文件 |
| S4-D5 | 裁剪器 | 固定比例预览、调整、输出矩形、Esc取消 |
| S4-D6 | AI provider | 真实官方 API、3秒超时、0次重试、每页≤3次 |
| S4-D7 | AI校验/降级 | Schema/evidence/冲突校验；失败本地继续 |
| S4-D8 | 真实网页模式 | 公开说明页读取规则并新增可操作准备卡 |
| S4-D9 | 可访问与安全 | 键盘、ARIA、对比度、reduced motion、textContent |

## 5. UI 架构

### 5.1 Host

- 业务页面中只挂一个 host 元素。
- 生产优先 closed Shadow Root；测试构建可以通过显式 config 使用 open。
- UI 自己的 file input 必须排除在 UploadFit uploader discovery 之外。
- 不使用 iframe、网络字体或外部 UI 框架。
- 关闭动作调用 `controller.dispose()`，再移除 host；不得只隐藏。
- z-index 使用有界层级，不用 2147483647。

### 5.2 单向数据流

```text
TaskController snapshot → UI render
UI click/input → controller intent method
```

- UI 不调用 `processImage`、`injectFile` 或规则 resolver。
- 渲染函数接收不可变 view model。
- 所有网页/AI文本用 `textContent`；禁止 `innerHTML` 拼接。
- 事件监听只绑定 Shadow DOM，销毁时全部解除。

## 6. 状态胶囊

固定文案：

| 状态 | 文案 |
|---|---|
| BOOTING | UploadFit启动中 |
| SCANNING | 正在寻找上传区域 |
| ARMED 0个 | 暂未发现上传框，我会继续监听页面变化 |
| ARMED 1个 | 已监听1个上传区域 |
| ARMED 多个 | 已监听N个上传区域 |
| PROCESSING | 正在适配图片 |
| SUCCESS | 图片已适配 |
| STOPPED | 本次未自动处理 |

交互：

- 单击展开当前卡片。
- 独立关闭按钮有可访问名称。
- 成功 3 秒后收回，不清掉恢复能力。
- 卡片宽 320–380px；窄于 640px 时 `calc(100vw - 24px)`。
- 不遮挡网页主按钮；MVP 不必支持拖动。

## 7. 任务卡

### 7.1 规则卡

显示机器规则、另有语义要求、来源和原文证据；冲突必须醒目标出。不得把 DPI/蓝底/免冠显示为已自动解决。

### 7.2 预检卡

显示：

- 当前 MIME、字节、宽高。
- 网页要求。
- 将执行的动作。
- “适配并继续”和“使用原文件”。

高置信且仅安全操作可以自动开始，但必须短暂展示动作；低置信规则必须先确认。

### 7.3 成功卡

- 文案是“已适配并放回上传框”，不是“报名/上传成功”。
- 显示输出 MIME、字节、宽高和操作。
- 提供恢复原文件、查看详情。
- 表单型页面提示使用网页原“保存/下一步/提交”，UploadFit 不点击。

### 7.4 失败卡

按错误码给具体、诚实、可行动的说明。需要时提供下载适配文件、恢复监听、查看规则、关闭。模糊错误必须明确说明“因此没有修改文件”。

## 8. 三类有损确认

### 8.1 裁剪

MVP 必须：

- 固定目标比例。
- 显示原图与裁剪框。
- 鼠标拖动图片或裁剪框，边界不超图像。
- 默认居中；可降级为顶部/居中/底部三锚点，但仍有预览。
- 显示输出尺寸。
- 确认后返回归一化 `{x,y,width,height}`，值在 0–1。
- Esc/取消调用 `cancelTask`，不改 input。
- 不做人脸定位，不拉伸，不静默裁。

### 8.2 透明转白底

- 显示前后预览或至少透明棋盘格与白底预览。
- 明确说明透明像素会变白。
- 用户确认后才把 `flattenBackground="#FFFFFF"` 交给 controller。

### 8.3 低清放大

- 显示原/目标尺寸。
- 文案：“放大只能让像素尺寸达标，不保证清晰度或人工审核通过。”
- 用户确认后才允许 upscale。

每类确认单独记录；不能用一个默认勾选框永久授权未来任务。

## 9. 可访问与视觉基线

- 系统中文字体；主色 `#2563EB`，成功 `#16A34A`，警告 `#D97706`，错误 `#DC2626`。
- 正文/按钮对比度满足 WCAG AA。
- 所有按钮和裁剪关键操作可键盘聚焦。
- 状态变化 `aria-live="polite"`；错误 `role="alert"`，同一错误不重复播报。
- 焦点进入确认卡后有合理顺序；关闭/取消后返回触发处。
- 尊重 `prefers-reduced-motion`。
- 200% 缩放、窄窗口下内容不溢出屏幕。

## 10. Tabbit AI Provider

### 10.1 调用时机

只在以下情况：

- 本地规则不完整。
- 中文自然语言/中文数字/分散表达需要补充。
- 用户选中文字并主动要求理解。
- 真实公开网页演示路径。

不得调用：

- 本地已经得到完整明确规则。
- 无上传器且无相关选中文字/适配页面文本。
- 用户关闭 AI 增强。
- 文本可能含密码/Token/其他表单值。
- 本页超时后或调用次数达到 3。

### 10.2 输入

```json
{
  "task": "extract_image_upload_constraints",
  "locale": "zh-CN",
  "pageType": "exam_registration",
  "text": "电子件要求：JPG格式，文件大小介于30KB到120KB之间，宽390像素，高567像素。不得拉伸。"
}
```

- text 来自 S1 的 ≤2000字符脱敏结果。
- 不含文件字节/Base64、完整文件名、其他字段值、Cookie、URL查询参数。
- provider 不接收 `File` 或 DOM 节点。

### 10.3 Prompt 和输出

系统约束必须包含：只提取明确文本、不执行、不推断、建议≠必须、无法确认填 null、区分机器规则和语义要求、严格 JSON。

输出 Schema：

```json
{
  "formats": ["jpg"],
  "minSize": {"value": 30, "unit": "KB"},
  "maxSize": {"value": 120, "unit": "KB"},
  "width": {"exact": 390, "min": null, "max": null},
  "height": {"exact": 567, "min": null, "max": null},
  "aspectRatio": null,
  "semanticRequirements": ["不得拉伸"],
  "evidence": ["JPG格式", "30KB到120KB", "宽390像素，高567像素"],
  "confidence": 0.97
}
```

### 10.4 校验

代码在加入 resolver 前必须检查：

- 严格 JSON/Schema；未知字段忽略或拒绝，不能执行。
- 数字有限正数；尺寸≤100,000；文件上限≤10GB。
- 格式只映射 JPEG/PNG/WebP 白名单。
- evidence 可在输入中精确或标准化近似匹配。
- 精确数字在 evidence 中有来源。
- min≤max；宽高/比例自洽。
- 高优先级确定性规则不被覆盖。
- timeout=3000ms，重试=0，每页调用≤3。

失败记录 `AI_UNAVAILABLE/AI_TIMEOUT/AI_INVALID_OUTPUT`，静默回本地规则；不弹阻断错误。

## 11. 真实公开网页模式

默认候选是 PRD 指定的国家知识产权局公开说明页。实现和验收时应重新确认页面可访问和文本仍存在；不要登录、不要提交真实报名。

预期流程：

1. 打开公开说明页并运行 UploadFit。
2. adapter 只读取目标文章/用户选中的照片要求。
3. 本地解析与真实 Tabbit AI 至少一条路径生成候选并确定性校验。
4. 页面出现“按本页要求准备照片”卡片。
5. 用户通过 UploadFit 卡片选择非敏感 fixture。
6. 复用 S2 处理；无原网页 input 时提供结果/下载，不伪装回填。

真实页面适配器只补充稳定选择器/目标文本，不硬编码处理成功，也不得远程加载逻辑。页面结构变化时安全停止并提示用户选中文本。

## 12. 测试基线

### UI

| ID | 场景 | 预期 |
|---|---|---|
| U01 | 页面 CSS 强污染 | Shadow UI 仍可读可点 |
| U02 | 重复启动 | 单 host |
| U03 | 状态变化 | 文案与 snapshot 一致 |
| U04 | 规则冲突 | 显示冲突，不显示自动开始 |
| U05 | crop取消/Esc | 原文件不变 |
| U06 | crop确认 | 合法归一化矩形传 controller |
| U07 | flatten取消 | process 不调用 |
| U08 | upscale确认 | warning 保留 |
| U09 | 表单型成功 | 提示用户操作，click=0 |
| U10 | dispose | host/listeners/object URLs 清空 |
| U11 | 键盘/ARIA | 焦点、live/alert、可访问名称通过 |
| U12 | 200%/窄窗口/reduced motion | 不溢出、不强制动画 |

### AI

| ID | 场景 | 预期 |
|---|---|---|
| A01 | 合法 JSON+evidence | 转 RuleCandidate |
| A02 | 非 JSON | AI_INVALID_OUTPUT，本地降级 |
| A03 | 数值无 evidence | 拒绝候选 |
| A04 | min>max | conflict，不执行 |
| A05 | 未知格式 | 拒绝该格式 |
| A06 | 3秒超时 | 取消/忽略结果，无重试 |
| A07 | 第4次调用 | 不调用平台 API |
| A08 | 高优先规则冲突 | AI不覆盖 |
| A09 | 输入含敏感模式 | 阻止调用并诊断 |
| A10 | 官方 API 不可用 | 明确本地模式，基础流程继续 |
| A11 | 真实 Tabbit 调用 | evidence/响应截图和脱敏诊断 |
| A12 | AI 返回指令性文字 | 不执行任何网页/图像动作 |

## 13. 阶段退出标准

- U01–U12、A01–A12 全部通过。
- 三类有损动作未确认时 process 调用次数为 0。
- UI 无外部文本 `innerHTML`，无网页 CSS 泄漏和运行时网络资源。
- AI 输入检查证明不含 File、文件名、Base64、其他表单值或 URL 查询参数。
- 真实 Tabbit AI 调用至少一次成功并有脱敏证据；若平台客观不可用，状态必须 BLOCKED，不用 mock 代替交付要求。
- AI 超时/错误/幻觉数值不阻塞本地明确规则流程。
- 真实公开网页展示读取规则和新增操作卡；无 input 时诚实提供下载模式。
- 关闭后 UI、对象 URL、监听器和任务全部清理。

## 14. 禁止事项

- 不让 AI 直接调用 controller、image、injection 或 DOM 操作。
- 不把 mock provider 当比赛真实 AI 路径。
- 不静默裁剪/扁平化/放大。
- 不显示“上传成功”来代替“文件已适配/已回填”。
- 不把真实公开说明页当真实报名提交页。
- 不从 CDN 加载框架、字体、图标或脚本。
