# UploadFit 产品需求文档 V2.0

- 文档状态：施工基线
- 版本：2.0
- 日期：2026-08-20；S4.1 产品修订：2026-08-25
- 目标环境：Tabbit PC Browser 1.10.16.0 或后续兼容版本
- 代码仓库：`C:\Users\蔡天乐\Desktop\黑客松\main`
- 上游基线：V1 S0–S5 已验收，提交 `5979dec`

## 0. 一页结论

UploadFit 不是独立压缩工具。它只在用户已经位于目标网页、准备上传文件但遭遇明确机器规则时，执行跨过“最后一公里”所需的最小改动。

V2 只新增一个音频场景：

> 用户向网页转写服务上传以人声为主的长录音；页面明确允许 MP3、明确给出单文件最大字节数，而当前 MP3、M4A/AAC 或 WAV 文件超过上限。UploadFit 经用户确认后，在浏览器本地生成不超过安全目标的 MP3，确定性复检通过后重新填回原上传控件。

会议、访谈、课程、客服录音属于同一底层场景，不分别扩展功能。

V2 必须继续满足：单个可粘贴 IIFE、无 ESM 运行时加载、无远程依赖、音频内容不离开本机、AI 不接触音频数据、不自动点击提交、无法安全处理时停止并解释。

2026-08-25 S4.1 修订确认：超限 MP3→MP3 重编码、常见 M4A/AAC-LC→MP3 转换属于 Must，不再作为 V2.1 延期项；短生命周期英文 toast 拒收和英文大小/时长规则属于上传墙发现闭环的一部分。此前阶段因 ADR-005 仅有编码器而实施的安全停止仍是正确历史行为，但不能作为最终产品能力边界。

## 1. 文档权威与继承关系

1. 本文是 V2 产品范围、安全边界和验收事实源。
2. V1 PRD 已归档于 `docs/archive/v1/UploadFit-PRD-v1.0.md`。
3. 本文未明确修改的 V1 图片行为、安全不变量、一次页面重试、文件回填和 UI 可访问性要求继续有效。
4. V2 任务书只负责把本文拆成工程施工步骤，不得通过修改任务书降低本文门槛。
5. 新增依赖、许可、媒体契约或体积策略必须留 ADR；突破安全红线的 ADR 无效。
6. `V2-S4.1` 是 2026-08-25 授权的产品修订阶段；其施工单可在新 ADR 和真实门禁成立后解禁 ADR-005 的解码边界，但不得降低隐私、资源、时长墙或最终复检要求。

## 2. 背景与问题

长语音来自手机录音、会议软件、录音笔和呼叫系统。用户需要的是转写结果，不是学习码率、采样率或音频编辑。当网页只接收 MP3 或设置较小单文件上限时，几小时录音常因 WAV 体积过大、M4A 格式不被接受或现有码率过高而停在上传前。

这一问题具有三个特征：

- 页面规则通常可被机器读取，例如 `accept`、附近说明或明确拒收文本。
- 人声转写可以在保守质量底线之上降低码率，且不改变语义内容和时长。
- 用户不希望离开当前页面去寻找转换工具，也不希望把敏感会议音频上传给额外第三方。

不同服务限制差异很大，因此 UploadFit 不预设“所有网站都是 100MB”。它必须读取当前页面的明确规则并以实际字节数计算。

## 3. 产品定位与核心用户故事

一句话定位：

> 在音频转写上传框前，识别明确的 MP3/体积墙，以最小有损处理让长语音文件满足规则，并安全回填。

核心用户故事：

> 当我上传数小时的会议、访谈、课程或客服录音进行转写，却因文件过大或常见录音格式不被接受而无法继续时，我希望 UploadFit 告诉我将发生什么，经我确认后在本地生成符合页面上限的 MP3，并把它放回原上传框；我的原文件和最终提交决定都应保留在我手中。

## 4. 目标与非目标

### 4.1 Must 目标

