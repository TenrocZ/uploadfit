# Podcastools MP3 适配回归修复

- 日期：2026-08-25
- 站点：https://www.podcastools.com/podcast-transcript
- 结论：`FIXED_WITH_DURATION_BOUNDARY`

## 现象与根因

页面选择文件后会在上传框附近显示文件名。测试文件名 `uploadfit-mp3-30MB-320k.mp3` 中的 `30MB-320k` 被规则解析器误判为反向体积区间，生成 `RULE_CONFLICT / BYTES_RANGE_REVERSED`，任务因而在 MP3 元数据检查和重编码之前停止。

修复后，解析器只忽略位于真实媒体文件名 token 内的体积样式文本；页面自身的 `Max 10 MB and 10 minutes` 仍解析为 10,000,000 bytes 和 600,000ms，普通 `30KB—120KB` 简写区间也保持有效。

## 实站验证

验证全程使用 Tabbit Browser，没有切换浏览器后端，也没有点击网站业务提交按钮。

| 输入 | 结果 |
|---|---|
| 12,000,000-byte、300,000ms、320kbps MP3 | 计划 `REENCODE_AUDIO`；确认后输出 8,400,672-byte、224kbps MP3；最终复检通过；`workerUsed=true`、`encodePasses=1`、`businessClickCount=0` |
| 30,481,920-byte、约 762,048ms、320kbps MP3 | 文件名不再造成规则冲突；规则与元数据均正确识别；因时长超过页面 600,000ms 上限，以 `AUDIO_DURATION_LIMIT_UNFIXABLE` 停止 |

第二项不是 MP3→MP3 编码缺陷：体积压缩不会缩短录音时长。UploadFit 当前产品范围明确不做裁剪或分段，因此无法让超过 10 分钟的文件满足该站规则。

## 自动化与产物

- 新增单测：文件名不得被解析为体积区间；Podcastools 规则与文件名共存时不得冲突。
- `npm run check`：PASS，25 files / 252 tests；production build 与 static-check PASS。
- production IIFE：446,208 bytes。
- SHA-256：`C7E3D59FA0B44B0EC2104B34AE7FFB040A577B6E8A8B18F6DB4F79241D5C79A8`。

## 安装提醒

本轮修改已经写入本地 `dist/uploadfit.js`。Tabbit 私有脚本编辑器不会自动同步本地文件，人工复验前必须把这个新产物重新粘贴保存；旧安装仍会复现旧缺陷。
