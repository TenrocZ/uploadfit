# V2-S3 Handoff：编排确认 UI 与音频回填闭环

- Status: `READY_FOR_ACCEPTANCE`
- Date: 2026-08-24
- Agent: `Codex /root/v2_s3_implementation`
- Start commit: `bf266484ee85d7deb30ea04584ee74e0c6e2d7a8`
- End code commit: `5bf25af260ed5df8260e8e659422c11c3cdd95af`
- Prerequisites: V2-S0、V2-S1、V2-S2 已验收；S2 第三轮交接和 ADR-005 为事实基线
- Scope: 正式 `TaskController` 的 image/audio registry 路由、音频确认/进度/取消/成功/失败 UI、DataTransfer 回填与事务恢复、拒收一次 retry；不扩展 codec，不执行 S4 门禁
- Acceptance: 仅提交给独立验收 Agent；本 handoff 不自我标记 `ACCEPTED`

## 交付摘要

### Controller 与 handler

`src/core/media-handlers.js` 增加 image adapter 并统一 registry；`src/core/task-controller.js` 按 `mediaKind` 路由 image/audio，保留原状态机、队列、确认、注入、回滚、拒收观察、下载/恢复、清理和任务隔离。音频分支在 process 前重新使用 canonical plan，process 后独立复检；不满足冻结子集时返回稳定停止码且不创建 Worker。

冻结矩阵：合规 MP3 原 File passthrough；PCM WAV 16/24/32-bit mono/stereo 转 MP3；超限 MP3 和全部 M4A/AAC（含 AAC-LC）为 `AUDIO_CODEC_UNSUPPORTED`，`process=0`、`Worker=0`；仅 duration、无可信 maxBytes、目标不允许 MP3 均安全停止。不新增 decoder，不自动裁剪/分段。

### Production Worker 嵌入

`src/audio/worker-runtime.js` 允许构建时注入 S2 implementation source，`esbuild.config.js` 将冻结 `lamejs@1.2.1` Worker 真正嵌入 production/test 单 IIFE；显著 ADR-005 约束和可替换构建路径保留。没有 runtime `import`/`export`、网络加载或新的 package dependency。上游源码中不执行的项目 URL 被标为 `embedded://lamejs`，只做静态扫描去歧义；构建同时移除历史尾随空格，不改变编码执行语义。

最终 production artifact：

```text
dist/uploadfit.js
bytes: 419330
SHA-256: 472F7A308933618630BA2057046CFA845C973CF1BA41EF4B6F4DD2F61CC83FD4
```

### UI、生命周期与隐私

`src/ui/task-card.js`、`src/ui/status-pill.js`、`src/ui/host.js` 增加 audio-safe 展示：原/目标格式、字节、duration、bitrate、channels/mono、lossy warning、限频单调进度、取消、成功/失败和错误码。按钮同级、使用 `textContent`；现有 closed Shadow DOM、键盘/焦点、`aria-live`、200% zoom、reduced-motion 约束继续生效。关闭、换文件、input detach、pagehide 均 abort；迟到消息在 taskId/生命周期校验后不能注入。

`src/utils/logger.js` 只保留稳定音频标量字段；单测和定向 E2E 覆盖 snapshot/log 不出现文件名或 File/Blob 内容。业务按钮不自动点击，定向和稳定页均断言 submit click 为 0。

## 本地稳定页与测试

稳定页：`test-pages/audio-s3.html?scenario=A` 至 `?scenario=H`，脚本和样式分别为 `test-pages/audio-s3.js`、`test-pages/audio-s3.css`；首页入口见 `test-pages/index.html`。页面只生成本地 fixture 或复用当前内存 MP3，不提交真实用户文件，不读取文件名、tags、PCM 或页面外文本。

新增测试：

- `tests/e2e/v2-audio-s3.spec.js`：production/debug bundle 的 PCM WAV 成功链、MP3 passthrough、A–H 页面入口/可访问快照、H 一次关联拒收 retry。
- `tests/e2e/v2-audio-s3-controller.spec.js`：超限 MP3/M4A、无 maxBytes、目标格式不允许、duration stop、确认拒绝、cancel/detach、DataTransfer rollback/download、拒收一次 retry、image/audio 隔离、snapshot/log 脱敏和 submit click=0。
- `tests/unit/logger.test.js`：音频进度日志安全投影。

## 验证结果

环境：Windows PowerShell，Node `v22.20.0`，npm `10.9.3`，本地 Playwright Chromium。

| 命令 | 实际结果 |
|---|---|
| `npm run check` | 通过：25 个 Vitest 文件、229 个测试；production build 419330 bytes；static-check PASS；SHA 如上 |
| `npm run test:e2e -- tests/e2e/v2-audio-s3-controller.spec.js tests/e2e/v2-audio-s3.spec.js --reporter=line --workers=1` | 通过：9/9 |
| `npm run test:e2e -- --reporter=line --workers=1` | 通过：156/156（本阶段唯一一次全量 E2E） |
| `git diff --check` | 通过 |

全量 E2E 中的既有 S4/S5 synthetic tests 仅作回归，不等同于 S4 实机验收。S4 真实 Tabbit、S4 200MB 慢速门禁和 S5 交付命令均未在本阶段执行。

## 追踪与证据

- 结构化结果：`docs/evidence/V2-S3/result.json`
- 证据说明：`docs/evidence/V2-S3/README.md`
- 追踪矩阵：`docs/v2/work-orders/90-需求追踪矩阵.md`
- 需求与冻结依据：[V2 S3 施工单](../v2/work-orders/40-V2-S3-编排确认UI与回填闭环.md)、[ADR-005](../decisions/ADR-005-V2-S0-音频编解码方案.md)

## 资源、许可与复用边界

- 没有新增 npm dependency；继续使用 S0/S2 已验收 `lamejs@1.2.1`、LGPL/NOTICE 和构建路径。
- S2 `docs/evidence/V2-S2/audio-200-to-100.json`、PCM 六组合真实 Worker 和 cleanup 证据是复用证据，不记录为 S3 新执行。
- S3 本轮实际执行的是 controller/UI/audio targeted E2E、生产 IIFE build/static-check 和一次 156/156 全量回归。

## 已知限制与交接请求

1. 超限 MP3 重编码与 M4A/AAC 转码仍稳定停止为 `AUDIO_CODEC_UNSUPPORTED`；解禁前必须按 ADR-005 条件 4 走新 ADR。
2. 真实 Tabbit 和 200MB 慢速门禁留给 V2-S4，当前阶段明确 `HOLD`；V2-S5 也保持 `HOLD`。
3. 请独立验收 Agent 按 S3 施工单复核 A–H 页面、production bundle SHA、controller E2E 和 rollback/privacy 证据后，再决定是否将矩阵 S3 行改为 `ACCEPTED`。
