# 传送门 · UploadFit

**让图片和音频适配网页上传要求，在浏览器本地完成处理。**

[English](README.en.md) · [安装脚本](dist/uploadfit.js) · [反馈问题](https://github.com/TenrocZ/uploadfit/issues) · [MIT 许可证](LICENSE)

传送门是运行在 **Tabbit Browser 脚本妙招**中的 JavaScript 工具。它读取上传框附近的格式、体积、尺寸等要求，在规则明确时处理用户选择的文件，再回填原上传框。需要裁剪、转码等确认时，会先展示方案；不会代替用户点击最终提交按钮。

当前版本为 **0.1.0**，仍在早期迭代。网页结构、浏览器编解码能力和站点上传逻辑不同，不能保证适配所有网站。本项目并非 Tabbit 官方产品。

## 能做什么

| 输入 | 处理能力 | 输出 |
| --- | --- | --- |
| JPEG、PNG、WebP | 压缩、缩放、格式转换、方向修复；按需确认裁剪、放大或透明背景变化 | JPEG、PNG、WebP |
| MP3 | 按网页体积上限重新编码 | MP3 |
| PCM WAV | 网页明确允许 MP3 时转码、压缩 | MP3 |
| AAC-LC M4A | 支持的非加密、非 fragmented 子集解码、转码 | MP3 |
| 已符合明确规则的文件 | 保留原文件，不做多余处理 | 原文件 |

支持动态出现的上传框、规则证据展示、取消处理与受控重试。规则缺失、冲突或输出复检失败时会停止处理，不猜测规则或承诺上传成功。

## 安装与使用

1. 获取本仓库完整源码包，或克隆仓库；生产脚本位于 [`dist/uploadfit.js`](dist/uploadfit.js)。
2. 打开该文件，复制全部 JavaScript 内容。
3. 在 Tabbit 中创建“脚本”妙招，粘贴代码，将生效范围限制为需要使用的网页，保存并启用。
4. 刷新目标网页，照常选择文件；出现处理方案时，核对规则与预计输出后确认。
5. 检查回填结果，自行完成网站的后续操作。

更新时重新复制新版本脚本并保存；本地修改或重新构建不会自动更新 Tabbit 中已保存的脚本。停用时关闭该妙招并刷新页面。

不要粘贴 Markdown 围栏或 `src/` 中的 ESM 模块。生产脚本是自包含 IIFE，不需要 CDN 或远程媒体处理服务。转发脚本时请同时提供对应源码和许可证材料，见[分发说明](licenses/RELINKING.md)。

## 隐私与 AI

- 图片、音频的检查和转换在浏览器内存中完成，UploadFit 没有媒体上传服务器。
- 规则优先由本地代码读取。规则不完整时，可通过 Tabbit 的 `LLMBridge.chat()` 将经过筛选、清洗、长度限制的相关规则文字交给 AI 理解；这一步可能调用 Tabbit 的在线服务。
- UploadFit 的 AI 请求不附带文件内容、文件名、媒体数据或完整网页；疑似敏感文字会阻止调用。AI 输出还须经过本地结构、数值和证据校验。
- AI 不可用时继续使用本地规则。无需为本项目填写 API Key。
- **目标网站可能在选择文件或收到回填事件后自动上传。**“本地处理”不代表目标网站不会接收文件，请只在信任的网站启用。

更多边界与漏洞报告方式见 [SECURITY.md](SECURITY.md)。

## 支持范围与限制

- 主要面向 Tabbit 的 Chromium 运行环境。MP3/M4A 转码依赖浏览器 Worker 中可用的 WebCodecs；受 CSP、浏览器版本和设备能力影响，能力不足时会停止。
- 图片输入上限为 50 MiB、解码上限为 8,000 万像素；其他资源限制由代码执行，不能据此承诺任意大文件可处理。
- 不支持批量多文件处理、音频裁剪/分段/降噪、视频抽轨、加密媒体或所有 M4A 编码变体。
- 压缩不会缩短音频时长。超过网站时长限制时不能靠减小体积解决。
- 不绕过登录、权限、服务端审核、额度或官方证件照校验。自定义控件、跨域 iframe、封闭 Shadow DOM 等场景可能无法识别或回填。

## 从源码构建

需要 Node.js **22.20.0+** 和 npm **10.9.3+**。

```sh
git clone https://github.com/TenrocZ/uploadfit.git
cd uploadfit
npm ci
npm run check
```

- `npm run build`：构建 `dist/uploadfit.js`，同步介绍页脚本、阅读视图及许可证。
- `npm run static-check`：检查运行时代码和产物中的禁止 API、许可证标记等。
- `npm run check`：构建并检查静态规则、分发文件和介绍页一致性；**不等同于浏览器功能测试**。
- `npm run release`：在干净且已提交的 Git 工作区生成 `release/` 中的源码 ZIP、来源记录与 SHA-256 校验文件，包含 lockfile、音频库源码和许可证；不会上传发布。

依赖从公共 npm registry 安装。`lamejs` 固定为 1.2.1，原始源码包保存在 `vendor/`；替换编码器后可自行重新构建，步骤见 [RELINKING.md](licenses/RELINKING.md)。

## 仓库结构

```text
src/            规则识别、图片/音频处理、交互与文件回填
scripts/        必要的构建和发布检查脚本
dist/           可直接安装的生产脚本
project-page/   项目介绍页及与生产脚本同步的静态文件
licenses/       第三方声明、完整许可证及替换重建说明
vendor/         随发行包提供的 lamejs 原始源码包
```

公开树已移除内部开发文档、测试夹具、探针和验收截图。保留构建所需源文件与依赖锁定，以便从源码重建和替换第三方编码器。

## 参与与许可

欢迎通过 [Issues](https://github.com/TenrocZ/uploadfit/issues) 提交脱敏问题，通过 Pull Request 改进项目。提交前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)；版本变化见 [CHANGELOG.md](CHANGELOG.md)。

本项目原创代码采用 [MIT](LICENSE)。生产脚本内嵌的 `lamejs@1.2.1` 按其上游许可分发（npm 声明为 LGPL-3.0），不因本项目采用 MIT 而改变。请保留 [NOTICE](NOTICE)、[`licenses/`](licenses/) 和可重建源码，完整要求见[第三方声明](licenses/NOTICE.md)。
