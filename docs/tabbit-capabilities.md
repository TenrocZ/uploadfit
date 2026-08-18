# Tabbit 能力探针记录

本文件是 S0 能力探针的持续记录。只有完成实际复现并保留证据后，能力才可标记为 `PASS`；当前未测试项目保持 `UNKNOWN`。

## 环境

| 项目 | 值 |
|---|---|
| Tabbit Browser | 1.9.22.0 |
| 操作系统 | Windows |
| Node | v22.20.0 |
| npm | 10.9.3 |
| 探针日期 | 2026-08-18 |
| 当前页面 | `https://web.tabbit.com/panel?mode=mi&hl=zh-CN` |

## 能力矩阵

| 能力 | 状态 | Tabbit版本 | 复现步骤/当前证据 | 降级或后续动作 |
|---|---|---:|---|---|
| 安装脚本 | PASS | 1.9.22.0 | 通过“创建妙招 → 脚本”创建私有探针，页面返回“创建成功”；验收后删除成功 | 正式发布仍使用同一创建入口；探针没有公开发布 |
| 手动运行生命周期 | PASS | 1.9.22.0 | 私有探针先启用“每次都自动运行”，匹配页刷新后执行；随后关闭并保存，刷新不再注入；产品自身重复 bootstrap/cleanup/rebootstrap 继续通过 | 用户可关闭自动运行；产品 cleanup 保持幂等 |
| 匹配页面范围 | PASS | 1.9.22.0 | 选择“仅对部分网页生效”，保存 `http://127.0.0.1:8768/*`；只在匹配页观察到 `LLMBridge` 与探针结果 | 正式脚本限定目标页面，不使用“全部网页” |
| File/Blob | PASS | 1.9.22.0 | `probe.html` 页面内生成内存文件成功 | 继续保留文件不出浏览器约束 |
| DataTransfer | PASS | 1.9.22.0 | 构造、添加 File、读取 `dt.files` 成功 | 产品注入器继续处理异常降级 |
| `input.files` 赋值 | PASS | 1.9.22.0 | B 写入后元信息复核通过，A 恢复也通过 | 进入产品注入器实现 |
| input/change 合成事件 | PASS | 1.9.22.0 | input 后 change；捕获/目标/冒泡各一次 | `isTrusted=false`，不承诺所有网站逻辑都接受 |
| Canvas/toBlob | PASS | 1.9.22.0 | 页面能力摘要均为 true | 后续图像引擎仍需单元/浏览器测试 |
| createImageBitmap | PASS | 1.9.22.0 | 页面能力摘要为 true | 后续增加解码实测和失败降级 |
| Worker/Blob Worker | PASS | 1.9.22.0 | 当前生产 bundle 在 Tabbit 实机能力探针中均为 true | S2 再验证实际图像任务并准备主线程降级 |
| OffscreenCanvas | PASS | 1.9.22.0 | 页面能力摘要为 true | S2 再验证实际转码路径 |
| Tabbit AI 官方接口 | PASS | 1.9.22.0 | 用户提供的官方调用指南确认 `LLMBridge.chat()`；私有官方脚本实测 JSON 模式 1730ms 成功，返回可解析 JSON 字符串；空参数以 `Error: content is required` 拒绝 | 仅在启用且页面匹配的官方脚本运行时可用；产品强制 3000ms 超时、解析并校验 JSON |
| CSP/外部依赖限制 | PASS | 1.9.22.0 | Tabbit 托管脚本、`LLMBridge.chat`、当前单文件 bundle 与 Blob Worker 均在实机运行；未加载任何远程运行时代码 | 继续禁止 CDN/远程脚本；外部 CDN 不作为产品路径探测 |
| 单脚本体积/发布限制 | PASS | 1.9.22.0 | `dist/uploadfit.js` 为 9308 bytes，无 ESM import/export，低于 150000 bytes 目标 | Tabbit 最终发布上限仍待确认 |
| 安装、更新、分享方式 | PASS | 1.9.22.0 | 私有探针创建和保存更新均成功；分享弹层生成 `https://web.tabbit.com/share/skill/<opaque-id>`，可见范围为“仅自己”，未分发；探针最终删除 | 正式交付时再生成并分发安装链接；S0 不公开临时探针 |

## 已确认的平台连接差异

Tabbit 的 `DevToolsActivePort` 文件为：

```text
C:\Users\蔡天乐\AppData\Local\Tabbit Browser\User Data\DevToolsActivePort
```

文件提供端口 `9222` 和浏览器 WebSocket 路径。对 `http://127.0.0.1:9222/json/version`、`/json/list` 等标准 Chromium 路径请求均返回 404；使用完整地址连接后，`agent-browser` 能读取当前页面 URL。因此后续实机证据使用完整 WebSocket 端点连接，不把标准 `/json/*` 可用性写成前置条件。

## 当前 bundle 实机证据

2026-08-17 在 Tabbit 1.9.22.0 的本地探针页加载当前 `dist/uploadfit.js`，已验证产品 bundle 的单例启动、DataTransfer/input.files 注入、input/change 事件链和 cleanup/rebootstrap。详见 `docs/evidence/S0/tabbit-bundle-result.json`。

2026-08-18 的补充探针使用 Tabbit 官方“创建妙招 → 脚本”完整创建和更新路径：限定 `127.0.0.1:8768/*`，启用自动运行后刷新匹配页，`LLMBridge.chat` 成功返回；关闭自动运行并保存后刷新不再注入。分享弹层可生成私有链接，临时探针最后删除。结果见 `docs/evidence/S0/tabbit-llmbridge-result.json`。

## 证据索引

- 当前连接检查：`docs/evidence/S0/README.md`
- 最小探针截图：`docs/evidence/S0/probe-after-restore.png`
- 最小探针诊断 JSON：`docs/evidence/S0/probe-result.json`
- Tabbit 平台与官方阻塞证据：`docs/evidence/S0/tabbit-platform-result.json`
- Tabbit 官方脚本生命周期与 LLMBridge 实机证据：`docs/evidence/S0/tabbit-llmbridge-result.json`
- LLMBridge 安全摘要截图：`docs/evidence/S0/tabbit-llmbridge-probe.png`
- S0 最终交接：`docs/handoffs/S0-handoff.md`
