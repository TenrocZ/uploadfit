# V2-S0 / V2-S1 二次独立验收与最小返工单

> 状态：`CLOSED`。R2-1～R2-4 已由主验收 Agent 补全并复验通过；施工留痕见 `V2-S0-S1-second-rework-report.md`，最终结论见 `V2-S0-S1-final-acceptance.md`。

- 验收日期：2026-08-21
- 验收对象：`docs/handoffs/V2-S0-S1-rework-report.md`
- V2-S0 结论：`REWORK_REQUIRED_DISTRIBUTION_GATE`
- V2-S1 结论：`IMPLEMENTATION_PASS_DEPENDENCY_HOLD`
- V2-S2：`HOLD`
- 原则：保留已经通过的编码、大 WAV 和 Tabbit 证据；本轮只关闭选型与公开分发门禁，不重复无关开发。

## 1. 验收摘要

### 已通过，可直接保留

| 项目 | 独立复验结果 |
|---|---|
| 真实大 WAV header-only 解析 | PASS；`data > 1 MiB` 时不再要求 PCM payload 驻留，仍校验声明长度、File.size、PCM 参数和正时长 |
| 定向测试 | PASS；5 个文件、48 个测试 |
| 全量检查 | PASS；23 个 Vitest 文件、209 个测试，production build 与 static-check 通过 |
| Production bundle | 185,068 bytes；SHA-256 `8BBBD1CB9564E2A6D01E53ABEC71B8B6D46AABB765FA90C16C3C7960E7EE404E` |
| S0 探针构建 | 353,264 bytes；SHA-256 `342F301006D05FD5950EB4CD8ED1F66EEC9E7E8C56280D211616B3995E3AD4C8`；单 IIFE、无远程运行时依赖 |
| Tabbit 200MB→100MB | 证据链可接受：200,000,044-byte PCM32 WAV → 20,834,880-byte MP3，Worker/heartbeat/清理成立 |
| S1 发现、规则、元数据与安全停止 | 实现层面 PASS；没有发现新的代码阻断项 |

### 当前不能签收的原因

S0 的任务目标不仅是“编码成功”，还要求证明选定编码器可以按 UploadFit 的公开单文件方式合法分发，并冻结可供 S2 直接采用的版本和分发方式。当前材料没有关闭该门禁：

1. `lamejs@1.2.1` 的 npm 包声明为 `LGPL-3.0`，上游 `LICENSE` 只有 424-byte 使用说明，并明确把“作为单独的 `lame.min.js` / `lame.all.js` 链接”列为最容易满足条件的方式。
2. 当前 `scripts/audio-probe/build.mjs` 把 `lame.min.js` 直接内嵌进同一个 Worker/IIFE，`legalComments: 'none'`，不是 ADR/NOTICE 所称的“separate linked encoder asset”。
3. 仓库只保存了上述 424-byte 上游说明和自写 NOTICE，没有随交付保存完整 LGPLv3/GPLv3 文本，也没有说明用户如何替换该库并重建组合产物。
4. 根 `package.json` 没有项目许可证或公开源码仓库地址，当前也没有 Git remote。因此“未来继续携带 NOTICE”不能证明实际公开分发路径已经成立。
5. 原 S0 任务书要求至少比较三类候选，并为每类记录准确版本、来源、许可、构建体积、流式能力、性能和限制；当前矩阵只有 `lamejs` 完整，WASM 候选仍为 `version=NOT_SELECTED`、`licenseSpdx=UNKNOWN`，`ffmpeg-wasm` 也写为 `not evaluated`。

这不是要求更换 `lamejs`，也不是法律结论；它表示当前工程证据不足以让验收方批准“可公开分发的 production 单 IIFE”。S2 任务书要求直接采用 S0 冻结的编解码器版本和分发方式，所以不能把该问题推到 S2 实现完成以后。

参考原始材料：

- lamejs 上游声明：<https://github.com/zhuker/lamejs/blob/master/LICENSE>
- GNU LGPLv3/GPLv3 完整文本与 Combined Work 条件：<https://www.gnu.org/licenses/lgpl+gpl-3.0-standalone.html>

## 2. 必须完成的返工

