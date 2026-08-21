# V2-S2 复验返修单（第 2 轮）

- 日期：2026-08-21
- 阶段：V2-S2 音频处理工程
- 来源：`docs/handoffs/V2-S2-acceptance-rework-order.md`、`docs/handoffs/V2-S2-rework-report.md`
- 返修提交：`ab6a765 fix(test): make e2e server ownership deterministic`
- 返修后状态：`READY_FOR_ACCEPTANCE`；S3 继续 HOLD

## 1. 触发原因

上一轮 S2 复验的业务用例均通过，但 E2E runner 在测试结束后曾打印未捕获的：

```text
Error: listen EADDRINUSE: address already in use 127.0.0.1:8765
```

该问题不影响当次断言，却使门禁日志不能视为干净通过，并且旧 runner 无法区分“自己启动的服务”和已经存在的测试服务：它总是先启动子进程，再等待端口，最后只杀掉自己持有的 child。固定端口上的陈旧服务因此可能被误复用、残留或产生未处理的 child error。

本轮返修仅处理测试基础设施的生命周期，不改变 S2 音频算法、Worker 协议、错误码、预算、两遍上限或生产入口。

## 2. 返修项

| 编号 | 级别 | 问题 | 修复与验收证据 |
|---|---|---|---|
| R3-1 | HIGH（门禁完整性） | runner 无条件启动 8765 服务，重复启动会产生 `EADDRINUSE`/未捕获 child error | `scripts/run-e2e.js` 启动前探测带有 UploadFit 标记的服务；仅在无标记服务时启动并登记 `ownsServer`；`scripts/serve-test.js` 对冲突注册 error handler；见 `ab6a765` |
| R3-2 | MEDIUM（生命周期） | runner 结束时不等待服务进程退出，连续执行存在端口释放竞态 | `stopServer()` 等待 child `exit`，2 秒超时兜底；复用外部服务时不终止它；两条 targeted E2E 路径均无 `EADDRINUSE` |
| R3-3 | LOW（证据） | 复验记录未区分业务断言通过与 harness 日志洁净 | 本单记录“自启”和“复用”两条实际命令；S2 handoff/result 在返修提交后更新 endCommit 与 harness 结果 |

## 3. 实施边界

### 3.1 runner 归属探测

`serve-test.js` 在 200/404/500 响应上附带 `x-uploadfit-test-server: 1`。`run-e2e.js` 先对 probe 页发 HEAD 请求，只有状态码 `<500` 且标记匹配时才复用现有服务；未知占用者不会被误认成 UploadFit 服务，也不会被 runner 杀掉。

### 3.2 启动、冲突与关闭

- 新启动的 child 注册 `error` listener，避免父进程收到未处理的 `EADDRINUSE`。
- 服务端自身对 `EADDRINUSE` 做可控退出；其他错误仍以非零状态报告。
- 仅 runner 自己拥有的 child 在 finally 中关闭，并等待退出；外部服务保持原状。
- 固定 8765 端口和 Playwright `baseURL` 不变，不引入动态端口或生产依赖。

## 4. 复验命令与结果

### 4.1 自启路径（无现存服务）

```powershell
npm run test:e2e -- --grep "S2 audio" --reporter=line --workers=1
```

结果：`23 passed`；runner 输出一次自身启动的 `UploadFit test server`，未出现 `EADDRINUSE`、`Unhandled 'error'` 或等待超时；命令结束后 8765 无 LISTENING 进程。

### 4.2 复用路径（已有新版服务）

先启动 `scripts/serve-test.js`，再执行同一条命令。结果：`23 passed`；runner 明确输出 `Reusing existing UploadFit test server on 127.0.0.1:8765`，未终止外部服务；清理测试服务后 8765 无 LISTENING 进程。

### 4.3 原有 S2 门禁保留

本轮没有重跑 35 秒级的 200MB 门禁；上一轮已执行且结构化证据仍有效：
`docs/evidence/V2-S2/audio-200-to-100.json`（200,000,044 → 20,834,880 bytes、首中尾帧 `203/valid`、processing cancel `9.7ms`、清理完整）。本轮只修复 E2E harness 生命周期，并以 targeted E2E 证明无回归。

### 4.4 全量回归

```powershell
npm run check
npm run test:e2e -- --reporter=line --workers=1
```

结果：`npm run check` 通过（25 个文件 / 227 个测试、production bundle 185,068 bytes、static-check PASS）；全量 Playwright `141 passed (1.7m)`。全量 runner 输出无 `EADDRINUSE` 或未捕获 child error。

## 5. 退出标准

- [x] E2E runner 启动前能识别自有服务，复用外部 UploadFit 服务不误杀。
- [x] child `EADDRINUSE` 不再以未捕获异常污染门禁输出。
- [x] 自启与复用两条路径各通过 23/23 S2 audio tests。
- [x] 自有服务 finally 等待退出，固定端口执行后无残留 LISTENING 进程。
- [x] S2 音频实现与上一轮 200MB production-equivalent 证据不变。
- [ ] 真实 Tabbit 200MB 门禁：按总控归 V2-S4，不在本轮扩大范围。

## 6. 交接结论

R3-1～R3-3 已关闭。S2 可再次提交独立验收；S3 仍不得启动，直到总控确认 S2 验收通过。历史 S0/S1/S2 聚合提交不做破坏性重写，本轮仅新增聚焦返修提交 `ab6a765`，并在 S2 证据中保留该审计说明。
