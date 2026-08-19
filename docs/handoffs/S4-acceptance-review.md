# S4 独立验收报告

- 验收日期：2026-08-19
- 验收对象：`2161939 feat: implement S4 UI confirmations and Tabbit AI provider`
- 上游基线：`d950253`（S3 已通过独立复验）
- 验收结论：`REWORK_REQUIRED`
- 是否放行 S5：**否**
- 返工施工单：`docs/handoffs/S4-acceptance-rework-order.md`
- 结构化结果：`docs/evidence/S4/acceptance-review-result.json`

## 1. 结论

S4 当前不能通过验收。既有 137 个 Vitest 用例和 80 个 Chromium 用例全部通过，但测试集合没有覆盖真实公开页、严格数字溯源、UI 到 controller 的归一化裁剪契约及若干可访问性行为；独立对抗复现已经得到实际失败。

本轮不是外部平台客观不可用导致的单一 `BLOCKED`：生产实现本身还存在可本地修复的问题，因此状态为 `REWORK_REQUIRED`。A11 真实 Tabbit 调用仍是阶段硬门禁，修复完成后的最终 bundle 必须在 Tabbit 官方脚本运行时重新取证，不能使用 S0 旧探针或 mock 代替，也不能顺延给 S5。

## 2. 独立门禁结果

| 检查 | 结果 | 说明 |
|---|---|---|
| `git status --short`（验收开始） | PASS | 工作区干净，HEAD=`2161939` |
| `npm run check` | 表面 PASS | 17 个测试文件、137 个测试通过；构建和 static-check 通过，但体积检查使用了未经批准的 168,000 bytes 新值 |
| `npm run test:e2e` | PASS | 80 个 Chromium 用例通过 |
| 连续两次 `npm run build` | FAIL / 可复现 | 两次均为 167,513 bytes，SHA-256 均为 `4656F05C260F676E24DDF4E94D9AB43AFDBE6BF4C2356D2F72071008BEE04509`；确定性通过，但比共享契约 150,000 bytes 多 17,513 bytes |
| 真实 CNIPA 页面 + 当前 production bundle | FAIL | 页面可访问且规则仍在，但生成 `pageCard.state="insufficient"`，规则错误且不可执行 |
| AI 输出独立对抗样例 | FAIL | 39 可借 390 的子串通过；无来源的 1.5 比例通过；exact 与 min/max 矛盾仍通过 provider 校验 |
| A11 真实 Tabbit AI 证据 | FAIL / 缺失 | S4 交接和证据中明确未完成；S0 的 1730ms 探针不是当前 provider/controller/UI 链路 |

## 3. 真实公开页复现

验收时重新访问任务书指定地址：

`https://ggfw-dlsks.cnipa.gov.cn/home_item_Text_details?nid=6387`

页面当前返回 2026 年公告，`.content` 中仍包含：JPG、30KB—120KB、300dpi、宽 390 像素、高 567 像素、蓝底免冠等要求。把当前 `dist/uploadfit.js` 注入已渲染页面后得到：

```json
{
  "hostCount": 1,
  "sessionState": "ARMED",
  "uploaderCount": 0,
  "pageCard": {
    "state": "insufficient",
    "rules": {
      "width": { "exact": 21 },
      "height": { "exact": null },
      "safetyFlags": ["PERMISSION_OR_LOGIN"],
      "actionable": false
    }
  }
}
```

根因是适配器以文章中第一个“照片/电子件”等命中点为中心截取固定字符窗口。窗口把“照片尺寸 48mm×33mm、人像头部宽度 21mm—24mm”等物理证件照要求和后续“登录考试系统”一起交给通用解析器，导致 21 被误当作像素宽度，并触发登录安全停止；真正的“宽：390像素，高：567像素”又没有被可靠解析。

现有 `S4-D8` 测试不是该真实场景：它只构造了短小、无干扰的 `.content` 文本，再用自定义 mock provider 直接返回候选，因此无法发现真实文章中的前后文污染。S4-D8 当前判定为 FAIL。

## 4. 交付物判定

| ID | 判定 | 验收说明 |
|---|---|---|
| S4-D1 Shadow DOM host | PASS（有残余） | closed/open Shadow、单 host、dispose 主路径存在；可访问性和隐藏裁剪监听问题见 D9 |
| S4-D2 状态胶囊 | PARTIAL | 固定中文文案正确；状态变化并未由有效的常驻 `aria-live` 区域播报 |
| S4-D3 任务卡 | FAIL | `safeRuleSet()` 从 snapshot 的 `sources` 中剥掉 `evidence`，`task-card.js` 虽尝试显示原文证据，实际拿不到；也没有清楚显示来源类型 |
| S4-D4 有损确认 | PASS（主安全条件） | crop/flatten/upscale 未确认时 process=0 的主路径有自动化；裁剪 payload 单位仍不符合 D5/U06 |
| S4-D5 裁剪器 | FAIL | 组件能产生 normalized 与 pixel 两种结果，但 UI 丢弃 normalized，向 `TaskController.confirmTask()` 传的是像素矩形；指针拖动自动测试为无操作占位 |
| S4-D6 AI provider | FAIL（证据门禁） | 调用方式、3 秒超时、0 重试、每实例 3 次的代码路径存在；A11 当前 S4 真实调用未完成 |
| S4-D7 AI 校验/降级 | FAIL | 数字 evidence 子串匹配、比例未参与数值溯源、exact/range 内部矛盾未在 provider 层拒绝 |
| S4-D8 真实网页模式 | FAIL | 真实页面产生错误且不可执行的 `insufficient` 卡；合成 fixture 不能替代 |
| S4-D9 可访问与安全 | FAIL | 外层状态 `<button>` 内嵌关闭 `<button>`；状态 live 区域只检查“存在”不检查播报；隐藏裁剪卡仍绑定 document Escape |

