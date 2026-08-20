# 10 V2-S0 编解码与 Tabbit 可行性探针

## 1. 阶段定位

- 状态：当前唯一放行阶段
- 依赖：V1 S5 ACCEPTED，提交 `5979dec`
- 目标：在不写完整产品功能前，证明 Tabbit 单脚本可以安全、合法、可取消地把实际 200MB 级长音频处理为不超过 100MB 的 MP3。
- 退出结果只能是：`READY_FOR_ACCEPTANCE`、`BLOCKED_CORE_GATE` 或 `NO_GO`。

S0 是 V2 最大风险前置验证，不是“安装一个库并跑通短文件”。任何缺少真实 Tabbit、实际大文件、流式内存、许可证或单 IIFE 证据的结果均不得进入下一阶段。

## 2. 开工前必读

- `docs/v2/UploadFit-PRD-v2.0.md` 第 5、8、9、10、13、16、19 节
- `00-项目总控与协作规则.md`
- `01-共享契约与接口基线.md`
- `docs/tabbit-capabilities.md`
- `docs/handoffs/S5-lightweight-reacceptance-report.md`
- `esbuild.config.js`、`scripts/static-check.js`、`src/image/worker-runtime.js`

## 3. 本阶段禁止事项

- 不接入 production controller、正式 UI 或上传回填。
- 不修改图片处理行为。
- 不使用远程转码服务、CDN、Node ffmpeg、桌面程序或开发服务器编解码能力冒充 Tabbit。
- 不把 200MB fixture、输出文件、Chrome profile 或编码器未压缩源码副本提交到仓库。
- 不把短音频 `decodeAudioData()` 成功视为流式方案成立。
- 不在许可证未确认前把第三方编码器打入 production 入口。

## 4. 交付物

| 交付物 | 路径/要求 |
|---|---|
| 能力矩阵 | `docs/evidence/V2-S0/capability-matrix.json` |
| 编码器选型与许可 ADR | `docs/decisions/ADR-004-V2音频编解码方案.md`，编号若冲突顺延 |
| 可重复探针 | `scripts/audio-probe/`，只用于本地/Tabbit 验证 |
| 探针页面 | `test-pages/audio-probe.html` 及最小 JS/CSS |
| 非敏感音频生成器 | `scripts/audio-probe/generate-fixture.*`，生成文件默认落在 gitignored 临时目录 |
| 单 IIFE 探针产物 | 临时构建输出，不替换 production `dist/uploadfit.js`，证据记录 bytes/SHA |
| 200→100 结果 | `docs/evidence/V2-S0/audio-200-to-100.json` + 去敏截图 |
| 内存/响应性结果 | `docs/evidence/V2-S0/resource-profile.json` |
| 清理结果 | `docs/evidence/V2-S0/cleanup.json` |
| 阶段索引 | `docs/evidence/V2-S0/README.md` |
| 交接 | `docs/handoffs/V2-S0-handoff.md` |

## 5. 施工步骤

### S0.1 建立无回归基线

执行并记录：

```powershell
git status --short
git rev-parse HEAD
npm ci
npm run check
npm run test:e2e
```

记录当前 production bytes/SHA。不要在探针阶段修改 production bundle；若构建脚本必须支持第二入口，保持默认 `npm run build` 行为和路径不变。

### S0.2 枚举当前 Tabbit 能力

在真实 Tabbit 私有、部分网址匹配的临时脚本中探测：

- `Worker`、Blob URL Worker、Transferable/structured clone；
- `WebAssembly` 及内嵌字节实例化；
- `ReadableStream`、`File.stream()`、`TransformStream`；
- `AudioDecoder.isConfigSupported()` 对 MP3、AAC-LC、Opus 的结果；
- `AudioEncoder.isConfigSupported()` 对 MP3/AAC/Opus 的结果；
- `OfflineAudioContext`/`AudioContext` 只能作为能力信息，不得成为 200MB 完整解码方案；
- 页面 CSP 是否阻止 Blob Worker/WASM；
- 关闭脚本、刷新、取消后临时资源是否消失。