- 识别普通及动态新增的单文件音频上传控件。
- 只在页面明确允许 MP3 且存在可信 `maxBytes` 时形成可执行音频计划。
- 检查 MP3、M4A/AAC、WAV 的签名、容器/编码、字节数、时长、采样率和声道数；S0 编码器门禁与 S4.1 ADR-006 真实解码门禁共同决定实际可支持的编码子集。
- 合规文件原样放行，不重编码。
- 合法超限 MP3 在页面明确允许 MP3且有可信字节上限时，经确认重新编码为更小 MP3。
- 常见非加密、非 fragmented 的 AAC-LC M4A 在需要跨越格式墙或体积墙时，经确认转换为 MP3；页面允许 M4A且文件合规时保持原 File passthrough。
- 超限文件按页面上限、时长和安全余量计算 MP3 目标码率。
- 所有音频转码、重新编码和单声道化均在执行前确认。
- 使用有界内存的流式或分块管线，不得把长文件完整展开为内存 PCM。
- 最终输出通过 MIME/签名、字节数和可解码性复检后才可回填。
- DataTransfer 回填失败时提供下载和人工上传指引。
- 同一页面任务最多一次由明确新拒收触发的自动重试；不得自动提交。
- 在有界等待窗口内识别与上传器相关的错误节点，以及唯一活跃上传任务对应的 transient toast/snackbar/notification；中文和英文明确拒收都必须经过本地规则解析后才能触发处理。
- 确定性解析常见中英文大小与时长表达；同一句 `Max 10 MB and 10 minutes` 必须同时形成字节上限和时长上限。
- 用实际 200MB 级非敏感合成录音证明可压到 100MB 硬上限以内。

### 4.2 Should 目标

- 在 S0 证明可行且不会显著增加包体/复杂度时，支持 WebM/Opus 输入。
- 在处理期间提供阶段、百分比、预计剩余量级和取消按钮。
- 页面若只暴露扩展名 `.mp3` 而未写 MIME，可确定性归一到 `audio/mpeg`。

### 4.3 明确不做

- 独立音频压缩器、文件选择后主动弹出“优化”入口。
- 音乐、播客母带或其他质量敏感内容的自动处理承诺。
- 视频文件抽取音轨。
- 批量、多文件合并、拆分、裁剪、静音删除、变速或时长修改。
- 降噪、人声增强、响度标准化、声纹、说话人分析或内容理解。
- AMR、FLAC、AIFF、WMA 等格式；未来版本另行评估。
- HE-AAC/HE-AACv2、ALAC、加密/DRM M4A、fragmented MP4、raw ADTS AAC 默认不在 S4.1 子集；只有新 ADR 和真实门禁可扩展。
- 解决账户额度、网络中断、登录权限、官方审核工具或服务端故障。
- 页面只有时长限制时自动分段或裁剪。
- 页面未明确上限时猜测目标大小。
- 页面不允许 MP3 时擅自输出 MP3。
- 修改原文件、覆盖用户磁盘文件或把结果写入云端。

## 5. 启动条件与停止条件

### 5.1 音频上传器成立条件

满足至少一项强证据，并且没有相反证据：

- `accept` 包含 `audio/*`、`audio/mpeg`、`audio/mp3`、`.mp3`、`.m4a`、`.aac` 或 `.wav`；
- 与上传框可访问关联的 label/help/error 文本明确说明上传录音或音频；
- 同一上传器的明确拒收文本指出音频格式或文件大小问题。
- 在恰好一个可观察音频任务时，页面全局 transient toast/snackbar/notification 明确指出文件格式、大小或时长拒收；多任务无法唯一关联时不得猜测。

单独出现“音频”“录音”字样、页面全局营销文案或隐藏的无关联 file input 不足以成立。

### 5.2 可执行音频计划的全部条件

1. 上传器被分类为 `mediaKind: audio`；
2. 页面高可信规则明确允许 MP3；
3. 高可信规则存在有限、正数的 `maxBytes`；
4. 文件签名属于已验收输入集合；
5. 文件实际超过 `maxBytes`，或输入格式不允许但 MP3 允许；
6. 计算所得参数不低于绝对质量底线；
7. 不存在格式/大小冲突、语义安全停止或官方工具要求。

