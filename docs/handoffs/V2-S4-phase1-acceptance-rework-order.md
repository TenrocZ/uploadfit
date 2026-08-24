# V2-S4 Phase 1 独立复审返工单

- 复审结论：`PHASE_1_REWORK_REQUIRED`
- 日期：2026-08-24
- 施工提交：`fbd67194409041c57e4b42d04bf91ef9e62df874`
- 返工执行者：Luna Max `/root/v2_s4_implementation`
- 阶段状态：V2-S4 继续 `IN_PROGRESS`；暂停 200MB/Tabbit Phase 2，V2-S5 继续 `HOLD`

## 1. 已通过项（不要重复施工）

- `npm run check`：25 个 Vitest 文件、229/229，build/static-check 通过。
- Phase 1 新增套件：24/24；全量 E2E：186/186。
- production bundle 未漂移：421348 bytes，SHA-256 `ABFA41EBB606CA0E7ED84F8DEE2F17783CAF0BDFA11CE777FB1BAEFBD173D18A`。
- 新增四个测试文件、V2-S4 evidence/handoff 骨架以及共享测试/安全/性能文档，阶段状态正确保留为 `IN_PROGRESS`。
- 200MB 和 LR1–LR10 均诚实写为 `NOT_RUN_PHASE_2`，没有用历史证据冒充。

返工只关闭下面的证据强度和覆盖缺口。不要重写已验收的 S0–S3 编码器/controller，不新增 decoder、远程依赖或产品能力。

## 2. R4-P1：debug/fake harness 被写成 production 证据

### 现状

四个新增测试都加载 `dist/uploadfit.test.js` 并通过 `__uploadfit_debug_bundle__` 调用内部 API；A13/A14 还注入 fake `workerRuntime`、`inspectOutput`、`validateOutput`。这些测试可以证明分支逻辑，但不能单独证明当前 production IIFE、真实 Worker 或 Tabbit 行为。

`docs/evidence/V2-S4/README.md`、`v2-s4-result.json`、handoff、`docs/test-results.md`、`security-review.md` 和 `performance.md` 的部分文字把上述结果写成 production/真实运行时覆盖，证据强度高于实际。

### 必须修改

1. 每个 A01–A18、S01–S06、P01–P03 明确标注 runner：
   - `DEBUG_CONTROLLER_REAL_WORKER`；
   - `DEBUG_PURE_PLAN`；
   - `DEBUG_FAKE_RUNTIME_BRANCH`；
   - `PRODUCTION_IIFE_LOCAL_PAGE`；
   - `REAL_TABBIT_PRODUCTION`；
   - `NOT_VERIFIED_PHASE_2`。
2. plan-only 分支只能声明 `plan.executable=false`，不能硬编码或推导成“Worker 构造计数=0”。
3. fake runtime 分支只能声明“两遍算法上界已覆盖”，不能写“真实编码器/production 两遍通过”。
4. 真实 Tabbit、200MB、MAIN-world AI、刷新/新标签生命周期在 Phase 2 前保持 `NOT_VERIFIED_PHASE_2`。
5. `v2-s4-result.json.phase1Commit` 写入完整 `fbd67194409041c57e4b42d04bf91ef9e62df874`；隐私/Worker 等没有实际测量的字段写 `NOT_MEASURED`，不能用常量 0/false 代替。

## 3. R4-P2：A02/A04、A10、A15/A16、A17 的 controller 闭环不足

### 必须新增/改写测试

