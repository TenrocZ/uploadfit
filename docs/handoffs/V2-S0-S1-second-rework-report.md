# V2-S0 / V2-S1 二次返工完成报告

- 日期：2026-08-21
- 执行者：主验收 Agent（按用户授权直接补全）
- 对应施工单：`docs/handoffs/V2-S0-S1-second-acceptance-rework-order.md`
- 结果：R2-1～R2-4 全部关闭；V2-S0、V2-S1 可进入最终签收
- 选择路径：A，继续精确锁定 `lamejs@1.2.1`

## 1. R2-1 分发方案与许可证材料

UploadFit 本体在 `package.json` 中明确为 `private: true` / `license: UNLICENSED`，没有因引入第三方依赖而自动授予项目级开源许可。含编码器的运行产物冻结为以下组合分发模型：

```text
单个 Tabbit 可粘贴 IIFE
  + IIFE 内 prominent third-party banner
  + 同版本可构建的 UploadFit 源码、package-lock 和构建脚本
  + 完整许可证、NOTICE、来源/hash 与替换重建说明
```

因此裸 Tabbit share URL 不是完整公开发布物。S5 必须给出稳定公开源码/许可证位置，否则必须移除编码器或停止公开发布。这是工程门禁，不是法律意见。

已完成：

- `package.json` / `package-lock.json` 将 `lamejs` 从范围依赖改为精确 `1.2.1`；`npm ls` 解析为 `lamejs@1.2.1 -> use-strict@1.0.1`。
- 保存完整 `LGPL-3.0.txt` 与其引用的 `GPL-3.0.txt`。
- 同时保留 npm 包根 424-byte 上游说明、包内历史 GNU Library GPL v2 COPYING 和传递依赖 ISC 文本，避免把不同上游材料混称为同一许可证。
- `NOTICE.md` 记录来源、版本、integrity、原始 JS hash、未修改事实和组合方式。
- `RELINKING.md` 给出随附材料、有限替换/调试权限、锁定版本重建和更换兼容编码器后的重建/复测命令。
- `provenance.json` 记录来源与文件 hash。
- `scripts/audio-probe/build.mjs` 在最终 IIFE 内保留 220-byte prominent notice，并指向随附许可/重建材料。

材料索引：

- `docs/evidence/V2-S0/licenses/NOTICE.md`
- `docs/evidence/V2-S0/licenses/RELINKING.md`
- `docs/evidence/V2-S0/licenses/provenance.json`
- `docs/evidence/V2-S0/licenses/LGPL-3.0.txt`
- `docs/evidence/V2-S0/licenses/GPL-3.0.txt`
- `docs/evidence/V2-S0/licenses/lamejs-embedded-COPYING-LGPL-2.0.txt`
- `docs/decisions/ADR-005-V2-S0-音频编解码方案.md`

## 2. R2-2 三类候选对比

ADR-005 与 `capability-matrix.json` 已补齐准确候选：

| 类别 | 准确版本/环境 | 体积与运行方式 | 结论 |
|---|---|---|---|
| 原生 WebCodecs | Tabbit 1.10.16.0 / Chrome 150 | 0-byte 依赖；真实环境 MP3 encoder 不支持，MP3/AAC-LC/Opus decoder 支持 | 拒绝作为 MP3 encoder |
| 纯 JavaScript | `lamejs@1.2.1` | 上游 minified 156,043 bytes；分块 PCM、Worker、本地单 IIFE；已通过 200MB 门禁 | 选定，随附可替换源码/许可包 |
| 小型 WASM | `wasm-media-encoders@0.7.0` | 上游 MP3 JS 3.3KiB + WASM 130KiB，内嵌 Base64 还会膨胀；可分块/Worker，但 LAME payload 分发链未优于选定方案且未跑 200MB | 拒绝，避免许可证/复测成本 |

`@ffmpeg/core@0.12.10` 只保留为完整 ffmpeg WASM 的 out-of-scope 否决参考，不冒充第三类轻量候选。

## 3. R2-3 字段语义与取消证据