S4.1 已验收输入集合至少包括：有效 MP3 Layer III，以及 ISO BMFF/M4A 内 AAC-LC `mp4a.40.2` 的 mono/stereo 常见 32/44.1/48kHz 子集。精确 container/profile、sample table 和布局边界由 ADR-006 与真实 Tabbit Worker 解码证据冻结。

### 5.3 必须停止并解释

- 只有时长上限、没有可执行体积方案：`AUDIO_DURATION_LIMIT_UNFIXABLE`。
- 需要低于 48kbps 单声道才能满足目标：`AUDIO_TARGET_UNSAFE`。
- 无法确认源编码、profile 不在 S4.1 子集或真实 Worker decoder 不支持：`AUDIO_CODEC_UNSUPPORTED`。
- 文件损坏、时长为零/非有限数：`AUDIO_DECODE_FAILED`。
- 页面不允许 MP3：`AUDIO_OUTPUT_FORMAT_NOT_ALLOWED`。
- 页面大小上限缺失、模糊或冲突：沿用规则不足/冲突错误，不执行。
- 需要完整加载或预计内存超过安全预算：`AUDIO_MEMORY_BUDGET_EXCEEDED`。
- 页面要求原始文件、证据原件、无损音频或官方工具：按语义安全规则停止。

停止条件存在优先级：若文件已超过可信 `duration.maxMs`，必须显示 `AUDIO_DURATION_LIMIT_UNFIXABLE`；不能因同一文件还需要重编码而用 `AUDIO_CODEC_UNSUPPORTED` 覆盖真实时长墙。

## 6. 规则来源与优先级

沿用 V1 来源优先级：站点适配器 700、明确拒收 600、HTML 属性 500、附近文字 400、选中文字 300、AI 200、弱页面文本 100。

音频 MVP 只把以下字段作为执行依据：

- `mediaKind: audio`
- `formats` / `extensions`
- `maxBytes`

时长、采样率、声道、位深等文本可以进入 advisory 或明确不可修复提示，但 V2.0 不据此生成额外专业格式方案。AI 只能帮助把相关页面文本结构化；音频文件、文件名、二进制、Base64、频谱、时长等不发送给 AI。AI 候选必须经过与 V1 相同的本地数字证据溯源和冲突校验。

如果 `accept` 允许 MP3，但附近更高语义文本明确禁止或限定另一格式，应产生冲突并停止，不使用低优先级规则覆盖。

英文规则至少覆盖 `max/maximum/up to/under/no more than/exceeds/too large/limit` 与 `second/minute/hour` 常见变体。拒收 observer 可以把清洗后、最多 600 字符的 transient error/toast 作为 `rejection` 来源，但不得抓取或保存完整页面文本；成功、复制、保存和套餐营销 toast 必须忽略。

## 7. 文件预检

### 7.1 AudioMetadata

预检至少产生：

```js
{
  mediaKind: 'audio',
  signatureMime: 'audio/mpeg',
  container: 'mp3',
  codec: 'mp3',
  size: 200000000,
  durationMs: 7200000,
  sampleRate: 48000,
  channels: 2,
  averageBitrate: 222222,
  seekable: true,
  inspectedBytes: 65536,
  errorCode: null
}
```

### 7.2 预检安全要求

- 优先读取文件头、尾部索引或分块，不为元数据调用整文件 `arrayBuffer()`。
- 元数据探测累计读取默认不超过 1MiB；超过必须有格式特定理由并记录。
- 不信任文件扩展名或 `File.type`，必须核对签名/容器。
- `durationMs` 必须有限且大于零；对 VBR 文件应使用容器索引或受控扫描，不用首帧码率直接冒充精确时长。
- MP3/M4A 的可执行转码必须在 production 等价 Blob Worker 中投递真实 encoded chunks 并获得真实 `AudioData`；`isConfigSupported()` 单独为 true 不是支持证据。
- 不把文件名写入产品日志、截图或 AI 输入；测试只使用明确非敏感生成名。

## 8. 处理规划

### 8.1 安全目标字节

硬上限为 `maxBytes`。首次编码使用：

