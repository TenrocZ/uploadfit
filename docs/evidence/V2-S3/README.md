# V2-S3 证据目录

状态：`READY_FOR_ACCEPTANCE`。本目录记录 S3 接入正式 `TaskController`、media handler registry、音频确认/进度 UI、回填闭环和拒收一次重试的本地证据；独立验收仍待主验收 Agent 执行。V2-S4、V2-S5 继续 `HOLD`。

## 范围与冻结裁决

本阶段基线为 `bf266484ee85d7deb30ea04584ee74e0c6e2d7a8`。实现严格遵守 [ADR-005](../../decisions/ADR-005-V2-S0-音频编解码方案.md)：

| 输入 | S3 行为 | process/Worker |
|---|---|---:|
| 合规 MP3（签名、MIME、帧、字节和页面规则均通过） | 原 `File` passthrough，不替换 input | 0/0 |
| PCM WAV，16/24/32-bit，mono/stereo | 先确认，再用冻结 `lamejs@1.2.1` 编码为 MP3，独立复检后回填 | 1/1 |
| 超限 MP3 | `AUDIO_CODEC_UNSUPPORTED`，保留原文件 | 0/0 |
| M4A/AAC（含 AAC-LC） | `AUDIO_CODEC_UNSUPPORTED`，保留原文件 | 0/0 |
| 仅 duration 上限、无可信 `maxBytes`、目标不允许 MP3 | 稳定安全停止，不裁剪、不分段、不扩 codec | 0/0 |

没有新增 decoder、M4A/AAC 路径、远程 runtime 依赖或第二套 controller。S2 已验收的生产等价 200MB 门禁和真实编码器证据只作为上游复用，未冒充本阶段新执行；真实 Tabbit 及 200MB 慢速门禁归 S4。

## 交付路径

- `src/core/media-handlers.js`：image/audio registry；image 保留既有 pipeline，audio 接入 S2 handler。
- `src/core/task-controller.js`：最小化按 `mediaKind` 路由，复用既有状态、FIFO、确认、注入、回滚、拒收观察、清理、下载/恢复和 pagehide/input detach abort。
- `src/audio/worker-runtime.js`、`esbuild.config.js`：将 S2 冻结 Worker implementation 真正嵌入 production 单 IIFE；无 runtime `import`/`export`/外联，构建时仍可替换源码。
- `src/ui/task-card.js`、`src/ui/status-pill.js`、`src/ui/host.js`：音频原/目标格式、字节、duration、bitrate、channels/mono、有损警告、进度、取消、成功/失败和可访问性呈现。
- `src/utils/logger.js`：仅记录稳定码和安全标量；不记录文件名、File/Blob、tags、PCM、Base64 或原始异常。
- `test-pages/audio-s3.html`、`audio-s3.css`、`audio-s3.js`：本地稳定页 A–H；无外部资源，页面快照不含文件名。

## A–H 覆盖

| 场景 | 本地页面 | 定向执行证据 |
|---|---|---|
| A 合规 MP3 直通 | `audio-s3.html?scenario=A` | `v2-audio-s3.spec.js`：真实 MP3 passthrough，process/injection=0 |
| B PCM WAV→MP3 | `audio-s3.html?scenario=B` | 真实 production page + probe：确认、Worker、最终复检、DataTransfer 回填 |
| C 超限 MP3/M4A 停止 | `audio-s3.html?scenario=C` | `v2-audio-s3-controller.spec.js`：两种输入均稳定码、process/Worker=0 |
| D 无 maxBytes 停止 | `audio-s3.html?scenario=D` | controller matrix：规则不足安全停止 |
| E MP3 不允许停止 | `audio-s3.html?scenario=E` | controller matrix：`AUDIO_OUTPUT_FORMAT_NOT_ALLOWED`，不处理 |
| F 仅 duration 停止 | `audio-s3.html?scenario=F` | controller matrix：`AUDIO_DURATION_LIMIT_UNFIXABLE`，不裁剪/分段 |
| G 取消/脱离 | `audio-s3.html?scenario=G` | controller：Abort、detach、迟到结果隔离、原文件保持 |
| H 拒收最多一次 retry | `audio-s3.html?scenario=H` | controller + production page：一次关联拒收、最多一次重试、submit click=0 |

## 实际验证

| 范围 | 命令 | 结果 |
|---|---|---|
| Unit/集成/静态 | `npm run check` | 通过：25 个 Vitest 文件、229 个测试；production `419330` bytes；static-check 通过 |
| S3 定向 | `npm run test:e2e -- tests/e2e/v2-audio-s3-controller.spec.js tests/e2e/v2-audio-s3.spec.js --reporter=line --workers=1` | 通过：9/9 |
| 全量 E2E（唯一一次） | `npm run test:e2e -- --reporter=line --workers=1` | 通过：156/156；未运行 S4 真实 Tabbit/200MB 慢速门禁 |
| 空白检查 | `git diff --check` | 通过 |

最终 production artifact：`dist/uploadfit.js`，419330 bytes，SHA-256 `472F7A308933618630BA2057046CFA845C973CF1BA41EF4B6F4DD2F61CC83FD4`。构建对冻结上游源码仅移除历史尾随空格和替换不执行的上游信息 URL 为 `embedded://lamejs`；未改变 encoder 版本/API/算法。

## 隐私与回填审计

- 安全 snapshot 只含 `mediaKind`、MIME/container/codec、尺寸、duration、bitrate、channels、进度、稳定错误码和有限计划数值。
- logger 单测覆盖音频 progress 的文件名/私有字段脱敏；E2E 断言 snapshot/log 不含测试私有文件名。
- 成功路径只使用 `DataTransfer` 注入；注入异常验证事务回滚、原文件恢复和可下载处理结果；不自动点击业务提交按钮。
- 关闭、input detach、pagehide 和取消均触发 abort/清理；迟到 Worker 消息不能再次注入。

## 复用与已知限制

- S2 `docs/evidence/V2-S2/audio-200-to-100.json`、真实 `lamejs@1.2.1` 六组合和清理证据为已验收上游复用，不计作 S3 新慢速门禁。
- S3 没有执行真实 Tabbit、200MB 慢速门禁或 S4/S5 交付；这些保持 `HOLD`，由后续阶段负责。
- 超限 MP3 重编码、M4A/AAC 转码仍稳定停止为 `AUDIO_CODEC_UNSUPPORTED`，除非按 ADR-005 条件 4 验证解码路径并新增 ADR。
