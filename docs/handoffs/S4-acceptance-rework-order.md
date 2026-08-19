# S4 返工施工单

- 施工状态：`OPEN`
- 目标：闭合 S4 独立验收发现的 P0/P1 缺口，使 U01–U12、A01–A12 和 S4-D1～D9 可由真实行为及可复现证据证明
- 返工基线：`2161939`
- 验收报告：`docs/handoffs/S4-acceptance-review.md`
- 结构化复现：`docs/evidence/S4/acceptance-review-result.json`
- 完成前不得启动 S5

## 1. 总体施工规则

1. 不得修改 PRD、总控任务书、共享契约或 S4 任务书来让实现“通过”。
2. `dist/uploadfit.js` 硬上限仍是共享契约和最终验收手册规定的 **150,000 bytes**；恢复 `BUILD_LIMIT_BYTES=150_000`，不得再次提高、拆成运行时分片或从网络加载资源。
3. 不得用 mock、S0 历史探针或普通 Chromium 中的同形对象冒充 A11。真实证据必须来自最终返工 bundle 在 Tabbit 官方脚本运行时中的 `LLMBridge.chat()`。
4. 不得把 A11、真实公开页、pointer drag、U09、U11 或 U12 顺延到 S5。
5. 不得削弱 S2 的“有损确认未决时不可执行”、越界裁剪拒绝、最终输出复检，也不得改变 S3 的提交/重试安全条件。
6. 继续保持单个可粘贴执行的纯 JavaScript IIFE；无 ESM、eval/new Function、CDN、远程字体或运行时远程逻辑。
7. 所有网页文本和 AI 文本只能经 `textContent` 进入 UI；日志和证据不得保存文件名、文件内容、Base64、Cookie、Token、其他表单值或完整 AI 原始响应。

## 2. 推荐施工顺序

1. 先完成 R1、R4、R5、R6、R7，并补真实行为测试；
2. 全量回归，确认没有破坏 S0～S3；
3. 完成 R3 体积收敛并固定最终 production bundle；
4. 用最终 bundle 完成 R1 真实公开页复测和 R2 Tabbit A11 取证；
5. 完成 R8 文档/证据校正，提交返工回报后申请复验。

## 3. P0 必修项

### S4-R1：修复真实 CNIPA 页面规则截取和准备卡

**当前复现**

在 `https://ggfw-dlsks.cnipa.gov.cn/home_item_Text_details?nid=6387` 注入当前 production bundle：

- `pageCard.state = "insufficient"`；
- 错误得到 `width.exact=21`，没有 `height.exact`；
- `safetyFlags=["PERMISSION_OR_LOGIN"]`，`actionable=false`；
- 页面真实规则仍是 JPG / 30KB—120KB / 390×567 / 300dpi。

**根因位置**

- `src/adapters/cnipa-public-guide.js` 的 `PHOTO_KEYWORD_PATTERN + WINDOW_BEFORE/WINDOW_AFTER` 固定窗口；
- `src/rules/deterministic-parser.js` 的轴尺寸规则不接受“宽：390像素，高：567像素”；
- 合成测试只提供短段落并注入 mock AI，未覆盖真实文章前后的 21mm 头部宽度和“登录考试系统”。

**施工要求**

1. 适配器必须按稳定结构定位目标文章中的“（2）电子件要求”段落，并按最小必要范围补充紧邻的蓝底/不得严重拉伸语义；不得从文章第一个“照片”开始截取宽泛字符窗口。
2. 排除前一段物理证件照尺寸（48mm×33mm、头宽 21mm—24mm）和后续报名/登录文本，避免将毫米规则误当像素或触发无关安全停止。
3. `matches()` 使用 `new URL()` 后严格校验 hostname，至少限定 CNIPA host 和目标详情路由；不得用 `url.includes(host)` 让 path/query 中的伪 hostname 命中。
4. 为确定性解析增加可复用支持：轴名称后允许中文/英文冒号，例如“宽：390像素，高：567像素”。不要在 adapter 中硬编码 `state=ready`、390、567 或处理成功。
5. 页面结构改变或目标段落缺失时继续安全停止并提示选中文字；不得扩大到整页序列化。
6. 真实页无原 input 时只提供本地处理后下载，继续明确“不伪装回填”。

**必须新增的测试**

