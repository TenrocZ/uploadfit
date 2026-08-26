# UploadFit V2 开发任务书

本目录把 [V2 PRD](../UploadFit-PRD-v2.0.md) 拆成可以逐阶段交给外部 Agent 执行和独立验收的施工包。V2 不是重写 V1；图片能力是已验收基线，新增范围仅为长语音转写上传的 MP3/M4A/WAV 格式墙与体积墙适配。

## 1. 当前放行状态

- 已验收：`V2-S0`、`V2-S1`、`V2-S2`、`V2-S3`、`V2-S4`、`V2-S4.1`
- 发布前最终代码审计：`CORE_CODE_ACCEPTED`，见 `docs/handoffs/V2-final-code-audit.md`
- 当前可施工：`V2-S5`（候选包、版本、发布材料与安装/更新烟测）
- 当前禁止：在 V2-S5 退出标准完成前公开分发或宣称 V2 正式发布
- 放行依据：V2-S4.1 独立验收为 `ACCEPTED`，最终代码审计又关闭连续选文件异步竞态与大 CBR MP3 ID3v1 时长偏差
- 编解码边界：ADR-005 的 `lamejs@1.2.1` 编码器继续冻结；ADR-006 冻结超限 MP3 解码重编码与 AAC-LC M4A→MP3 子集，未列入子集的 codec/container 继续安全停止
- 施工 Agent 只能写 `READY_FOR_ACCEPTANCE`，不得自行宣布阶段通过

## 2. 必读顺序

每个外部 Agent 必须阅读：

1. `docs/v2/UploadFit-PRD-v2.0.md`
2. 本页
3. `00-项目总控与协作规则.md`
4. `01-共享契约与接口基线.md`
5. 当前阶段任务书
6. 上游 `docs/handoffs/V2-Sx-handoff.md` 与对应证据 README

只阅读当前阶段任务书、不读 PRD 与共享契约，视为未开工。

## 3. 阶段依赖

```text
V2-S0 编解码与 Tabbit 可行性探针
  -> V2-S1 音频发现、规则与元数据
  -> V2-S2 规划、流式处理与最终复检
  -> V2-S3 编排、确认 UI 与回填闭环
  -> V2-S4 全量 QA、安全、性能与 Tabbit 实机
  -> V2-S4.1 超限 MP3/M4A 转码与 transient 拒收修复
  -> V2-S5 发布材料、演示与候选包
  -> 主验收 Agent 最终验收
```

本版本不安排并行施工。媒体契约、编码器选择和内存策略相互依赖，抢跑会造成返工。

## 4. 文档索引

| 文档 | 执行人 | 核心产出 |
|---|---|---|
| `00-项目总控与协作规则.md` | 全员 | 范围、依赖、文件所有权、证据和交接纪律 |
| `01-共享契约与接口基线.md` | 全员 | 音频数据结构、handler、worker、错误码和配置契约 |
| `10-V2-S0-编解码与Tabbit可行性探针.md` | S0 Agent | 编码器/许可选择、单 IIFE 原型、200→100 实证与 Go/No-Go |
| `20-V2-S1-音频发现规则与元数据.md` | S1 Agent | uploader 分类、规则、签名/元数据和计划前置判定 |
| `30-V2-S2-音频规划流式处理与复检.md` | S2 Agent | 码率规划、worker 管线、有界内存、输出复检 |
| `40-V2-S3-编排确认UI与回填闭环.md` | S3 Agent | 媒体 handler 路由、有损确认、进度/取消、回填/一次重试 |
| `50-V2-S4-全量QA安全性能与Tabbit实机.md` | S4 Agent | A–H 稳定场景、安全性能、200MB 实机、图片回归 |
| `55-V2-S4.1-MP3-M4A转码与拒收监听修复.md` | S4.1 Agent | MP3 重编码、AAC-LC M4A 转 MP3、英文规则与 transient toast 拒收闭环 |
| `60-V2-S5-发布材料演示与候选包.md` | S5 Agent | README、说明页、安装/更新、演示、最终候选产物 |
| `90-需求追踪矩阵.md` | 阶段 Agent更新、主验收复核 | PRD 到代码、测试、证据闭环 |
| `99-最终验收手册.md` | 主验收 Agent | 干净基线复验、放行和返工报告模板 |

## 5. 每阶段标准流程

1. 记录起始 commit 和 `git status --short`。
2. 确认上游状态为 `ACCEPTED`；否则只写阻塞报告。
3. 执行 `npm ci`、`npm run check` 和必要的 E2E，记录基线。
4. 先补测试/探针，再实现最小范围。
5. 运行当前阶段指定命令和 V1 回归。
6. 更新 `90-需求追踪矩阵.md` 中本阶段行。
7. 写 `docs/handoffs/V2-Sx-handoff.md` 与 `docs/evidence/V2-Sx/README.md`。
8. 记录 production bundle raw bytes/SHA 和依赖变化。
9. 状态写为 `READY_FOR_ACCEPTANCE`，等待独立验收。

## 6. 一票否决项

- 用 Node/本机 ffmpeg、服务器 API、远程 CDN 或开发服务器能力冒充 Tabbit 单脚本运行能力。
- 对长音频使用整文件 `arrayBuffer()` + `decodeAudioData()`，或完整展开 PCM。
- 音频内容、文件名、PCM、Base64 或频谱产生外部请求或持久化。
- 页面未明确允许 MP3或未明确给出 `maxBytes` 时执行音频处理。
- 使用低于 48kbps 单声道的参数让测试“必过”。
- 未确认即转码、重编码或改单声道。
- 输出未最终复检就回填，或自动点击最终业务按钮。
- 页面自动重试超过一次，或内部编码无限搜索。
- 提交大体积音频 fixture、密钥、账号、脚本 ID、分享链接或真实敏感录音。
- 图片 V1 Must 回归失败。
- 第三方编解码器许可证不明仍继续集成。

## 7. 完成定义

阶段代码、测试和文档齐全只是“可交验”。只有主验收 Agent 按 `99-最终验收手册.md` 复验并给出 `ACCEPTED` 后，下一阶段才可启动。
