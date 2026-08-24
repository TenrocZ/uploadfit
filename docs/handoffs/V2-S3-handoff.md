# V2-S3 Handoff：编排确认 UI 与音频回填闭环

- Status: `ACCEPTED`
- Date: 2026-08-24
- Implementation agent: `Codex /root/v2_s3_implementation`
- Independent acceptance: `Codex /root`
- Start commit: `bf266484ee85d7deb30ea04584ee74e0c6e2d7a8`
- Initial code baseline: `dd4e35f54ebc0253df39cdc82dd3603b83ea7377`
- Accepted code commit: `a430d91fa406686a57d38e5321bfa420437c50d4`
- Artifact commit: `092ac4815243f18c9acd81aa752e7db5e06660fd`
- Scope: 正式 controller 的 image/audio registry 路由、音频确认/进度/取消 UI、DataTransfer 回填与事务恢复、严格收紧后的拒收一次 retry；不扩展 codec，不执行 S4 实机门禁

## 交付与冻结边界

`src/core/media-handlers.js` 统一 image/audio registry，`src/core/task-controller.js` 复用既有状态机、FIFO、确认、注入、回滚、拒收观察、下载/恢复和清理。合规 MP3 原 File passthrough；PCM WAV 16/24/32-bit mono/stereo 可在确认后转 MP3；超限 MP3 和 M4A/AAC 稳定返回 `AUDIO_CODEC_UNSUPPORTED`，不创建 Worker。仅 duration、无可信 maxBytes、目标不允许 MP3、官方工具、原始/无损语义均安全停止。

拒收重试已增加严格门禁：相同规则、规则放宽、无关文字或停止语义不会重新处理；只有仍允许 MP3 且对可执行计划形成严格收紧的新规则才可重新规划，最多一次。二次拒收不再处理或派发业务事件。

音频 UI 展示原/目标格式、字节、duration、bitrate、channels/mono、有损警告及规则来源/有界原文。确定进度的视觉、文字和 ARIA 数值来自同一 ratio；只有未知进度使用不确定动画。所有外部文字用 `textContent`，按钮同级且不自动点击业务提交。

production Worker 与冻结的 `lamejs@1.2.1` 嵌在单 IIFE 内，无 runtime import/export 或远程依赖。最终产物：

```text
dist/uploadfit.js
bytes: 421348
SHA-256: ABFA41EBB606CA0E7ED84F8DEE2F17783CAF0BDFA11CE777FB1BAEFBD173D18A
```

## 返工闭环

首轮验收产生 [返工施工单](V2-S3-acceptance-rework-order.md)，Luna Max 分三项完成：

- `c04e1a8`：严格拒收规则比较与 controller 回归；
- `ab60dc3`：音频 UI、进度和 UI E2E；
- `a430d91`：A–H 稳定页的真实 M4A、长 WAV 取消和 500KB→250KB retry。

独立复验没有复用施工 Agent 的“通过”结论；主验收 Agent 重跑了 S3 定向和全量测试。最终裁决见 [V2-S3 最终验收报告](V2-S3-final-acceptance.md)。

## 验证结果

环境：Windows PowerShell，Node `v22.20.0`，npm `10.9.3`，本地 Playwright Chromium。

| 命令 | 独立实测 |
|---|---|
| `npm run check` | PASS：25 个 Vitest 文件、229 项；production build/static-check PASS |
| `npm run build:test` | PASS：debug IIFE 427067 bytes |
| `node scripts/run-e2e.js tests/e2e/v2-audio-s3-controller.spec.js tests/e2e/v2-audio-s3-ui.spec.js tests/e2e/v2-audio-s3.spec.js --reporter=line --workers=1` | PASS：15/15 |
| `node scripts/run-e2e.js --reporter=line --workers=1` | PASS：162/162（返工后全量一次） |
| `git diff ee18af3..a430d91 --check` | PASS |
| 调试标记扫描 | PASS：0 命中 |

全量 E2E 中既有的 synthetic 测试只作回归，不等同于真实 Tabbit。S3 没有重跑 S2 的 200MB 慢速门禁，也没有执行 S4/S5 交付命令。

## A–H 与证据入口

本地稳定页为 `test-pages/audio-s3.html?scenario=A` 至 `?scenario=H`。C 使用实际 M4A fixture 和超限 MP3；G 使用足够长 WAV 在 processing 中验证取消和 input detach；H 从 500KB 规则严格收紧到 250KB。结构化结果见 `docs/evidence/V2-S3/result.json`，详细映射见 `docs/evidence/V2-S3/README.md`。

## 后续授权

V2-S3 已通过独立验收，V2-S4 可以启动。S4 必须对 artifact commit `092ac48` / 上述 SHA 执行真实 Tabbit LR、安全性能、当前 production IIFE 和 200MB 慢速门禁；通过前 V2-S5 保持 `HOLD`，且不得对外宣称 V2 已发布。
