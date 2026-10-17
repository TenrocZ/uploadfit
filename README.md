# 传送门 · UploadFit

**通用浏览器上传助手：在当前网页本地适配图片和音频。**

[English](README.en.md) · [安装通用版](https://raw.githubusercontent.com/TenrocZ/uploadfit/main/dist/uploadfit.user.js) · [下载完整源码](https://github.com/TenrocZ/uploadfit/archive/refs/heads/main.zip) · [反馈问题](https://github.com/TenrocZ/uploadfit/issues)

UploadFit **0.2.0** 通过 Tampermonkey 或 Violentmonkey 运行于支持用户脚本的现代浏览器。无需 Tabbit、AI 账号或 API Key，即可读取页面明确的上传规则、本地处理文件并回填。Tabbit AI 单独保留为可选增强版本。

## 三步开始

### 1. 安装一个脚本管理器

| 你的浏览器 | Tampermonkey 官方安装入口 | 其他选择 |
| --- | --- | --- |
| Chrome、Brave、Vivaldi、Opera 等 Chromium 浏览器 | [Chrome 网上应用店](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) | [Violentmonkey 官方下载页](https://violentmonkey.github.io/get-it/) |
| Microsoft Edge | [Edge 扩展商店](https://microsoftedge.microsoft.com/addons/detail/iikmkjmpaadaobahmlepeloendndfphd) | [Violentmonkey 官方下载页](https://violentmonkey.github.io/get-it/) |
| Firefox | [Firefox 附加组件商店](https://addons.mozilla.org/firefox/addon/tampermonkey/) | [Violentmonkey 官方下载页](https://violentmonkey.github.io/get-it/) |
| Safari | [Tampermonkey 官方 Safari 入口](https://www.tampermonkey.net/index.php?browser=safari) | 以系统对应 App Store 的可用性与价格为准 |

只需选择一个管理器。安装完管理器后，还需要安装下面的 **UploadFit 脚本**。

Chrome/Edge 等 Chromium 浏览器若提示没有脚本运行权限，请在扩展详情中启用 **“允许用户脚本 / Allow User Scripts”**；没有此开关的版本按管理器提示启用开发者模式。具体界面见 [Tampermonkey 官方权限指引](https://www.tampermonkey.net/faq.php?q=Q209)。Safari 还需在浏览器扩展设置中启用管理器并允许访问目标网站。

### 2. 安装 UploadFit

**方式 A：直接安装。** 点击 [安装通用版 uploadfit.user.js](https://raw.githubusercontent.com/TenrocZ/uploadfit/main/dist/uploadfit.user.js)，在脚本管理器弹出的安装页核对名称与权限后点击安装。

**方式 B：手动粘贴。** 如果链接只显示代码、GitHub Raw 不可访问，或当前仓库/分支尚未公开：

1. 下载你有权限访问的完整源码 ZIP，或打开仓库中的 [`dist/uploadfit.user.js`](dist/uploadfit.user.js)。
2. 在 Tampermonkey 中选择“添加新脚本”（Violentmonkey 为“新建脚本”）。
3. 删除编辑器的默认模板，粘贴文件的**全部内容，包括最上方 `// ==UserScript==` 元数据块**，然后保存。
4. 确认脚本列表中的 UploadFit 已启用。不要只安装 `uploadfit.meta.js`，也不要把普通 `uploadfit.js` 当成通用版。

直接安装与自动更新地址指向 `main`。本改动尚未合并到主分支、仓库为私有或 Raw 无法访问时，请使用方式 B，不要在脚本中填写访问令牌。

### 3. 在目标网站使用

1. 在扩展/脚本设置中允许访问目标网站，刷新网页。
2. 选择一份图片或音频。UploadFit 会读取上传框附近的格式、体积、尺寸或时长要求。
3. 出现裁剪、转码等确认时，核对方案再确认。处理通过复检后会回填，无法回填时按提示下载并手动选择。
4. 检查结果，自行完成网站提交。UploadFit 不代点最终提交按钮。

默认匹配普通 **HTTP/HTTPS 顶层网页**，不会在浏览器内部页、扩展商店或 PDF 查看器中运行，也不在 iframe 中启动独立实例；顶层脚本可以发现部分同源 iframe 内的上传框。建议通过管理器的“用户匹配/排除规则”或浏览器站点访问权限，只允许需要的网站；这类设置比直接修改脚本头更容易在更新后保留。不要同时启用多份 UploadFit。

## 功能与浏览器边界

| 输入 | 处理能力 | 浏览器条件 |
| --- | --- | --- |
| JPEG、PNG、WebP | 压缩、缩放、格式转换、方向修复；按需确认裁剪、放大、透明背景变化 | 现代 Canvas、File、Blob API；输出格式还须被浏览器编码器支持 |
| PCM WAV | 页面明确允许 MP3 时，本地转码与压缩 | 支持 Blob Worker；输入解码不依赖 WebCodecs，但 MP3 输出复检仍需要 Worker 内 MP3 WebCodecs 解码器 |
| MP3、受支持的 AAC-LC M4A | 按体积要求重编码/转为 MP3 | **Worker 内支持对应 WebCodecs 解码器**，通常还要求安全上下文（HTTPS） |
| 已符合明确规则的文件 | 原样保留 | 不为不需要转换的文件强行编码 |

桌面 Chrome、Edge、Firefox 及其他 Chromium 浏览器是主要使用目标；Safari 可通过对应管理器尝试。**管理器可安装不等于每种媒体编码都可用。** 浏览器引擎、操作系统编解码器、网站 CSP 和设备资源会影响能力，缺失时会明确停止，不把文件转交远程服务。移动浏览器还取决于扩展支持，未作为本轮实机验收目标。

0.2.0 已在 Chromium、Firefox、Windows WebKit 验证图片处理、回填和启动生命周期，并完成 Chromium + Tampermonkey 的真实导入与自动运行验证。Chromium/Firefox 的 WAV 转 MP3 已通过；本轮 Windows WebKit 缺少输出复检解码能力，会明确停止并保留原文件。WebKit 自动化结果不代表 Safari 扩展实机验收。

图片上限为 50 MiB、8,000 万解码像素。不支持批量多文件处理、音频裁剪/分段/降噪、视频抽轨、加密媒体或所有 M4A 变体。压缩不会缩短音频时长，也不会绕过服务端审核、权限或额度。自定义上传控件、跨域 iframe、封闭 Shadow DOM 和拦截合成事件的站点可能无法回填。

## 隐私与可选 AI

**通用版 `uploadfit.user.js` 完全使用本地规则，不调用 AI。** 没有 `@require` CDN、远程媒体服务或特权网络接口；`@grant none` 在网页上下文运行。脚本管理器自身的安装/更新检查和隐私政策独立于 UploadFit。

如果使用 Tabbit，并希望在本地规则不足时启用其 AI，可改用 [`dist/uploadfit.js`](dist/uploadfit.js)：将完整内容粘贴到 Tabbit“脚本”妙招，限定网站、保存、刷新。不要与通用版同时启用。只有该版本可能经 `LLMBridge.chat()` 向 Tabbit 在线服务发送经过筛选的规则文字，且仍不附带文件内容、文件名或完整网页；候选规则必须经过本地校验。

两种版本的媒体处理都在浏览器内存中完成。**目标网站可能在选中文件或收到回填事件后自动上传**，本地处理不代表网站不会接收文件，请仅在信任的网站启用。更多内容见 [SECURITY.md](SECURITY.md)。

## 更新、停用与常见问题

- **更新**：通过公开 `main` 地址安装的脚本由管理器检查版本；手动安装且自动更新不可用时，重新打开同一脚本，替换为新版本完整内容并保存。刷新目标网页生效。不要叠加第二份脚本。
- **停用/卸载**：在管理器中关闭/删除 UploadFit，然后刷新页面。关闭页面内状态条只停止当前页面会话。
- **安装后没反应**：检查管理器和脚本已启用、允许用户脚本、目标网站权限；刷新普通网页。浏览器内部页、商店页、iframe 不在自动运行范围。严格 CSP 可能阻止脚本或 Worker。
- **没有 AI 也能用吗？** 可以，通用版仅处理可由本地规则可靠判断的约束；缺失/冲突规则时会停止，不猜测。
- **音频提示不支持**：先检查是否为 HTTPS 页面、输入是否属于支持格式及编码子集。MP3/M4A 还取决于当前浏览器的 Worker 解码能力；可改用更新的 Chromium 浏览器或手动转换。
- **网站仍拒收**：本地复检不能替代服务器审核。按提示下载结果后用原上传按钮选择；不要反复重试或绕过网站规则。

## 从源码构建

需要 Node.js **22.20.0+** 和 npm **10.9.3+**。

```sh
git clone https://github.com/TenrocZ/uploadfit.git
cd uploadfit
npm ci
npm run check
```

`npm run build` 生成通用安装文件 `dist/uploadfit.user.js`、更新元数据 `dist/uploadfit.meta.js`、可选 Tabbit 文件 `dist/uploadfit.js`，并同步介绍页。`npm run check` 检查运行时代码、元数据、许可材料与分发一致性，不等同于浏览器功能测试。`npm run release` 从干净的已提交 Git 工作区生成含完整源码、lockfile、第三方源码和许可证的 ZIP，以及来源与校验记录，不会上传发布。

`src/` 为核心代码，`scripts/` 为构建与分发工具，`project-page/` 为产品介绍与安装页。公开树不携带内部测试和开发档案。原始编码器源码在 `vendor/`，替换重建见 [RELINKING.md](licenses/RELINKING.md)。

## 参与与许可

欢迎通过 [Issues](https://github.com/TenrocZ/uploadfit/issues) 或 Pull Request 改进项目，参见 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [CHANGELOG.md](CHANGELOG.md)。

原创代码采用 [MIT](LICENSE)。内嵌的 `lamejs@1.2.1` 保持上游许可（npm 声明为 LGPL-3.0），请连同 [NOTICE](NOTICE)、[`licenses/`](licenses/)、对应可重建源码及第三方源码包一起分发。项目与上述浏览器、脚本管理器无官方隶属关系。
