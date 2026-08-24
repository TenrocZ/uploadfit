# UploadFit

UploadFit 是一个在浏览器本地识别文件上传规则、执行最小必要适配并安全回填文件框的 Tabbit 纯 JavaScript 插件。公开发布基线仍是已验收的 V1 图片版；工作区 production 包已完成并验收 V2-S3 的长语音转写上传编排，尚待 V2-S4 实机/性能验收和 V2-S5 发布收口。

当前图片字节不会发送到远端；AI 只在本地规则不完整时通过 Tabbit 提供的 `LLMBridge.chat()` 理解经过筛选的规则文本。V2 同样要求音频内容不离开浏览器本地，AI 不接触音频文件或元数据。

## 构建与验证

环境要求：Node.js 22.20+、npm 10.9+。

```powershell
npm ci
npm run check
npm run test:e2e
```

- `npm run check`：运行 Vitest、生成生产包并执行静态安全检查。
- `npm run test:e2e`：构建测试包、启动临时本地夹具服务器并运行 Chromium 回归，结束后自动关闭服务器。
- 生产发布物为 `dist/uploadfit.js`。该文件是可直接粘贴的单个 IIFE，不需要模块加载器或额外资源。

## 在 Tabbit 中使用

1. 运行 `npm run build`。
2. 打开 `dist/uploadfit.js`，复制完整纯 JavaScript 内容。
3. 粘贴到 Tabbit 的脚本编辑器并保存，在目标上传页面启用。
4. 选择图片后按状态卡提示确认裁剪、放大或透明背景填充；在冻结的音频场景中，PCM WAV 可经确认转为 MP3，合规 MP3 原样放行，不支持的音频格式安全停止。失败时以页面原上传按钮或下载文件作为降级路径。

不要把源码目录、多文件 import 或 Markdown 代码围栏粘贴到 Tabbit。发布时保留生产包的实际字节数与 SHA-256；项目不设置固定体积上限。

当前 `dist/uploadfit.js` 已包含 V2-S3 验收范围内的音频功能，但**还不是 V2 公开发布候选包**。S4 必须完成当前 SHA 的真实 Tabbit、200MB 慢速、安全与性能门禁，S5 再完成发布材料和候选包；在此之前不能按完整 V2 能力对外宣传。

## 文档导航

- `docs/progress.md`：阶段进度与验收记录。
- `docs/v2/README.md`：V2 音频 MVP 的 PRD、施工入口和当前放行状态。
- `docs/archive/v1/README.md`：V1 PRD/任务书归档及阶段状态。
- `docs/handoffs/`：各阶段交接、返工和复验报告。
- `docs/evidence/`：结构化与视觉证据。
- `docs/testing-sites.md`：公开站点与本地回归夹具清单。
- `docs/decisions/`：架构决策记录。
