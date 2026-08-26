# Tabbit 能力探针记录

## V2-S4.1 Worker codec gate（2026-08-25）

Tabbit Chromium 151、本地安全上下文、Dedicated Blob Worker 中，真实 MP3 与 AAC-LC chunks 均产生可验证 `AudioData`；MP3 33 outputs/38,016 frames，M4A 48 outputs/49,152 frames，48kHz mono。两类均复用成功、decoder closed、未关闭 `AudioData=0`；取消无迟到消息；external requests=0。MP3/M4A production matrix 另覆盖 32/44.1/48kHz mono/stereo。当前 production 为 444,989 bytes / SHA `EB77F23278CBCEB739376671D0C1AEEEAC417309DD346EB40CEC2FE99729E030`。

Podcastools 当前 production IIFE 的规则、时长停止、MP3 正例与 M4A 正例均通过；VocaText 25MB transient toast、压缩与一次重试闭环通过，业务 submit=0。验收 task 已按技能要求唯一 `finish` 一次。细节见 `docs/evidence/V2-S4.1/tabbit-matrix.json`。

本文件是 S0 能力探针的持续记录。只有完成实际复现并保留证据后，能力才可标记为 `PASS`；当前未测试项目保持 `UNKNOWN`。

## V2-S4 Phase 2A1 状态

状态 `CORE_FIX_PASS_OFFICIAL_REINSTALL_REQUIRED`。当前 production `dist/uploadfit.js` 为 421,333 bytes，SHA-256 `98BD12C651C2801E2E2E8BC9C2A006057024AA26E2D916B33899487B9A0F1A68`。Chrome/151.0.7922.109 的 VocaText/Zent 真实 DOM 修复诊断通过，但本轮使用当前 bundle 临时验证，没有冒充官方私有脚本保存；此前 421,347-byte SHA 的 exact save/LR1/LR3 继续作为历史证据。当前 SHA 重新粘贴后需补保存/刷新检查。

以下“历史环境与平台记录”是 S0/S2 及既往平台记录；本轮 V2-S4 只引用 `docs/evidence/V2-S4/phase2a1-*.json`，不从历史记录推导通过。

## 历史环境与平台记录（非 V2-S4 Phase 1 证据）

| 项目 | 值 |
|---|---|
| Tabbit Browser | 1.10.16.0（S4 最终复验；S0 历史证据为 1.9.22.0） |
| 操作系统 | Windows |
| Node | v22.20.0 |
| npm | 10.9.3 |
| 探针日期 | 2026-08-19 |
| 当前页面 | Tabbit 官方私有脚本 + `http://127.0.0.1:8766/test-pages/probe.html`（取证后已清理） |

## 能力矩阵

| 能力 | 状态 | Tabbit版本 | 复现步骤/当前证据 | 降级或后续动作 |
|---|---|---:|---|---|
| 安装脚本 | PASS | 1.9.22.0 | 通过“创建妙招 → 脚本”创建私有探针，页面返回“创建成功”；验收后删除成功 | 正式发布仍使用同一创建入口；探针没有公开发布 |
| 手动运行生命周期 | PASS | 1.9.22.0 | 私有探针先启用“每次都自动运行”，匹配页刷新后执行；随后关闭并保存，刷新不再注入；产品自身重复 bootstrap/cleanup/rebootstrap 继续通过 | 用户可关闭自动运行；产品 cleanup 保持幂等 |
| 匹配页面范围 | PASS | 1.9.22.0 | 选择“仅对部分网页生效”，保存 `http://127.0.0.1:8768/*`；只在匹配页观察到 `LLMBridge` 与探针结果 | 正式脚本限定目标页面，不使用“全部网页” |
| File/Blob | PASS | 1.9.22.0 | `probe.html` 页面内生成内存文件成功 | 继续保留文件不出浏览器约束 |
| DataTransfer | PASS | 1.9.22.0 | 构造、添加 File、读取 `dt.files` 成功 | 产品注入器继续处理异常降级 |
| `input.files` 赋值 | PASS | 1.9.22.0 | B 写入后元信息复核通过，A 恢复也通过 | 进入产品注入器实现 |
| input/change 合成事件 | PASS | 1.9.22.0 | input 后 change；捕获/目标/冒泡各一次 | `isTrusted=false`，不承诺所有网站逻辑都接受 |
| Canvas/toBlob | PASS | 1.9.22.0 | 页面能力摘要均为 true | 后续图像引擎仍需单元/浏览器测试 |
| createImageBitmap | PASS | 1.9.22.0 | 页面能力摘要为 true | 后续增加解码实测和失败降级 |
| Worker/Blob Worker | PASS | 1.9.22.0 | 当前生产 bundle 在 Tabbit 实机能力探针中均为 true | S2 再验证实际图像任务并准备主线程降级 |
| OffscreenCanvas | PASS | 1.9.22.0 | 页面能力摘要为 true | S2 再验证实际转码路径 |
| Tabbit AI 官方接口 | PASS | 1.9.22.0 | 用户提供的官方调用指南确认 `LLMBridge.chat()`；私有官方脚本实测 JSON 模式 1730ms 成功，返回可解析 JSON 字符串；空参数以 `Error: content is required` 拒绝 | 仅在启用且页面匹配的官方脚本运行时可用；产品强制 3000ms 超时、解析并校验 JSON |
| CSP/外部依赖限制 | PASS | 1.9.22.0 | Tabbit 托管脚本、`LLMBridge.chat`、当前单文件 bundle 与 Blob Worker 均在实机运行；未加载任何远程运行时代码 | 继续禁止 CDN/远程脚本；外部 CDN 不作为产品路径探测 |
| 单脚本粘贴/保存/运行与实际体积 | PASS | 1.10.16.0 | 169,536-byte production IIFE 随 172,028-byte 验收脚本成功保存并自动运行；无 ESM import/export | 官方未声明固定上限；按 PRD 仅记录 bytes/SHA，不设体积门禁 |
| 安装、更新、分享方式 | PASS | 1.9.22.0 | 私有探针创建和保存更新均成功；分享弹层生成 `https://web.tabbit.com/share/skill/<opaque-id>`，可见范围为“仅自己”，未分发；探针最终删除 | 正式交付时再生成并分发安装链接；S0 不公开临时探针 |

