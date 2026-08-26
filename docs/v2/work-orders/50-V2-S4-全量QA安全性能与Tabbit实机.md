# 50 V2-S4 全量 QA、安全、性能与 Tabbit 实机

## 1. 阶段定位

- 开工条件：`V2-S3 ACCEPTED`。
- 目标：在接近发布的 production 单 IIFE 上完成自动化、安全、性能、兼容和真实 Tabbit 验证。
- 本阶段以发现问题和证据闭环为主；允许修复明确缺陷，但不得扩展功能或降低门槛。
- 阶段 Agent 只能申请 `READY_FOR_ACCEPTANCE`，主验收 Agent独立复核后才能放行 S5。

冻结范围：S4 只验证 S2 已验收的“合规 MP3 passthrough + PCM WAV 16/24/32-bit mono/stereo→MP3”。超限 MP3 与所有 M4A/AAC 输入必须以 `AUDIO_CODEC_UNSUPPORTED` 停止、Worker 调用数为 0；不得在 QA 阶段补解码器或把 S0 的原始目标文字当成已实现能力。相关扩展归 V2.1 和新 ADR。

> 2026-08-25 后续裁决：上述内容继续作为 V2-S4 历史验收基线，不再代表最终产品范围。产品所有者已将超限 MP3、AAC-LC M4A 和 transient 拒收修复授权为独立 `V2-S4.1`；施工与验收以 `55-V2-S4.1-MP3-M4A转码与拒收监听修复.md` 为准，不回写或伪造本阶段历史证据。

### 资源分级执行原则（2026-08-24 补充）

S4 优先回答产品能否跨过真实上传墙。以下为阻塞性核心：官方 Tabbit 纯 JS 保存/auto-run、合规 MP3 直通、PCM WAV→受限 MP3、不支持输入安全停止、大文件响应/取消、不自动提交、不外传/不持久化，以及图片主线不回归。

以下只作为辅助观测，不得因测试工具自身盲区长时间阻塞施工：CDP 是否枚举到短生命周期 Blob Worker target、DataTransfer 后 JavaScript `File` 引用是否严格同一（最终签名/字节/类型/注入仍必须正确）、为每条已由真实 controller/Worker 自动化覆盖的分支重复开发 Tabbit 专用驱动。辅助项缺失必须诚实标记 `NOT_MEASURED`/pending，不得伪写 PASS；若核心结果或安全边界失败，仍按第 9 节返修。

## 2. 必须验证的候选产物

- 先运行 `npm run build`，测试和实机均使用同一份 `dist/uploadfit.js`。
- 记录 raw bytes 与 SHA-256；每份 Tabbit JSON 证据引用相同 SHA。
- 禁止使用 S0 探针包、debug/test bundle、历史 dist 或直接注入源码冒充候选包。
- 单 IIFE 不要求固定字节门禁，但 >1.2MB 时必须存在已批准 ADR。

## 3. 交付物

```text
tests/e2e/v2-audio-scenarios.spec.js
tests/e2e/v2-audio-security.spec.js
tests/e2e/v2-audio-performance.spec.js
tests/integration/v2-media-regression.test.js
docs/evidence/V2-S4/README.md
docs/evidence/V2-S4/v2-s4-result.json
docs/evidence/V2-S4/tabbit-matrix.json
docs/evidence/V2-S4/*.json / *.png
docs/handoffs/V2-S4-handoff.md
```

同步更新 `docs/test-results.md`、`docs/security-review.md`、`docs/performance.md`、`docs/tabbit-capabilities.md` 和 `docs/testing-sites.md`。

## 4. 自动化测试范围

### S4.1 功能矩阵

至少覆盖：

