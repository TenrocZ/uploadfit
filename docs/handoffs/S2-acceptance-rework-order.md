# S2 图像处理引擎验收返工施工单

- 施工单日期：2026-08-18
- 工程目录：`C:\Users\蔡天乐\Desktop\黑客松\main`
- 对应任务书：`C:\Users\蔡天乐\Desktop\黑客松\UploadFit-开发任务书-v1.0\30-S2-图像处理引擎.md`
- 独立验收基线：`8e502f9`（`docs: mark S2 ready for acceptance`）
- S2 实质实现基线：`463bab7`
- 当前状态：`BLOCKED_REWORK`
- 返工范围：仅 S2 图像处理引擎、S2 测试、fixtures 与证据
- 执行对象：外部开发 Agent

## 1. 施工结论

S2 的既有自动门禁在验收基线下可以通过：12 个 Vitest 文件、92 个用例，24 个 Chromium 用例，生产 IIFE 80652 bytes，静态检查通过。但是独立验收增加对抗性输入、双边字节约束、Worker 等价性、真实 fixture 体积和降级/性能证据后，确认存在 6 组必须返工的问题。

在 R1～R6 全部关闭、新增 Q-S2-001～Q-S2-013 全绿、证据刷新前：

- 不得把 S2 标记为 `READY_FOR_ACCEPTANCE` 或 `ACCEPTED`；
- 不得启动依赖 S2 正确性的 S3 实质开发；
- 不得用删除约束、放宽最终复检、跳过 Worker/降级测试来换取门禁通过；
- 现有 PASS 结果只能作为“返工前自动化基线”，不能作为本轮验收结论。

## 2. 问题总表

| 编号 | 级别 | 板块 | 验收结论 | 必须达到的关闭条件 |
|---|---|---|---|---|
| R1 | P0 | 执行确认边界 | 可伪造 plan 绕过 UPSCALE 确认 | `processImage()` 不信任可变 plan 标志；伪造/删除确认项均被阻断 |
| R2 | P1 | 主线程大小优化 | 同时存在 min/max 时误报 `FILE_TOO_SMALL` | 在质量区间内搜索满足双边约束的最高可用质量 |
| R3 | P1 | Worker 编码等价性 | Worker 错误选择最低质量，和主线程显著不等价 | Worker 与主线程采用同一搜索语义并满足等价断言 |
| R4 | P1 | 防护分类与错误码 | 主错误被二次规则污染；任意 error.code 可穿透 | 不可处理输入短路；错误码只允许稳定白名单 |
| R5 | P1 | fixtures 基线 | 声称的目标体积与生成文件严重不符，且测试未消费生成文件 | 生成器对体积容差做硬断言，集成测试真实读取 fixtures |
| R6 | P1 | Worker/降级/性能证据 | 取消、运行时错误、HTML 回退、连续卡顿、80MP 边界缺证据 | 补齐实现和自动化证据，满足任务书 D7/I10/I16/I17 |

建议按 R1 → R2/R3 → R4 → R5 → R6 的顺序施工。每组问题均先补一个必失败的回归用例，再修改生产代码，最后执行全量门禁。

## 3. R1：确认边界可被伪造 plan 绕过

### 3.1 对应要求

- 任务书：未确认的 `CROP`、`FLATTEN_BACKGROUND`、`UPSCALE` 必须阻断执行。
- 安全语义：调用方可以持有并修改普通 JavaScript 对象，生产入口不能把调用方提供的 `plan.executable` 当作可信凭据。

### 3.2 当前根因

位置：`src/image/canvas-pipeline.js` 的 `assertExecutablePlan()` 与 `processImage()` 入口。

当前入口主要依赖以下可变字段判断是否可执行：

- `plan.executable === true`；
- `plan.confirmations` 中仍存在未确认项目；
- `CROP` 是否有 `plan.crop`；
- `FLATTEN_BACKGROUND` 是否有 `plan.flattenBackground`。

