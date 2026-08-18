# S1 DOM 发现与规则引擎交接

- 交接日期：2026-08-18
- 工程目录：`C:\Users\蔡天乐\Desktop\黑客松\main`
- 对应任务书：`20-S1-DOM发现与规则引擎.md`
- Status：`READY_FOR_ACCEPTANCE`
- 核心门禁：`PASS`
- Start commit：`3d132ad`（S1 启动登记）
- End commit（第二次复验实质实现）：`4e4d89c`
- Agent：`Codex / UploadFit S1 Agent`
- Environment：Windows；Node `v22.20.0`；npm `10.9.3`；Playwright Chromium；Tabbit Browser `1.9.22.0`（S1 未依赖 AI）
- Build artifact：`dist/uploadfit.js`，40961 bytes，SHA-256 `956E13F9BF8CA887C04488904DCCE12E56735BA6024CBACF86393D21F80C8B2B`

## 1. 阶段结论

S1 已完成独立验收质检提出的 R1–R8 返工，并关闭第二次复验发现的后置格式否定、嵌套规则校验和 source item 语义串染。结果符合共享契约的 `UploaderContext`、`ContextBundle`、`RuleCandidate`、`RuleSet` 形态，并通过 R01–R30、Q-S1-001～031、DOM 边界和既有回归测试。

本阶段只读 DOM 和文本。没有读取图片像素、处理 File、回填 input、触发上传、调用 AI、创建 UI/controller 或实现 S3 的 `src/dom/rejection-observer.js`。

## 2. D1–D7 交付结果

| 交付物 | 状态 | 实现/证据 |
|---|---|---|
| S1-D1 上传器发现 | PASS | `src/dom/input-discovery.js`、`src/dom/spa-observer.js`；普通/动态/open Shadow DOM、composedPath、MIME 升级、真实同源 iframe load/navigate、去重、cleanup 和受保护 iframe 边界 |
| S1-D2 上下文提取 | PASS | `src/dom/context-extractor.js`、`src/utils/text.js`；局部 uploader/error 隔离、共享说明、敏感过滤、单一 6000/2000 字符预算 |
| S1-D3 确定性解析 | PASS | `src/rules/deterministic-parser.js`；大小、格式、尺寸/`*` 分隔符、比例、数量、语义、格式前置/后置否定和逐 source item 解析 |
| S1-D4 规则归一化 | PASS | `src/rules/normalizer.js`；NFKC、全角单位/标点、MIME/规范扩展名全集、比例/单位；evidence 保留安全原文 |
| S1-D5 来源合并 | PASS | `src/rules/resolver.js`；固定优先级、来源证据、非法候选留痕、冲突可回溯、最低 confidence |
| S1-D6 安全分类 | PASS | advisory 不强制；网络/系统繁忙/官方工具等产生 safety conflict；非法/不可解冲突 `actionable=false` |
| S1-D7 测试 | PASS | R01–R30、Q-S1-001～031、DOM/安全边界、全量单测/E2E/build/static-check |

## 3. 关键行为

### 上传器发现

- 只将 `input[type=file]` 且具备 image accept 或图片关联文本的控件标为图片上传器；`multiple` 保留在上下文中。
- 初始扫描一次；MutationObserver 只扫描新增节点/子树；WeakSet 防止同一 input 重复回调。
- open Shadow DOM 递归扫描；动态新增 host 子树通过 composed event 补发现；closed Shadow DOM 不尝试突破。
- 同源 iframe 初始、动态插入、srcdoc load 和导航替换均重新注册观察；跨域/不可访问 iframe 捕获异常并报告 `CROSS_ORIGIN_OR_UNAVAILABLE`。
- 裸 file input 不在初始扫描中发现；S3 通过 `upgradeFromMime(input, mime)` 传入真实/已验证的 `image/*` MIME 后才升级，同一 input 只回调一次。
- SPA 只监听 `popstate`/`hashchange` 并去抖，不 monkey-patch history；cleanup 会移除 iframe load、composed event、观察器和路由监听。

### 上下文与规则