```text
safeTargetBytes = min(floor(maxBytes × 0.95), maxBytes - 64KiB)
```

当 `maxBytes <= 128KiB` 或 `safeTargetBytes <= 0` 时停止。输出最终必须满足 `output.size <= maxBytes`；95% 是避免容器、标签和网站进制差异的预算，不是放宽规则。

### 8.2 目标码率

```text
rawTargetBitrate = floor((safeTargetBytes × 8 - containerReserveBits) / durationSeconds)
```

从不高于 `rawTargetBitrate` 的离散码率阶梯选择最高值：

```text
320, 256, 224, 192, 160, 128, 112, 96, 80, 64, 56, 48 kbps
```

若无可选项，停止。不得为了“必过”偷偷使用低于 48kbps 的参数。

### 8.3 声道策略

- 默认保留源声道数。
- 如果保留立体声无法在不低于质量底线的情况下满足目标，可提出单声道方案。
- 单声道化必须单独在确认卡中明确展示，不能包含在笼统“优化”文案里。
- 超过双声道的文件不在 MVP 支持范围。

### 8.4 重编码边界

- 合规 MP3：原样放行。
- 超限 MP3：重新编码为 MP3。
- M4A/AAC 或 WAV：仅当页面允许 MP3时转为 MP3。
- 输出采用可预测大小的 MP3 码率模式；具体编码器能力由 S0 探针裁决。
- 第一次编码复检仍超限时，允许在回填前降一个码率档再编码一次。
- 两次均失败则停止；不得无限搜索，也不得先把失败文件注入页面。

S4.1 实现不得先删除 planner 停止分支再补 decoder。必须先完成 ADR-006、真实 Tabbit Worker 的 MP3/AAC-LC 解码、资源/许可门禁，再让合法 MP3/M4A 形成可执行计划。不在冻结子集的 codec/profile 继续诚实停止。

## 9. 处理管线与资源约束

目标管线：

```text
File.stream / bounded slice
  -> demux
  -> decode compressed frames
  -> bounded PCM chunks
  -> optional resample/downmix
  -> MP3 encode
  -> chunk collector / Blob
  -> deterministic final validation
```

硬要求：

- 禁止对长音频使用 `decodeAudioData(await file.arrayBuffer())`。
- 禁止同时保留完整输入 ArrayBuffer、完整 PCM 和完整输出副本。
- 单块输入建议不超过 4MiB；并发未释放 PCM 预算建议不超过 32MiB。
- 编解码在 Blob Worker 或等效后台执行路径中运行，主线程负责 UI、取消和状态。
- 每个解码帧/AudioData/临时缓冲必须在使用后及时 `close` 或释放引用。
- MP3 帧残留、M4A sample table、AudioDecoder queue 和未释放 PCM 必须分别有硬上界；M4A sample offset 必须落在文件及合法 `mdat` 范围内。
- 同时只处理一个音频任务；新任务进入有界队列。
- 取消后 1 秒内停止产生新工作，并清理 Worker、对象 URL、缓冲和监听器。
- 浏览器能力、内存预算或 Worker 不成立时诚实停止，不在主线程退化处理 200MB 文件。

## 10. 单文件 Tabbit 交付约束

- 生产物仍为 `dist/uploadfit.js` 单个 IIFE，可直接粘贴到 Tabbit 脚本编辑器。
- 生产物不得包含顶层 `import`/`export`、动态 import、外部脚本、CDN、远程 Worker 或运行时 fetch 编解码资产。
- 如果使用 WASM，二进制必须内嵌在同一 JS 文本并通过本地 Blob/ArrayBuffer 实例化；不得产生第二个安装文件。
- 第三方编码器必须锁版本、记录许可证、来源、未压缩增量字节和安全审查结论。
- 当前 V1 包为 175868 bytes。V2 目标为 600KB–1.0MB；每次构建记录 raw bytes 与 SHA-256。
- 官方没有已知固定体积上限，因此体积不作为自动构建失败；若超过 1.2MB，必须先停在阶段验收并提交范围/依赖 ADR，由产品所有者决定是否继续。

## 11. 编排、回填与网页行为