## 已确认的平台连接差异

Tabbit 的 `DevToolsActivePort` 文件为：

```text
C:\Users\蔡天乐\AppData\Local\Tabbit Browser\User Data\DevToolsActivePort
```

文件提供端口 `9222` 和浏览器 WebSocket 路径。对 `http://127.0.0.1:9222/json/version`、`/json/list` 等标准 Chromium 路径请求均返回 404；使用完整地址连接后，`agent-browser` 能读取当前页面 URL。因此后续实机证据使用完整 WebSocket 端点连接，不把标准 `/json/*` 可用性写成前置条件。

## 当前 bundle 实机证据

2026-08-17 在 Tabbit 1.9.22.0 的本地探针页加载当前 `dist/uploadfit.js`，已验证产品 bundle 的单例启动、DataTransfer/input.files 注入、input/change 事件链和 cleanup/rebootstrap。详见 `docs/evidence/S0/tabbit-bundle-result.json`。

2026-08-18 的补充探针使用 Tabbit 官方“创建妙招 → 脚本”完整创建和更新路径：限定 `127.0.0.1:8768/*`，启用自动运行后刷新匹配页，`LLMBridge.chat` 成功返回；关闭自动运行并保存后刷新不再注入。分享弹层可生成私有链接，临时探针最后删除。结果见 `docs/evidence/S0/tabbit-llmbridge-result.json`。

2026-08-19 的 S4 最终探针发现 Tabbit 1.10.16.0 会扫描脚本源码中的字面量 `LLMBridge.`，命中后才注入 MAIN-world bridge。最终 production bundle 已固定保留该 token；官方脚本实际调用 0→1 并通过本地 Schema/evidence 校验。结果见 `docs/evidence/S4/tabbit-ai-result.json`，临时私有妙招已删除。

## 证据索引

- 当前连接检查：`docs/evidence/S0/README.md`
- 最小探针截图：`docs/evidence/S0/probe-after-restore.png`
- 最小探针诊断 JSON：`docs/evidence/S0/probe-result.json`
- Tabbit 平台与官方阻塞证据：`docs/evidence/S0/tabbit-platform-result.json`
- Tabbit 官方脚本生命周期与 LLMBridge 实机证据：`docs/evidence/S0/tabbit-llmbridge-result.json`
- LLMBridge 安全摘要截图：`docs/evidence/S0/tabbit-llmbridge-probe.png`
- S0 最终交接：`docs/handoffs/S0-handoff.md`

## V2-S0 音频补充（2026-08-21）

V2-S0 已在真实 Tabbit `1.10.16.0` 执行音频探针。大文件证据使用项目 CDP `9222`；最终带许可证声明的构建、完整能力快照与进度后取消使用隔离临时 profile/CDP `9333`，取证后关闭并删除，日常 Tabbit profile 未被修改。File/Stream、ReadableStream、TransformStream、Blob Worker、Transferable、WASM、AudioContext/OfflineAudioContext 以及 MP3/AAC-LC/Opus decoder 能力通过；WAV 由 bounded PCM parser 处理，不宣称浏览器存在 WAV container API。原生 MP3 `AudioEncoder` 为 `false`，因此采用并精确锁定 `lamejs@1.2.1`。

真实 200,000,044-byte PCM32 WAV → 20,834,880-byte `audio/mpeg` 通过独立首帧解码和全帧扫描；Worker heartbeat 189ms，峰值缓冲 21,162,560 bytes；立即取消证据继续保留。最终带声明 IIFE 为 353,484 bytes，SHA `878ABD08E561E627E9C3024C367ADA4036F9C481AC304FE8617DC2D9C0B4EAED`；剥离 220-byte 纯注释后，可执行 payload 的 bytes/SHA 与大文件已测版本完全一致。该最终构建另以小型合成 WAV 完成“收到首个 Worker 进度后取消”，取消后新增进度与结果均为 0，Worker/URL 清理通过。外部请求与持久化均为 0。

V2-S0 与 V2-S1 已于 2026-08-21 独立验收为 `ACCEPTED`，V2-S2 可开工。V2-S0 的分发合同要求正式含编码器发布物同时提供稳定源码/许可证/NOTICE/替换重建材料；裸 Tabbit share URL 不得单独公开。证据与交接：

- `docs/evidence/V2-S0/capability-matrix.json`
- `docs/evidence/V2-S0/tabbit-capability-safe-snapshot.json`
- `docs/evidence/V2-S0/audio-200-to-100.json`
- `docs/evidence/V2-S0/resource-profile.json`
- `docs/evidence/V2-S0/cleanup.json`
- `docs/evidence/V2-S0/licenses/NOTICE.md`
- `docs/handoffs/V2-S0-handoff.md`
- `docs/handoffs/V2-S0-S1-final-acceptance.md`
