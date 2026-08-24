# V2-S3 独立验收返工单

- 验收结论：`NOT_ACCEPTED`
- 验收日期：2026-08-24
- 验收基线：代码 `dd4e35f54ebc0253df39cdc82dd3603b83ea7377`，文档 `6dcaec8`
- 返工执行者：`/root/v2_s3_implementation`（Luna Max）
- 后续阶段：V2-S4、V2-S5 继续 `HOLD`

## 1. 已通过项（不要重复施工）

独立验收已复用或重跑以下内容；返工不得重写已经通过的 S0-S2 编码器、图片主链或许可证材料：

- `npm run check`：25 个 Vitest 文件、229 个测试通过；production 419478 bytes；static-check 通过。
- S3 定向 E2E：9/9 通过。
- 施工 Agent 留存的一次全量 E2E：156/156，通过。
- `dist/uploadfit.js` 是单 IIFE，无 runtime import/export；首行 LGPL notice 已存在。
- 最终产物 SHA-256 为 `007D9DE412C98E02F9EE0EAE258A45268CFA5F27D1ACE8F32CD9EC23A39BA166`。
- 合规 MP3 passthrough、PCM WAV 真实 Worker 转 MP3、超限 MP3/M4A 安全停止、取消/脱离、注入回滚和日志文件名脱敏的现有定向用例均已通过。

返工只处理下述未通过项。不得解禁超限 MP3 重编码或 M4A/AAC 转码；不得新增 decoder、远程依赖或第二套 controller。

## 2. Must R3-1：拒收重试没有“规则严格收紧”门禁

### 现象与证据

施工单 40-V2-S3 §3.6 明确要求：“新规则必须比当前计划更具体，且仍允许 MP3”。当前 `src/core/task-controller.js::_handleRejection` 在收到任何 `explicit + related` 拒收后，直接把 `detail.candidates` 合并并重新 inspect/plan/process，没有比较新旧规则。

现有测试还把错误行为固化成了成功断言：`tests/e2e/v2-audio-s3-controller.spec.js` 的 retry 用例初始规则和拒收文本都是“MP3 最大 250KB”，但仍期待 `process === 2`、`retryCount === 1`。`test-pages/audio-s3.js` 的 H 场景也以相同 250KB 规则制造拒收。

这会让重复提示、DOM 重绘出来的同一提示或更宽松提示触发一次无意义的有损重编码，不符合“最小处理”和一次安全 retry 的定义。

### 必须修改

1. 在覆盖 `task.ruleCandidates/task.rules` 前保留旧规则，并增加纯函数门禁，例如 `isStrictlyMoreSpecificAudioRejection(previousRules, nextRules, rejectionCandidates)`。
2. 音频拒收只有同时满足以下条件才可进入重新规划：
   - 仍明确允许 MP3；
   - 无 safety flag、不可解冲突、duration/官方工具/原始文件/无损语义停止；
   - 至少一个会影响 S3 可执行计划的约束严格收紧，而不是只增加 evidence/source；最低要求支持“有限 maxBytes 变得更小”。如实现格式集合比较，则必须是规范化后的严格子集且仍含 MP3；
   - 相同规则、仅新增同文证据、规则放宽或与当前计划无关的文字均不算更具体。
3. 不满足门禁时：不得再次调用 audio `process`、不得派发 retry input/change、`retryCount` 保持 0；任务以稳定停止状态结束。可以用现有 `PROCESSING_FAILED` 作为用户错误码，并在 diagnostics 中记录 `REJECTION_RULE_NOT_STRICTER`，不要把内部原因或拒收原文写进 logger/snapshot。
4. 严格收紧后仍走现有 canonical plan；如果码率、mono 或其他处理事实变化，必须重新显示未决确认；用户未确认时 process 必须为 0 增量。
5. 第二次拒收后不得再规划/处理/派发事件。

### 必须新增/改写测试

- 相同 250KB → 250KB：第一次成功后出现拒收，`process` 不增加、`retryCount=0`、无 retry 事件。
- 更宽松 250KB → 500KB：同样零新增处理。
- 严格收紧 500KB → 250KB：重新规划一次；若计划参数改变则重新确认；最终 `retryCount=1`，页面 retry 只派发一次。
- 已 `retryCount=1` 后再次拒收：process 和事件计数不再增加。
- 新规则不再允许 MP3、只含 duration 或带官方/原始/无损语义：零新增处理。

## 3. Must R3-2：音频 UI 缺少规则证据，并出现图片文案

### 现象与证据

- `src/ui/task-card.js::renderAudioConfirm` 没有调用 `rulesSection(card, task.rules)`，因此音频有损处理前看不到施工单要求“继续可查看”的规则来源与原文证据。
- `src/ui/task-card.js::renderWaiting` 在音频 `INSPECTING` 时仍显示“正在检查图片 / 正在读取图片信息”。
- `src/ui/status-pill.js::statusText` 未覆盖 audio `INSPECTING`，同样退回“正在检查图片”。
- S3 新增的两个 spec 没有对音频 closed/open Shadow UI 的文字、证据、同级确认按钮、双确认、恶意文字和进度可访问性做断言，所以以上回归没有被发现。
- 有数值百分比时 `.uf-progress-bar` 仍保留无限 `uf-slide` 位移动画；视觉位置与 Worker 百分比并不一致。

