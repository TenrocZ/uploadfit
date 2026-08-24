# V2-S4 证据索引（Phase 1）

状态：`IN_PROGRESS`。本目录只记录 Phase 1 自动化 QA、安全、格式对抗和快速性能；200MB 慢门禁、Tabbit LR1–LR10、真实 MAIN-world AI 和关闭/刷新/新标签生命周期均保持 `NOT_VERIFIED_PHASE_2`。本 Agent 不写 `ACCEPTED`，V2-S5 保持 `HOLD`。

## 产物、环境与 provenance

- 基线：`e9fea4c06f9602125df7434434fc6bbc1fd9f7c4`。
- Phase 1 基线施工提交：`fbd67194409041c57e4b42d04bf91ef9e62df874`。
- 返工批次：Batch A `2a26897`；Batch B `de768db79b1d70661b017dad4b42ee5712297b46`；Batch C `53bcc5b21879d640dee047677d2462704ed783cd`；Batch D1 `c6e8b3b1fbbee44dba061abab819a14b20fb7cf5`；Batch D2 本轮文档提交在 Phase 2 最终交接时记录。
- Windows，Node `v22.20.0`，npm `10.9.3`；本地测试服务 `http://127.0.0.1:8765`。
- 当前 production `dist/uploadfit.js`：421,348 bytes，SHA-256 `ABFA41EBB606CA0E7ED84F8DEE2F17783CAF0BDFA11CE777FB1BAEFBD173D18A`，单 IIFE；runtime remote dependencies=0。

Runner 约定：

- `DEBUG_CONTROLLER_REAL_WORKER`：本地 `dist/uploadfit.test.js` debug API；真实 audio handler/Worker 或真实 TaskController 链路，不能外推为 production IIFE/Tabbit。
- `DEBUG_DIRECT_PIPELINE_REAL_WORKER`：本地 `dist/uploadfit.test.js` 直接 `processAudio` pipeline 的真实 Worker；不是 TaskController、production IIFE 或 Tabbit 证据。
- `DEBUG_CONTROLLER_REAL_FILE`：同一 debug controller 使用真实 File/DataTransfer，但该分支在 Worker 前停止。
- `DEBUG_PURE_PLAN`：只证明确定性 inspect/plan/predicate/边界结果；不填写 Worker/process=0 作为测量。
- `DEBUG_FAKE_RUNTIME_BRANCH`：注入 fake runtime，仅证明协议/两遍算法分支，不证明真实 encoder/production。
- `PRODUCTION_IIFE_LOCAL_PAGE`：本地页面加载当前 production IIFE 的回归；不等于 Tabbit。
- `PRODUCTION_IIFE_STATIC_ARTIFACT + DEBUG_REGISTRY`：当前 production IIFE 只做静态 artifact 校验，registry 断言来自 debug bundle；不写成 production page runtime。
- `REAL_TABBIT_PRODUCTION`：Phase 2 才允许使用；当前无该 runner 结果。
- `NOT_VERIFIED_PHASE_2`：尚未执行，不能以 Playwright、mock、debug bundle、历史截图或 S0/S2 结果替代。

四个新增文件都通过 `scripts/run-e2e.js` 使用本地页面。debug 结果和既有 production-IIFE E2E 分栏记录；不得把 debug harness 写成 Tabbit/production 实机证据。

## Phase 1 执行结果

| 检查 | 结果 |
|---|---|
| `npm ci` | PASS（开工基线已执行） |
| 四文件定向 runner | PASS：31/31，workers=1 |
| `npm run check` | PASS：25 Vitest files / 229 tests，build/static-check PASS |
| 一次全量 E2E | PASS：193/193，workers=1，约 142s；旧 V1 S4 截图已恢复且未纳入本批 |
| `git diff --check` | PASS（截图恢复后最终检查） |

## A01–A18 精确映射