- `audio-200-to-100.json` 已将 520,868.8ms 放回 `output.durationMs` / `verification.durationMs`；它是媒体时长，不再冒充处理耗时。
- `runtime.processingElapsedMs` 诚实记录为 `null`，状态为原大文件运行未采集；S2 production-equivalent 200MB 门禁强制采集。
- 原 200MB 立即取消证据保留。
- 新增最终带 banner 构建的“收到第一次 Worker progress 后再取消”实测：输入 2,880,044-byte、15 秒合成 PCM16 WAV；`progressBeforeCancel=1`，取消后新增 progress/result 均为 0，`AbortError/AUDIO_PROCESSING_CANCELLED`，Worker terminated、object URL revoked、无半成品。

证据：`docs/evidence/V2-S0/audio-200-to-100.json`、`resource-profile.json`、`cleanup.json`、`tabbit-capability-safe-snapshot.json`。

## 4. R2-4 真实 Tabbit 原始安全快照

使用隔离临时 Tabbit profile/CDP `9333` 在真实 Tabbit `1.10.16.0` / Chrome `150.0.7871.129` 采集；日常 profile 与既有进程未被修改，取证后临时进程/profile 已清理。

快照保留：

- File/Blob/File.stream、ReadableStream、TransformStream、Worker、WASM；
- AudioContext、OfflineAudioContext；
- ArrayBuffer / MessagePort / ReadableStream Transferable；
- Blob Worker 创建、消息、终止和 URL revoke；
- MP3/AAC-LC/Opus decoder/encoder 的输入 config、supported、resolvedConfig 和 error；
- Tabbit/Chrome 版本、最终 probe bytes/SHA；
- 最终 banner build 小文件编码与进度后取消结果。

快照不含账号、脚本 ID、用户 profile 路径、文件名或音频内容：`docs/evidence/V2-S0/tabbit-capability-safe-snapshot.json`。

## 5. 最终构建身份与大文件证据复用

```text
最终 probe IIFE：353,484 bytes
最终 SHA-256：878ABD08E561E627E9C3024C367ADA4036F9C481AC304FE8617DC2D9C0B4EAED
prominent notice：220 bytes（纯注释）
可执行 payload：353,264 bytes
payload SHA-256：342F301006D05FD5950EB4CD8ED1F66EEC9E7E8C56280D211616B3995E3AD4C8
```

可执行 payload 与已通过 200,000,044-byte 大文件门禁的构建逐字节身份一致，因此按返工单路径 A 不重复 200MB。最终 banner build 已在真实 Tabbit 做小文件编码、独立解码、完整帧扫描和进度后取消烟测。

## 6. 实际验证

```powershell
npm run audio:probe:build
npm test -- --run tests/unit/audio-signatures.test.js tests/unit/audio-metadata.test.js tests/unit/audio-capabilities.test.js tests/unit/audio-rules.test.js tests/unit/audio-validation.test.js tests/integration/audio-discovery.test.js
npm run check
git diff --check
npm ls lamejs use-strict --all
```

结果：

- probe build：PASS；353,484 bytes，SHA 如上，单 IIFE，无 forbidden runtime matches。
- 定向：5 files / 48 tests PASS。
- 全量：23 files / 209 tests PASS；production build 185,068 bytes，SHA `8BBBD1CB9564E2A6D01E53ABEC71B8B6D46AABB765FA90C16C3C7960E7EE404E`；static-check PASS。
- `git diff --check`：PASS，仅输出既有 Windows LF/CRLF 转换提醒，无 whitespace error。
- JSON：`docs/evidence/V2-S0` 下 9 个 JSON 全部可解析。
- 未重跑 200MB：是，理由为最终 executable payload 与已测版本 bytes/SHA 完全相同。

## 7. 退出结论

R2-1～R2-4 和返工单全部退出项均已关闭。V2-S0 可签收；S1 实现此前已通过且依赖门禁随 S0 关闭，可同轮签收。后续唯一持续约束不是开放阻塞，而是 S2/S5 必须遵守的冻结合同：S2 采集真实墙钟耗时，S5 随候选包提供稳定源码/许可证/NOTICE/重建位置。
