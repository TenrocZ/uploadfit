# UploadFit V2 施工入口

V2 在已验收的图片上传适配基线上增加一个收缩后的音频 MVP：**长语音录音上传转写时，网页明确允许 MP3、明确给出体积上限且当前文件超限，UploadFit 在本地把文件压到安全上限内并重新填回原上传框。**

## 开工顺序

外部 Agent 开工前必须依次阅读：

1. [UploadFit-PRD-v2.0.md](UploadFit-PRD-v2.0.md)
2. [work-orders/README.md](work-orders/README.md)
3. [work-orders/00-项目总控与协作规则.md](work-orders/00-项目总控与协作规则.md)
4. [work-orders/01-共享契约与接口基线.md](work-orders/01-共享契约与接口基线.md)
5. 当前领取阶段的任务书

当前状态：**V2-S0 至 V2-S4.1 已验收，发布前最终代码审计通过，V2-S5 可以开工**。工作区 production IIFE 已包含冻结范围内的图片与 MP3/M4A/WAV 本地适配闭环；公开发布仍须由 S5 统一版本、bytes/SHA、候选清单、安装/更新烟测和发布材料。代码审计见 `../handoffs/V2-final-code-audit.md`，S4.1 证据见 `../handoffs/V2-S4.1-final-acceptance.md` 与 `../evidence/V2-S4.1/README.md`。

## 历史基线

- V1 规划归档：[../archive/v1/README.md](../archive/v1/README.md)
- V1 实现证据：[../evidence/S5/README.md](../evidence/S5/README.md)
- V1 当前生产包：`dist/uploadfit.js`，175868 bytes
- V1 基线提交：`5979dec`

## V2 施工目录

- PRD：`docs/v2/UploadFit-PRD-v2.0.md`
- 任务书：`docs/v2/work-orders/`
- 阶段交接：`docs/handoffs/V2-Sx-handoff.md`
- 阶段证据：`docs/evidence/V2-Sx/`
- 架构裁决：沿用 `docs/decisions/ADR-NNN-标题.md`

不得在 PRD、任务书或验收用例之外自行扩展到音乐处理、视频抽取、批量压缩、降噪、裁剪或解决时长限制。