缺口是：调用方可以把 `executable` 改成 `true`，再删除 `confirmations`；`UPSCALE` 操作没有独立的运行时确认校验。结果是未经用户确认的放大仍可真实执行。

### 3.3 最小复现

在 Chromium 测试里创建 100×100 JPEG，对它应用 390×390 精确尺寸规则：

```js
const metadata = await inspectImage(inputFile);
const originalPlan = createProcessingPlan(metadata, {
  formats: ['image/jpeg'],
  width: { exact: 390 },
  height: { exact: 390 }
});

expect(originalPlan.executable).toBe(false);
expect(originalPlan.operations).toContain('UPSCALE');

const forgedPlan = structuredClone(originalPlan);
forgedPlan.executable = true;
forgedPlan.confirmations = [];

await expect(
  processImage(inputFile, forgedPlan, undefined, { useWorker: false })
).rejects.toMatchObject({ code: 'USER_CONFIRMATION_REQUIRED' });
```

返工前实际结果为成功输出 390×390 文件，因此验收失败。

### 3.4 必须修改

1. 在 `processImage()` 入口读取真实输入 metadata 后，重新从 `metadata + plan.rules` 派生权威计划/权威确认需求。
2. 不得仅凭 `plan.executable` 判断确认已完成；它只能是派生展示字段。
3. 对权威计划中的每个 `requiredConfirmation`，必须在传入计划中找到同类型、结构合法、`resolved === true`、`accepted === true` 的确认记录。
4. `CROP`、`FLATTEN_BACKGROUND`、`UPSCALE` 均需逐类型验证；确认 payload 还要符合计划允许的值，不能通过替换任意 payload 注入处理参数。
5. 输入 metadata、rules、目标尺寸、目标 MIME 或操作序列与权威计划不一致时，抛稳定的 `PROCESSING_FAILED` 或专用稳定错误，不执行图像转换。
6. 拒绝确认仍返回 `USER_CANCELLED`；缺失、删除、未解析或伪造接受状态返回 `USER_CONFIRMATION_REQUIRED`。
7. 保持 `resolveProcessingConfirmation()` 的不可变返回语义；不要在原 plan 上原地写入。

推荐实现方式是“入口重算 + 对照已解析确认”，不要依赖仅在单一 JS realm 内有效的隐藏对象身份。后续 S3 可能复制/序列化 plan，施工结果需要对普通结构化对象仍然可验证。

### 3.5 必补测试

- `Q-S2-001`：覆盖删除 `confirmations`、强改 `executable`、伪造 UPSCALE accepted、篡改确认 payload；四种情况均不能执行。
- 保留并重新跑既有 CROP、FLATTEN_BACKGROUND、UPSCALE 正常接受/拒绝测试。
- 正常经 `resolveProcessingConfirmation()` 接受后的 UPSCALE 必须仍能成功，防止只做“一律阻断”的假修复。

### 3.6 关闭标准

- 上述伪造计划稳定抛 `USER_CONFIRMATION_REQUIRED`；
- 用户明确拒绝稳定抛 `USER_CANCELLED`；
- 合法确认路径仍输出符合 RuleSet 的文件；
- 最终输出复检不放宽。

## 4. R2：主线程 min/max 双边约束搜索错误

### 4.1 对应要求

- `targetMaxBytes` 使用安全目标，不越过最大体积。
- 有损格式最多 8 步质量搜索，并选取约束内最高可用质量。
- 当 `minBytes` 和 `maxBytes` 同时存在时，必须寻找二者交集，而不是只验证质量端点。

### 4.2 当前根因

位置：`src/image/size-optimizer.js` 的 `searchLossy()`。

当前流程是：最高质量大于 max 后编码最低质量；若最低质量小于 min，立即返回 `belowMinimum`。这忽略了质量区间中间可能存在大量同时满足 min/max 的解。

例如编码大小单调近似为 `160000 * quality - 52000`：