| ID | 场景 | Must 断言 |
|---|---|---|
| A01 | 合规 MP3 | 原 File passthrough，process=0 |
| A02 | 超限 MP3 | `AUDIO_CODEC_UNSUPPORTED`，process=0、原 File 保留 |
| A03 | WAV→MP3 | 签名正确、时长保持、回填 |
| A04 | M4A/AAC（含 AAC-LC） | `AUDIO_CODEC_UNSUPPORTED`，process=0、原 File 保留 |
| A05 | maxBytes 缺失 | 不形成 executable plan |
| A06 | MP3 未允许 | 不处理 |
| A07 | 只有 duration limit | `AUDIO_DURATION_LIMIT_UNFIXABLE` |
| A08 | 低于 48kbps 才可满足 | `AUDIO_TARGET_UNSAFE` |
| A09 | lossy 确认拒绝 | 原文件保留，Worker 不启动 |
| A10 | mono 确认拒绝 | 不处理 |
| A11 | processing cancel | 1 秒内停止，无迟到注入 |
| A12 | input detach / SPA replace | abort + cleanup |
| A13 | 第一次输出超限 | 最多第二次编码 |
| A14 | 第二次仍超限 | error，不回填 |
| A15 | 明确页面拒收 | retryCount=1，第二次不再自动处理 |
| A16 | 模糊/网络/权限/官方工具 | 零处理 |
| A17 | DataTransfer 失败 | 原 File/列表恢复，下载降级 |
| A18 | 关闭/刷新/新标签 | 无重复 host/session/Worker |

### S4.2 格式与对抗矩阵

- MP3 CBR/VBR、ID3v2、大/小标签、截断帧、伪扩展；
- WAV PCM 已支持位深、异常 chunk、超声道、data 长度伪造；
- M4A AAC-LC、其他 codec、moov 前后布局、截断 box：均有界识别并稳定停止，不进入 Worker；
- MIME/扩展名/签名冲突；
- 0 字节、零时长、NaN/Infinity、极端 duration/size；
- 规则冲突、数字子串伪证据、其他 uploader 文本污染；
- 混合 image/audio、video-only、multiple input；
- Worker 初始化/运行/终止异常和迟到消息。

### S4.3 图片回归

运行所有 V1 unit/integration/E2E，包括：

- 图片 A–F 稳定页；
- PNG/JPEG/WebP 转换、裁剪、大小区间和透明底；
- Zent v7 回归；
- CNIPA fixture/公开说明页行为；
- AI validator、拒收分类、一次重试；
- 注入回滚、关闭/清理、UI 可访问性；
- production 单 IIFE、static-check。

任何 V1 Must 失败均阻塞 V2-S4，不得标记为“与音频无关”。

## 5. 安全测试

### S4.4 外联与数据泄露

对 production 源码/产物静态扫描并在浏览器拦截记录：

- fetch、XHR、WebSocket、EventSource、sendBeacon；
- script/link/import/Worker 外部 URL；
- form 自动提交、导航、popup；
- localStorage、sessionStorage、IndexedDB、Cache Storage、OPFS；
- console/logger/AI 输入是否包含 File/name/Base64/PCM/完整网页文本。

允许的本地 Blob Worker 请求必须区分记录，不得计为外部网络。核心音频场景外部请求必须为 0。

### S4.5 资源与攻击面

- 恶意 ID3/tag 不进入 UI innerHTML；
- 恶意规则文本不执行脚本；
- 伪造 Worker 消息/taskId 被拒绝；
- 超大 box/chunk/帧长度不导致无限分配；
- zip bomb 类容器声明、整数溢出和超大 duration 有界失败；
- 多次取消/关闭不残留 Worker/object URL/listener；
- CSP 阻止路径诚实停止，不引导关闭安全设置；
- 编码器/依赖版本与许可证/NOTICE 一致。

## 6. 性能测试

### S4.6 快速自动化

- 用小/中 fixture 记录 inspect、plan、process、validate 分阶段耗时；
- 100ms heartbeat，最大间隔目标 ≤500ms；
- progress 事件频率 ≤10/s 且单调；
- 同时选多个文件时只有一个音频任务处理；
- 取消 deadline ≤1000ms；
- 处理完成后再运行第二任务，无显著资源累积。

### S4.7 实际 200MB 慢速门禁

- 输入为可解码、无版权风险的合成语音型音频，`size > 200000000`；
- 页面硬上限 `100000000`，输出 MP3 可独立解码且 `size <=100000000`；
- 记录输入/输出 SHA、duration、codec、bitrate、channels；
- 记录总耗时、分阶段耗时、encodePasses、max heartbeat gap、可得峰值内存/peakBufferedBytes；
- 执行一次成功和一次处理中取消；
- 文件本体不入 Git，验收后按说明清理。