| ID | runner 与实际覆盖 | 关键断言/限制 |
|---|---|---|
| A01 | `v2-audio-scenarios.spec.js` A01 `[DEBUG_CONTROLLER_REAL_FILE]`；production 等价路径由 full E2E 的 S3 passthrough 覆盖 | 合规 MP3 原 File identity；passthrough 无 Worker；不把 debug 计数写成 Tabbit |
| A02 | 规划矩阵 `[DEBUG_PURE_PLAN]`；Q-S4-P01 真实 controller/File `[DEBUG_CONTROLLER_REAL_FILE]` | 超限 MP3 实际 `AUDIO_CODEC_UNSUPPORTED`，process/Worker/processed-injection=0；plan-only 不声称 Worker=0 |
| A03 | 六组合 PCM 16/24/32-bit × mono/stereo `[DEBUG_CONTROLLER_REAL_WORKER]` | 实际 Worker、输出 `signatureMime=audio/mpeg/container=mp3/codec=mp3`、独立 `validateAudioOutputFile`、frameValidation、duration tolerance、encodePasses≤2 |
| A04 | Q-S4-P01 `[DEBUG_CONTROLLER_REAL_FILE]` 使用实际可解析 AAC-LC M4A fixture；规划矩阵另列 `[DEBUG_PURE_PLAN]` | `AUDIO_CODEC_UNSUPPORTED`，process/Worker/processed-injection=0，原 File 保留 |
| A05 | A05–A08 `[DEBUG_CONTROLLER_REAL_FILE]` | missing maxBytes 为 `RULES_INSUFFICIENT`，不启动处理 |
| A06 | A05–A08 `[DEBUG_CONTROLLER_REAL_FILE]` | MP3 未被允许为 `AUDIO_OUTPUT_FORMAT_NOT_ALLOWED` |
| A07 | A05–A08 `[DEBUG_CONTROLLER_REAL_FILE]` | duration-only 为 `AUDIO_DURATION_LIMIT_UNFIXABLE`，不裁剪/分段 |
| A08 | A05–A08 `[DEBUG_CONTROLLER_REAL_FILE]` | 不安全目标为 `AUDIO_TARGET_UNSAFE`，不启动 Worker |
| A09 | A09 `[DEBUG_CONTROLLER_REAL_FILE]` | lossy confirmation decline 后原 File 保留；rollback 与 processed-injection 分开计数 |
| A10 | Q-S4-P02 `[DEBUG_CONTROLLER_REAL_FILE]` | 先接受 `AUDIO_LOSSY_TRANSCODE`，再拒绝 `AUDIO_DOWNMIX_MONO`；原 File 保留，processed injection/process/Worker=0 |
| A11 | A11/A12 `[DEBUG_CONTROLLER_REAL_WORKER]` cancel 分支 | ≤1,000ms，取消后无迟到结果；cleanup 记录 |
| A12 | A11/A12 `[DEBUG_CONTROLLER_REAL_WORKER]` detach 分支 | `INPUT_DETACHED`，原 File 保留，Worker abort/cleanup |
| A13 | A13/A14 `[DEBUG_FAKE_RUNTIME_BRANCH]` | 仅证明两遍算法上界：第一次超限再 lower-rate；不声称真实 production encoder |
| A14 | A13/A14 `[DEBUG_FAKE_RUNTIME_BRANCH]` | 第二次仍超限为 `AUDIO_OUTPUT_TOO_LARGE`，不声称真实 production 两遍通过 |
| A15 | Q-S4-P03 `[DEBUG_CONTROLLER_REAL_WORKER]` 真实 controller + `src/dom/rejection-observer.js` DOM observer + real Worker | 关联 DOM 错误节点触发 500KB→250KB；仅 retry 一次，第二次明确拒收无第三次 process/第二次 retry/submit |
| A16 | Q-S4-P04 `[DEBUG_CONTROLLER_REAL_FILE]` | ambiguous/network/permission/official 分别走 controller stop path，错误码不统一误报 |
| A17 | Q-S4-P05 `[DEBUG_CONTROLLER_REAL_WORKER]` 真实 `injectFile`/`DataTransfer` | 受控首个 DataTransfer 构造失败→真实注入失败→restore 构造成功→rollback/download fallback；原 File/FileList、cleanup、submit=0 |
| A18 | `[PRODUCTION_IIFE_STATIC_ARTIFACT + DEBUG_REGISTRY]` 静态 production IIFE + debug registry；完整关闭/刷新/新标签为 `NOT_VERIFIED_PHASE_2`（LR1/LR9） | 不把 debug registry 或两次 dispose 写成 production 生命周期通过 |

## S01–S06 安全映射

| ID | runner | 本轮实际证据 |
|---|---|---|
| S01 | `DEBUG_CONTROLLER_REAL_WORKER` | 小 WAV 真实 Worker；fetch/XHR/WebSocket/EventSource/sendBeacon delta=0；local/session storage before/after 均可读且无变化；persistent 结论只限该 API scope |
| S02 | `DEBUG_PURE_PLAN` | 恶意标签为数据，script 数量 delta=0；规则文本 prompt 不含音频 bytes/filename |
| S03 | `DEBUG_FAKE_RUNTIME_BRANCH` | forged taskId 的 PROGRESS/RESULT 先发送；有界窗口 promise 未 settle、无结果/注入；合法 taskId 后才成功 |
| S04 | `DEBUG_PURE_PLAN` | malformed WAV/MP4 bounded inspect，稳定错误码与 ≤1MiB inspectedBytes |
| S05 | `DEBUG_FAKE_RUNTIME_BRANCH` / `FAKE_BRIDGE_REDACTION_HARNESS` | 本地 fake bridge/schema/redaction；真实 Tabbit `LLMBridge.chat` 和 MAIN-world call count 为 Phase 2 LR8 |
| S06 | `DEBUG_FAKE_RUNTIME_BRANCH` | fake CSP Worker constructor 返回 `AUDIO_WORKER_UNAVAILABLE`，不外推真实 Tabbit CSP |