- q=0.45 → 20,000 bytes，小于 30,000；
- q=0.95 → 100,000 bytes，大于 90,000；
- 中间质量存在 `[30,000, 90,000]` 的有效交集。

返工前实现却抛 `FILE_TOO_SMALL`。

### 4.3 可复制的纯单测复现

```js
const result = await optimizeEncodedOutput({
  mime: 'image/jpeg',
  targetMinBytes: 30_000,
  targetMaxBytes: 90_000,
  qualityMin: 0.45,
  qualityMax: 0.95,
  searchSteps: 8,
  resizeRetryLimit: 0,
  allowResize: false,
  minWidth: 390,
  minHeight: 567,
  initialWidth: 390,
  initialHeight: 567,
  render: () => ({ canvas: {}, width: 390, height: 567, release() {} }),
  encode: async (_canvas, quality) => ({
    size: Math.round(160_000 * quality - 52_000)
  })
});

expect(result.blob.size).toBeGreaterThanOrEqual(30_000);
expect(result.blob.size).toBeLessThanOrEqual(90_000);
```

### 4.4 必须修改

1. 先区分真正无解的端点：
   - 最高质量仍小于 min：才是 `belowMinimum`；
   - 最低质量仍大于 max：才是 `overMaximum`，允许进入尺寸缩小逻辑；
   - 最低质量小于 min 且最高质量大于 max：区间可能有解，必须继续搜索。
2. 二分时保留“满足 min/max 的最高质量候选”，而不是第一个有效候选。
3. 搜索步数仍受任务书限制；不得把上限扩大成无界循环。
4. `targetMaxBytes === null`、`targetMinBytes === null`、min=max、无解区间、非严格单调编码误差都应有稳定行为。
5. 每个渲染轮次的 `release()` 必须在成功、失败、异常时均执行一次。

### 4.5 必补测试与关闭标准

- `Q-S2-002`：上述端点跨越双边区间时找到有效结果，并断言返回的是搜索预算内最高可用质量。
- 增加最高质量仍小于 min、最低质量仍大于 max、只有 max、只有 min 四个邻接用例。
- 无有效输出时错误码稳定；有有效输出时不允许误报 `FILE_TOO_SMALL`。

## 5. R3：Worker 返回最低质量，和主线程不等价

### 5.1 对应要求

- Worker 与主线程结果应满足同一规则与安全余量。
- 对同一输入、计划和浏览器编码器，Worker 不得无理由选择显著更低质量。
- 清理 Worker、对象 URL、Bitmap 和中间 Canvas。

### 5.2 当前根因

位置：`src/image/worker-runtime.js` 内嵌 Worker 的 `optimize()`。

当最高质量大于 max，最低质量本身已落在 min/max 区间时，代码先执行：

```js
if (valid(lowest, minimum, maximum)) {
  result = { blob: lowest, quality: qualityMin };
}
```

紧随其后的二分分支要求 `!result` 且最低质量有效，因此永远无法进入。Worker 直接返回 qMin，而主线程继续寻找更高质量。

独立浏览器探针的同一输入结果：

- q=0.45 约 227,501 bytes；
- q=0.95 约 646,403 bytes；
- 安全目标约 436,952 bytes；
- 主线程输出约 435,738 bytes；
- Worker 输出约 217,480 bytes，`workerUsed=true`。

两者都没有超过 max，但 Worker 明显没有实现“最高可用质量”。

### 5.3 必须修改

1. Worker 的质量搜索必须与 `size-optimizer.js` 修正后的语义一致，包括 min/max、最高候选、8 步上限和 resize retry。
2. 优先抽取可测试的纯搜索策略并复用，或由同一源模板生成两端逻辑；不得继续维护两份行为不同的算法。
3. Worker 每个 resize round 创建的 `OffscreenCanvas` 都要在该轮结束释放，例如归零宽高；当前只释放最终外围资源不足以证明中间轮次已清理。
4. Worker 结果仍需经过主线程最终 `inspectImage + validateFile` 复检，不能因为 `workerUsed=true` 跳过。

