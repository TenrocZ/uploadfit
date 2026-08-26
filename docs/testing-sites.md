# UploadFit 公开站点测试清单

## Podcastools MP3 文件名回归（2026-08-25）

- 已修复页面回显 `uploadfit-mp3-30MB-320k.mp3` 时把 `30MB-320k` 误解析为反向体积区间的问题。
- 修复版 production 在真实页面把 12,000,000-byte / 300,000ms MP3 重编码为 8,400,672-byte MP3；不点击业务提交。
- 30,481,920-byte 测试 MP3 约 762,048ms，超过网站 600,000ms 上限；修复版会正确报 `AUDIO_DURATION_LIMIT_UNFIXABLE`。该样本不能用纯体积压缩变为合规，需另行裁剪或分段，而这不在当前产品范围。
- 当前 production：446,208 bytes；SHA-256 `C7E3D59FA0B44B0EC2104B34AE7FFB040A577B6E8A8B18F6DB4F79241D5C79A8`。人工复验前必须重新粘贴保存本地 `dist/uploadfit.js`。

## V2-S4.1（2026-08-25）

- Podcastools `https://www.podcastools.com/podcast-transcript`：当前 production 发现 1 个 uploader；`Max 10 MB and 10 minutes` 同时解析为 10,000,000 bytes / 600,000ms。12MB/300秒 MP3 正例输出 8,400,672 bytes；10,194,008-byte/497,536ms AAC-LC M4A 正例输出 7,961,088-byte MP3；submit=0。30,481,920-byte、762,044.8ms MP3 时长负例仍在 Worker 前停止。
- VocaText `https://vocatext.com/`：30,000,000-byte WAV 触发 `File exceeds 25 MB limit.`，插件保留 accept 格式、输出 6,251,520-byte MP3并只重试一次；submit=0。
- S4.1 验收基线 production：444,989 bytes；SHA `EB77F23278CBCEB739376671D0C1AEEEAC417309DD346EB40CEC2FE99729E030`。逐项状态见 `docs/evidence/V2-S4.1/tabbit-matrix.json`；当前产物以本页上一节为准。

自动化测试使用本地最小 DOM 夹具，避免公网波动改变 CI 结果；原网址用于发布前人工复核。

## V2-S4 音频 Phase 1 + Phase 2A1

- 本地 production 音频页：`test-pages/audio-s3.html?scenario=A`、`?scenario=B`、`?scenario=C`、`?scenario=G`、`?scenario=H`；由既有 production IIFE E2E 覆盖 passthrough、PCM→MP3、M4A/AAC/超限 MP3 stop、取消/解绑和一次拒收 retry。
- 确定性 debug API 页：`test-pages/probe.html`；由 `tests/e2e/v2-audio-scenarios.spec.js`、`v2-audio-security.spec.js`、`v2-audio-performance.spec.js` 和 `tests/integration/v2-media-regression.test.js` 使用，本轮四文件定向为 31/31，不冒充 Tabbit 实机；P01/P02 使用 `DEBUG_DIRECT_PIPELINE_REAL_WORKER`，Q-P07 使用真实 controller；A18 为 `PRODUCTION_IIFE_STATIC_ARTIFACT + DEBUG_REGISTRY`；`DEBUG_PURE_PLAN` 不推导 Worker=0，fake branch 不推导 production encoder。
- Tabbit 实机页：`test-pages/audio-s4-tabbit.html?scenario=B`，页面自身不加载 bundle，只接受官方私有脚本 auto-run；LR3 已通过。
- 当前候选 production bundle：421,333 bytes，SHA-256 `98BD12C651C2801E2E2E8BC9C2A006057024AA26E2D916B33899487B9A0F1A68`。
- 当前 handler/真实 Worker 的 >200,000,000-byte 成功/取消核心门禁已通过；精确 Tabbit LR4 仍明确 pending。证据不公开脚本 ID、prompt/response、文件名、路径或账号信息。

## Zent v7 Upload

- 原网址：https://youzan.github.io/zent-v7/zh/component/upload
- 自动化用例：`tests/e2e/zent-v7-upload.spec.js`
- 本地夹具：`test-pages/zent-v7-upload-fixture.html`
- 重点风险：页面同时出现“网络图片”和“本地图片”时，不得把“网络图片”误判为网络故障；`accept` 中不受处理管线支持的 GIF/BMP 不得进入可执行格式集合。
- 预期识别：JPEG / PNG、最大 1,000,000 字节、无 safety flag、规则可执行。
- 真实输入为 `multiple=true`；实际只选择 1 个文件时应处理，选择超过 1 个文件时仍保持不处理。
- 人工步骤：打开原网址并加载 `dist/uploadfit.js`，在“本地图片”示例选择测试图；确认状态卡不再显示 `NETWORK_OR_TIMEOUT` 或 `OFFICIAL_TOOL_REQUIRED`。页面自身若要求人工/官方审核，只验证本地适配与提示，不宣称替代审核结果。

## VocaText

- 原网址：https://vocatext.com/
- 真实上传框 `accept` 同时包含 `.mp4`、多种音频扩展名与 `audio/*`，且 input 为隐藏单选控件。
- 预期：明确音频 accept 不应被同控件的视频容器 token 覆盖，控制器应注册 1 个音频 uploader；实际选择视频文件时 audio handler 仍拒绝处理。
- 2026-08-25 当前 SHA 在 Tabbit 真实 DOM 临时诊断中 uploaderCount 从 0 修复为 1；官方脚本重装后需复核自动运行。