- 图片与音频共享同一会话、上传器发现、规则解析、拒收观察、注入保护、清理和 UI host。
- 任务必须携带 `mediaKind`，图片任务继续走既有图像处理器；音频任务走独立处理器，不能在 controller 中堆叠格式特例。
- 原文件始终保存在任务内用于取消/恢复，但不持久化。
- 处理后先复检再调用现有 `injectFile`；验证 `name/type/size` 与 FileList 一致。
- 合成 `input`/`change` 只用于通知页面，不伪造 `isTrusted`，不绕过页面安全策略。
- 页面不响应合成事件时沿用人工上传/下载降级。
- 不点击上传、转写、保存、下一步、发布、付款、删除等业务按钮。
- 页面明确拒收后最多一次自动重试；模糊错误、网络错误和权限错误不处理。

## 12. UI 与确认

音频确认卡必须展示：

- 原格式、原大小、时长；
- 输出 MP3、预计大小范围和目标码率；
- 是否改单声道；
- “有损处理，可能影响音质；原文件不会被修改”；
- `开始处理`、`取消`，处理期间提供 `停止`；
- 不使用“无损压缩”“保证识别率”“自动修复所有上传失败”等承诺。

完成卡展示实际输出字节、格式、处理耗时和“已放回上传框/请手动上传下载文件”。错误卡展示稳定错误文案与可行下一步，不暴露堆栈、文件名或网页敏感文本。

沿用 closed Shadow DOM、同级按钮、键盘可操作、焦点可见、`aria-live`、200% 视口和 reduced-motion 要求。

## 13. 隐私、安全与许可

- 音频二进制、PCM、频谱、文件名和音频内容不得发送到任何网络端点。
- 生产运行时不得发起 fetch/XHR/WebSocket/EventSource/sendBeacon 传输音频。
- AI 只接收经过预算、清洗、与上传器相关的规则文本；不得接收文件元数据。
- 不写 localStorage、IndexedDB、Cache Storage 或 OPFS 保存音频。
- 关闭、刷新、完成、失败和取消均清理临时资源。
- CSP/浏览器策略阻止 Blob Worker 或 WASM 时停止并提示，不建议关闭安全设置。
- 引入编解码依赖前必须审查许可证能否随单文件分发，并保留版权/许可证文件；不清楚即阻塞。

## 14. 稳定错误码

V2 新增错误码至少包括：

| 错误码 | 含义 | 用户动作 |
|---|---|---|
| `AUDIO_CODEC_UNSUPPORTED` | 输入容器/编码不在已验收集合 | 使用网站支持格式或其他工具转换 |
| `AUDIO_METADATA_INVALID` | 时长、采样率、声道等元数据无效 | 检查源文件 |
| `AUDIO_DECODE_FAILED` | 解复用或解码失败 | 保留原文件，不回填 |
| `AUDIO_ENCODE_FAILED` | MP3 编码失败 | 保留原文件，不回填 |
| `AUDIO_TARGET_UNSAFE` | 满足上限需要低于质量底线 | 不自动处理，建议分段或更换入口 |
| `AUDIO_OUTPUT_TOO_LARGE` | 两次有界编码仍超限 | 不回填 |
| `AUDIO_OUTPUT_FORMAT_NOT_ALLOWED` | 页面未明确允许 MP3 | 不执行 |
| `AUDIO_DURATION_LIMIT_UNFIXABLE` | 障碍是时长而不是字节 | 不裁剪、不分段 |
| `AUDIO_MEMORY_BUDGET_EXCEEDED` | 无法在安全内存预算内处理 | 停止并释放资源 |
| `AUDIO_WORKER_UNAVAILABLE` | 后台处理路径不可用 | 不退化处理长文件 |
| `AUDIO_PROCESSING_CANCELLED` | 用户取消 | 清理并恢复原文件 |

错误码必须进入共享白名单、UI 文案、单元测试和诊断映射。

S4.1 验收后，合法且位于支持子集内的超限 MP3 或 AAC-LC M4A 不得再仅因“源文件是压缩格式”返回 `AUDIO_CODEC_UNSUPPORTED`；该错误只表示真实 profile/container/capability 不支持。

