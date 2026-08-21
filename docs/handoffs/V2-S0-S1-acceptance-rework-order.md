# V2-S0 / V2-S1 联合验收返工单

- 下单日期：2026-08-21
- 验收结论：`REJECTED_FOR_REWORK`
- S0 状态：`BLOCKED_CORE_GATE`
- S1 状态：`REJECTED`，实现可保留后返工
- S2–S5：`HOLD`
- 施工基线：当前未提交工作区；起始历史提交 `31d3d2b`
- 返工原则：基建轻量验收，只补核心门禁和已复现缺陷，不扩展产品范围

## 1. 返工目标

本轮只完成两件事：

1. 修复 S1 对真实大 PCM WAV 的有界元数据读取，使长录音不会因为 `data` chunk 大于元数据缓冲区而被误判损坏。
2. 补齐 S0 真实 Tabbit、可分发 MP3 编码器和实际 200MB→100MB 的核心证据。

完成后必须先申请 S0 复验；S0 被独立验收为 `ACCEPTED` 后，再申请 S1 复验。不得因为 S1 大部分测试已通过就跳过 S0。

## 2. 当前可保留成果

以下内容无需推倒重做：

- `src/audio/capabilities.js` 的能力探针和资源常量；
- `scripts/audio-probe/` 的单 IIFE 构建入口和合成 fixture 生成器；
- audio/image/mixed/video uploader 分类主体；
- MP3、WAV、AAC-LC M4A 的基础签名解析；
- RuleSet 音频字段、MP3 + maxBytes 可执行前提和安全停止语义；
- `inspectAudio()` 的有界 slice 读取框架与安全 snapshot；
- 已有 207 项 Vitest 和辅助 Chromium 证据。

不得用大规模重写 controller、替换测试框架或删除现有对抗用例完成返工。

## 3. 验收发现

### R0-1：S0 核心门禁没有执行

严重级别：`BLOCKER`

现状证据：

- `docs/handoffs/V2-S0-handoff.md` 状态为 `BLOCKED_CORE_GATE`；
- `docs/evidence/V2-S0/audio-200-to-100.json` 没有输出 MP3、目标码率、独立解码、峰值内存、心跳或取消数据；
- `docs/decisions/ADR-005-V2-S0-音频编解码方案.md` 明确“暂不选择任何生产编码器”；
- 只有辅助 Playwright Chromium 能力结果，没有真实 Tabbit 音频运行。

缺失门禁：

1. 真实 Tabbit API/codec/Worker/WASM 能力矩阵；
2. 准确版本、许可证和 NOTICE 明确的 MP3 编码方案；
3. 实际大于 200,000,000 bytes 的可解码输入；
4. 输出小于等于 100,000,000 bytes 的可解码 MP3；
5. Worker、有界缓冲、heartbeat、取消 ≤1 秒和清理证据；
6. 单 IIFE 的最终增量 bytes/SHA 和无运行时远程依赖证明。

这不是文档缺口，而是 S0 的核心目标尚未实现。

### R1-1：真实大 WAV 被错误判为元数据无效

严重级别：`BLOCKER`

问题代码：`src/audio/signatures.js` 的 `parseWavChunks()`。

当前逻辑：

```js
const dataEnd = dataStart + chunkSize;
if (dataEnd > fileSize || dataEnd < dataStart) return { errorCode: 'AUDIO_DECODE_FAILED' };
if (dataEnd > value.length) break;
if (id === 'data') data = { offset: dataStart, size: chunkSize };
```

对于正常的长 WAV，`data` chunk 通常远大于 1MiB 元数据读取预算，因此会在记录 data header 之前 `break`，最终返回 `AUDIO_METADATA_INVALID`。

独立复现结果：合法 2,000,044-byte、48kHz、16-bit、双声道 PCM WAV：

```json
{
  "size": 2000044,
  "signatureMime": null,
  "durationMs": null,
  "inspectedBytes": 1048576,
  "errorCode": "AUDIO_METADATA_INVALID"
}
```

现有测试 `tests/unit/audio-metadata.test.js` 的“大 blob”只是给约 19KB 的完整 WAV 尾部追加 1.5MB 零数据，WAV header 声明的 data chunk 仍只有约 19KB，因此没有覆盖真实长 WAV。