- 完整文章 fixture：在目标段落之前放置 48×33mm、21–24mm 和报名文字，之后放置“登录考试系统”；断言只得到 390×567、30–120KB，且没有 `PERMISSION_OR_LOGIN`。
- 全角冒号解析：`宽：390像素，高：567像素` 本地候选可解析。
- URL 匹配：真实 host/path 命中；`https://evil.example/?next=ggfw-dlsks.cnipa.gov.cn` 不命中。
- 真实页面 Playwright 探针：`pageCard.state=ready`、`actionable=true`、width=390、height=567、无不可解冲突；保存脱敏 JSON 和至少一张卡片截图。

**完成标准**

真实公开页使用最终 bundle 在无 mock provider 条件下至少能形成正确本地规则卡；Tabbit AI 成功时可增加 AI 候选，但不得污染或覆盖高优先级确定性规则。

### S4-R2：补齐最终 bundle 的 A11 真实 Tabbit AI 链路

**当前问题**

`docs/handoffs/S4-handoff.md` 和 `docs/evidence/S4/*` 明确 A11 未执行，却把阶段标为 READY。S0 的 `LLMBridge.chat` 探针只证明平台 API 存在，不证明当前 S4 prompt、输入控制、schema/evidence 校验、resolver/controller/UI 路径成立。

**施工要求**

1. 所有代码和体积返工完成后先构建最终 `dist/uploadfit.js`，记录 bytes 和 SHA-256。
2. 通过 Tabbit 官方“脚本/妙招”加载这一份最终 IIFE；范围只匹配无敏感测试页或任务书公开页，不开启全站。
3. 让生产 `TabbitAiProvider` 真实调用一次 `LLMBridge.chat(prompt,{response_format:"json"})`，再经过 `validateAiRuleOutput()` 和 controller/pageCard 路径。
4. 证据只保留：Tabbit 版本、时间、最终 bundle SHA、固定非敏感输入摘要/长度、callCount、耗时、返回类型/字段名、validator 结果、候选来源、页面卡状态；不保存完整 prompt/响应，不保存任何本地文件名或页面表单值。
5. 截图必须能证明是在 Tabbit 官方脚本运行时且当前 provider 路径成功，但对可能出现的账号、脚本 ID、分享链接进行遮挡。
6. 取证完成后删除临时脚本/草稿、关闭临时服务和端口，并在证据中记录清理结果。
7. 若平台客观不可用，S4 状态必须改为 `BLOCKED` 并给出时间、版本、错误形态和重试边界；不得写 READY，也不得用 mock 替代。

**必须交付**

- `docs/evidence/S4/tabbit-ai-result.json`
- `docs/evidence/S4/tabbit-ai-redacted.png`
- S4 handoff 中 A11 和退出标准的真实勾选/阻塞状态

### S4-R3：恢复 150,000 bytes 硬门禁并压缩产物

**当前复现**

- production bundle：167,513 bytes；
- 共享契约硬上限：150,000 bytes；
- 超出：17,513 bytes；
- 连续两次构建 SHA 相同，说明不是时间戳波动；
- `src/config.js` 被阶段 agent 改为 168,000，ADR-003 未经主 agent 事前批准，也没有同步共享契约，不能构成有效放宽。

**施工要求**

1. `BUILD_LIMIT_BYTES` 恢复为 `150_000`，ADR-003 状态改为“验收否决/未批准”；不得编辑共享契约。
2. 通过代码复用、生产入口裁剪、文案/视图结构去重和构建优化压缩，不得删除 S4 Must，不得引入运行时依赖。
3. 优先检查 production 入口是否无必要地保留仅供测试使用的 debug exports。允许建立独立测试构建/测试入口，但正式 `dist/uploadfit.js` 必须仍自动 bootstrap、单 IIFE、可直接粘贴；测试不得因此改为不验证 production 主路径。
4. 保持 UTF-8 中文、closed Shadow、三类确认、AI 校验、真实页准备卡和全部错误诚实文案。
5. static-check 必须以 150,000 为真实阈值；禁止通过读取另一个宽松常量或跳过 size check 获得 PASS。

**完成标准**

- 两次 clean build 均 ≤150,000 bytes；
- 两次 SHA-256 相同；
- 无 `import`/`export`、source map、fetch/XHR、动态远程资源；
- `npm run check` 和全量 E2E 通过。

### S4-R4：修复 AI 数字 evidence 与内部自洽校验

**当前复现**

以下结果当前均错误地 `ok=true`：

1. evidence 只有“宽390像素”，输出 `width.exact=39`；
2. evidence 只有“JPG格式”，输出 `aspectRatio=1.5`；
3. 输出 `width={exact:390,min:500,max:600}`，evidence 各数字都存在。

**施工要求**