### 5.4 必补测试

- `Q-S2-003`：构造“qMin 有效、qMax 超 max、中间存在更高质量有效解”的浏览器用例；Worker 输出必须接近安全上界，并高于 qMin 输出。
- `Q-S2-004`：同一 File/Plan 分别 `useWorker:true/false`，断言 MIME、宽高、规则合法性一致，字节数处于同一安全区间；允许浏览器编码细微差异，不要求二进制 hash 一致。
- 在可观测的 render/release 替身中断言每轮 release 恰好一次；Worker 分支至少证明中间 OffscreenCanvas 已清理。

### 5.5 关闭标准

- Worker 与主线程都选择搜索预算内最高可用质量；
- 两条路径最终验证均通过；
- 不用禁用 Worker 或强制全部走主线程来规避问题。

## 6. R4：防护错误被二次分类污染，错误码无白名单

### 6.1 当前表现

位置：`src/image/metadata.js` 的 `validateFile()`，以及 `src/image/errors.js` 的 `asImageProcessingError()`。

当 metadata 已经给出不可处理的主错误时，校验器仍继续使用缺失/占位的 MIME、宽高去跑普通 RuleSet，于是产生没有意义的二次违规与“可自动修复”建议。验收复现包括：

| 主错误 | 返工前额外污染 |
|---|---|
| `FILE_TOO_LARGE_TO_PROCESS` | `UNSUPPORTED_FORMAT`、`FORMAT_NOT_ALLOWED`、`DIMENSION_MISMATCH`，并提出 `CONVERT/RESIZE` |
| `DECODE_FAILED` | `UNSUPPORTED_FORMAT`、格式和尺寸违规 |
| `PIXEL_LIMIT_EXCEEDED` | 尺寸违规、`RESIZE`，并混入 `DECODE_FAILED` |

这些输入在高成本处理前就必须拒绝，不能向后续层声称可通过 CONVERT/RESIZE 修好。

此外，`asImageProcessingError()` 当前会直接传播 `error.code`，包括数字或任意字符串，如 `9`、`ARBITRARY`。这破坏共享错误契约。

### 6.2 必须修改

1. `validateFile()` 在 RuleSet 本身有效后，先验证 metadata 结构。
2. 对以下主错误做短路返回：`FILE_TOO_LARGE_TO_PROCESS`、`PIXEL_LIMIT_EXCEEDED`、`UNSUPPORTED_FORMAT`、`DECODE_FAILED`，以及共享契约定义的其他不可处理输入错误。
3. 短路结果只保留真实主违规和对应 `unfixable`；`safeAutoFixes`、`requiredConfirmations` 必须为空。
4. `metadata.decodable !== true` 且没有可信主错误时，归一为单一 `DECODE_FAILED`。
5. 不接受任意 metadata.errorCode。建立与共享契约一致的冻结白名单；未知值归一为 `DECODE_FAILED` 或明确的安全 fallback。
6. `ImageProcessingError` 与 `asImageProcessingError()` 均只输出白名单内的字符串 code。未知、数字、空值统一映射到调用方指定 fallback，默认 `PROCESSING_FAILED`。
7. 保留原始异常名称等非敏感诊断字段即可，不要把任意异常对象或文件信息写入 evidence。

### 6.3 必补测试

- `Q-S2-005`：`FILE_TOO_LARGE_TO_PROCESS` 与 `PIXEL_LIMIT_EXCEEDED` 各只产生一个主分类，无 auto-fix/confirmation。
- `Q-S2-006`：损坏文件、签名不支持、不可解码输入分别得到单一稳定分类，不混入尺寸/格式规则推论。
- `Q-S2-007`：`error.code = 9`、`ARBITRARY`、空串、未知 metadata.errorCode 均不能穿透白名单；已知 code 保持不变。

