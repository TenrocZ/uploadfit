# S2 图像处理引擎交接

- 交接日期：2026-08-18
- 工程目录：`C:\Users\蔡天乐\Desktop\黑客松\main`
- 对应任务书：`30-S2-图像处理引擎.md`
- Status：`READY_FOR_ACCEPTANCE`
- 核心门禁：`PASS`
- Start commit：`115a495`（S1 用户验收登记后启动 S2 前的本地基线）
- End commit：`463bab7`（S2 实质实现、测试、证据和交接提交）
- Agent：`Codex / UploadFit S2 Agent`
- Environment：Windows；Node `v22.20.0`；npm `10.9.3`；Playwright Chromium `1.62.1`
- Build artifact：`dist/uploadfit.js`，80652 bytes，SHA-256 `FC24CC793CB62E25F83630A16A80932A2837B81ED61E9C7990ECE8C48ED0758E`

## 1. 阶段结论

S2 已完成从 `File + RuleSet` 到 `ProcessResult` 的纯本地图像管线：真实签名/元数据读取、输入资源防护、规则校验、固定处理计划、显式确认、Canvas/OffscreenCanvas 绘制、JPEG/WebP 质量搜索、PNG 安全缩小、输出新 File、最终再解码复检，以及 Worker 失败后主线程回退。

本阶段没有实现 S3 任务编排、拒收观察、注入调用、S4 UI 或 Tabbit AI。合规文件仍走原样 passthrough；`CROP`、`FLATTEN_BACKGROUND`、`UPSCALE` 在确认前均不可执行。

## 2. D1–D8 交付结果

| 交付物 | 状态 | 实现/证据 |
|---|---|---|
| S2-D1 元数据读取 | PASS | `src/image/metadata.js`、`src/image/exif.js`、`src/utils/mime.js`；JPEG/PNG/WebP 签名、MIME/扩展名一致性、宽高、比例、方向、实际透明度和可解码状态 |
| S2-D2 纯校验器 | PASS | `validateFile()`；违规、safeAutoFixes、requiredConfirmations、unfixable 稳定分类 |
| S2-D3 计划生成 | PASS | `src/image/planner.js`；固定 operation order、等比裁剪框、不可变确认解析 |
| S2-D4 Canvas 管线 | PASS | `src/image/canvas-pipeline.js`；方向归一、格式转换、裁剪/缩放、白底扁平化、平滑质量和中间 Canvas 清理 |
| S2-D5 大小优化 | PASS | `src/image/size-optimizer.js`、`encoder.js`；0.45–0.95 质量搜索最多 8 步，安全目标和最多 3 轮缩小；PNG 不伪用 quality |
| S2-D6 最终复检 | PASS | 新 File 命名、签名/MIME/扩展名/字节/宽高/可解码/RuleSet 复检；失败只抛 `OUTPUT_VALIDATION_FAILED`，不返回成功 File |
| S2-D7 Worker/降级 | PASS | `src/image/worker-runtime.js`；Blob Worker + OffscreenCanvas 成功路径，构造/CSP/运行异常后主线程重试一次并清理 |
| S2-D8 fixtures/测试 | PASS | `tests/fixtures/*`、`tests/unit/*image*.test.js`、`tests/integration/image-pipeline.test.js`、`worker-fallback.test.js` |

## 3. 公共接口

已从生产 bundle 导出并保持共享契约名称：

- `inspectImage(file)` → Promise<ImageMetadata>
- `validateFile(metadata, rules)` → ValidationResult
- `createProcessingPlan(metadata, rules)` → ProcessingPlan
- `resolveProcessingConfirmation(plan, confirmation)` → 新 ProcessingPlan
- `processImage(file, plan, progressCallback, options)` → Promise<ProcessResult>

`inspectImage()` 对资源边界和损坏输入返回带稳定 `errorCode` 的不可解码 metadata；`processImage()` 在处理入口和最终复检边界抛出稳定 `ImageProcessingError.code`，不会把失败当成成功结果。

## 4. 测试和证据

| 命令 | 结果 |
|---|---|
| `npm ci` | PASS |
| `npm test -- --run` | PASS：12 个文件、92 个单测 |
| `npm run build` | PASS：80652 bytes，单个 minified IIFE |
| `npm run static-check` | PASS |
| `npm run test:e2e -- --reporter=line --workers=1` | PASS：24 个 Chromium 测试；8765 端口关闭 |
| `npm run fixtures:generate` | PASS：8 个非敏感本地样本 |

I01–I18 映射、性能门槛、Worker 回退和 fixture 摘要见 `docs/evidence/S2/`。4000×3000 synthetic JPEG 在 Chromium 参考环境中通过 `durationMs <= 5000` 和 wall elapsed `<= 5000` 断言；测试输出等比缩放并满足最大字节约束。

## 5. 安全和范围边界

- 图片二进制/像素只在当前页面或 Worker 内存中处理；没有上传、网络请求、AI 调用或运行时 CDN/WASM。
- 不读取网页 DOM 内容；Canvas 只作为未插入业务 DOM 的图像处理表面。
- 不把完整文件名、Base64、图片像素、Cookie、Token、页面 URL 或表单值写入日志/证据；输出命名只在本地使用输入名并过滤非法字符，最长 120 字符。
- EXIF 只读取 Orientation；重新编码输出不保留 GPS 等无关元数据。DPI 只展示，不声称写入或控制。
- `CROP`、`FLATTEN_BACKGROUND`、`UPSCALE` 各自独立确认；用户拒绝返回 `USER_CANCELLED`，未确认返回 `USER_CONFIRMATION_REQUIRED`。
- 超过 50MiB、20,000 单边或 80MP、空/损坏/不支持格式均在高成本解码前或解码边界转换为稳定错误码。

## 6. 已知限制

- MVP 不引入 PNG 量化；只允许 PNG 且在尺寸规则不允许缩小时，无法满足体积会诚实失败，不添加垃圾字节。
- Worker 依赖 Worker、Blob Worker、OffscreenCanvas、createImageBitmap 和 convertToBlob；任一能力不可用或 CSP 阻止 Blob Worker 时，主线程 Canvas/HTMLImageElement 路径重试。
- 动态背景颜色仅接受白、蓝、红、绿、黑；透明 PNG 转 JPEG 默认只提出白底确认，不自动读取或修改证件照语义背景。
- 本地自动门禁通过不等于 S2 用户验收通过；当前交接状态仍需用户验收。

Git 仅做本地版本留痕，未推送远程。