- `Q-S4-P01` A02/A04：通过真实 `TaskController` 选择超限 MP3 和实际 M4A fixture；安装 Worker 构造计数器，断言 `STOPPED/AUDIO_CODEC_UNSUPPORTED`、process=0、Worker=0、injection=0、原 File 保留。测试仍是 debug bundle 时必须明确标 `DEBUG_CONTROLLER_REAL_FILE`，Phase 2 LR5 再提供 production Tabbit 证据。
- `Q-S4-P02` A10：先接受 `AUDIO_LOSSY_TRANSCODE`，确认仍停在第二个 `AUDIO_DOWNMIX_MONO`；拒绝 mono 后断言原 File 保留、process/Worker/injection=0、稳定停止。只检查 confirmation 数组不算通过。
- `Q-S4-P03` A15：实际 controller/rejection observer 完成 500KB→250KB 的严格收紧 retry，断言 retry/process/事件计数；再制造第二次明确拒收，断言没有第三次 process、没有第二次 retry 事件、业务 submit=0。
- `Q-S4-P04` A16：模糊、网络、权限、官方工具至少分别走 controller 停止路径；断言 process/Worker/injection=0，错误码不被统一误报。
- `Q-S4-P05` A17：走“处理完成→最终复检→DataTransfer 注入失败→事务恢复→下载降级”的 controller 链，断言原 File/FileList、状态、errorCode、download fallback、submit=0 和资源清理。直接单测 `injectFile()` 只能保留为底层补充。

A18 的关闭/刷新/新标签/单 host/session 必须留给 Phase 2 LR1/LR9，Phase 1 不得仅凭两次 `dispose()` 写成完整生命周期通过。

## 4. R4-P3：安全测试存在自证常量与伪消息漏检

### 必须修改

1. S01 不得返回硬编码 `externalAudioRequests: 0`、`persistedAudio: false`。至少执行一次真实小型 WAV Worker 处理，并从实际拦截器/前后 storage 快照计算结果；无法可靠拦截的 API 明确记 `NOT_MEASURED_PHASE_1`，留给 Phase 2 CDP Network/Storage。
2. S03 先只发 forged taskId 的 `RESULT/PROGRESS`，等待一个有界窗口并断言 promise 未 settle、未注入、无结果；之后才发合法 taskId 消息并断言成功。不能让合法结果覆盖错误接受的 forged 结果后仍通过。
3. S05 明确标记为 `FAKE_BRIDGE_REDACTION_HARNESS`，不宣称真实 Tabbit `LLMBridge.chat` 已通过；MAIN-world、真实调用次数和输入边界由 Phase 2 LR8 证明。
4. `security-review.md` 和结构化 JSON 为每个安全数字写出测量来源，禁止只列汇总 0。

## 5. R4-P4：快速性能数据与并发场景不完整

### 必须修改

- `Q-S4-P06` P01 记录 inspect、plan/confirm、process、validate 四段实际耗时；继续验证 heartbeat ≤500ms、progress 单调且 ≤10/s。
- `Q-S4-P07` P03 必须通过同一页面/controller 同时选择或快速排队多个音频任务，断言任一时刻只有一个 processing/Worker；完成两个任务后无显著未清理 Worker/object URL。连续两次直接调用 `processAudio()` 只能标为 sequential cleanup harness，不能冒充并发队列。
- 快速性能文档只记录本轮实际值和 run 类型；真实 200MB 指标仍留 Phase 2。

## 6. R4-P5：格式对抗与最终输出声明需要收紧

- A03 的六组合应至少记录真实 Worker、最终 MP3 signature/frames、独立 output validation、duration 容差和 encodePasses；仅 MIME/size 不足。
- MP3/WAV/M4A 对抗矩阵列出每个实际 fixture/输入形态和稳定结果。尚未覆盖的大/小 ID3、VBRI、截断帧、BMFF moov 布局等必须补测试，或在 Phase 1 文档明确为待补而非笼统写“格式对抗通过”。
- MIME/扩展/签名冲突、multiple audio、mixed image/audio、video-only 必须有实际断言及证据路径。

## 7. 允许修改范围

- `tests/e2e/v2-audio-scenarios.spec.js`
- `tests/e2e/v2-audio-security.spec.js`
- `tests/e2e/v2-audio-performance.spec.js`
- `tests/integration/v2-media-regression.test.js`
- `docs/evidence/V2-S4/*`
- `docs/handoffs/V2-S4-handoff.md`
- `docs/test-results.md`
- `docs/security-review.md`
- `docs/performance.md`
- `docs/tabbit-capabilities.md`
- `docs/testing-sites.md`
- `docs/v2/work-orders/90-需求追踪矩阵.md`

