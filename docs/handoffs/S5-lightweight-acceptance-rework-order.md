# S5 轻量验收补验返工单

- 日期：2026-08-20
- 验收基线：`9ed5839`
- S5 实现提交：`dcd5c1a`
- 当前状态：`BLOCKED_BY_ENVIRONMENT`
- S6 状态：`HOLD`
- 当前生产包：`dist/uploadfit.js`，175,868 bytes
- 当前 SHA-256：`29C5613CD5F9C71EBBD9E88754097B18435A4FA8508D0E2612D160233D79FD8F`

## 1. 验收结论

S5 本地实现不需要代码返工。独立轻量验收已确认：

- `npm run check` 通过：18 个 Vitest 文件、159 个测试；
- S5 专属场景、安全、性能 E2E 通过：17/17；
- 当前生产包可重复构建，bytes 与 SHA-256 和 S5 交接一致；
- 本地安全检查通过，普通图片流程无外部请求，敏感文本不会进入 AI Bridge；
- 场景 A–F、一次重试、裁剪确认/取消、不代点提交、官方工具安全停止均已由 Chromium 自动化覆盖；
- 工作区在验收后保持干净。

唯一阻断是当前生产包没有 S5 阶段的 Tabbit 实机冒烟证据。验收时再次连接 in-app Browser，结果仍为 `Browser is not available: iab`，可用浏览器列表为空。不得使用 mock、Playwright Chromium 或 S4 旧 SHA 的实机截图冒充当前 S5 产物。

本返工单按用户批准的“轻量验收重要环节”口径，将原任务书的完整 Tabbit A–F 矩阵收敛为四组平台关键冒烟。未重跑的项目必须如实标记为“由自动化覆盖，按轻量验收不重复实机执行”，不得伪造为已实测。

## 2. 施工边界

### 必须做

1. 使用当前 `dist/uploadfit.js` 在真实 Tabbit 官方脚本环境中运行。
2. 完成安装/刷新、场景 A、场景 B、真实 AI、关闭/再次运行四组关键冒烟。
3. 保存脱敏截图和结构化记录。
4. 修正文档中的一处性能数字不一致。
5. 更新 S5 状态并提交本地 Git 留痕。

### 禁止做

- 不修改产品源码来绕过实机失败。
- 不修改自动化断言来“完成”补验。
- 不使用真实证件照、真实报名网站最终提交或敏感页面文本。
- 不公开临时 Tabbit 脚本，不保存账号、脚本 ID、分享链接、文件名、图片内容、完整 prompt 或完整 AI 响应。
- 不把 Chromium、同形 `LLMBridge` mock 或 S4 的旧产物证据写成当前 S5 实机 PASS。
- 不自动点击网页业务提交按钮。

## 3. 环境准备

1. 在仓库 `C:\Users\蔡天乐\Desktop\黑客松\main` 执行：

   ```powershell
   npm run build
   npm run serve:test
   ```

2. 确认测试首页可访问：

   `http://127.0.0.1:8765/test-pages/index.html`

3. 在 Tabbit 中创建或更新一个临时私有脚本：

   - 代码必须完整来自当前 `dist/uploadfit.js`；
   - 匹配范围仅限 `http://127.0.0.1:8765/test-pages/*`；
   - 不启用全站权限；
   - 记录 Tabbit 完整版本、日期、Git commit、bundle bytes 和 SHA-256；
   - 验收结束后删除临时脚本或关闭自动运行，并记录清理结果。

4. 只使用 `tests/fixtures/manual-ai/` 中的非敏感测试图片。场景 A/B 优先使用明显不合规的 PNG/JPEG，不得使用用户真实证件照。

## 4. 返工项

### S5-LR1：当前 bundle 安装、保存与刷新运行

操作：

1. 将当前生产 IIFE 粘贴进 Tabbit 官方脚本编辑器并保存。
2. 打开测试首页，确认 UploadFit 状态胶囊只出现一个。
3. 刷新页面，确认脚本按配置重新运行，仍只有一个 UI host。
4. 核对实际脚本 SHA 为本单顶部 SHA，不得使用旧构建。

通过标准：

- 保存无语法错误；
- 无 ESM `import/export` 或外部运行时依赖；
- 首次运行与刷新后均只有一个 UploadFit 实例；
- 页面原功能可继续操作；
- 截图不含账号和脚本 ID。

建议证据：`docs/evidence/S5/s5-tabbit-install-refresh.png`。

### S5-LR2：场景 A 预检适配与真实回填

地址：

`http://127.0.0.1:8765/test-pages/index.html?scenario=A`

操作：

1. 选择约 2MB、1170×1701 或其他明确不合规的 PNG。
2. 记录页面识别到的 JPG、30–120KB、390×567 规则。
3. 完成必要确认，观察页面事件和最终 File 元信息。
4. 核对网页业务逻辑收到的是处理后的 JPEG，而不是先收到原始不合规文件。

通过标准：

- 输出 MIME 为 `image/jpeg`；
- 输出尺寸为 390×567；
- 输出在网站安全字节区间内；
- input/change 事件只按产品契约发生，页面最终接受；
- 不产生图片二进制网络外发；
- 不声称已完成网页最终提交。

建议证据：`docs/evidence/S5/s5-tabbit-scenario-a.png`。

### S5-LR3：场景 B 明确拒收后只重试一次

地址：

`http://127.0.0.1:8765/test-pages/index.html?scenario=B`

操作：

1. 选择会被页面明确拒收的超大 PNG。
2. 观察页面首次出现“仅支持 JPG 且不能超过 100KB”。
3. 核对 UploadFit 从拒收文本补充规则、处理并重新分发一次。
4. 记录页面事件计数、`retryCount`、最终文件 MIME/bytes 和结果。