1. 移除基于字符串 `includes()` 的数字溯源；按完整数值 token、边界、单位和规范化数值匹配，39 不得匹配 390，30 不得匹配 300。
2. minBytes/maxBytes 只能由被采用的 evidence 项中的等价 B/KB/MB 数值证明；删除“只要整个 input 中出现 raw bytes 就算有来源”的旁路。
3. 把 `aspectRatio.value` 纳入数值来源验证；如果 AI 显式返回 tolerance，也必须限定范围并说明是否要求 evidence，默认代码常量不视为 AI 声称。
4. provider 在创建 candidate、加入 resolver 前检查：exact 落在 min/max 内；width/height exact 与 aspect ratio 在 tolerance 内；内部矛盾直接返回 `AI_INVALID_OUTPUT`。
5. 保持最大尺寸 100,000、最大文件 10GB、格式白名单、unknown instruction 不执行、高优先级本地规则不被覆盖。
6. 如需支持中文数字，必须采用有界、可测试的中文数字规范化，不能放宽成模糊子串。

**必须新增的测试**

- 39 vs 390、30 vs 300 均拒绝；
- 无 evidence 的 aspectRatio 拒绝；
- exact/min/max 内部矛盾拒绝；
- width/height 与 ratio 不一致拒绝；
- 30KB 与 30720B 等价来源通过，31KB 不得借 310KB 通过；
- AI_INVALID_OUTPUT 后本地确定性规则照常继续。

## 4. P1 必修项

### S4-R5：让 U06 的 controller intent 使用 0–1 normalized crop

**当前问题**

`createCropper()` 产生 normalized 与 pixel，但 `task-card.js` 只把 pixel 传给 `TaskController.confirmTask()`。这与 S4 §8.1、U06“合法归一化矩形传 controller”不符。

**施工要求**

1. UI 到 controller 的 CROP intent 必须携带 `{x,y,width,height}` 且四项均为 0–1 范围的 normalized 值。
2. 在 controller 权威边界用 task metadata 和 `proposedCrop` 验证 normalized rectangle：有限数、边界内、固定比例/固定裁剪尺寸、不得改变 width/height 规避规则。
3. controller 验证后再转换成 S2 canonical pixel crop；不要让 UI 直接决定权威像素值。
4. 保持每任务独立确认、取消不改 input、越界/篡改不进入 process。
5. Escape 只在可见裁剪卡且焦点位于该卡/裁剪控件时生效。

**必须替换的假测试**

删除 `tests/integration/cropper.test.js` 中只 `return true` 的 pointer-drag 占位。真实测试必须：

- 打开裁剪卡，读取默认居中 rect；
- 发送真实 pointerdown/move/up；
- 断言 rect 改变且仍在 0–1 边界内；
- 点击确认，spy `controller.confirmTask` 收到 normalized payload；
- 用 controller 转换后的 canonical plan 跑真实 S2 pipeline；
- 尝试越界、改 width/height、NaN/Infinity 并断言 process=0。

### S4-R6：在任务卡显示来源和脱敏原文 evidence

**当前问题**

`safeRuleSet()` 丢弃 `sources[].evidence`，导致 `rulesSection()` 的原文证据分支永远没有内容。任务书要求同时显示来源和原文证据。

**施工要求**

1. snapshot 只读 view model 保留有界、脱敏后的 `sources[].evidence`；每项和总长度沿用共享安全上限。
2. 任务卡明确显示来源类型（本地属性/附近文字/选中文字/AI/适配器等）和对应原文；AI 只标“候选/低优先级”，不得显示成已执行事实。
3. 全部通过 `textContent`；加入 `<img onerror>`, `</style>`, 超长文本等对抗样例，确认无 HTML 执行、无样式逃逸。
4. 冲突卡仍显示冲突，不因 evidence 恢复而自动执行。

**完成标准**

真实 pageCard snapshot 和 UI 都能看到目标规则的来源及原文证据；日志仍不输出完整 prompt/模型响应。

### S4-R7：修复状态播报、按钮语义和裁剪监听作用域

**当前问题**

- 状态胶囊外层 `<button>` 内嵌关闭 `<button>`，是非法嵌套交互控件；
- `.uf-live` 只被失败卡使用，且卡片折叠时隐藏；胶囊状态变化没有有效 live 播报；
- 首次失败同时写 polite live 和 `role=alert`，可能重复播报；
- cropper 在卡片折叠时仍创建，并向 document 绑定 Escape，用户在网页其他区域按 Esc 也可能取消隐藏任务；
- U11 只断言 live 元素存在，没有断言实际播报内容和次数。

**施工要求**