### 必须修改

1. 音频确认卡展示 `task.rules` 的机器规则、来源和有界原文证据；继续只用 `textContent`，不得展示文件名。
2. audio `INSPECTING`/等待阶段使用音频文案；不得出现“图片”。audio `PROCESSING/INJECTING/SUCCESS/PASSTHROUGH` 的现有文案保持一致。
3. 有有限 `ratio` 时给进度条使用 determinate 样式并停止滑动动画；未知总量/无 ratio 时才使用不确定动画。`aria-valuenow/min/max` 与文字百分比必须来自同一个 Worker ratio。
4. `开始处理` 与 `取消` 保持同一个 `.uf-actions` 父级；双声道转单声道必须依次完成 lossy 与 mono 两个独立确认，不能一次点击代替两次。

### 必须新增 UI 测试

使用 test IIFE/open Shadow harness 增加最小但真实的 audio task-card 测试，至少断言：

- 原格式/字节/时长、目标 MP3/码率/估算范围、mono、有损说明准确；
- 规则 evidence 可见，`<img ...>`/`<script>` 只成为文字且 DOM 中没有新增可执行节点；
- 开始/取消按钮同级、`type=button`、可聚焦；取消回调不触发 process；
- 第二个 mono 确认确实在第一个确认后仍待处理；
- determinate progress 的 aria 数值、文本百分比和无滑动动画；reduced-motion 下所有进度动画为 none；
- audio INSPECTING 卡片和状态 pill 均不含“图片”。

## 4. Must R3-3：A-H 稳定页没有完整证明施工单场景

### 现象与证据

- C 页只有“生成超限 MP3”，没有可重复生成的 M4A/AAC 输入；生产路径对 M4A/AAC 的自动化测试使用的是伪造 handler metadata，而非真实 production `inspectAudio → planner → process=0`。
- G 页默认只生成 0.5 秒 WAV，真实编码很可能在用户点取消或移除 input 前结束，不能作为稳定的“处理中取消”场景。
- A/C 的提示让用户“先在 B 生成，再复用最近 MP3”，但切换 query 页面会整页刷新，内存中的 `lastMp3` 不会跨页保留。可以在当前页先生成 WAV 再复用，但页面说明与实际生命周期不一致。
- H 页初始和拒收都是 250KB，证明的是 R3-1 的错误同规则重试，而不是“更具体新规则”的一次 retry。

### 必须修改

1. H 页改成可观察的严格收紧：例如初始 500KB、关联拒收 250KB，并使用足够长的 WAV 使目标码率/计划确实改变；页面事件摘要需能证明业务 submit click 恒为 0。
2. G 页提供足够长但受内存预算约束的真实 PCM WAV，自动化在进入 `PROCESSING` 后立即 cancel/detach，断言 1 秒内 STOPPED、原 File 保留、等待后无迟到注入。不要使用计时器伪造 Worker progress。
3. C 页增加本地、确定性的有效 M4A/AAC-LC metadata fixture（可复用现有 `audio-signatures.test.js` 的构造逻辑），通过 production handler 得到 `AUDIO_CODEC_UNSUPPORTED`；断言 Worker/process=0、原 File 保留。页面 `accept` 应允许用户选择该测试输入，但输出规则仍明确只允许 MP3。
4. 修正 A/C 的操作说明，使每个 query 场景在当前页即可复现；不得新增跨页持久化用户 File。

## 5. 返工验证顺序

先跑最小集合，全部通过后再跑一次全量；不要重跑 S2 200MB、真实 Tabbit 或 S4/S5 慢门禁。

```powershell
npm run check
npm run test:e2e -- tests/e2e/v2-audio-s3-controller.spec.js tests/e2e/v2-audio-s3.spec.js <新增的音频UI spec> --reporter=line --workers=1
npm run test:e2e -- --reporter=line --workers=1
git diff --check
```

## 6. 返工退出标准与留痕

- 上述 R3-1、R3-2、R3-3 均有“先失败、修复后通过”的定向断言。
- 不改变冻结 codec 范围；不重复 S0-S2 已通过的慢门禁。
- 更新 `docs/evidence/V2-S3/result.json`、`docs/evidence/V2-S3/README.md`、`docs/handoffs/V2-S3-handoff.md` 和需求追踪矩阵，状态只能写 `READY_FOR_REACCEPTANCE`，不得自行写 `ACCEPTED`。
- result 记录新的 start/end commit、production bytes/SHA、定向/全量实际计数和未执行项。
- 建议代码/测试一笔提交、证据/交接一笔提交；最终工作区必须 clean。

完成后由 `/root` 独立重跑定向验收并签发最终结论。