每项记录：API 是否存在、config、返回值/错误名、Tabbit 版本、是否在 Worker 内可用。不要只记录 `typeof`。

### S0.3 候选方案对比

至少比较三类方案：

| 方案 | 必查项 |
|---|---|
| 浏览器原生 WebCodecs + 轻量 demux/mux | MP3 编码是否真实可用、M4A/MP3 解复用、容器输出、兼容性 |
| 轻量纯 JS MP3 编码器 + 浏览器/自带解码 | 流式 API、速度、内存、维护状态、许可证、增量体积 |
| 内嵌小型 WASM 编码器/解码器 | Base64 膨胀、初始化、Worker、许可证、CSP、单 IIFE 体积 |

完整 ffmpeg.wasm 只能作为否决对照，不是默认候选。每个候选记录：准确包版本、来源、license SPDX/原文路径、构建后增量 raw bytes、是否动态加载、是否流式、支持的输入子集、200MB 预计内存和已知浏览器限制。

若候选仓库/包许可证不清晰，状态为 `LICENSE_BLOCKED`，不能推荐。

### S0.4 冻结输入子集

逐项验证而不是按扩展名承诺：

- MP3：CBR、VBR（至少 Xing/VBRI 之一）、常见 ID3v2；
- WAV：PCM 16-bit 为 Must，24-bit 是否支持由证据裁决；拒绝压缩 WAV/异常通道；
- M4A：AAC-LC 为 Must 目标，HE-AAC/ALAC/空间音频明确记录支持或拒绝；
- WebM/Opus：仅当额外代码、许可和回归成本很小才列 Should。

输出固定为带正确帧头、可被独立解码验证的 MP3。不得只修改扩展名或 MIME。

### S0.5 构建可重复的非敏感大文件

生成器必须：

- 只生成合成音调、静音间隔或机器合成的无语义测试信号；
- 参数可复现：格式、采样率、声道、时长、目标字节；
- 输入 `size > 200000000`；
- 文件落在系统临时目录或仓库内明确 gitignored 目录；
- 打印 SHA-256、size、duration、codec，不打印用户路径；
- 支持单独生成小 fixture 用于快速回归。

不要通过附加 200MB 垃圾尾数据伪造“200MB 音频”；输入必须能正常解码到其声明时长。

### S0.6 编写最小流式原型

原型只包含：选择/加载合成 fixture、读取元数据、按 100000000-byte 上限计算参数、在 Worker 中处理、显示进度/取消、生成 Blob、最终复检和下载。

硬约束：

- 禁止整文件 `arrayBuffer()`；仅允许有界 `slice()` 和 `File.stream()`。
- 禁止完整 PCM 常驻内存。
- 输入块建议 ≤4MiB，未释放 PCM 目标 ≤32MiB。
- 主线程每 100ms 心跳，记录最大间隔。
- 取消后 1 秒内停止新输出并终止/清理 Worker。
- output 只在最终完成后组成 Blob；若编码器必须先累计全部 chunk，要测量实际额外内存并解释。
- 输出复检必须由与编码步骤分离的验证逻辑完成。

### S0.7 单 IIFE 与体积

建立独立探针入口并用与 production 等价的 esbuild 条件生成一个可粘贴 IIFE：

- 无 import/export 残留；
- 无第二文件、外部 fetch、CDN、远程 Worker；
- 编码器/WASM 若使用，全部内嵌；
- 记录未引入编解码器、引入后、minify 后 raw bytes；
- 记录 Base64/WASM 占比；
- 扫描 `eval/new Function/import()/fetch/XHR/WebSocket/EventSource/sendBeacon` 等模式。

目标 600KB–1.0MB。探针若预计 production 超过 1.2MB，必须写 ADR 并在阶段验收暂停，不能自动放行。

### S0.8 Tabbit 真实 200→100

必须通过 Tabbit 官方私有脚本加载临时探针 IIFE，在无外部网络依赖下完成：

