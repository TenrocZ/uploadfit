# S2 图像处理引擎证据

状态：`BLOCKED_REWORK`（返工前自动门禁完成，但 2026-08-18 独立验收发现 6 组阻塞问题；不得将下列 PASS 视为验收通过）。

独立验收返工施工单：`docs/handoffs/S2-acceptance-rework-order.md`。现有 JSON 和下列命令结果保留为返工前基线；R1～R6 修复后必须重跑并刷新，新增 Q-S2-001～Q-S2-013 映射后方可恢复待验收状态。

## 证据范围

- `metadata-result.json`：签名、真实 MIME、尺寸、方向、透明度、输入上限和损坏文件分类。
- `planner-result.json`：固定操作顺序、确认边界、等比尺寸规划、原样放行和不可修复分类。
- `pipeline-result.json`：I01–I18 的自动覆盖映射、Canvas/编码、最终复检和 4000×3000 性能门槛。
- `worker-fallback-result.json`：Worker 成功路径、构造/CSP 失败后的主线程重试和清理边界。
- `fixtures-result.json`：非敏感 Canvas fixture 生成结果的结构化摘要。

## 返工前自动验证基线

| 命令 | 结果 |
|---|---|
| `npm ci` | PASS |
| `npm test -- --run` | PASS：12 个 Vitest unit 文件、92 个用例 |
| `npm run build` | PASS：单个生产 IIFE，80652 bytes |
| `npm run static-check` | PASS |
| `npm run test:e2e -- --reporter=line --workers=1` | PASS：24 个 Chromium 浏览器用例 |
| `npm run fixtures:generate` | PASS：8 个非敏感样本生成；生成目录被 `.gitignore` 排除 |
| 测试端口清理 | PASS：8765 已关闭 |

测试仅在本地内存中构造图片；没有读取用户文件、上传文件、调用网络/AI 或保存 Base64/图片像素日志。`localName` 只在处理输出命名时留在本地调用链中，不进入日志和证据摘要。