### R1-2：S1 在 S0 未通过前抢跑并冻结格式子集

严重级别：`HIGH`

`docs/handoffs/V2-S1-handoff.md` 已承认 S0 尚未独立通过。S1 可以保留实现，但 MP3/WAV/M4A 的最终支持子集只能在 S0 真实编码器和 Tabbit 证据成立后冻结。

当前 S1 文档还存在施工顺序陈述不一致：S0 handoff/ADR 实际已经存在，但 S1 文档仍写“absent/not present”。返工后必须统一为“存在但状态如何”，不能写成缺失。

## 4. 允许修改范围

### S1 缺陷修复

- `src/audio/signatures.js`
- `src/audio/metadata.js`，仅在有界读取或错误映射确有必要时
- `tests/unit/audio-signatures.test.js`
- `tests/unit/audio-metadata.test.js`
- `docs/evidence/V2-S1/*`
- `docs/handoffs/V2-S1-handoff.md`
- `docs/decisions/ADR-004-V2-S1-音频契约增量.md`

### S0 门禁补齐

- `scripts/audio-probe/*`
- `test-pages/audio-probe.html`
- `test-pages/audio-probe.css`
- `src/audio/capabilities.js`
- 编解码器所需的最小生产/探针模块；路径必须在 handoff 解释
- `package.json`、`package-lock.json`，仅用于锁定最终选定依赖
- `esbuild.config.js`，仅在单 IIFE 内嵌构建确有必要时
- `docs/decisions/ADR-005-V2-S0-音频编解码方案.md`
- `docs/tabbit-capabilities.md`
- `docs/evidence/V2-S0/*`
- `docs/handoffs/V2-S0-handoff.md`
- `docs/v2/work-orders/90-需求追踪矩阵.md`

公共修复若越界，必须在 handoff 逐文件说明。禁止提前实现 S2 planner、正式音频 pipeline、确认 UI 或上传回填。

## 5. 施工步骤

### R1-A：修复大 WAV header-only 解析

目标：读取 `data` chunk header 后即可依据声明长度、File.size 和 `fmt ` 信息计算元数据，不读取完整 PCM。

实现要求：

1. 当当前 chunk 是 `data`，只要求 8-byte chunk header 已完整读取；不要求 `dataEnd <= value.length`。
2. 继续要求：
   - `dataEnd` 是安全整数；
   - `dataEnd >= dataStart`；
   - `dataEnd <= fileSize`；
   - `chunkSize > 0`；
   - `fmt ` 已解析且 byteRate/blockAlign/bitDepth/channels 有效。
3. 用声明的 `data.size / byteRate` 计算 duration，并做有限数和正数检查。
4. 对未知的超大非 `data` chunk 不得盲目跳到未读取位置继续解析；应返回稳定的 bounded/unsupported 结果，或按明确偏移再做受预算约束的 slice。
5. 不提高 1MiB 默认元数据预算，不读取完整 PCM。
6. 保持截断和伪造 `dataEnd > fileSize` 为失败。

推荐结构：先识别 chunk id 和 header，再针对 `data` 记录声明；只有需要读取 chunk payload 的 `fmt `/其他结构才要求 payload 落在缓冲区内。

### R1-B：替换无效的大 WAV 测试

新增真实结构测试：

- WAV 总字节大于 1MiB；
- RIFF size 和 data chunk size 与实际 Blob 一致；
- `data.size > 1MiB`；
- 48kHz、16-bit、双声道；
- `inspectAudio()` 返回 `audio/wav`、`pcm` 和正确 duration；
- `inspectedBytes <= 1_048_576`；
- 不把文件名、原始 bytes 或 PCM 放入 snapshot。

同时保留负例：

- data 声明超过 File.size；
- data size 为 0；
- blockAlign/byteRate 不一致；
- truncated `fmt `；
- AbortSignal。

测试 fixture 可以是 2–4MiB，避免每次 unit 生成 200MB。200MB 只在 S0 最终门禁运行一次。

### R0-A：选择唯一 MP3 编码器方案