## P01–P03 / Q-S4-P06/P07 性能映射

| ID | runner | 实际证据 |
|---|---|---|
| P01 / Q-S4-P06 | `DEBUG_DIRECT_PIPELINE_REAL_WORKER` | 直接 `processAudio` pipeline 的 inspect、plan、confirm、process、validate 五段耗时；progress 单调、≤10/s，heartbeat≤500ms，独立输出复检、cleanup |
| P02 | `DEBUG_DIRECT_PIPELINE_REAL_WORKER` | 直接 pipeline 在 encode progress 后取消，≤1,000ms，无迟到 progress/result，cleanup |
| P03（原） | `DEBUG_SEQUENTIAL_CLEANUP_HARNESS` | 仅为直接 `processAudio` 的连续清理补充，不冒充队列 |
| P03 / Q-S4-P07 | `DEBUG_CONTROLLER_REAL_WORKER` | 同一页面/同一 TaskController 的两个 uploader 快速选择；两个完成，任一时刻 processing/Worker≤1，active Worker=0，两个 cleanup 完整 |

## 格式对抗矩阵（本轮实际 fixture）

`v2-media-regression.test.js` 的 Format adversaries `[DEBUG_PURE_PLAN]` 逐项调用真实 bounded `inspectAudio`，再对错误 metadata 形成不可执行 plan；不新增 decoder。

| Fixture ID | 输入形态 | 实际结果 |
|---|---|---|
| `mp3-cbr` | MPEG-1 Layer III 同码率多帧 | signature mp3、CBR、无 error |
| `mp3-vbr` | 两种 bitrate index 多帧 | signature mp3、`variableBitrate=true` |
| `mp3-id3-small` / `mp3-id3-large` | 16B / 16KiB ID3v2 标签 | 解析 audio offset，稳定 MP3 metadata |
| `mp3-truncated` | 截断首帧 | bounded stable unsupported/decode code |
| `wav-unknown-chunk` | 合法 JUNK chunk + PCM | signature wav、无 error |
| `wav-three-channels` | PCM 超声道 | `AUDIO_CODEC_UNSUPPORTED` |
| `wav-data-pseudolong` | data declared length 大于本体 | `AUDIO_DECODE_FAILED` |
| `wav-pseudo-mp3-extension` | WAV signature + `.mp3`/`audio/mpeg` | WAV metadata + MIME/extension mismatch warnings |
| `m4a-moov-before-mdat` / `m4a-moov-after-mdat` | AAC-LC BMFF 两种 moov 布局 | valid AAC-LC metadata，仍由 frozen scope stop，不转码 |
| `m4a-non-aac` | BMFF mp4a 但 ASC object type 非 2 | `AUDIO_CODEC_UNSUPPORTED` |
| `m4a-truncated-box` | 截断 BMFF box | bounded stable decode/metadata/codec code |
| `mp3-mime-extension-conflict` | MP3 signature + WAV MIME/extension | MP3 metadata + 两类 mismatch warnings |
| boundary | `multiple=true`、image+audio mixed accept、video-only | audio handler `supports=false` |

仍待补（不能笼统写“已覆盖”）：大于 1MiB ID3、Xing/VBRI index 的完整矩阵、更多 MPEG Layer/version、任意 mdat/64-bit BMFF 极端布局、真实 Tabbit UI 文件选择。它们不改变本阶段冻结范围。

## 隐私、安全数字的测量来源

- `externalAudioRequests=0`：最终全量中的 S01 页面初始化后 delta 计数（fetch/XHR/WebSocket/EventSource/sendBeacon），不是常量自证；真实 Tabbit 网络仍 `NOT_MEASURED_PHASE_1`。
- `persistentAudio=false`：最终全量中的 S01 local/session storage before/after key snapshot，storage API 可读；IndexedDB/cache 真实 CDP storage 仍留 Phase 2，结构化结果注明 scope。
- `businessSubmitClicks=0`：Q-S4-P03/P05/P07 logger、controller task businessClickCount 和 submit/business 事件断言；不是 Tabbit 实测。
- fake AI：S05 只记录本地 fake bridge safe/blocked calls；真实 AI calls/input boundary 为 `NOT_MEASURED_PHASE_1`。
- `maliciousMarkupExecution=0`：S02 script node delta=0；仅限本地 debug page。

## Phase 2 留痕

`tabbit-matrix.json` 的 LR1–LR10 全部为 `NOT_RUN_PHASE_2`。`v2-s4-result.json` 的 slow gate 同样未运行；不得引用历史 S0/S2 200MB 文件。Phase 2 必须在同一 production SHA 上证明 Tabbit Browser.getVersion/UA、官方私有脚本 MAIN-world、部分网址匹配，再执行真实 >200,000,000-byte WAV 成功和处理中取消，并记录 SHA/bytes/codec/duration/bitrate/channels/耗时/encodePasses/heartbeat/peakBufferedBytes/cleanup。