### 6.4 关闭标准

- 下游只收到可操作且不矛盾的分类；
- 所有公开错误 code 都属于共享契约白名单；
- 不通过简单删除 `unfixable` 或吞掉真实主错误修复。

## 7. R5：fixtures 目标体积失真且没有进入测试链路

### 7.1 当前实测

执行 `npm run fixtures:generate` 退出码为 0，但 manifest 的目标体积与实际文件严重不符：

| fixture | 声称目标 | 返工前实测 |
|---|---:|---:|
| medium JPEG | 500,000 bytes | 141,471 bytes |
| small JPEG | 20,000 bytes | 74,472 bytes |
| large JPEG | 5,000,000 bytes | 9,155,188 bytes |
| PNG | 2,000,000 bytes | 53,077 bytes |
| transparent PNG | 未作为本表目标 | 11,560 bytes |
| orientation JPEG | 未作为本表目标 | 5,501 bytes |
| corrupt PNG | 损坏样本 | 7 bytes |
| WebP | 未作为本表目标 | 162,128 bytes |

生成器只“生成并记录”，没有验证容差，且现有 unit/integration 测试没有读取 `tests/fixtures/generated`。所以“8 个样本生成成功”不代表任务书要求的 20KB/500KB/2MB/5MB 基线成立。

### 7.2 必须修改

1. 在 `tests/fixtures/manifest.json` 为每个体积型 fixture 明确：`targetBytes`、`toleranceRatio`、用途、MIME、预期宽高。
2. 推荐体积容差先统一为 ±25%；如果个别浏览器编码器确需不同容差，必须在 manifest 单独解释，不能把容差放宽到失去边界意义。
3. 修改 `tests/fixtures/generate-fixtures.js` 的图案复杂度、尺寸与编码参数，使生成文件真实落在目标容差内。
4. 生成后读取实际文件大小、签名、MIME/可解码性；任一体积型样本越界时脚本必须非零退出。
5. WebP 能力不可用时必须明确失败或输出 capability skip；不得写空 Blob 后仍报告 PASS。
6. 集成测试必须读取生成目录中的真实文件，并至少覆盖：小文件补足/失败语义、中等 JPEG 正常处理、2MB PNG、5MB JPEG 压缩、透明 PNG、EXIF Orientation、损坏文件、WebP 能力分支。
7. fixtures 不含用户文件或敏感图片；继续使用确定性合成图案。生成二进制可保持 `.gitignore`，但 manifest、生成器和结构化摘要必须提交。

### 7.3 必补测试

- `Q-S2-008`：生成器逐项断言目标容差；故意设置不可能目标时脚本非零退出。
- `Q-S2-009`：集成测试真实打开 `tests/fixtures/generated/*`，并通过 spy/路径断言证明不是在测试内重新构造同名 synthetic File。

### 7.4 关闭标准

- `npm run fixtures:generate` 只在所有必需 fixture 合格时返回 0；
- `docs/evidence/S2/fixtures-result.json` 记录新一轮真实字节数、容差和判定；
- 集成测试确实消费这些文件；
- 不得把当前错误实测值改写成“新目标”以规避任务书基线。

## 8. R6：Worker/降级/取消/性能证据不完整

### 8.1 缺口清单

1. **取消路径缺失**：S2 图像处理代码没有完整 `AbortSignal`/cancel 通路；当前 `USER_CANCELLED` 主要表示用户拒绝确认，不等于处理中途取消。
2. **Worker 运行时失败证据不足**：现有测试主要覆盖 Worker 构造/CSP 失败，未完整覆盖 `worker.onerror`、无响应超时、处理中取消。
3. **HTMLImageElement 降级未自动化**：独立探针确认 createImageBitmap 不可用时当前 HTML 回退可工作，但仓库没有持久回归用例。
4. **连续卡顿未测**：现有性能用例只测总 duration/wall ≤5s，没有测主线程连续 freeze ≤500ms。
5. **80MP 边界不精确**：现有超限测试偏向单边 20,001，不能证明 `10000 × 8001 > 80MP` 在解码前独立触发像素上限。
6. **清理证据不足**：需要在成功、失败、超时、取消四条路径证明 `terminate()`、`URL.revokeObjectURL()`、Bitmap close 和中间 Canvas 释放。