至少记录：

- 包/源码准确名称和版本；
- 官方来源；
- SPDX、许可证原文和 NOTICE 路径；
- 是否允许当前单文件分发方式；
- 是否支持分块 PCM 输入和逐块 MP3 输出；
- Worker 内运行情况；
- minified IIFE 增量 raw bytes；
- 是否包含 WASM/Base64、相应膨胀；
- 无外部 fetch/CDN/远程 Worker；
- 回滚和替代方案。

不得保留 `UNKNOWN` 许可证并申请通过。不得以浏览器 AAC/Opus encoder 成功替代 PRD 固定的 MP3 输出。

ADR 状态由施工方更新为 `PROPOSED_FOR_ACCEPTANCE`，不能自行写 `ACCEPTED`。

### R0-B：将选定方案接入隔离探针 IIFE

探针需要完成：

```text
File.stream / bounded slices
  -> WAV PCM 分块读取
  -> 必要时 stereo->mono
  -> MP3 分块编码
  -> Blob
  -> 独立 MP3 签名/元数据/可解码复检
```

仍然禁止：

- 整文件 `file.arrayBuffer()`；
- `decodeAudioData(await file.arrayBuffer())`；
- 完整 PCM 常驻；
- Node/本机 ffmpeg；
- 远程 API/CDN；
- 只改扩展名或 MIME；
- 用短音频结果冒充 200MB。

探针保持和 production controller/UI 隔离；S0 不实现正式回填。

### R0-C：真实 Tabbit 能力矩阵

通过 Tabbit 官方私有脚本、部分网址匹配加载同一探针 IIFE，记录：

- Tabbit 版本；
- Blob Worker 创建、消息、终止和 URL revoke；
- WebAssembly（如使用）初始化；
- 实际选定编码器初始化；
- MP3/WAV/M4A 相关 decoder/encoder 能力事实；
- CSP/异常路径；
- 临时脚本关闭自动运行并保存为 false；
- 不公开分享。

如果常规 in-app Browser 不可用，应使用项目此前已验证的 Tabbit remote CDP `9222` 路径。若仍无法连接，按真实情况保留 `BLOCKED_BY_ENVIRONMENT/BLOCKED_CORE_GATE`，不得用 Playwright Chromium 代替。

### R0-D：只执行一次最终 200MB→100MB 重型门禁

为节省资源，中间调试使用小 fixture；选型、单元测试和小文件 Tabbit 烟测稳定后，才执行一次最终大文件成功和一次取消测试。

成功用例：

1. 通过现有生成器生成可解码、无版权风险的 PCM WAV；
2. `input.size > 200_000_000`；
3. 页面/探针硬上限 `100_000_000`；
4. 计算并记录 safe target、目标码率和声道；
5. Worker 中流式编码；
6. 输出 `audio/mpeg`、`0 < size <= 100_000_000`，目标优先 ≤95,000,000；
7. 用与编码器分离的解析/解码逻辑验证输出；
8. duration 未被裁剪；
9. 外部音频请求 0、持久化 0；
10. 记录总耗时、encode passes、max heartbeat gap 和 peak buffered bytes/理论上界。

取消用例：

- 同一真实 Tabbit 环境启动处理后取消；
- 1 秒内不再产生新进度/结果；
- Worker 终止、对象 URL 回收、缓冲释放；
- 不保留输出半成品；
- 合成 fixture 在取证后删除，不进入 Git。

## 6. 必须更新的证据

### V2-S0

- `capability-matrix.json`
- `audio-200-to-100.json`
- `resource-profile.json`
- `cleanup.json`
- `fixture-manifest.json`
- `result.json`
- `README.md`
- 至少一张去敏真实 Tabbit 截图；不含账号、脚本 ID、路径或文件名

`audio-200-to-100.json` 不得再有以下字段为 null/NOT_RUN：

- `tabbitVersion`
- `plan.bitrateKbps`
- `output.bytes/sha256/signatureMime/decodable`
- `runtime.workerUsed/durationMs/maxHeartbeatGapMs`
- `runtime.peakBufferedBytes`；若浏览器不可测，提供明确理论硬上界和测量限制

### V2-S1