## 15. 诊断与可观察性

允许记录：媒体类型、容器/编码枚举、近似时长区间、输入/输出字节、目标码率、声道数、处理阶段、耗时、workerUsed、重试次数、错误码、清理结果、生产包 bytes/SHA。

禁止记录：文件名、文件内容、Base64、PCM、频谱、完整网页文本、完整 AI prompt/响应、账号、脚本 ID、分享链接或用户目录。

建议事件：

```text
AUDIO_INSPECTION_STARTED / COMPLETED
AUDIO_PLAN_CREATED
AUDIO_CONFIRMATION_REQUIRED / ACCEPTED / DECLINED
AUDIO_PROCESSING_STARTED / PROGRESS / CANCELLED
AUDIO_OUTPUT_VALIDATED
AUDIO_INJECTION_SUCCEEDED / FAILED
AUDIO_RESOURCES_CLEANED
```

## 16. 测试与验收场景

### 16.1 自动化 Must

- 合规 MP3 原样放行，字节与 File 身份不被替换。
- MP3 允许且超限：形成音频计划，确认后输出不超过硬上限。
- M4A/AAC 与 WAV：在页面允许 MP3 时形成转码计划。
- 英文 `Max 10 MB and 10 minutes` 同时解析大小/时长；超过时长时即使能压小也停止。
- `File exceeds 25 MB limit.` 等 transient toast 被识别为明确拒收，只在规则更严格且任务唯一关联时进入最多一次重试。
- 页面没有 maxBytes、没有允许 MP3、规则冲突、只有时长限制时均不执行。
- 48kbps 以下才可满足时停止。
- 取消、输入被移除、页面关闭、处理错误后资源清理。
- 图片全量测试保持通过；音频扩展不能让裸 file input 或视频 input 被误判。
- 生产包无运行时外联、无模块加载、可直接执行。

### 16.2 本地稳定页面

至少新增：

- A：合规 MP3 直接通过；
- B：超限 MP3，确认后压缩并回填；
- C：WAV/M4A 转 MP3；
- D：maxBytes 缺失，不处理；
- E：不允许 MP3，不处理；
- F：只有时长限制，明确停止；
- G：取消和输入移除；
- H：明确拒收后最多一次重试。

### 16.3 实际 200MB→100MB 门禁

- 使用本地生成、无人物、无版权风险的合成语音型 fixture；不得提交 200MB 文件到 Git。
- 输入字节必须大于 200,000,000，页面硬上限为 100,000,000 bytes。
- 记录输入/输出 SHA-256、容器、时长、码率、声道、处理耗时、峰值内存可得值、主线程心跳和外部请求数。
- 输出必须为可解码 MP3，`0 < output.size <= 100000000`，目标应尽量不超过 95,000,000。
- 页面 `change` 业务处理一次、最终提交点击为零、外部音频请求为零。
- Tabbit UI 在处理期间可响应取消；最大主线程心跳间隔目标不超过 500ms。

## 17. 成功指标

| 指标 | 门槛 |
|---|---|
| 核心场景闭环 | 200MB 级输入在 100MB 上限页完成确认、处理、复检、回填 |
| 最终字节 | 不超过页面机器上限；首次目标保留约 5% 安全余量 |
| 质量底线 | 不使用低于 48kbps 单声道的方案 |
| 隐私 | 音频外部请求 0；持久化 0 |
| 操作安全 | 自动提交点击 0；页面自动重试不超过 1 |
| 性能 | 流式有界内存；主线程可取消；不完整展开 PCM |
| 回归 | V1 图片测试和实机主路径保持通过 |
| 交付 | 单 IIFE、无远程依赖、bytes/SHA 可复现 |

## 18. 阶段计划

