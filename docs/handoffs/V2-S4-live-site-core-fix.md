# V2-S4 真实站点核心修复交接

状态：`CORE_FIX_PASS_OFFICIAL_REINSTALL_REQUIRED`。代码、自动化和 Tabbit 真实 DOM 诊断均通过；当前 bundle 尚未通过官方私有脚本编辑器重新保存，因此不得把本轮写成新的 LR1/LR3 同 SHA 验收。

## 修复内容

1. VocaText `https://vocatext.com/`
   - 真实输入同时列出音频格式、`audio/*` 和 `.mp4`。
   - 修复前视频 token 覆盖明确音频证据，控制器 `uploaderCount=0`。
   - 修复后保留 audio+video 容器上传框的音频监控；实际选择视频文件时仍由 audio handler 拒绝，不会误处理。
2. Zent v7 `https://youzan.github.io/zent-v7/zh/component/upload`
   - 真实图片输入为 `multiple=true`。
   - 修复前 image handler 因输入框“允许多选”拒绝，即使实际只选择 1 个文件。
   - 修复后单文件可处理；控制器原有 `files.length>1` 保护继续保证多文件不处理。

## 验证

- 定向浏览器测试：16/16 PASS。
- `npm run check`：25 files / 229 tests、production build、static-check PASS。
- Tabbit 真实 VocaText DOM：上传器注册数 0→1。
- Tabbit 真实 Zent DOM：4,944,335-byte 合成 JPEG→890,624-byte JPEG，`SUCCESS`，最终 validation=true。
- 当前 `dist/uploadfit.js`：421,333 bytes，SHA-256 `98BD12C651C2801E2E2E8BC9C2A006057024AA26E2D916B33899487B9A0F1A68`。

结构化证据见 [`../evidence/V2-S4/live-site-core-fixes.json`](../evidence/V2-S4/live-site-core-fixes.json)。本轮没有记录用户文件名、路径或内容，没有点击网站提交按钮。临时诊断脚本已删除。

## 安装边界

Tabbit 当前没有打开可安全恢复的官方私有脚本编辑器，也没有可用的编辑器历史入口。本轮没有改动任何未知 Tabbit 脚本。使用修复版需要把当前 `dist/uploadfit.js` 重新粘贴保存，并为两个目标站点启用匹配/自动运行；保存后应补一次当前 SHA 的轻量安装与刷新检查。