- `result.json` 使用本轮实际测试数、bundle bytes/SHA；
- `fixture-manifest.json` 增加真实大 data chunk 回归参数；
- `README.md` 与 handoff 将 S0 描述改为实际状态，不再写“仓库中不存在”；
- ADR-004 根据 S0 最终支持子集收敛。

所有证据只能使用当前最终构建/探针 SHA，不能拼接旧轮次数字。

## 7. 轻量测试策略

### 每次修改先跑定向测试

```powershell
npm test -- --run tests/unit/audio-signatures.test.js tests/unit/audio-metadata.test.js tests/unit/audio-capabilities.test.js tests/unit/audio-rules.test.js tests/unit/audio-validation.test.js tests/integration/audio-discovery.test.js
npm run audio:probe:build
git diff --check
```

### 提交交验前只跑一次全量检查

```powershell
npm run check
```

只有修改 uploader/controller/生产运行路径时才补跑音频 discovery E2E：

```powershell
npm run test:e2e -- --grep "S1 audio discovery" --reporter=line --workers=1
```

本轮不要求重复执行完整 V1 118 项 E2E；如果返工越界修改了图片、controller、injection 或公共 DOM 生命周期，则必须恢复全量 E2E。

## 8. 禁止绕过

- 不得把 `BLOCKED_CORE_GATE` 改名为 PASS 而不补真实证据。
- 不得删除 200MB 门禁或换成 20MB。
- 不得继续使用“完整小 WAV + 尾部 padding”冒充真实大 WAV。
- 不得提高元数据读取预算到覆盖整个 data chunk。
- 不得降低 `48kbps` 底线、放宽 `100_000_000` 硬上限或省略最终复检。
- 不得用 Node ffmpeg、桌面程序、服务器 API、Playwright Chromium 或 mock 冒充 Tabbit。
- 不得提交 200MB fixture、输出 MP3、用户录音、账号或完整 AI 数据。
- 不得提前进入 S2 planner/正式 pipeline/UI/injection。
- 不得修改 PRD/任务书使当前实现看起来通过。

## 9. 返工退出标准

### S0 重新申请验收

- [ ] 唯一编码器方案版本、许可和 NOTICE 明确。
- [ ] 单 IIFE 无远程依赖，raw bytes/SHA 已记录。
- [ ] 真实 Tabbit 能力矩阵完成。
- [ ] 实际 >200,000,000-byte 可解码输入成立。
- [ ] 输出为可解码 MP3 且 ≤100,000,000 bytes。
- [ ] Worker、有界内存/缓冲、heartbeat 和取消 ≤1 秒成立。
- [ ] 完成、失败、取消和关闭清理成立。
- [ ] 外部音频请求 0、持久化 0。
- [ ] S0 handoff 状态为 `READY_FOR_ACCEPTANCE`，ADR 为 `PROPOSED_FOR_ACCEPTANCE`。

### S1 重新申请验收

- [ ] 真实 `data chunk >1MiB` PCM WAV 可正确读取元数据。
- [ ] `inspectedBytes <=1MiB`，没有完整 PCM 读取。
- [ ] forged/truncated/zero data 负例继续失败。
- [ ] MP3/WAV/M4A 子集与通过后的 S0 ADR 一致。
- [ ] audio/image/mixed/video discovery 和安全停止测试继续通过。
- [ ] `npm run check` 全绿，生产 bytes/SHA 与文档一致。
- [ ] S1 handoff 状态为 `READY_FOR_ACCEPTANCE`，没有声称自行通过。

## 10. 交接格式

返工完成后更新原 S0/S1 handoff，并新增：

```text
docs/handoffs/V2-S0-S1-rework-report.md
```

报告至少包含：

- R0-1、R1-1、R1-2 的逐项完成表；
- 修改文件及越界说明；
- 编码器版本/许可/增量体积；
- 大 WAV 修复前后复现；
- 定向与全量测试实际结果；
- 真实 Tabbit 200MB 成功和取消证据索引；
- 最终 bundle/probe bytes/SHA；
- 已知限制；
- 申请顺序：先 S0，再 S1；S2 在两者独立通过前继续 HOLD。
