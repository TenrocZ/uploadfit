# UploadFit 公开站点测试清单

自动化测试使用本地最小 DOM 夹具，避免公网波动改变 CI 结果；原网址用于发布前人工复核。

## V2-S4 音频 Phase 1 + Phase 2A1

- 本地 production 音频页：`test-pages/audio-s3.html?scenario=A`、`?scenario=B`、`?scenario=C`、`?scenario=G`、`?scenario=H`；由既有 production IIFE E2E 覆盖 passthrough、PCM→MP3、M4A/AAC/超限 MP3 stop、取消/解绑和一次拒收 retry。
- 确定性 debug API 页：`test-pages/probe.html`；由 `tests/e2e/v2-audio-scenarios.spec.js`、`v2-audio-security.spec.js`、`v2-audio-performance.spec.js` 和 `tests/integration/v2-media-regression.test.js` 使用，本轮四文件定向为 31/31，不冒充 Tabbit 实机；P01/P02 使用 `DEBUG_DIRECT_PIPELINE_REAL_WORKER`，Q-P07 使用真实 controller；A18 为 `PRODUCTION_IIFE_STATIC_ARTIFACT + DEBUG_REGISTRY`；`DEBUG_PURE_PLAN` 不推导 Worker=0，fake branch 不推导 production encoder。
- Tabbit 实机页：`test-pages/audio-s4-tabbit.html?scenario=B`，页面自身不加载 bundle，只接受官方私有脚本 auto-run；LR3 已通过。
- 当前候选 production bundle：421,347 bytes，SHA-256 `842FA9AB712C028AB1B9A94526B4FBEE175016A73E5B944A3987BFAC169A78D0`。
- 当前 handler/真实 Worker 的 >200,000,000-byte 成功/取消核心门禁已通过；精确 Tabbit LR4 仍明确 pending。证据不公开脚本 ID、prompt/response、文件名、路径或账号信息。

## Zent v7 Upload

- 原网址：https://youzan.github.io/zent-v7/zh/component/upload
- 自动化用例：`tests/e2e/zent-v7-upload.spec.js`
- 本地夹具：`test-pages/zent-v7-upload-fixture.html`
- 重点风险：页面同时出现“网络图片”和“本地图片”时，不得把“网络图片”误判为网络故障；`accept` 中不受处理管线支持的 GIF/BMP 不得进入可执行格式集合。
- 预期识别：JPEG / PNG、最大 1,000,000 字节、无 safety flag、规则可执行。
- 人工步骤：打开原网址并加载 `dist/uploadfit.js`，在“本地图片”示例选择测试图；确认状态卡不再显示 `NETWORK_OR_TIMEOUT` 或 `OFFICIAL_TOOL_REQUIRED`。页面自身若要求人工/官方审核，只验证本地适配与提示，不宣称替代审核结果。