- 上下文按允许来源稳定收集，排除隐藏、导航/页脚、脚本/样式、其他表单值和敏感值；同一 form 下按局部 uploader scope 隔离祖先和错误节点，明确共享说明可稳定复用；总文本 ≤6000 字符。
- source arrays、`normalizedText` 和确定性 parser 使用同一稳定 6000 字符预算；`selectAiRelevantText()` 仅从预算后的文本提供 ≤2000 字符规则相关文本，S1 不调用 AI。
- R01–R30 全部通过；JPG/JPEG 归一化为 `image/jpeg` 与 `jpg/jpeg`，全角输入通过 NFKC 归一化，ASCII `*` 尺寸分隔符与 `×`/`x` 等价。
- 建议/推荐保持 `advisoryOnly`，各 source item 独立分类；文件名语义仅展示；示例文件名、路径和 URL 扩展名不生成格式规则；格式词前后的不支持/禁止表达均不进入允许集合；模糊文案不产生执行规则。
- `validateRuleCandidate()` 与 `validateRuleSet()` 校验格式及完整规范扩展名映射、数量、DPI、比例、背景、语义、evidence、safety flags、顶层及嵌套未知字段；非法候选以脱敏证据形成稳定不可解冲突。
- evidence 保留经过 URL/敏感值脱敏后的原始显示文本；归一化副本只用于匹配，不写回证据。

## 4. 返工用例映射

| 整改项 | 自动覆盖 |
|---|---|
| R1 上下文/错误节点隔离 | Q-S1-001～003：同 form 两 uploader、局部错误、共享说明 |
| R2 单一文本预算 | Q-S1-004～006：nearby/alert/selected 6000 预算、稳定裁剪、AI 2000 摘要 |
| R3 运行时校验 | Q-S1-007～010：非法数值、格式/扩展名、DPI/比例/语义/evidence/safety、顺序无关 |
| R4 裸 input MIME 升级 | Q-S1-011～013：image MIME 单次升级、PDF/空 MIME、detached/cleanup |
| R5 格式语义 | Q-S1-014～017：文件名/路径/URL、否定格式及 R04/R05/R21/R25/R26/R27 |
| R6 生命周期 | Q-S1-018～022：真实 iframe 初始/动态/导航、延迟 Shadow event、cleanup |
| R7 evidence/尺寸 | Q-S1-023～026：`*`/`×`/`x`、比例 `/`、全角原文、Token/URL 脱敏 |
| R8 文档与证据 | 交接、progress、S1 evidence 和本验收复验记录均按返工后真实结果更新 |
| 第二次复验补强 | Q-S1-027～031：格式前置/后置否定、source item 建议隔离、完整 MIME/扩展名映射、嵌套未知字段、JPEG 规范扩展名全集 |

## 5. 自动验证

| 命令 | 结果 |
|---|---|
| `npm ci` | PASS |
| `npm test -- --run` | PASS：9 个测试文件、75 个单测 |
| `npm run build` | PASS：40961 bytes；单文件生产 IIFE |
| `npm run static-check` | PASS |
| `npm run check` | PASS |
| `npm run test:e2e -- --reporter=line --workers=1` | PASS：19 个浏览器测试；测试服务退出后 8765 端口关闭 |

代表性结果：

```text
JPG｜30–120KB｜390×567｜confidence=0.90｜actionable=true
```

证据文件：

- `docs/evidence/S1/input-discovery-result.json`
- `docs/evidence/S1/context-and-rules-result.json`
- `docs/evidence/S1/README.md`
- `docs/handoffs/S1-acceptance-review.md`

## 6. 安全与范围边界

- `src` 未引入 AI、网络请求、图片像素读取、File 处理、UI/controller 或业务上传调用。
- `src/dom/rejection-observer.js` 未创建；拒收观察和任务编排留给 S3。
- closed Shadow DOM、跨域 iframe、密码/验证码和其他表单控件值不绕过、不读取。
- host 插入后再创建的 open shadow root 不做原型 patch 或轮询，只在首次相关 composed event 到达时补发现；在事件发生前不声称已发现。
- 本交接不保存真实照片、完整文件名、Base64、Cookie、Token 或完整页面文本。

`4e4d89c` 是第二次复验的实质代码、测试和构建产物提交；本行回填属于后续文档元数据提交。Git 只做本地版本留痕，未推送远程。
