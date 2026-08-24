# V2-S4 Phase 1 handoff

状态：`IN_PROGRESS`。本 handoff 只交接自动化 QA、安全、格式对抗、快速性能和文档骨架；不申请 `READY_FOR_ACCEPTANCE`，不启动 S5。

## 基线与产物

- 基线：`e9fea4c06f9602125df7434434fc6bbc1fd9f7c4`，开工前 clean。
- Phase 1 commit：以本次 handoff 的 `git rev-parse HEAD` 报告为准（本地聚焦 commit；不在此自行写 ACCEPTED）。
- Node `v22.20.0`，npm `10.9.3`，Windows。
- production `dist/uploadfit.js`：421,348 bytes，SHA-256 `ABFA41EBB606CA0E7ED84F8DEE2F17783CAF0BDFA11CE777FB1BAEFBD173D18A`。
- 旧 V1 `docs/evidence/S4/s4-crop-after.png` 的基线 E2E 自动覆盖已识别并恢复；该文件不属于 V2-S4 提交。

## 已施工文件

- `tests/e2e/v2-audio-scenarios.spec.js`：A01–A18 场景矩阵，含 PCM 六组合、Worker、取消/解绑、两遍编码、注入 fallback、dispose。
- `tests/e2e/v2-audio-security.spec.js`：S01–S06 外联/持久化/恶意输入/伪消息/异常格式/AI/Worker 不可用。
- `tests/e2e/v2-audio-performance.spec.js`：P01–P03 快速进度、heartbeat、取消和连续任务清理。
- `tests/integration/v2-media-regression.test.js`：格式/边界/registry/IIFE 回归。
- `docs/evidence/V2-S4/{README.md,v2-s4-result.json,tabbit-matrix.json}`。
- 本 handoff 及同步的测试、安全、性能、Tabbit、站点和需求矩阵文档。

## 执行记录

| 检查 | 结果 |
|---|---|
| `npm ci` | PASS（开工基线已执行，本阶段未重复） |
| `npm run check` | PASS：25 files / 229 tests；build/static-check PASS |
| Phase 1 定向 runner | PASS：24/24，1 worker |
| 最终 `npm run test:e2e` | PASS：186/186，8 workers，50.1s（含新增 24 项与既有 production/image regression） |
| `git diff --check` | Phase 1 closeout PASS |

A01–A18 精确映射、runner、debug/production 边界以及 process/Worker/injection/submit/retry/encodePasses 记录见 [`../evidence/V2-S4/README.md`](../evidence/V2-S4/README.md)。

## 冻结范围与安全结果

- 合规 MP3 只 passthrough；PCM WAV 16/24/32-bit mono/stereo 走 Worker → MP3；超限 MP3、所有 M4A/AAC 稳定 `AUDIO_CODEC_UNSUPPORTED` 且 Worker=0。
- 定向 24/24 覆盖 A01–A18、格式对抗、伪 Worker taskId、CSP/Worker 不可用和两遍输出上限。
- Phase 1 浏览器安全计数：external audio requests=0、持久化=0、business submit click=0；静态检查 PASS。
- 未新增 decoder、远程依赖、第二 controller、音乐/裁剪/分段/降噪能力。

## Phase 2 阻塞/待办

1. 在当前 production SHA 上，用官方私有脚本和部分网址匹配证明 Tabbit MAIN-world 上下文，完成 LR1–LR10；不得只因 9222 监听就写 PASS。
2. 生成 >200,000,000 bytes 可解码非敏感合成音频，页面 max=100,000,000，实际成功一次和处理中取消一次；记录输入/输出 bytes、SHA、codec、duration、bitrate、channels、耗时、encodePasses、heartbeat、peakBufferedBytes，并清理文件。
3. 受影响产物若重建，更新 production bytes/SHA 并重做对应 Tabbit 证据；不把 S0/S2 历史慢门禁或 `docs/evidence/S4/*` 旧 V1 截图冒充本阶段。
4. 完成后由 `/root` 独立验收；本 Agent 不写 `ACCEPTED`，不启动 S5。
