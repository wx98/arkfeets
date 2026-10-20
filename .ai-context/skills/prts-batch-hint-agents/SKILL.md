---
name: prts-batch-hint-agents
description: 用并行 lite 模式 sub-agent 批量为干员档案生成 AI 提示语（hint，≤30 字）。This skill should be used when 需要为大量干员（或新增干员）生成/重新生成 AI hint，或运行其他"大批次+并行 agent+文件合并"类工作流。
agent_created: true
---

# AI Hint 批量生成工作流

适用：436 个干员的档案 → 每个一句 ≤30 字猜谜提示。产出 `../../hints_merged.json`（`{"干员名": "提示"}`），由 `prts_generate_info.py` 消费。同模式可复用于任何"对几百个文件各做一次 LLM 处理"的场景。

## 流程（主 agent 编排）

1. **切批**：列出有档案的干员（`Arknights_PRTS/<名>/<名>.txt` 存在且非空），按 15 个/批写入 `hint_batches/batch_XX.txt`。
2. **并行派发**：为每批启动一个 **lite 模型** 后台 sub-agent（Agent 工具，`model="lite"`, `run_in_background=true`），一条消息里可发多个。每 agent 的产出**直接 Write 到 `hint_batches/out_batch_XX.json`**（UTF-8、中文不转义），不依赖回复消息传数据。
3. **合并**：读全部 `out_batch_*.json` 合并为 `../../hints_merged.json`。

## Agent 提示词要点（自包含，模板）

- 读批次名单 `hint_batches/batch_XX.txt`，对每个干员 Read 其 `Arknights_PRTS/<干员名>/<干员名>.txt`
- 写一句中文提示：概括身份/出身/阵营/经历特点，**绝对不出现干员代号本身**，严格 ≤30 字
- 结果 Write 到 `hint_batches/out_batch_XX.json`，格式 `{"干员名": "提示", ...}`，中文不要 `\uXXXX` 转义
- 回复只报完成数量和路径（数据在文件里，不靠消息传递）

## 合并后三重校验（必做）

1. **覆盖**：合并条数 == 有档案干员数（当前 436/436）
2. **长度**：`len(v) <= 30` 全量通过
3. **泄漏**：`干员名 in 提示` 全量为 0

## 增量更新（新干员入库）

只对有档案但不在 `../../hints_merged.json` 的干员组新批次跑一遍，再合并；不要全量重跑。跑完后重跑 `prts_generate_info.py` 生效。
