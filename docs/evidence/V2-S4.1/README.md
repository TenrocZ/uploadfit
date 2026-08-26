# V2-S4.1 验收证据

- 阶段状态：`ACCEPTED`
- 验收基线 commit：`7d6b73a681435ad0f7f80f7eeb7e58bec90e2808`（工作区未提交）
- production：444,989 bytes；SHA-256 `EB77F23278CBCEB739376671D0C1AEEEAC417309DD346EB40CEC2FE99729E030`
- 相对开工 production 421,333 bytes：`+23,656` bytes
- 环境：Windows / Node v22.20.0 / npm 10.9.3 / Tabbit Chromium 151

## 结论

1. MP3→MP3 和 AAC-LC M4A→MP3 均使用真实 Dedicated Blob Worker 解码、冻结的 `lamejs@1.2.1` 编码和独立最终代表窗口解码复检；无新增生产依赖。
2. P02 使用 31,457,453 bytes 的真实 AAC payload，而非 `free` padding；31,818,912-byte M4A 输出 23,095,584-byte MP3。
3. MP3/M4A 取消分别为 3.3ms/2.7ms；`AudioData` 未关闭数 0；最大 active Worker 1，结束 0；取消后复用通过。
4. Podcastools 的规则、时长负例、12MB MP3 正例和 10.19MB M4A 正例均由当前 production IIFE 在 Tabbit 实测通过；业务 submit click=0。
5. VocaText 30MB WAV 的 25MB transient toast 被捕获，保留 accept 格式后形成可执行计划，输出 6,251,520-byte MP3并只重试一次；submit click=0。
6. `npm run check` 为 25 files / 250 tests PASS；完整 E2E 204/204 PASS；static-check 和 `git diff --check` PASS。

## 验收修复

- 完整 M4A 的截断尾 box 不再被头部前缀容错误接受。
- M4A sample 按不超过 4MiB 的连续 batch 读取，避免每 access unit 一次 `File.slice()`。
- 音频生产处理默认上限为 15 分钟，取消门禁仍为 1 秒。
- resolver 忽略候选中的空数组字段，size-only rejection 不再擦除 accept 的格式证据。

## 索引

- [`result.json`](result.json)：最终 bundle、测试、资源和修复摘要。
- [`capability-matrix.json`](capability-matrix.json)：浏览器/Worker 支持子集。
- [`codec-matrix.json`](codec-matrix.json)：R/C/P/S/G 工单矩阵。
- [`tabbit-matrix.json`](tabbit-matrix.json)：Podcastools、VocaText 与本地 production 实机结果。
- [`fixture-manifest.json`](fixture-manifest.json)：非敏感合成 fixture 参数。
- [`../../handoffs/V2-S4.1-final-acceptance.md`](../../handoffs/V2-S4.1-final-acceptance.md)：最终验收报告。

证据只保留元数据与统计，不记录 PCM、Base64、账号、Tabbit 私有脚本 ID 或用户音频内容。所有正例 fixture 均为无版权风险的合成数据；大型二进制未提交。
