# S3 返工后独立复验报告

- 复验日期：2026-08-19
- 工程目录：`C:\Users\蔡天乐\Desktop\黑客松\main`
- 返工基线：`ce0cb3f`
- 外部 Agent 返工提交：`5cec842`
- 返工文档提交：`25087d0`
- 独立复验修复提交：`09e7d3d`
- 最终结论：`ACCEPTED`
- S4：允许启动
- 结构化证据：`docs/evidence/S3/reacceptance-result.json`

## 1. 结论

S3 已通过返工后独立复验。上一轮 R1～R4 的修复方向和正式 Q-S3-001～008 均验证通过；复验额外发现 1 个裸 file input 首次选择图片未进入 TaskController 的集成残留，已由本轮直接修复并以 Q-S3-009 固化。Q-S3-010 进一步证明中置信规则接受路径可以调用真实 S2 pipeline 完成 PNG→JPEG、最终复检与回填，不只在 mock 中成立。

当前没有阻塞 S4 的 S3 已知问题。S4 可以以提交 `09e7d3d` 及后续文档留痕为基线启动。

## 2. R1～R4 复验

| 项目 | 独立复验结果 | 结论 |
|---|---|---|
| R1 异步事件决策 | Q-S3-001～003：确认前下游事件为 0；合规原文件单次释放；安全修复只释放处理结果 | PASS |
| R2 策略确认分层 | `policyConfirmation` 与 S2 canonical plan 分离；接受、拒绝及 CROP 独立性通过 | PASS |
| R3 多 uploader FIFO | 最大处理并发 1，A→B 顺序稳定；首任务失败后 B 继续；合法流程 diagnostics 为空 | PASS |
| R4 测试与证据 | Q-S3-001～008、结构化 JSON、事件轨迹和确认前后截图均存在并可读取 | PASS |

视觉证据人工复核通过：`s3-confirmation-before.png` 显示策略/CROP 待确认和原始 change 阻断状态，`s3-confirmation-after.png` 显示两项确认接受、最终复检/注入成功及业务按钮点击为 0。

## 3. 复验新增残留与修复

### R5：裸 file input 首次图片选择未进入 S3

S1 的 discovery 已支持通过调用方提供的图片 MIME 升级没有 `accept`、没有图片 label 的裸 `input[type=file]`，但 S3 文档捕获监听调用 `discoverFromEvent(event)` 时没有传入本次唯一文件的 `File.type`。因此目标 input 没有注册 uploader，也没有 task；页面中其他已识别 uploader 会掩盖简单的 uploaderCount 断言。

修复后，S3 在尚无 record 时读取唯一所选文件的 MIME，并调用 `discoverFromEvent(event, selectedMime)`。注册回调在同一捕获事件内建立 record，随后正常执行 `handleFileChange()`。非图片 MIME 仍不会升级；多文件路径仍不据单个 MIME 推断。

新增回归：

- Q-S3-009：裸 input 首次选择真实 PNG fixture，目标 input 被注册并创建自己的 `WAITING_REJECTION` task，原始 File 类型保持 `image/png`。
- Q-S3-010：置信度 0.8 的规则接受后，真实 S2 pipeline 将生成 PNG 处理为最终验证通过的 JPEG，任务 `SUCCESS`。

## 4. 最终门禁

| 检查 | 结果 |
|---|---|
| `npm run check` | PASS：15 个 Vitest 文件、103 个测试；构建和静态检查通过 |
| `npm run test:e2e -- --reporter=line --workers=1` | PASS：59 个 Chromium 测试，Q-S3-001～010 全部通过 |
| 生产产物 | `dist/uploadfit.js`，单个纯 JavaScript IIFE，122865 bytes |
| SHA-256 | `4483FC94F140F892F9A0FCF16AF27797639C41B44F8E863AD9FEDE2F4897702D` |
| `git diff --check` | PASS |
| 测试服务 | 8765 端口已关闭 |

## 5. 边界说明

- 按任务书既定边界，插件捕获监听仍可能晚于网站更早注册的 document/window 捕获监听器，不能声称覆盖所有站点。
- 含异步强约束的文件会先阻断再以 guard 单次释放；释放事件为 `isTrusted=false`，网站拒绝合成事件时仍使用 manual-submit/download 降级语义。
- S3 不点击业务按钮、不读取请求/响应、不 monkey-patch 网络 API，不实现 S4 UI 或真实 AI provider。
- 截图和自动化只使用合成 fixture；日志和 evidence 不包含用户文件内容、Base64、Token 或真实页面敏感数据。

## 6. 放行决定

S3 状态更新为 `ACCEPTED`。允许外部模型启动 S4，但应继续保留 S0～S3 全量门禁，并以 `09e7d3d` 后的当前 HEAD 作为开发基线。