### 8.2 必须修改

1. 为 `processImage()` options 增加可选 `signal`（或与共享契约一致的取消句柄），调用前、decode 后、每轮 encode/resize 前后检查。
2. 取消时统一抛稳定的取消错误；需明确区分“拒绝确认”与“处理中止”时，可在 details 中增加非敏感 reason，但不得产生任意 code。
3. Worker 路径接收取消信号后立即 terminate，并在 `finally` revoke Blob URL；主线程路径也停止后续轮次并释放当前资源。
4. 为 Worker 加有界超时或由上层 deadline 驱动；超时/运行时错误按任务书只回退主线程一次，不得无限重试。
5. createImageBitmap 不存在或抛错时走 HTMLImageElement + object URL；成功/失败均 revoke URL。
6. 性能测试同时记录总时长和事件循环 heartbeat 最大间隔。Worker 可用路径必须证明连续主线程阻塞 ≤500ms。
7. 如果主线程回退对 4000×3000 无法满足连续 ≤500ms，应通过分段/yield、缩放策略或明确的任务书允许方案修复，不能删掉指标。
8. 在读取头部宽高后、高成本解码前执行 80MP 检查。

### 8.3 必补测试

- `Q-S2-010`：临时禁用/替换 `createImageBitmap`，真实走 HTMLImageElement 回退；断言成功、对象 URL 被回收。
- `Q-S2-011`：Worker 构造失败、`onerror`、无响应超时、处理中 abort 四个分支；各自断言最多回退一次及所有资源清理。若 abort 语义规定不回退，测试必须断言不回退。
- `Q-S2-012`：4000×3000、≤10MiB 输入记录总耗时 ≤5s，heartbeat 最大间隔 ≤500ms；证据包含浏览器、CPU/环境说明与实际数值。
- `Q-S2-013`：构造头部声明 `10000 × 8001` 且单边均 ≤20,000 的文件，断言在完整像素解码前返回 `PIXEL_LIMIT_EXCEEDED`；另测 `10000 × 8000` 的精确边界不因像素数被误拒。

### 8.4 关闭标准

- 取消/失败路径没有残留 Worker、Blob URL、Bitmap 或 Canvas；
- Worker 不可用时只回退一次且最终结果仍复检；
- 自动测试持久证明 HTML 回退、连续 freeze 与 80MP 独立边界；
- evidence 写入真实数值，不只写“PASS”。

## 9. 新增回归用例编号与建议落点

| 编号 | 建议测试层 | 建议落点 | 核心断言 |
|---|---|---|---|
| Q-S2-001 | Chromium integration | `tests/integration/image-pipeline.test.js` | 伪造/删除 UPSCALE 确认不可执行，合法确认可执行 |
| Q-S2-002 | Vitest unit | `tests/unit/size-optimizer.test.js` | min/max 端点跨越时找到最高有效质量 |
| Q-S2-003 | Chromium integration | Worker pipeline 测试 | Worker 不直接返回 qMin |
| Q-S2-004 | Chromium integration | Worker/main equivalence 测试 | MIME/尺寸/规则/安全体积区间等价 |
| Q-S2-005 | Vitest unit | metadata/validation 测试 | 资源防护错误单一分类、无 auto-fix |
| Q-S2-006 | Vitest unit + integration | metadata/fixture 测试 | 损坏/不支持/不可解码不被二次污染 |
| Q-S2-007 | Vitest unit | `tests/unit/image-errors.test.js` | 任意错误码不能穿透稳定白名单 |
| Q-S2-008 | Node fixture script | fixture 生成测试 | 目标容差硬断言，越界非零退出 |
| Q-S2-009 | integration | fixture 驱动测试 | 真实读取 generated fixtures |
| Q-S2-010 | Chromium integration | fallback 测试 | 无 createImageBitmap 时 HTML 回退与 revoke |
| Q-S2-011 | Chromium integration | worker fallback/cancel 测试 | error/timeout/abort 清理和单次回退 |
| Q-S2-012 | Chromium performance | pipeline 性能测试 | 总时长 ≤5s；最大 heartbeat 间隔 ≤500ms |
| Q-S2-013 | Vitest unit | metadata header guard 测试 | 80MP 上下边界，且发生于高成本解码前 |

