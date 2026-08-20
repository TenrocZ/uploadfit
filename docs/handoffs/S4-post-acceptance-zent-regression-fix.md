# S4 验收后 Zent v7 回归修复

日期：2026-08-20
状态：`FIXED_AND_VERIFIED`

## 用户现场现象

在 `https://youzan.github.io/zent-v7/zh/component/upload` 选择图片后，UploadFit 报“未能完成适配”，并重复显示“网页要求使用官方照片审核工具”。规则证据实际只有格式、`1,000,000 bytes` 上限和“网络图片 / 本地图片”来源选项。

## 根因

1. `NETWORK_OR_TIMEOUT` 使用 `/网络|超时/`，将普通的“网络图片”误判为网络故障。
2. controller 对任意 `safetyFlags` 都输出 `OFFICIAL_TOOL_REQUIRED`，导致错误原因被二次误报。
3. stopped card 同时渲染可见错误和内容相同的独立 alert，所以文案重复。

## 修复

- 网络安全停机改为只匹配“网络异常 / 错误 / 故障 / 不可用 / 超时”等明确故障表述；“网络图片”不再停机。
- 登录/权限与官方工具判定同步收紧到明确要求或错误语义。
- `SYSTEM_BUSY` / `NETWORK_OR_TIMEOUT` / `PERMISSION_OR_LOGIN` / `REVIEW_REJECTED` / `OFFICIAL_TOOL_REQUIRED` 分别保留真实错误码与中文说明。
- 失败文案改为单一可见元素，该元素自身承担 `role=alert`。

## 回归验证

| 命令 | 结果 |
| --- | --- |
| `npm run check` | PASS：18 个 Vitest 文件 / 149 个测试，build 与 static-check 通过 |
| `npm run test:e2e` | PASS：91/91 Chromium |
| `git diff --check` | PASS |

新增回归覆盖：

- Zent 原文“网络图片”保持 `actionable=true`，解析 JPEG / PNG 与 `maxBytes=1000000`。
- 真实“网络超时”仍安全停机，但错误码为 `NETWORK_OR_TIMEOUT`。
- 失败信息只显示一次，且页面中只有一个 alert。

生产产物：`dist/uploadfit.js`，170,651 bytes，SHA-256 `8126F37A6EF212A6BB7B3A24565DB5A7493CB6B3DF779699C8EBB552B394D45D`。

结构化证据：`docs/evidence/S4/zent-v7-regression-result.json`。