| 阶段 | 目标 | 硬闸门 |
|---|---|---|
| V2-S0 | 编解码、许可、单文件体积、流式内存和 Tabbit 探针 | 真实 200MB 原型成立，否则停止 |
| V2-S1 | 音频上传器、规则与元数据 | 不处理文件即可准确判定计划前提 |
| V2-S2 | 规划、流式处理、最终复检 | 处理引擎独立通过 200→100 自动化/人工证据 |
| V2-S3 | controller、确认 UI、回填与拒收闭环 | 本地 A–H 场景通过，图片无回归 |
| V2-S4 | 全量 QA、安全、性能、Tabbit 实机 | 真实单 IIFE 核心闭环与清理通过 |
| V2-S4.1 | 超限 MP3 重编码、AAC-LC M4A 转 MP3、英文规则与 transient 拒收修复 | 两类真实 decoder 在 Tabbit Worker 成立；Podcastools/VocaText/稳定 M4A 门禁通过；图片/WAV 无回归 |
| V2-S5 | 发布材料、演示与最终候选包 | 安装、说明、演示、矩阵和最终验收齐全 |

S0 是强制停止线。外部 Agent 不得以短文件 `decodeAudioData` demo、Node 原生 ffmpeg、远程服务、Playwright Chromium 或 mock 编码器替代 Tabbit 真实可行性。

## 19. 风险与裁决原则

| 风险 | 应对 |
|---|---|
| Tabbit 无 MP3 编码能力 | 内嵌轻量编码器；若许可/体积/性能不成立则停止 V2 |
| M4A 解复用复杂 | S0 锁定 AAC-LC 子集和 demux 方案；不承诺所有 M4A |
| WebCodecs 只报告支持但实际解码失败 | S4.1 必须在 production 等价 Worker 投递真实 MP3/AAC chunk 并获得 AudioData；否则对应格式阻塞 |
| transient toast 太短或误关联 | 有界 MutationObserver + 英文 classifier；全局提示仅单活跃任务可关联；成功 toast 忽略 |
| 200MB 内存爆炸 | 流式分块、Worker、有界 PCM；禁止完整 decodeAudioData |
| 输出大小不可预测 | CBR/离散阶梯、5% 余量、最多一次本地纠偏、最终复检 |
| 人声质量下降 | 48kbps 绝对底线、单声道明确确认、不承诺音乐 |
| 包体上升 | 目标 600KB–1.0MB，超过 1.2MB 先做 ADR/范围复核 |
| 第三方许可证 | S0 审查并锁定；不清楚即阻塞 |
| 图片能力回归 | 每阶段运行 V1 全量测试，媒体路由保持隔离 |

## 20. 最终 Definition of Done

只有同时满足以下条件，V2 才能声明完成：

- V2-S0 至 S5（包括产品修订阶段 V2-S4.1）均有独立验收结论和可复核证据；
- 核心场景在当前 Tabbit 真实单 IIFE 中通过；
- 200MB 级输入到 100MB 硬上限实测通过；
- 合规文件原样放行，停止条件没有越界处理；
- 音频内容不联网、不持久化、可取消、资源清理完成；
- 图片 V1 全量回归通过；
- 最终 `dist/uploadfit.js` 可复现并记录 raw bytes/SHA；
- 第三方依赖及许可证清单完整；
- 安装说明、隐私说明、测试矩阵、演示脚本和已知限制一致；
- 主验收 Agent 从干净基线复验后签发 `ACCEPTED`。

代码完成、短音频 demo 成功或 Chromium 自动化全绿，均不能单独替代以上完成定义。

## 21. 参考事实

- W3C WebCodecs：浏览器编解码支持取决于 User Agent，encoded chunks 不自动提供完整媒体容器。<https://www.w3.org/TR/webcodecs/>
- W3C MediaStream Recording：`isTypeSupported()` 只能说明 MIME/容器组合可能受支持，实际运行仍可能失败。<https://www.w3.org/TR/mediastream-recording/>
- OpenAI Audio API FAQ：不同转写入口存在不同上传限制，旧 `whisper-1` 请求上限为 25MiB。<https://help.openai.com/en/articles/7031512-audio-api-faq>
- Notta 导入说明：音频可受 1GB/5 小时等组合限制，证明不能把固定站点数字写死进产品。<https://support.notta.ai/hc/en-us/articles/15358519267611-Import-files-from-local-storage>
