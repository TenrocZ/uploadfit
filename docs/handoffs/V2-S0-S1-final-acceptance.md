# V2-S0 / V2-S1 最终验收结论

- 验收日期：2026-08-21
- 验收角色：主验收 Agent
- V2-S0：`ACCEPTED`
- V2-S1：`ACCEPTED`
- V2-S2：`RELEASED_TO_START`
- 对应返工：`docs/handoffs/V2-S0-S1-second-acceptance-rework-order.md` → `CLOSED`
- 施工留痕：`docs/handoffs/V2-S0-S1-second-rework-report.md`

## 验收判定

| 范围 | 结论 | 核心依据 |
|---|---|---|
| S0 技术可行性 | PASS | 真实 Tabbit、200MB→100MB、Worker/heartbeat/内存/取消/清理、单 IIFE 均有证据 |
| S0 编码器与分发合同 | PASS | 精确版本、三类候选、完整许可证/NOTICE/provenance、prominent banner、可替换重建材料已冻结 |
| S0 证据语义 | PASS | 媒体时长与墙钟处理耗时已拆分；原运行未采集值诚实为 null；S2 采集义务已写入 |
| S0 最终构建身份 | PASS | 新构建仅增加 220-byte 纯注释，剥离后 payload bytes/SHA 与 200MB 已测构建完全一致；真实 Tabbit 小烟测通过 |
| S1 实现 | PASS | 发现、规则、签名、有界元数据、安全停止与图片回归通过 |
| S1 前置依赖 | PASS | S0 已在本轮签收 |

## 门禁结果

- 定向测试：5 files / 48 tests PASS。
- 全量检查：23 files / 209 tests、production build、static-check PASS。
- Production：185,068 bytes；SHA-256 `8BBBD1CB9564E2A6D01E53ABEC71B8B6D46AABB765FA90C16C3C7960E7EE404E`。
- S0 probe：353,484 bytes；SHA-256 `878ABD08E561E627E9C3024C367ADA4036F9C481AC304FE8617DC2D9C0B4EAED`。
- `git diff --check` PASS；仅有 LF/CRLF 信息提示。

## 对 S2 的冻结输入

1. 使用精确 `lamejs@1.2.1`，不得静默升级或换 encoder；变化必须新 ADR 并重跑 codec/Tabbit/200MB 门禁。
2. 沿用单 IIFE、内嵌 Blob Worker、无远程运行时依赖，以及 relinkable source/license release package 分发模型。
3. 输入子集冻结为 MP3、PCM WAV 16/24/32-bit 单/双声道、AAC-LC M4A；其余稳定停止。
4. 保持 bounded reads / bounded PCM / Worker cancellation contract。
5. S2 production-equivalent 200MB 证据必须新增真实 `processingElapsedMs`，不得用媒体 duration 代替。
6. S5 公开候选必须提供稳定源码/许可证/NOTICE/替换重建位置；裸 share link 禁止作为完整发布物。

结论：没有遗留阻断项，V2-S2 可以按原计划开工。S3–S5 不提前解锁。
