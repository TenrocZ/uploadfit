# V2-S0 编解码与 Tabbit 可行性探针

- 验收状态：`ACCEPTED`（2026-08-21 二次返工补全后复验通过）
- 日期：2026-08-21
- 真实环境：Tabbit `1.10.16.0`；大文件证据使用项目 CDP `9222`，最终 banner/能力/进度后取消复验使用隔离临时 CDP `9333`
- 编码器：精确锁定 `lamejs@1.2.1`；完整许可、来源、NOTICE 和替换重建说明在 `licenses/`

## 本阶段交付

| 交付物 | 说明 |
|---|---|
| `capability-matrix.json` | 真实 Tabbit API/Worker/WASM/codec 能力及三类候选方案 |
| `tabbit-capability-safe-snapshot.json` | 去敏的真实 Tabbit 原始能力、codec config/resolvedConfig、最终小烟测与进度后取消结果 |
| `audio-200-to-100.json` | 200,000,044-byte PCM32 WAV → 20,834,880-byte、可独立解码 MP3 |
| `resource-profile.json` | 256KiB 选定输入块、PCM/输出峰值、189ms heartbeat 与边界 |
| `cleanup.json` | 真实成功/取消的 Worker、对象 URL、无持久化结果 |
| `fixture-manifest.json` | 合成输入参数、SHA-256、取证后删除声明 |
| `result.json` | 最终 production/probe bytes/SHA、许可、范围和限制 |
| `tabbit-audio-200-to-100.png` | 去敏真实 Tabbit 结果截图（不含路径/账号/文件名） |

## 复现实验

```powershell
npm run audio:probe:build
node scripts/audio-probe/run-local.mjs
node scripts/audio-probe/generate-fixture.mjs --bytes=200000004 --bit-depth=32
npm test -- --run tests/unit/audio-capabilities.test.js
npm run check
git diff --check
```

大文件只写入系统临时目录，成功/取消取证后删除，不进入 Git。探针通过 `File.slice()` 分块读 WAV PCM，Worker 内用 `Mp3Encoder.encodeBuffer()` 流式输出，最终 Blob 做完整 MP3 帧扫描，并用独立 `AudioDecoder` 解码首帧样本。

## 真实 Tabbit 结果

- API、Blob Worker 创建/消息/终止/revoke、WASM 初始化、MP3/AAC-LC/Opus decoder 能力均通过；WAV 由探针的 bounded PCM parser 处理，不宣称浏览器存在 WAV container API。原生 MP3 `AudioEncoder` 为 `false`，因此没有冒充原生编码。
- 200,000,044-byte 输入输出 20,834,880 bytes（远低于 100,000,000 硬上限），目标码率 320kbps、mono，完整 MP3 帧扫描 21,703 帧，独立首帧解码通过，duration 未裁剪。
- Worker 运行期间 `maxHeartbeatGapMs=189`（目标 500ms），峰值 PCM 327,680 bytes；编码阶段测得缓冲 21,162,560 bytes，考虑 Blob chunks、独立复检和 SHA-256 `arrayBuffer` 的保守峰值上界为 62,832,320 bytes，单遍编码。
- 同一环境启动后立即取消：`cancelLatencyMs=0.09999990463256836`，Worker/对象 URL 均清理，无半成品持久化。
- 最终带声明的 353,484-byte IIFE 另以 15 秒合成 WAV 做“收到首个 Worker 进度后取消”：取消后新增进度/结果均为 0，Worker/对象 URL 均清理。
- 外部音频请求为 0，持久化音频为 0；fixture 为纯合成信号。

## 许可与分发边界

`lamejs@1.2.1` 精确锁定。npm 包声明 `LGPL-3.0`，但上游根 `LICENSE` 只是短说明、包内还含历史 LGPLv2 COPYING；完整 LGPLv3/GPLv3、上游原文、hash 和差异均被保留。构建脚本将未修改的 minified 模块内嵌到单 IIFE，运行时不 fetch CDN、不创建远程 Worker。分发采用“单 IIFE + 同版本可构建源码/lockfile/许可证/NOTICE/替换重建材料”的组合；裸 Tabbit share URL 不构成完整发布包。UploadFit 本体为 `private` / `UNLICENSED`，不因该依赖自动开源。

## 状态与后续

本目录及 ADR-005 已独立验收为 `ACCEPTED`；S1 同轮通过，V2-S2 已解除前置依赖并可开工。S2 必须沿用冻结版本/分发模型，并在 production-equivalent 200MB 门禁采集真实 `processingElapsedMs`。S3–S5 仍按阶段顺序等待。
