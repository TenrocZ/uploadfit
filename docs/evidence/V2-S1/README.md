# V2-S1 证据目录

状态：`ACCEPTED`（2026-08-21 独立复验通过）。

本阶段交付音频上传器发现、规则归一/解析、MP3/WAV/AAC-LC M4A 有界签名与元数据检查，以及不执行处理的 validation。R1 返工修复了真实 `data` chunk 大于 1MiB 的 PCM WAV header-only 解析；S1 仍没有编码器、Worker、确认 UI 或回填改动。

## 自动化证据

| 范围 | 结果 |
|---|---|
| 全量 unit | `npm test -- --run`：23 个文件、209 个测试通过 |
| S1 discovery | 2 个 Playwright 用例通过；无业务提交点击、外部音频请求 0 |
| 全量 E2E 回归 | 118 个 Playwright 用例通过；辅助服务收尾有既有 8765 端口告警，未影响断言 |
| R1 定向回归 | 2,400,044-byte、2,400,000-byte data chunk 的 48kHz/16-bit/双声道 WAV 通过；`inspectedBytes <= 1MiB` |
| 负例 | forged/truncated/zero data、blockAlign/byteRate 不一致继续稳定失败 |

大 WAV fixture 参数和 SHA 在 `fixture-manifest.json`；只在内存中生成，未提交 PCM。

## 资源与隐私

- 元数据只读取 `File.slice(...).arrayBuffer()` 的有界片段，默认不超过 1MiB；大 `data` chunk 只依据 header 声明长度和 `File.size` 计算 duration，不读取完整 PCM。
- snapshot 不含文件名、标签、原始字节；音频模块不调用网络、Storage、AI 或 Worker。
- `AbortSignal` 在读取前和每个分片后检查，取消返回稳定 `AUDIO_PROCESSING_CANCELLED`。

## 与 S0 的关系

S0 handoff/ADR 和真实 Tabbit 证据位于 `docs/handoffs/V2-S0-handoff.md`、`docs/evidence/V2-S0/`，均已独立验收。S1 的 MP3/PCM WAV/AAC-LC M4A 子集与 S0 冻结证据一致，依赖门禁已关闭。

## 已知限制

WebM/Opus、裸 AAC、压缩 WAV、复杂 BMFF 和伪造/截断容器稳定停止；S1 不执行转码/规划/确认/回填。S2 已解除前置依赖，可按冻结契约开工；S3–S5 继续按阶段顺序等待。