测试名称中必须直接包含 `Q-S2-xxx`，便于 `rg "Q-S2-" tests` 建立证据映射。若拆成多个 `it()`，使用 `Q-S2-011a/b/c` 等子编号，主编号仍保留。

## 10. 允许修改范围

允许按需要修改：

- `src/image/**`
- `src/utils/bytes.js`
- `src/utils/mime.js`
- 与 S2 共享错误契约直接相关的最小文件
- `tests/unit/**` 中的 S2 测试
- `tests/integration/**` 中的 S2 测试
- `tests/fixtures/**`
- `docs/evidence/S2/**`
- `docs/handoffs/S2-handoff.md`
- `docs/progress.md`
- 生产入口导出与构建产物（仅在新增/调整 S2 公共导出确有必要时）

禁止越界：

- 不实现 S3 任务编排、拒收观察或文件回填；
- 不实现 S4 UI、Tabbit AI 或页面业务逻辑；
- 不读取/修改业务 DOM，不发起上传、网络、AI、CDN 或运行时 WASM；
- 不添加用户图片、Base64、文件名、页面 URL、Cookie、Token 到日志或 evidence；
- 不改变“Tabbit 插件最终为单个可粘贴加载的纯 JS IIFE”方向；
- 不为修复 S2 引入必须在运行时安装/加载的依赖。

如确需修改允许范围之外的文件，先在返工回报中说明原因、影响和最小改动，不得顺带重构无关模块。

## 11. 建议施工顺序

1. 保存返工前基线结果，确认工作区没有覆盖用户未提交修改。
2. 先为 R1、R2、R3 各写一个返工前必失败用例。
3. 修复确认入口，使 plan 不能通过普通对象篡改绕过。
4. 统一主线程与 Worker 的质量搜索语义，补资源释放断言。
5. 修复 metadata 短路分类和错误码白名单。
6. 校准 fixture 生成器，增加生成后硬校验；让集成测试消费真实 fixture。
7. 实现取消、Worker runtime error/timeout、HTMLImageElement 降级与清理。
8. 补连续卡顿和 80MP 精确边界测试。
9. 执行全量门禁，刷新所有 S2 evidence。
10. 更新 handoff 为新的实测提交和产物 hash；仅当 R1～R6 均关闭时恢复 `READY_FOR_ACCEPTANCE`。

每个生产修复前都应看到对应 Q 用例在旧代码上失败；如无法通过 Git/测试输出证明，返工回报中必须解释原因。

## 12. 必跑验收命令

在工程根目录依次执行：

```powershell
npm ci
npm run fixtures:generate
npm test -- --run
npm run build
npm run static-check
npm run test:e2e -- --reporter=line --workers=1
```

然后补充检查：

```powershell
rg "Q-S2-0(0[1-9]|1[0-3])" tests
Get-Item dist\uploadfit.js | Select-Object Length
Get-FileHash dist\uploadfit.js -Algorithm SHA256
Get-NetTCPConnection -LocalPort 8765 -ErrorAction SilentlyContinue
git status --short
git diff --check
```

门禁要求：