### R2-1：冻结一种真实可执行的分发方案

严重级别：`BLOCKER`

只能选择以下两条路径之一，并在 ADR 中明确选择，不能把两种口径混写。

#### 路径 A：继续使用 `lamejs@1.2.1`

至少完成：

1. 明确 UploadFit 最终发布形态和项目许可证；如需项目所有者裁决，应在报告中把具体选择列为唯一待确认项，不得自行假设。
2. 保存完整、来源可追踪的 LGPLv3 与其引用的 GPLv3 许可证文本；424-byte 上游 FAQ 只能作为补充，不能命名为完整 LGPL 原文。
3. 说明组合产物采用 LGPLv3 第 4 节哪条合规路径，并提供工程上可执行的替换/重建方式：
   - 精确依赖版本；
   - 对应源码来源；
   - UploadFit application/build code；
   - 用户替换兼容版本并重新生成单 IIFE 的命令；
   - 是否修改上游及修改差异。
4. 修正“separate linked asset”表述。当前 esbuild 产物是内嵌组合 IIFE；除非构建结构确实改变，不得称为独立文件链接。
5. 为未来公开 production 产物定义 prominent notice 的实际承载位置及稳定源码/许可证地址。只写仓库内相对路径不足以说明 Tabbit 分享后的获取方式。
6. 把 `package.json` 中 `"lamejs": "^1.2.1"` 改为精确版本 `"lamejs": "1.2.1"`，同步 lockfile。
7. ADR 状态仍只能申请 `PROPOSED_FOR_ACCEPTANCE`；不得由施工 Agent 自行写为 `ACCEPTED`。

如团队无法确认 LGPL 组合分发条件是否满足，应取得许可证/法务复核，或改走路径 B；验收 Agent 不代替法律意见。

#### 路径 B：更换为允许当前公开单 IIFE 方式的编码器

至少完成：

1. 准确包名、版本、官方来源、SPDX 与完整许可证；
2. Worker 分块 PCM 输入、分块 MP3 输出、无远程依赖；
3. minified 单 IIFE 增量和 NOTICE；
4. 小文件自动化与真实 Tabbit 烟测；
5. 因编码器行为发生变化，必须重新执行一次最终 200MB→100MB、独立复检、heartbeat 和取消门禁。

不得只更换 npm 包名但继续嵌入来源/许可证不清晰的 LAME 派生代码。

### R2-2：补齐三类候选对比

严重级别：`HIGH`

在 ADR-005 或独立附表中实际比较：

1. 浏览器原生 WebCodecs + 轻量 demux/decode；
2. 轻量纯 JavaScript MP3 编码器；
3. 一个准确可识别的内嵌 WASM 编码器/解码器方案。

每类必须记录：准确实现/浏览器版本、官方来源、SPDX/许可证路径、minified 或预计单 IIFE raw bytes、是否运行时加载、是否分块、Worker 可用性、200MB 内存/性能事实或保守估算、维护状态和否决原因。

`UNKNOWN`、`NOT_SELECTED`、`not evaluated` 可以作为调研中状态，但不能计入“已完成比较”的三类方案。完整 `ffmpeg.wasm` 仍只作否决对照，不能冒充第三个轻量候选。

### R2-3：纠正证据字段含义

严重级别：`MEDIUM`，不要求为此单独重跑 200MB

`audio-200-to-100.json` 当前的 `runtime.durationMs=520868.8` 实际是输出媒体时长，不是处理耗时。必须：

- 改名为 `output.durationMs` 或 `verification.durationMs`；
- 新增 `runtime.processingElapsedMs`；若旧实机运行没有采集，诚实写 `null` 和 `NOT_CAPTURED_IN_ACCEPTED_RUN`，不得用媒体时长冒充墙钟耗时；
- 在 S2 的 production-equivalent 200MB 门禁中强制采集真实 elapsed time；
- README/handoff/ADR 同步相同含义。

取消证据应说明取消发生在 Worker 已创建/任务已投递后。若无法从旧证据证明出现过至少一次处理进度，只需用小型或中型合成 fixture 增加一次“收到进度后取消”烟测，记录取消后的新进度/结果数为 0；无需仅为取消再跑 200MB。