1. 输入大于 200,000,000 bytes 的合成语音型文件；
2. 硬上限输入为 100,000,000 bytes；
3. 展示计算后的码率和确认；
4. 开始处理并观察页面仍可响应；
5. 输出 `0 < size <= 100000000`，优先 `<=95000000`；
6. 用独立元数据读取/解码抽检输出；
7. 外部音频请求数为 0；
8. 再执行一次中途取消，确认 1 秒内停止并释放资源；
9. 关闭临时脚本自动运行、关闭测试页，不公开分享。

如机器资源不足，先验证是否实现违反内存设计；不得简单把测试换成 20MB。确有硬件阻塞时写清峰值、失败阶段和最小复现，交主验收裁决。

### S0.9 回归与清理

- `npm run check`
- `npm run test:e2e`
- `git diff --check`
- 端口无残留监听；临时 Tabbit 脚本关闭自动运行；临时文件可删除且未入 Git；无残留 Worker/对象 URL。

## 6. ADR 必须回答的问题

1. 最终选择哪个解码、解复用和 MP3 编码组合？
2. 为什么它在 Tabbit 而不只是 Chromium/Node 中成立？
3. 支持的 MP3/WAV/M4A 精确子集是什么？
4. 许可证和分发义务是什么，NOTICE 放哪里？
5. minified 单 IIFE 增量多少，预计 production 总体积多少？
6. 200MB 输入实际耗时、最大主线程心跳、内存/缓冲证据是什么？
7. 无 Blob Worker/WASM/某 codec 时如何停止？
8. 选择如何回滚，替代候选是什么？

## 7. 结构化证据最低字段

`audio-200-to-100.json` 至少包括：

```json
{
  "tabbitVersion": "1.10.16.0",
  "bundleBytes": 0,
  "bundleSha256": "...",
  "input": {
    "bytes": 200000001,
    "sha256": "...",
    "container": "wav",
    "codec": "pcm",
    "durationMs": 0,
    "sampleRate": 48000,
    "channels": 2
  },
  "plan": {
    "maxBytes": 100000000,
    "safeTargetBytes": 95000000,
    "bitrateKbps": 0,
    "targetChannels": 1
  },
  "output": {
    "bytes": 0,
    "sha256": "...",
    "signatureMime": "audio/mpeg",
    "decodable": true
  },
  "runtime": {
    "workerUsed": true,
    "durationMs": 0,
    "maxHeartbeatGapMs": 0,
    "peakBufferedBytes": 0,
    "externalAudioRequests": 0
  }
}
```

路径和文件名不得写入 JSON。

## 8. 验收清单

- [ ] V1 基线和阶段结束回归均通过。
- [ ] 真实 Tabbit API/codec/Worker/WASM 矩阵完整。
- [ ] 至少三类方案有版本、许可、体积、流式与性能对比。
- [ ] 推荐方案许可证明确且可单文件分发。
- [ ] MP3/WAV/M4A 子集有正反 fixture 实证。
- [ ] 实际可解码输入大于 200,000,000 bytes。
- [ ] 输出 MP3 不超过 100,000,000 bytes 并可独立解码。
- [ ] 未使用完整 arrayBuffer/decodeAudioData/PCM 常驻。
- [ ] Worker、进度、取消和清理通过。
- [ ] 外部音频请求为 0，持久化为 0。
- [ ] 探针是可直接粘贴单 IIFE，无运行时依赖。
- [ ] 体积及 SHA 完整；>1.2MB 已暂停并申请裁决。
- [ ] ADR、证据 README 和 handoff 完整。

## 9. Go / No-Go 判定

只有上述清单全部通过，才可申请 `READY_FOR_ACCEPTANCE`。以下任一成立即 `NO_GO` 或 `BLOCKED_CORE_GATE`：

- 真实 Tabbit 不能运行选定编解码方案；
- 无法在有界内存中处理 200MB；
- 无法输出稳定小于硬上限的可解码 MP3；
- 编码器许可证不适合分发；
- 必须外联或多文件安装；
- 主线程长期无响应且无法取消；
- 生产总体积明显超出已接受区间且没有产品裁决。
