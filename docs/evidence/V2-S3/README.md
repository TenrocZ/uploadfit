# V2-S3 证据目录

状态：`ACCEPTED`。2026-08-24 由 `/root` 在 Luna Max 完成返工后独立复验通过。V2-S4 前置条件已满足、可以开工；V2-S5 继续 `HOLD`。

## 验收范围

S3 把冻结的音频 handler 接入正式 `TaskController`、closed Shadow DOM UI、DataTransfer 回填、拒收观察和生命周期清理。功能边界仍遵守 [ADR-005](../../decisions/ADR-005-V2-S0-音频编解码方案.md)：

| 输入 | 已验收行为 | process/Worker |
|---|---|---:|
| 合规 MP3 | 原 `File` passthrough，不替换 input | 0/0 |
| PCM WAV，16/24/32-bit，mono/stereo | 先确认，再由冻结 `lamejs@1.2.1` 编码 MP3，独立复检后回填 | 1/1 |
| 超限 MP3 | `AUDIO_CODEC_UNSUPPORTED`，保留原文件 | 0/0 |
| M4A/AAC | `AUDIO_CODEC_UNSUPPORTED`，保留原文件 | 0/0 |
| 仅 duration、无可信 maxBytes、目标不允许 MP3 | 稳定安全停止，不裁剪、不分段 | 0/0 |

没有新增 decoder、远程 runtime 依赖、第二套 controller 或业务自动提交。真实 Tabbit 与 200MB 慢速门禁属于 S4，不以 S2/S3 自动化冒充。

## 首轮验收与返工闭环

首轮独立验收未放行，并形成 [V2-S3 验收返工单](../../handoffs/V2-S3-acceptance-rework-order.md)（`ee18af3`）。最终关闭三项 Must：

| 项目 | 修复提交 | 独立复验结论 |
|---|---|---|
| R3-1 拒收 retry 缺少“严格收紧”门禁 | `c04e1a8` | 相同、放宽、无关、仅 duration、官方/原始/无损及不允许 MP3 的新规则均不再处理；只有支持范围内严格收紧才允许至多一次 retry |
| R3-2 音频 UI 证据、文案与进度不完整 | `ab60dc3` | 规则来源/有界原文可见，音频等待文案正确，数值进度不再滑动，双确认和安全文本渲染有真实 UI E2E |
| R3-3 A–H 稳定页证据不足 | `a430d91` | C 使用实际 M4A 和超限 MP3，G 使用足够长 WAV 验证取消/脱离，H 使用 500KB→250KB 的严格收紧规则 |

## A–H 覆盖

| 场景 | 入口 | 最终证据 |
|---|---|---|
| A 合规 MP3 直通 | `audio-s3.html?scenario=A` | production flow，process/injection=0 |
| B PCM WAV→MP3 | `audio-s3.html?scenario=B` | 确认、Worker、最终复检、DataTransfer 回填 |
| C 超限 MP3/M4A 停止 | `audio-s3.html?scenario=C` | 实际 M4A fixture 与超限 MP3 均稳定停止，process/Worker=0 |
| D 无 maxBytes 停止 | `audio-s3.html?scenario=D` | 规则不足安全停止 |
| E MP3 不允许停止 | `audio-s3.html?scenario=E` | `AUDIO_OUTPUT_FORMAT_NOT_ALLOWED`，不处理 |
| F 仅 duration 停止 | `audio-s3.html?scenario=F` | `AUDIO_DURATION_LIMIT_UNFIXABLE`，不裁剪/分段 |
| G 取消/脱离 | `audio-s3.html?scenario=G` | 长 WAV processing 中 abort，迟到结果隔离、原文件保持 |
| H 严格收紧 retry | `audio-s3.html?scenario=H` | 500KB→250KB，至多一次关联 retry，submit click=0 |

## 独立验证

| 范围 | 命令 | 结果 |
|---|---|---|
| Unit/集成/production 静态检查 | `npm run check` | PASS：25 个 Vitest 文件、229 项；production 421348 bytes；static-check PASS |
| Debug IIFE | `npm run build:test` | PASS：427067 bytes |
| S3 定向 | `node scripts/run-e2e.js tests/e2e/v2-audio-s3-controller.spec.js tests/e2e/v2-audio-s3-ui.spec.js tests/e2e/v2-audio-s3.spec.js --reporter=line --workers=1` | PASS：15/15 |
| 全量 E2E（返工后一次） | `node scripts/run-e2e.js --reporter=line --workers=1` | PASS：162/162 |
| 返工 diff | `git diff ee18af3..a430d91 --check` | PASS |
| 调试残留扫描 | debug marker scan | PASS：0 命中 |

最终 production artifact 为 `dist/uploadfit.js`，421348 bytes，SHA-256 `ABFA41EBB606CA0E7ED84F8DEE2F17783CAF0BDFA11CE777FB1BAEFBD173D18A`，提交 `092ac48`。它仍是可直接粘贴的单 IIFE，首行保留 `lamejs 1.2.1` LGPL notice。

## 隐私、回填与限制

- snapshot/logger 不保存文件名、File/Blob、tags、PCM、Base64 或原始异常；恶意 evidence 只作为文本呈现。
- 最终复检后才使用 `DataTransfer` 注入；注入异常回滚到原文件，并提供下载/人工降级。
- 关闭、换文件、input detach、pagehide 和取消均清理；迟到 Worker 消息不能再次注入。
- 业务提交按钮自动点击次数固定为 0。
- 超限 MP3 重编码与 M4A/AAC 转码仍是明确限制；解禁必须按 ADR-005 条件 4 新开 ADR。
- S4 仍须执行当前 SHA 的真实 Tabbit LR 门禁和 200MB 慢速门禁。
