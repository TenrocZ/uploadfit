# UploadFit V2-S4 性能记录（Phase 1 + Phase 2A1）

## 快速自动化

状态为 `IN_PROGRESS`。四文件 Phase 1 定向 runner 本轮实测 `31/31` 通过（workers=1）。`v2-audio-performance.spec.js` 的 P01/P02/P03 与 Q-S4-P06/P07 均通过；P03 原用例明确是 sequential cleanup harness，Q-S4-P07 才是同页 TaskController 排队证据：两个任务完成，`maxProcessing=1`、`maxActiveWorkers=1`、结束后 active Workers=0。

- P01/Q-S4-P06 `[DEBUG_DIRECT_PIPELINE_REAL_WORKER]`：直接 `processAudio` pipeline 处理小型 PCM WAV，最终全量样本五段耗时实测 inspect=3.8ms、plan=1.4ms、confirm=0.5ms、process=225.8ms、validate=3.7ms；progress 单调 4 次、频率上限 10/s、heartbeat 最大间隔 108.4ms、encodePasses=1、输出 81,502 bytes，并完成独立复检和 cleanup。
- P02 `[DEBUG_DIRECT_PIPELINE_REAL_WORKER]`：直接 pipeline 收到 encode progress 后取消，`AUDIO_PROCESSING_CANCELLED` 在 ≤1,000ms 返回，无迟到 progress/result，Worker/object URL/queue 清理通过。
- P03：连续两个任务分别完成，Worker/object URL 清理字段完整，无 stale state；该项是顺序清理补充，不冒充队列并发测量。

Phase 2A1 复用现有真实门禁对当前 handler/Worker 重新实测：200,000,044-byte PCM32 WAV 在 36,967ms 内输出 20,834,880-byte MP3，单次编码、独立帧校验通过、peakBufferedBytes=26,825,856、最大 heartbeat gap=112.1ms；处理中取消延迟 8.2ms，无部分输出，随后小任务复用成功。它证明大文件核心性能，但不冒充精确 Tabbit LR4。

production `dist/uploadfit.js`：421,347 bytes，SHA-256 `842FA9AB712C028AB1B9A94526B4FBEE175016A73E5B944A3987BFAC169A78D0`。

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
