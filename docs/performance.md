# UploadFit V2-S4 性能记录（Phase 1 + Phase 2A1）

## V2-S4.1 压缩输入增量（2026-08-25）

31,458,240-byte 真 MP3 → 22,021,440-byte MP3：最终全量处理 45,279.2ms，heartbeat 最大 41ms，peak buffered 26,216,128 bytes，最大 residual 448 bytes、decode queue 8，单次编码，输出时长误差 22.63ms，最终首/中/尾代表窗口 3/3 真解码，未关闭 `AudioData=0`。处理中取消 3.3ms。

31,818,912-byte M4A 含 31,457,453-byte 真实 AAC payload、90,215 access units，验证 `co64`、`moov` after `mdat` 与有界 batch 读取；输出 23,095,584-byte MP3，总处理 135,104.5ms，heartbeat 最大 20.4ms，max slice 4,194,099 bytes，decode queue 8，未关闭 `AudioData=0`。M4A 取消 2.7ms；随后任务复用成功；active Worker 最大 1、结束 0。P02/P03/P04 均 PASS。

## 快速自动化

状态为 `IN_PROGRESS`。四文件 Phase 1 定向 runner 本轮实测 `31/31` 通过（workers=1）。`v2-audio-performance.spec.js` 的 P01/P02/P03 与 Q-S4-P06/P07 均通过；P03 原用例明确是 sequential cleanup harness，Q-S4-P07 才是同页 TaskController 排队证据：两个任务完成，`maxProcessing=1`、`maxActiveWorkers=1`、结束后 active Workers=0。

- P01/Q-S4-P06 `[DEBUG_DIRECT_PIPELINE_REAL_WORKER]`：直接 `processAudio` pipeline 处理小型 PCM WAV，最终全量样本五段耗时实测 inspect=3.8ms、plan=1.4ms、confirm=0.5ms、process=225.8ms、validate=3.7ms；progress 单调 4 次、频率上限 10/s、heartbeat 最大间隔 108.4ms、encodePasses=1、输出 81,502 bytes，并完成独立复检和 cleanup。
- P02 `[DEBUG_DIRECT_PIPELINE_REAL_WORKER]`：直接 pipeline 收到 encode progress 后取消，`AUDIO_PROCESSING_CANCELLED` 在 ≤1,000ms 返回，无迟到 progress/result，Worker/object URL/queue 清理通过。
- P03：连续两个任务分别完成，Worker/object URL 清理字段完整，无 stale state；该项是顺序清理补充，不冒充队列并发测量。

Phase 2A1 复用现有真实门禁对当前 handler/Worker 重新实测：200,000,044-byte PCM32 WAV 在 36,967ms 内输出 20,834,880-byte MP3，单次编码、独立帧校验通过、peakBufferedBytes=26,825,856、最大 heartbeat gap=112.1ms；处理中取消延迟 8.2ms，无部分输出，随后小任务复用成功。它证明大文件核心性能，但不冒充精确 Tabbit LR4。

production `dist/uploadfit.js`：421,333 bytes，SHA-256 `98BD12C651C2801E2E2E8BC9C2A006057024AA26E2D916B33899487B9A0F1A68`。2026-08-25 的上传器分类/单文件门禁修复不改变图片或音频处理算法，未重复消耗 200MB 慢门禁。

## 历史 S5 性能记录（非 V2-S4 证据）

## 门禁

S5 要求单次处理总耗时不超过 5 秒、连续主线程冻结不超过 500ms，输出尺寸和字节必须再次通过最终校验。本页记录一次 S5 性能用例执行的六个样本；bytes 不设固定产物体积门禁，按用户裁决只记录 raw bytes/SHA。

环境：Windows，Node `v22.20.0`，Playwright Chromium `1.62.1`；输入为确定性 fixture `jpeg-4000x3000.jpg`，4,944,335 bytes，4000×3000，输出规则最大 2000×2000、500,000 bytes。

## 样本

| 模式 | 次数 | 总耗时 ms | 最大 heartbeat 间隔 ms | 输出 bytes | 输出尺寸 | 有效 |
|---|---:|---:|---:|---:|---|---|
| Worker | 1 | 742.6 | 249.8 | 440,409 | 1647×1235 | PASS |
| Worker | 2 | 801.9 | 279.5 | 440,409 | 1647×1235 | PASS |
| Worker | 3 | 780.1 | 295.9 | 440,409 | 1647×1235 | PASS |
| main thread | 1 | 852.0 | 301.3 | 440,409 | 1647×1235 | PASS |
| main thread | 2 | 939.6 | 326.8 | 440,409 | 1647×1235 | PASS |
| main thread | 3 | 971.5 | 353.1 | 440,409 | 1647×1235 | PASS |

六个样本均满足 5,000ms、500ms、2,000px 和 500,000 bytes 门禁。自动化来源：[`s5-performance.spec.js`](../tests/e2e/s5-performance.spec.js)；既有 S2 性能用例也在最终全量 E2E 中通过。

## 清理与回退

Worker 成功、构造失败、运行时错误、超时和 main-thread fallback 的对象 URL、Worker 终止及 abort 清理由既有集成测试覆盖；S5 X12 继续验证 dispose 后 host/session 和后续 DOM 观察均停止。真实 Tabbit 同环境性能仍需在平台矩阵中补测，不能从 Chromium 样本外推为平台通过。