- fixtures 生成器退出 0，并逐项处于声明容差；
- 所有 unit/integration/e2e 用例通过；
- 生产产物仍为单个可直接粘贴加载的纯 JavaScript IIFE；
- minified bundle 小于任务书 150KB 上限；
- 静态检查无网络/AI/CDN/敏感日志违规；
- E2E 结束后 8765 端口关闭；
- `git diff --check` 无空白错误；
- 最终工作区只保留明确列出的返工文件，且提交本地 Git 留痕。

## 13. 证据刷新要求

至少刷新以下文件，不能沿用返工前数值冒充新证据：

- `docs/evidence/S2/metadata-result.json`
- `docs/evidence/S2/planner-result.json`
- `docs/evidence/S2/pipeline-result.json`
- `docs/evidence/S2/worker-fallback-result.json`
- `docs/evidence/S2/fixtures-result.json`
- `docs/evidence/S2/README.md`
- `docs/handoffs/S2-handoff.md`

结构化 evidence 至少增加：

- `acceptanceReview`: R1～R6 的 `fixed/verified` 状态；
- `regressionCases`: Q-S2-001～013 到测试文件/测试名的映射；
- `fixtureSizes`: target、tolerance、actual、pass；
- `workerEquivalence`: main/worker MIME、宽高、bytes、quality/区间结论；
- `performance`: totalMs、maxHeartbeatGapMs、输入尺寸、输入字节、浏览器/环境；
- `cleanup`: success/error/timeout/abort 的 terminate/revoke/close 断言；
- `artifact`: bytes、SHA-256、IIFE、是否含运行时依赖。

只记录合成输入的结构化数值，不写入二进制、Base64 或完整本地临时路径。

## 14. 外部 Agent 返工回报模板

请按以下模板回报，缺项视为未完成：

```md
# S2 返工回报

- 状态：READY_FOR_REACCEPTANCE / BLOCKED
- 基线提交：
- 返工提交：
- 生产产物：dist/uploadfit.js
- 产物 bytes：
- SHA-256：

## 问题关闭

| 问题 | 修改摘要 | 代码位置 | 回归用例 | 结果 |
|---|---|---|---|---|
| R1 |  |  | Q-S2-001 | PASS/FAIL |
| R2 |  |  | Q-S2-002 | PASS/FAIL |
| R3 |  |  | Q-S2-003/004 | PASS/FAIL |
| R4 |  |  | Q-S2-005/006/007 | PASS/FAIL |
| R5 |  |  | Q-S2-008/009 | PASS/FAIL |
| R6 |  |  | Q-S2-010/011/012/013 | PASS/FAIL |

## fixture 实测

| fixture | target | tolerance | actual | result |
|---|---:|---:|---:|---|

## Worker 等价性

- 输入：
- target min/max：
- main bytes / MIME / width×height：
- worker bytes / MIME / width×height：
- 最高可用质量判定：

## 性能与清理

- 运行环境：
- totalMs：
- maxHeartbeatGapMs：
- success/error/timeout/abort 清理结果：

## 全量命令

| 命令 | 结果 | 测试数/关键输出 |
|---|---|---|

## 修改文件

- ...

## 已知限制或阻塞

- 无 / ...
```

## 15. 重新验收入口条件

只有同时满足下列条件，外部 Agent 才能请求重新验收：

- R1～R6 全部标为 fixed + verified；
- Q-S2-001～Q-S2-013 全部存在且通过；
- fixtures 实测符合目标容差并被集成测试消费；
- Worker/main 质量搜索等价，最终验证未放宽；
- Worker error/timeout/abort、HTMLImageElement 回退和资源清理均有自动证据；
- 总耗时与连续卡顿指标均有真实数值并过门槛；
- 新 bundle 仍满足纯 JS IIFE、体积和静态安全约束；
- evidence、handoff、progress 与实际 Git 提交一致；
- 外部 Agent 按第 14 节回报，且没有未说明的越界修改。

重新验收由独立验收方执行。外部 Agent 不得自行把“代码写完”记为“用户已验收”。
