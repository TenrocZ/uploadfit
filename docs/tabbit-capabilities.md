# Tabbit 能力探针记录

本文件是 S0 能力探针的持续记录。只有完成实际复现并保留证据后，能力才可标记为 `PASS`；当前未测试项目保持 `UNKNOWN`。

## 环境

| 项目 | 值 |
|---|---|
| Tabbit Browser | 1.9.22.0 |
| 操作系统 | Windows |
| Node | v22.20.0 |
| npm | 10.9.3 |
| 探针日期 | 2026-08-17 |
| 当前页面 | `https://web.tabbit.com/panel?mode=mi&hl=zh-CN` |

## 能力矩阵

| 能力 | 状态 | Tabbit版本 | 复现步骤/当前证据 | 降级或后续动作 |
|---|---|---:|---|---|
| 安装脚本 | UNKNOWN | 1.9.22.0 | 尚未执行 UploadFit 脚本安装流程 | 下一步验证“使用脚本”路径 |
| 手动运行生命周期 | UNKNOWN | 1.9.22.0 | 尚未运行 UploadFit 探针 | 运行后记录刷新、关闭和重复执行行为 |
| 匹配页面范围 | UNKNOWN | 1.9.22.0 | 尚未验证 | 记录脚本生效范围 |
| File/Blob | PASS | 1.9.22.0 | `probe.html` 页面内生成内存文件成功 | 继续保留文件不出浏览器约束 |
| DataTransfer | PASS | 1.9.22.0 | 构造、添加 File、读取 `dt.files` 成功 | 产品注入器继续处理异常降级 |
| `input.files` 赋值 | PASS | 1.9.22.0 | B 写入后元信息复核通过，A 恢复也通过 | 进入产品注入器实现 |
| input/change 合成事件 | PASS（边界已知） | 1.9.22.0 | input 后 change；捕获/目标/冒泡各一次 | `isTrusted=false`，不承诺所有网站逻辑都接受 |
| Canvas/toBlob | PASS | 1.9.22.0 | 页面能力摘要均为 true | 后续图像引擎仍需单元/浏览器测试 |
| createImageBitmap | PASS | 1.9.22.0 | 页面能力摘要为 true | 后续增加解码实测和失败降级 |
| Worker/Blob Worker | PASS（基础 API） | 1.9.22.0 | Worker 构造能力为 true；Blob Worker 尚未单独验证 | S2 再验证并准备主线程降级 |
| OffscreenCanvas | PASS（基础 API） | 1.9.22.0 | 页面能力摘要为 true | S2 再验证实际转码路径 |
| Tabbit AI 官方接口 | UNKNOWN | 1.9.22.0 | 公开入门资料仅确认“使用脚本”交互，尚未确认可供网页脚本调用的官方 AI API | 不猜测全局方法；继续查官方入口并保留本地规则降级 |
| CSP/外部依赖限制 | UNKNOWN | 1.9.22.0 | 尚未用探针页验证 | 生产脚本不依赖 CDN |
| 单脚本体积/发布限制 | PASS（构建门槛） | 1.9.22.0 | `dist/uploadfit.js` 为 6785 bytes，无 ESM import/export，低于 150KB 目标 | Tabbit 最终发布上限仍待确认 |
| 安装、更新、分享方式 | UNKNOWN | 1.9.22.0 | 尚未执行发布流程 | S6 阶段补齐 |

## 已确认的平台连接差异

Tabbit 的 `DevToolsActivePort` 文件为：

```text
C:\Users\蔡天乐\AppData\Local\Tabbit Browser\User Data\DevToolsActivePort
```

文件提供端口 `9222` 和浏览器 WebSocket 路径。对 `http://127.0.0.1:9222/json/version`、`/json/list` 等标准 Chromium 路径请求均返回 404；使用完整地址连接后，`agent-browser` 能读取当前页面 URL。因此后续实机证据使用完整 WebSocket 端点连接，不把标准 `/json/*` 可用性写成前置条件。

## 当前 bundle 实机证据

2026-08-17 在 Tabbit 1.9.22.0 的本地探针页加载当前 `dist/uploadfit.js`，已验证产品 bundle 的单例启动、DataTransfer/input.files 注入、input/change 事件链和 cleanup/rebootstrap。详见 `docs/evidence/S0/tabbit-bundle-result.json`。

该验证通过连接后的页面直接加载 bundle，不等同于 Tabbit 官方“使用脚本”安装、更新或分享流程，因此“安装脚本”“手动运行生命周期”“匹配页面范围”仍保持 `UNKNOWN`。

## 证据索引

- 当前连接检查：`docs/evidence/S0/README.md`
- 最小探针截图：`docs/evidence/S0/probe-after-restore.png`
- 最小探针诊断 JSON：`docs/evidence/S0/probe-result.json`
- S0 最终交接：`docs/handoffs/S0-handoff.md`，待 S0 退出时生成
- S0 最终交接：`docs/handoffs/S0-handoff.md`