通过标准：

- 首次明确拒收能触发一次适配；
- `retryCount=1`；
- 第二次页面接受；
- 不出现第二次自动重试或循环；
- 不点击任何网页业务按钮。

建议证据：`docs/evidence/S5/s5-tabbit-scenario-b.png`。

### S5-LR4：真实 AI 与敏感边界

操作：

1. 使用固定、非敏感的规则文本触发一次生产 `TabbitAiProvider`。
2. 确认生产路径实际调用官方 `LLMBridge.chat()`，返回后经过本地 Schema、evidence 和数值一致性校验。
3. 记录 `callCount`、耗时、返回类型、字段名、validator 结果和降级状态。
4. 核对请求不含 File、文件名、Base64、图片字节、完整页面正文或其他表单字段。

通过标准：

- 当前 bundle 的真实官方 Bridge 调用次数为 1；
- 合法输出通过本地校验并只补充低优先级候选；
- 图片内容和敏感字段发送次数为 0；
- AI 失败或超时时本地明确规则仍可继续；
- 不保存完整 prompt/响应。

建议证据：`docs/evidence/S5/s5-tabbit-ai-redacted.png` 和脱敏 JSON 摘要。

### S5-LR5：关闭、刷新与再次运行清理

操作：

1. 在完成场景 A 或 B 后点击 UploadFit 自有关闭按钮。
2. 确认 UI host 消失；继续修改 DOM 或重新选择文件时不再创建旧任务。
3. 刷新页面或按 Tabbit 生命周期再次运行脚本，确认可以得到一个全新实例。
4. 记录 object URL、Worker、observer、listener 和任务会话的可观察清理结果；无法直接观察的内部项引用既有自动化，但不得伪装成实机可见。

通过标准：

- 关闭后 UI 和旧会话无残留；
- 再次运行不会重复 host 或复用旧任务；
- 页面业务按钮 click 计数不因 UploadFit 改变；
- 临时测试服务和 Tabbit 私有脚本最终清理。

建议证据：`docs/evidence/S5/s5-tabbit-close-rerun.png`。

### S5-LR6：文档一致性修正

`docs/handoffs/S5-handoff.md` 当前写“最大 heartbeat 间隔 357.2ms”，但 `docs/performance.md` 与 `docs/evidence/S5/s5-result.json` 均记录 353.1ms。

要求：

- 将 handoff 数字改为 353.1ms；
- 不用本次临时重跑的新性能数字覆盖原 S5 证据，除非重新生成整套性能记录并同步所有文件；
- 复核 bytes、SHA、测试数量和状态在 handoff、result、test-results、security-review、performance 中一致。

## 5. 轻量验收对未重跑项的记录方式

场景 C/D/E/F 和 X01–X12 已由本轮独立抽验的 S5 专属 17/17 Chromium 用例覆盖。按用户批准的轻量范围，不要求再次逐项在 Tabbit 执行。

这些矩阵项不得写为“Tabbit 实测 PASS”。建议记录为：

```text
NOT_REPEATED_BY_APPROVED_LIGHTWEIGHT_SCOPE
证据：S5 专属 Chromium 17/17 + 对应自动化用例
边界：未宣称本项在当前 Tabbit 版本逐项人工执行
```

只有 LR1–LR5 全部通过后，独立验收方才可以结合上述范围裁决把 S5 改为 `ACCEPTED`。

## 6. 回归命令

若只修改文档和证据，执行：

```powershell
npm run check
npm run test:e2e -- tests/e2e/s5-stable-scenarios.spec.js tests/e2e/s5-security.spec.js tests/e2e/s5-performance.spec.js --reporter=line --workers=1
git diff --check
```

预期：159/159 Vitest、17/17 S5 专属 Chromium、build/static-check、diff check 全部通过，生产 SHA 不变。

若修改任何 `src/`、构建脚本或测试逻辑，必须改为执行完整：

```powershell
npm run check
npm run test:e2e -- --reporter=line --workers=1
git diff --check
```

产品代码变化后必须记录新 bytes/SHA，并重新绑定全部 Tabbit 证据；不得沿用本单顶部 SHA。

## 7. 必交付文件

外部 Agent 完工后至少提交：

- 更新后的 `docs/evidence/S5/tabbit-matrix.json`；
- 更新后的 `docs/evidence/S5/s5-result.json`；
- 更新后的 `docs/evidence/S5/README.md`；
- 更新后的 `docs/handoffs/S5-handoff.md`；
- 更新后的 `docs/test-results.md`、`docs/security-review.md` 和 `docs/progress.md`；
- 新增 `docs/handoffs/S5-lightweight-reacceptance-report.md`；
- LR1–LR5 对应的脱敏截图/JSON 摘要；
- 本地 Git 提交，提交信息建议：`test: close S5 Tabbit smoke gate`。

## 8. 重新申请验收的硬条件

- LR1–LR6 全部完成；
- 当前 bundle 的安装/刷新、场景 A、场景 B、真实 AI、关闭/再次运行均有 Tabbit 证据；
- 未执行项按轻量范围如实标记，没有伪造 PASS；
- 普通图片流程外部网络请求为 0，AI 输入不含图片和敏感字段；
- 无自动业务提交、无限重试、重复实例或关闭残留；
- P0/P1/P2 未决仍为 0；
- 自动门禁绿色，文档数字一致；
- 临时服务、临时 Tabbit 脚本和测试资源已清理；
- 工作区有可复查提交，未擅自推送远程。

若仍无可用 Tabbit 实例，应保持 `BLOCKED_BY_ENVIRONMENT`，列明时间、版本/环境、错误形态和已尝试范围后停止；不得将 S5 改为 `ACCEPTED`，也不得启动 S6。