如果新增测试复现生产缺陷，可修改最小生产文件，但必须先通知 `/root`，在 handoff 的 Cross-stage changes 中逐文件说明，并在新 SHA 下重做后续实机证据。不得修改 PRD/任务书降低门槛。

## 8. 返工验证与退出标准

推荐先跑：

```powershell
node scripts/run-e2e.js tests/e2e/v2-audio-scenarios.spec.js tests/e2e/v2-audio-security.spec.js tests/e2e/v2-audio-performance.spec.js tests/integration/v2-media-regression.test.js --reporter=line --workers=1
npm run check
node scripts/run-e2e.js --reporter=line --workers=1
git diff --check
```

退出标准：

- R4-P1～P5 全部关闭，新增 Q-S4-P01～P07 全绿；
- 文档不再把 debug/fake/plan 结果写成 production/Tabbit 结果；
- 每个 0/false/耗时/计数都有真实测量来源或明确 `NOT_MEASURED`；
- bundle 若未改源码，继续为 421348 bytes / `ABFA…D18A`；若改变，记录新 SHA 并以新 SHA 进入 Phase 2；
- 工作区无旧 V1 截图、debug bundle、大 fixture、profile 或敏感信息漂移；
- 提交聚焦本地 commit，状态保持 `IN_PROGRESS`，等待 `/root` 复核后再恢复 Phase 2。

## 9. 第二次独立回扫残留（Batch D，2026-08-24）

对返工提交 `2a26897`、`de768db`、`53bcc5b` 的只读复核确认大部分缺口已关闭，但以下 6 项仍须完成；在此之前 Phase 2 再次暂停：

1. `tests/integration/v2-media-regression.test.js` 的 A01/A03/A04 `DEBUG_PURE_PLAN` 仍硬编码 `workers: 0` 并断言。删除该字段/断言或写为 `NOT_MEASURED`；plan-only 不能证明 Worker 构造次数。
2. Q-S4-P03 用替换后的 `observeRejection` hook 直接回调，没有经过 `src/dom/rejection-observer.js` 的真实 DOM 观察。改为实际 observer + 关联错误 DOM 节点，验证 500KB→250KB 一次 retry 和第二次拒收不再处理；若保留 hook 用例，必须降级标记 `FAKE_REJECTION_HOOK` 且另补真实 observer 证据。
3. Q-S4-P05 的 `failProcessedInjection` 直接返回伪造失败对象。必须在真实 controller 链中让生产 `injectFile/DataTransfer` 失败，例如在处理前受控移除 DataTransfer、让真实注入器返回失败，再恢复环境；验证事务恢复、download fallback、清理和 submit=0。直接 helper 测试只作底层补充。
4. `v2-media-regression.test.js` 的 A18 标成 `PRODUCTION_IIFE_LOCAL_PAGE`，但实际 registry 来自 debug bundle，production 只被下载做静态检查。改为如实 runner（例如 `PRODUCTION_IIFE_STATIC_ARTIFACT + DEBUG_REGISTRY`），或真正加载 production IIFE 后再声明 production page。P01/P02 直接调用 `api.processAudio`，runner 也不得写 controller。
5. 将 `v2-s4-result.json`、`tabbit-matrix.json`、S4 handoff 中的 `PENDING_FINAL_COMMIT_BACKFILL` 回填为 `53bcc5b21879d640dee047677d2462704ed783cd`；Batch D 提交可留到 Phase 2 最终文档统一记录，避免循环占位。
6. Tabbit 未执行时，`officialPrivateScriptContextVerified` 不得写布尔 `false`，应写 `NOT_VERIFIED_PHASE_2`。`fakeBridgeSensitiveCalls` 必须写出 fake bridge 测量来源，或改为 `NOT_APPLICABLE_FAKE_BRIDGE_HARNESS`，不得表现为真实 Tabbit 测量值。

Batch D 退出：相关 S4 定向用例全绿、JSON 可解析、`rg` 不再命中上述占位/硬编码、production bundle 未漂移、工作区 clean；不需要再次运行全量 E2E，也不运行 200MB/Tabbit。
