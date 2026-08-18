# S1 证据目录

本目录记录 S1 DOM 发现、上下文提取和确定性规则引擎的可复查证据。S1 只读 DOM 和文本，不读取图片像素、不处理文件、不回填、不调用 AI。

## 证据规划

- 上传器发现：普通 input、动态节点、重复注册、open Shadow DOM、同源/跨域 iframe 边界。
- 上下文提取：允许来源、隐藏/脚本/样式过滤、敏感字段过滤、6000/2000 字符预算、多个 uploader 不串线。
- 规则解析：R01–R30 中文变体、全角字符和单位归一化、强制/建议分类、冲突与来源优先级。
- 安全边界：不读取其他表单值、不解析 script/style 伪造文本、不访问 closed Shadow DOM、不改写 history、不触发业务副作用。

## 当前状态

- 2026-08-18：S1 启动登记完成。
- 2026-08-18：S1-D1 上传器发现与动态生命周期完成；证据见 `input-discovery-result.json`。
- 证据只保存结构化测试结果和脱敏摘要，不保存完整页面文本、Cookie、Token、文件名或文件内容。

## S1-D1：上传器发现与动态生命周期

- 普通 `input[type=file]` 和 open Shadow DOM 输入可发现；无图片 accept/关联语义的裸 file input 不进入图片上传器集合。
- 重复扫描使用 WeakSet 去重；动态新增子树只扫描新增节点；路由事件使用 `popstate`/`hashchange` 去抖，不改写 history。
- `composedPath()` 可定位 open Shadow DOM 事件中的 file input；同源 iframe 可递归扫描；跨域/受保护 iframe 捕获异常并报告，不绕过访问控制。
- cleanup 会断开 MutationObserver、移除 SPA 监听和清理订阅状态。
- 自动验证：9 个单测、11 个浏览器测试通过；当前 IIFE 14021 bytes。
