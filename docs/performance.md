# UploadFit V2-S4 性能记录（Phase 1）

## 快速自动化

状态为 `IN_PROGRESS`。`v2-audio-performance.spec.js` P01–P03 在定向 runner 中 3/3 通过：

- P01：Worker 处理小型 PCM WAV，progress 单调、事件频率 ≤10/s、heartbeat 最大间隔 ≤500ms、输出 ≤规则上限，记录 cleanup/encodePasses。
- P02：收到 encode progress 后取消，`AUDIO_PROCESSING_CANCELLED` 在 ≤1,000ms 返回，无迟到 progress/result，Worker/object URL/queue 清理通过。
- P03：连续两个任务分别完成，Worker/object URL 清理字段完整，无 stale state。

这是浏览器 debug harness 的快速门禁，不是 Tabbit 结果；生产页音频/图片回归进入最终 `npm run test:e2e`。实际 >200,000,000-byte 成功/取消门禁属于 Phase 2，当前 `NOT_RUN_PHASE_2`，不得引用 S0/S2 历史慢门禁冒充本轮。

production `dist/uploadfit.js`：421,348 bytes，SHA-256 `ABFA41EBB606CA0E7ED84F8DEE2F17783CAF0BDFA11CE777FB1BAEFBD173D18A`。

## 历史 S5 性能记录

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
