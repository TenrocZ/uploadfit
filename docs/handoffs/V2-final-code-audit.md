# UploadFit V2 发布前最终代码审计

- 日期：2026-08-25
- 范围：当前工作区主代码、production IIFE、核心状态机、图片/音频 handler、规则、Worker、验证、回填、清理、安全与生产依赖
- 结论：`CORE_CODE_ACCEPTED_S5_REQUIRED`

## 1. 本轮发现并修复

### F01 异步旧任务可越过取消边界

`TaskController` 原先只在 `inspect` 和 `process` 返回后检查 task 是否仍为当前任务；异步 `validate`、`plan`、audio `validateOutput` 返回后缺少同等检查。快速连续选择文件时，已经取消的旧任务可能继续释放被拦截事件；最坏情况下，旧音频结果会在第二个文件已选中后继续回填。

修复：在 preflight、拒收重规划和最终音频复检的每个异步 handler 边界后统一检查 abort、`record.currentTask` 与 input 连接性；旧任务只静默结束，脱离 input 则稳定停止为 `INPUT_DETACHED`。项目回归覆盖“旧校验不释放新选择事件”和“旧最终复检不覆盖新文件”。

### F02 大 CBR MP3 的 ID3v1 假设造成时长偏差

大于元数据读取窗口的 CBR MP3 原先无条件扣除尾部 128 bytes，等价于假定所有大文件都有 ID3v1。修复后只在有界 tail 的倒数 128 bytes 确认 `TAG` 签名时扣除，并让平均码率使用同一音频字节范围。单测同时覆盖有 TAG 与无 TAG 的 >1MiB CBR 文件。

### F03 Podcastools 展示文件名被误解析为体积区间

Podcastools 在选择文件后会把文件名显示在上传框附近。形如 `uploadfit-mp3-30MB-320k.mp3` 的名称原先会被确定性规则解析器误判为 `30MB–320KB`，继而产生 `BYTES_RANGE_REVERSED`，导致已经具备 MP3 重编码能力的任务在元数据检查前停止。

修复：体积解析仅忽略位于真实媒体文件名 token 内的数字单位，页面真实规则 `Max 10 MB` 和独立简写区间 `30KB—120KB` 仍照常解析。新增回归同时覆盖纯文件名和 Podcastools 真实规则文本。

## 2. 独立验收结果

| 门禁 | 结果 |
|---|---|
| `npm run check` | PASS：25 files / 252 tests；production build 与 static-check PASS |
| production IIFE | 446,208 bytes；SHA-256 `C7E3D59FA0B44B0EC2104B34AE7FFB040A577B6E8A8B18F6DB4F79241D5C79A8` |
| `git diff --check` | PASS；只有既有 CRLF 提示，无 whitespace error |
| 源码/新增测试语法 | PASS |
| production 依赖 | `lamejs@1.2.1` → `use-strict@1.0.1`，无其他 runtime 依赖 |
| npm 官方 production audit | 0 info / low / moderate / high / critical |
| Tabbit 竞态回归 | PASS：旧图片校验零事件释放；旧音频复检零回填；只处理第二个文件 |
| Tabbit production 冒烟 | PASS：Chrome 151；production 模式；状态 `ARMED`；动态 input 被发现；重复加载保持 1 host / 同一 session |
| Podcastools MP3 正例 | PASS：12,000,000 bytes / 300,000ms / 320kbps MP3 → 8,400,672 bytes / 224kbps MP3；`submit=0` |
| Podcastools 30MB 边界 | PASS：30,481,920-byte MP3 不再产生文件名规则冲突；识别 762,048ms > 600,000ms 后以 `AUDIO_DURATION_LIMIT_UNFIXABLE` 安全停止 |

本轮没有切换浏览器后端；Tabbit 任务按技能要求只执行一次 `finish`。本轮修复前的 S4.1 已验收基线完整 E2E 为 204/204；本轮没有用项目 Playwright 后端重跑，受影响的两个异步竞态以修复后同源码 debug bundle 在 Tabbit 中直接执行，production IIFE 另做启动与发现冒烟。

Podcastools 的公开页面复验也只使用 Tabbit。页面规则同时为 10,000,000 bytes 与 600,000ms：5 分钟超体积 MP3 能被重编码到安全上限内；用户的 30MB 样本约 12.7 分钟，压缩体积不能缩短时长，因此仍应停止。完整增量见 `V2-podcastools-mp3-filename-fix.md`。

## 3. 审计未发现的新阻断

- 无 runtime fetch/XHR/WebSocket/EventSource/sendBeacon、远程 codec/Worker 或音频持久化路径。
- 无 eval/new Function、动态 import、动态 HTML 注入或业务提交按钮自动点击。
- Worker、Blob URL、AudioData、queue 与 task dispose/cancel 清理边界保持既有 S4.1 证据；本轮未改 codec/Worker payload、码率策略或内存上界。
- multiple 音频、混合 image/audio、时长裁剪/分段、HE-AAC/ALAC/DRM/fragmented MP4/raw ADTS AAC 等仍按 PRD/ADR 冻结为非支持范围，不作为缺陷解禁。

## 4. 发布边界

核心代码可以进入 V2-S5，但当前不能写成“已经公开发布”：

1. 尚无 `docs/evidence/V2-S5/release-candidate.json`；
2. `package.json`/build info 仍为工程版本 `0.1.0`，尚未由 S5 统一盖 `2.0.0-rc.1`；
3. 最终候选仍需统一 commit、version、bytes/SHA，并完成候选 SHA 的安装/更新及小型图片/音频烟测；
4. 公开分发必须同时提供 ADR-005 冻结的 NOTICE、完整许可证和 relinking/source 材料，不能只发布脱离配套材料的 Tabbit 脚本。

因此本报告裁决为 `CORE_CODE_ACCEPTED_S5_REQUIRED`：没有剩余已知主代码阻断，V2-S5 前置已满足；正式 `ACCEPTED` 只能在 S5 候选包完成后按 `99-最终验收手册.md` 给出。