1. 将状态展开按钮和关闭按钮改为同级控件，不得 button 套 button；保持独立可访问名称和合理 Tab 顺序。
2. 增加常驻、未被 hidden 祖先屏蔽的 `aria-live="polite"` 状态区域，状态改变时写入一次；同一状态不重复。
3. 错误使用单一、明确的 `role="alert"` 或等价策略，避免第一次同时播报两遍。
4. 裁剪 Escape/方向键监听绑定 Shadow/card 内可见控件；dispose 时显式解除。折叠卡片或焦点在网页正文时按 Esc 不得取消任务。
5. 确认卡出现后焦点顺序合理；取消后返回状态胶囊；关闭后 controller dispose 再移除 host。
6. 按任务书色板校正 primary/success/warning/error token，并实际核对 WCAG AA。

**必须新增的测试**

- DOM 中不存在 `button button`；
- BOOTING→ARMED→PROCESSING→SUCCESS 时 live 文本逐次正确且同值不重复；
- 错误只播报一次；
- 裁剪卡折叠/无焦点时 document Escape 不取消，聚焦裁剪卡时 Escape 取消；
- close/cancel 的焦点和 cleanup 行为；
- 页面正文监听器计数在 dispose 后回到基线。

### S4-R8：补齐 U09/U12、真实视觉证据并纠正文档状态

**当前问题**

原交接宣称 U01–U12 全部自动化，但 pointer drag 为 no-op、U09 不存在、U11 只查元素、U12 只测窄窗口；S4 证据目录没有当前阶段必要的 UI/真实页/Tabbit 截图。

**施工要求**

1. U09：表单型成功卡必须显示“已适配并放回上传框”和使用网页原“保存/下一步/提交”的提示；对网页业务按钮计数，整个流程 click=0。
2. U12：分别覆盖 200% 缩放、窄窗口和 `prefers-reduced-motion: reduce`；断言卡片无水平/垂直不可达溢出、动画为 none。
3. 保存并人工检查至少以下视觉证据：规则/来源卡、crop 确认前后、flatten、upscale warning、表单成功、失败、真实 CNIPA 准备卡、Tabbit A11。
4. 截图使用无敏感 fixture；真实页面只截公开规则和 UploadFit UI，避开账号信息。
5. 更新 `docs/handoffs/S4-handoff.md`、`docs/evidence/S4/README.md`、`docs/evidence/S4/s4-result.json` 和 `docs/progress.md`，逐项写真实 PASS/FAIL/BLOCKED；删除“留给 S5”“本工作区无 Tabbit”等与事实或阶段退出标准冲突的说法。
6. ADR-003 标明主验收否决；ADR-002 若保留，应补充 normalized intent 到 canonical pixel 的权威边界和防篡改测试。

## 5. 全量验收命令

返工完成后至少执行并原样记录：

```powershell
npm test -- --run
npm run build
npm run static-check
npm run test:e2e
git diff --check
```

另执行：

1. 两次 clean production build，记录 bytes/SHA；
2. 真实 CNIPA 页面最终 bundle 探针；
3. 真实 Tabbit 官方脚本 A11；
4. 临时端口、Tabbit 草稿、object URLs、worker、observer、listener 清理检查；
5. `git status --short`，说明所有新增/修改文件。

## 6. 返工交付清单

外部 agent 交回时必须包含：

- 修复后的生产代码和回归测试；
- `docs/handoffs/S4-rework-report.md`，按 R1～R8 逐条写“修改、测试、结果、证据”；
- 更新后的 `docs/handoffs/S4-handoff.md`；
- 更新后的 `docs/evidence/S4/README.md`、`s4-result.json`；
- 新增 `docs/evidence/S4/rework-result.json`；
- 真实公开页 JSON + 截图；
- `tabbit-ai-result.json` + 脱敏截图；
- 最终 bundle bytes、两次 SHA、150,000-byte static-check；
- 全部命令结果和清理结果；
- 本地 Git 提交号，不推送远程。

## 7. 重新申请验收的硬条件

只有同时满足以下条件才可重新申请：

- R1～R8 全部完成，无“留给 S5”；
- 真实 CNIPA 页面卡为正确、可操作的 ready 状态；
- A11 绑定最终 bundle SHA 且真实 Tabbit 调用成功，或按规则正式标 `BLOCKED`；
- AI 对抗样例全部拒绝且本地降级继续；
- controller 收到 normalized crop，真实 pointer drag 测试有效；
- 来源/evidence 实际可见且无 HTML sink；
- U09/U11/U12 有行为级测试和视觉证据；
- `dist/uploadfit.js ≤150,000 bytes`；
- S0～S3 全量回归无退化；
- 工作区、临时服务、Tabbit 草稿和资源清理有记录。
