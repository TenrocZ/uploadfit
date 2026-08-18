# S1 DOM 发现与规则引擎交接

- 交接日期：2026-08-18
- 工程目录：`C:\Users\蔡天乐\Desktop\黑客松\main`
- 对应任务书：`20-S1-DOM发现与规则引擎.md`
- Status：`READY_FOR_ACCEPTANCE`
- 核心门禁：`PASS`
- Start commit：`3d132ad`（S1 启动登记）
- End commit（实质实现范围）：待 Git 提交后回填
- Agent：`Codex / UploadFit S1 Agent`
- Environment：Windows；Node `v22.20.0`；npm `10.9.3`；Playwright Chromium；Tabbit Browser `1.9.22.0`（S1 未依赖 AI）
- Build artifact：`dist/uploadfit.js`，31929 bytes，SHA-256 `7E3E73B9C0E64FA9FA5B7CDF33C1A99AF173E330882DE611F9152BAB726D7161`

## 1. 阶段结论

S1 已完成上传器发现、上下文提取、确定性规则解析、归一化、来源合并和安全分类。结果符合共享契约的 `UploaderContext`、`ContextBundle`、`RuleCandidate`、`RuleSet` 形态，并通过 R01–R30、DOM 边界和既有回归测试。

本阶段只读 DOM 和文本。没有读取图片像素、处理 File、回填 input、触发上传、调用 AI、创建 UI/controller 或实现 S3 的 `src/dom/rejection-observer.js`。

## 2. D1–D7 交付结果

| 交付物 | 状态 | 实现/证据 |
|---|---|---|
| S1-D1 上传器发现 | PASS | `src/dom/input-discovery.js`、`src/dom/spa-observer.js`；普通/动态/open Shadow DOM、同源 iframe、composedPath、去重、cleanup 和受保护 iframe 边界 |
| S1-D2 上下文提取 | PASS | `src/dom/context-extractor.js`、`src/utils/text.js`；允许来源、敏感过滤、6000/2000 字符预算、uploader 隔离 |
| S1-D3 确定性解析 | PASS | `src/rules/deterministic-parser.js`；大小、格式、尺寸、比例、数量和语义 |
| S1-D4 规则归一化 | PASS | `src/rules/normalizer.js`；NFKC、全角单位/标点、MIME/扩展名、比例/单位 |
| S1-D5 来源合并 | PASS | `src/rules/resolver.js`；固定优先级、来源证据、冲突可回溯、最低 confidence |
| S1-D6 安全分类 | PASS | advisory 不强制；网络/系统繁忙/官方工具等产生 safety conflict；不可解冲突 `actionable=false` |
| S1-D7 测试 | PASS | 30 条规则、DOM/安全边界、全量单测/E2E/build/static-check |

## 3. 关键行为

### 上传器发现

- 只将 `input[type=file]` 且具备 image accept 或图片关联文本的控件标为图片上传器；`multiple` 保留在上下文中。
- 初始扫描一次；MutationObserver 只扫描新增节点/子树；WeakSet 防止同一 input 重复回调。
- open Shadow DOM 递归扫描；动态新增的 host 子树同样递归；closed Shadow DOM 不尝试突破。
- 同源 iframe 可递归扫描；跨域/不可访问 iframe 捕获异常并报告 `CROSS_ORIGIN_OR_UNAVAILABLE`。
- SPA 只监听 `popstate`/`hashchange` 并去抖，不 monkey-patch history；cleanup 会断开观察器和监听。

### 上下文与规则

- 上下文按允许来源稳定收集，排除隐藏、导航/页脚、脚本/样式、其他表单值和敏感值；总文本 ≤6000 字符。
- `selectAiRelevantText()` 仅提供 ≤2000 字符的规则相关文本，S1 不调用 AI。
- R01–R30 全部通过；JPG/JPEG 归一化为 `image/jpeg` 与 `jpg/jpeg`，全角输入通过 NFKC 归一化。
- 建议/推荐保持 `advisoryOnly`；文件名语义仅展示；模糊文案不产生执行规则。
- 来源优先级为 `700/600/500/400/300/200/100`；高优先级覆盖低优先级但记录 conflict；同优先级 exact/min/max 不选择“最后一个”。
- exact 与兼容范围合并时 exact 保留；违反范围、范围反转、比例与精确尺寸矛盾、网络/系统繁忙/官方工具停止语义均不可执行。

## 4. 自动验证

| 命令 | 结果 |
|---|---|
| `npm ci` | PASS |
| `npm test -- --run` | PASS：8 个测试文件、60 个单测 |
| `npm run build` | PASS：31929 bytes；单文件生产 IIFE |
| `npm run static-check` | PASS |
| `npm run check` | PASS |
| `npm run test:e2e -- --reporter=line --workers=1` | PASS：14 个浏览器测试；测试服务退出后 8765 端口关闭 |

代表性结果：

```text
JPG｜30–120KB｜390×567｜confidence=0.90｜actionable=true
```

证据文件：

- `docs/evidence/S1/input-discovery-result.json`
- `docs/evidence/S1/context-and-rules-result.json`
- `docs/evidence/S1/README.md`

## 5. 安全与范围边界

- `src` 未引入 AI、网络请求、图片像素读取、File 处理、UI/controller 或业务上传调用。
- `src/dom/rejection-observer.js` 未创建；拒收观察和任务编排留给 S3。
- closed Shadow DOM、跨域 iframe、密码/验证码和其他表单控件值不绕过、不读取。
- 本交接不保存真实照片、完整文件名、Base64、Cookie、Token 或完整页面文本。

End commit 将在实质实现提交完成后回填；Git 只做本地版本留痕，未推送远程。