## 5. U01–U12 判定

| ID | 判定 | 说明 |
|---|---|---|
| U01 | PASS | 敌意页面 CSS 下 Shadow UI 主体可读 |
| U02 | PASS | 重复创建保持单 host |
| U03 | PASS（文本） | snapshot 到胶囊文案映射正确；播报问题归 U11 |
| U04 | PASS | 合成冲突规则显示冲突且无自动开始 |
| U05 | PASS | cancel/Esc 主路径可停止且原文件保持不变；Esc 监听作用域仍需修复 |
| U06 | FAIL | controller 接收像素 payload，而非 0–1 normalized payload；所谓 pointer-drag 测试只 `return true` |
| U07 | PASS | flatten 取消时 process=0 |
| U08 | PASS | upscale 明示确认且 warning 保留 |
| U09 | NOT PROVEN | 测试文件中没有 U09 用例或 click=0 断言；代码文案存在不足以替代自动化 |
| U10 | PASS | 当前测试覆盖 host、listener、controller dispose 和 object URL 清理 |
| U11 | FAIL | nested button 非法；live region 不播报胶囊状态；首次错误可能被 polite + alert 双重播报；隐藏裁剪卡监听 document Escape |
| U12 | NOT PROVEN | 只测 390px 窄窗口；未测 200% 缩放及 reduced-motion 实际行为 |

## 6. A01–A12 判定

| ID | 判定 | 说明 |
|---|---|---|
| A01 | PASS（基础样例） | 合法 JSON 字符串/对象可转候选 |
| A02 | PASS | 非 JSON 和空响应降级 |
| A03 | FAIL | `containsDigits()` 使用字符串包含关系，39 可借“390”作为来源；`aspectRatio` 完全未加入 `numericClaims()` |
| A04 | FAIL（不完整） | min>max 被拒绝，但 width exact=390、min=500、max=600 仍被 provider 接受，未在加入 resolver 前保证自洽 |
| A05 | PASS | 格式白名单与未知格式降级符合当前约定 |
| A06 | PASS（mock） | 3 秒超时、晚到结果忽略、无重试已自动化 |
| A07 | PASS（实例级） | 第 4 次不调用 bridge；返工需继续保持 |
| A08 | PASS | 高优先规则不会被 AI 覆盖 |
| A09 | PASS（现有边界） | credential/query/data URI/长数字阻断；ContextBundle 不读其他表单值 |
| A10 | PASS | LLMBridge 缺失时基础本地流程继续；真实公开页本地规则错误是另一个 D8 缺陷 |
| A11 | FAIL / 缺失 | 没有最终 S4 production bundle 的真实 Tabbit 调用证据 |
| A12 | PASS | 未知指令字段/非白名单语义不进入执行 |

## 7. 关键实现缺陷

### 7.1 AI 数字溯源可被子串绕过

独立执行 `validateAiRuleOutput()` 得到三个错误接受结果：

1. 输入只有“宽390像素”，AI 声称 `width.exact=39`，结果 `ok=true`；
2. 输入只有“JPG格式”，AI 声称 `aspectRatio=1.5`，结果 `ok=true`；
3. 输入“宽390像素，至少500像素，最多600像素”，AI 同时返回 exact=390/min=500/max=600，结果 `ok=true`。

第一项来自 `String(value).includes(String(digits))`，第二项来自比例没有进入 numeric claims，第三项来自 dimension 校验只检查 min≤max，没有检查 exact 是否落在范围内。AI 低优先级不能替代 provider 自身的安全校验；这些值在缺少高优先级规则时可能进入可执行候选。

### 7.2 裁剪确认单位不符合任务书

`createCropper()` 的 `onConfirm` 同时返回 `{ normalized, pixel }`，但 `task-card.js` 解构后只把 `pixel` 传给 controller。任务书 §8.1 和 U06 明确要求 controller intent 收到 0–1 的 normalized `{x,y,width,height}`。ADR-002 是阶段 agent 的局部判断，不能覆盖更高优先级的当前阶段 Must。

### 7.3 规则原文证据在 view model 边界丢失

`TaskController.safeRuleSet()` 复制 source 时只保留 type/priority/confidence/advisoryOnly，不保留 evidence。`task-card.js` 后续遍历 `source.evidence` 永远拿不到数据。真实页独立快照也确认每个 source 都没有 evidence。

### 7.4 自动化覆盖声明不实

`tests/integration/cropper.test.js` 中名为“pointer drag moves the box”的测试只访问 debug API 后 `return true`；没有实例化 cropper、没有发送 pointer 事件、没有断言位置或 payload。现有测试也没有 U09，U11 只检查 live 元素存在，U12 只检查窄窗口。由此不能声明 U01–U12 全部自动化通过。

## 8. 验收边界

本轮只新增验收、证据和返工文档，没有修改 S4 生产代码。外部 agent 应严格按 `S4-acceptance-rework-order.md` 施工；全部 P0/P1 条目闭合、真实 Tabbit 证据绑定最终 bundle SHA、产物恢复到 ≤150,000 bytes 后，再申请一次独立复验。S4 复验通过前不得启动 S5。