### R2-4：保存真实 Tabbit 能力探针原始安全快照

严重级别：`MEDIUM`

当前 `capability-matrix.json` 是人工摘要，省略了任务书要求的 `ReadableStream`、`TransformStream`、`AudioContext`、`OfflineAudioContext`、Transferable 以及各 codec 的 config/resolvedConfig/error 字段。

新增一个去敏原始 JSON，内容应直接来自最终探针的 `probeAudioCapabilities()` 结果，至少保留：

- `api` 全字段；
- `transfer`；
- `wasm`；
- `blobWorker`；
- MP3/AAC-LC/Opus decoder/encoder 的输入 config、supported、resolvedConfig 和 error；
- Tabbit 版本、probe IIFE SHA；
- 不含账号、脚本 ID、路径或文件名。

如旧运行的页面输出仍可导出，可直接保存，无需重跑；否则只运行轻量 capability probe，不运行大文件。

## 3. S1 判定

S1 本轮代码已通过独立复验，没有新的返工项。大 WAV 回归 fixture 是真实声明长度，不再是尾部 padding；有界读取和负例均成立。

但 S1 任务书的开工/验收依赖是 `V2-S0 ACCEPTED`。因此当前记为：

```text
IMPLEMENTATION_PASS_DEPENDENCY_HOLD
```

R2-1～R2-4 关闭且 S0 被独立验收为 `ACCEPTED` 后，S1 可直接转为 `ACCEPTED`；除非本轮返工改动了 S1 production 源码，否则不需要重跑 S1 全套 E2E。

## 4. 允许修改范围

- `package.json`、`package-lock.json`
- `scripts/audio-probe/build.mjs`，仅在分发 notice/build 方案确需修改时
- `docs/decisions/ADR-005-V2-S0-音频编解码方案.md`
- `docs/evidence/V2-S0/*`
- `docs/handoffs/V2-S0-handoff.md`
- `docs/handoffs/V2-S0-S1-rework-report.md` 或新增二次返工报告
- `docs/tabbit-capabilities.md`
- `docs/v2/work-orders/90-需求追踪矩阵.md`

除非选择路径 B，不得改动 S1 production 源码、controller、UI、正式音频 pipeline 或 S2 文件。

## 5. 最小验证策略

### 路径 A，编码器与运行 payload 未改变

不重跑 200MB。执行：

```powershell
npm run audio:probe:build
npm test -- --run tests/unit/audio-capabilities.test.js tests/unit/audio-metadata.test.js tests/unit/audio-signatures.test.js
npm run check
git diff --check
```

如只增加 banner/notice 导致最终 SHA 变化，应记录变更前后 bytes/SHA，并证明剥离纯注释后的可执行 payload 与已通过大文件的版本一致；再做一次真实 Tabbit 小文件保存/运行烟测即可。

### 路径 B，编码器发生变化

先跑小 fixture；稳定后再执行一次完整 200MB 成功和一次取消门禁，并更新全部 S0 SHA/证据。不得复用旧 `lamejs` 大文件结果证明新编码器。

## 6. 返工退出标准

- [x] 选定路径 A，ADR 无互相矛盾的分发口径。
- [x] 许可证文本、NOTICE、源码替换/重建和分发条件完整。
- [x] production 单 IIFE 的许可承载方式可执行，不只写“未来处理”。
- [x] 三类候选对比包含真实、准确、可核验的数据。
- [x] `runtime.durationMs` 不再冒充处理耗时。
- [x] 真实 Tabbit 能力原始安全快照完整。
- [x] 路径 A 未重复大文件；最终 executable payload 与已测版本 bytes/SHA 相同。
- [x] `npm run check` 和 `git diff --check` 通过。
- [x] 施工阶段先保持申请状态；补全后由主验收 Agent 独立签收 S0/S1 并解除 S2 前置。

## 7. 二次返工报告

新增：

```text
docs/handoffs/V2-S0-S1-second-rework-report.md
```

至少包含：所选分发路径、用户/项目许可证裁决（如需）、三类候选对比索引、许可证/源码/重建材料索引、证据字段修正、Tabbit 原始快照索引、实际运行过的最小命令，以及是否触发重新 200MB 门禁。
