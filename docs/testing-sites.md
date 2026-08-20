# UploadFit 公开站点测试清单

自动化测试使用本地最小 DOM 夹具，避免公网波动改变 CI 结果；原网址用于发布前人工复核。

## Zent v7 Upload

- 原网址：https://youzan.github.io/zent-v7/zh/component/upload
- 自动化用例：`tests/e2e/zent-v7-upload.spec.js`
- 本地夹具：`test-pages/zent-v7-upload-fixture.html`
- 重点风险：页面同时出现“网络图片”和“本地图片”时，不得把“网络图片”误判为网络故障；`accept` 中不受处理管线支持的 GIF/BMP 不得进入可执行格式集合。
- 预期识别：JPEG / PNG、最大 1,000,000 字节、无 safety flag、规则可执行。
- 人工步骤：打开原网址并加载 `dist/uploadfit.js`，在“本地图片”示例选择测试图；确认状态卡不再显示 `NETWORK_OR_TIMEOUT` 或 `OFFICIAL_TOOL_REQUIRED`。页面自身若要求人工/官方审核，只验证本地适配与提示，不宣称替代审核结果。