墙钟耗时受硬件影响，只记录不设置统一分钟阈值；但 UI 无响应、无法取消或内存随完整 PCM 膨胀为硬失败。

## 7. Tabbit 实机矩阵

使用当前 production bundle，通过 Tabbit 官方私有脚本、部分网址匹配加载。临时脚本不得公开分享。

| LR | 实机步骤 | 必须证据 |
|---|---|---|
| LR1 | 安装/保存/刷新 | 版本、bundle SHA、1 host/1 session、无模块错误 |
| LR2 | 合规 MP3 | passthrough、File 未替换、submit click=0 |
| LR3 | 小型 PCM WAV→MP3 | 确认→处理→复检→回填、external=0 |
| LR4 | 实际 200MB→100MB | 完整结构化结果、进度可响应、最终字节、截图 |
| LR5 | 冻结输入边界 | PCM WAV 输出 MP3；超限 MP3 与 M4A/AAC 诚实停止且 Worker=0 |
| LR6 | 处理中取消 | ≤1s 停止、原文件保留、Worker/URL 清理 |
| LR7 | 明确拒收重试 | source=rejection、retryCount=1、无第二次自动重试 |
| LR8 | AI 文本规则路径 | LLMBridge 仅收去敏规则文本；本地 validator；音频数据 0 |
| LR9 | 关闭/刷新/新标签 | 关闭不复活，新标签仅 1 session，无残留处理 |
| LR10 | 图片回归 | 至少复跑 S5 场景 A/B 与关闭，当前 SHA 一致 |

截图只截 UploadFit UI 和非敏感测试页。JSON 不保存完整 prompt/响应、文件名、路径、脚本 ID 或分享链接。

## 8. 结果一致性检查

以下位置数字必须一致：

- `dist/uploadfit.js` 实际 bytes/SHA；
- `v2-s4-result.json`；
- `tabbit-matrix.json`；
- `docs/test-results.md`、`performance.md`、`security-review.md`；
- S4 handoff；
- 证据 README。

测试数量使用实际值，不复制任务书历史数字。性能多次运行应标明 runId/时间，不把不同轮次最大值拼成一条结果。

## 9. 缺陷处理

发现失败时：

1. 写最小复现和对抗测试；
2. 只修复与已定义需求相关的根因；
3. 重新构建 production bundle；
4. 重跑受影响测试和完整 `npm run check`；
5. Tabbit 证据必须使用新 SHA 重做相关 LR；
6. handoff 列出修复前/后与未解决项。

环境不可用时状态为 `BLOCKED_BY_ENVIRONMENT`，不得用 Playwright 或历史证据冒充 Tabbit PASS。

## 10. 验收命令

```powershell
npm ci
npm run check
npm run test:e2e
git diff --check
```

Handoff 另列 200MB fixture 生成、慢速测试和 Tabbit 探针的精确命令/操作。

## 11. 退出标准

- [ ] A01–A18 和格式对抗矩阵通过。
- [ ] V1 图片 Must 全量回归通过。
- [ ] production 静态安全、运行时外联和持久化均通过。
- [ ] 实际 200MB→100MB 成功与取消门禁通过。
- [ ] LR1–LR10 使用同一 production SHA 完成。
- [ ] 自动提交 click=0、页面 retry≤1、编码 pass≤2。
- [ ] 图片/音频内容、文件名、PCM/Base64 未进入网络/AI/持久化/证据。
- [ ] 许可证和 NOTICE 完整。
- [ ] 所有文档数字一致。
- [ ] 状态只申请 `READY_FOR_ACCEPTANCE`，未自行放行 S5。

## 12. 给独立验收方的返工单要求

若任一 Must 不通过，验收方应输出 `docs/handoffs/V2-S4-acceptance-rework-order.md`，逐项包含：缺陷 ID、严重级别、复现、预期/实际、根因线索、允许文件范围、必须新增测试、证据路径和退出标准。不得只写“继续优化”。
