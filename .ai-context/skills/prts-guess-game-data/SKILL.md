---
name: prts-guess-game-data
description: 为 Arknights_PRTS 每张立绘生成猜谜游戏信息 JSON（name/answers/hint/difficulty/tags）。This skill should be used when 需要重新生成、修改字段结构、裁剪 tags、调整 answers 别名规则或接入新 AI hint 的信息 JSON。
agent_created: true
---

# 干员信息 JSON 生成规范

脚本：`.workbuddy/skills/prts-full-pipeline/scripts/prts_generate_info.py`（内置项目根目录自动定位，任意目录可运行）。数据源：`../../prts_operators.json`（tags）、`Arknights_PRTS/<干员>/<干员>.txt`（hint 回退）、`../../.ai-context/hints_merged.json`（AI hint 优先）。

## JSON 结构（每张 .png 一个同名 .json）

```json
{
  "name": "电弧 1",                 // 与文件名一致（含后缀编号），不是干员名
  "answers": ["电弧", "电弧精一"],   // 文件夹名 + 按后缀推导的别名
  "hint": "巴别塔出身的通讯精英...",  // AI 生成 ≤30 字，禁含干员代号
  "difficulty": ["simple", "medium", "hard", "hell"],  // 固定原样
  "tags": [ {"星级": "6星"}, {"职业": "辅助"}, ... ]    // 单键 map 数组
}
```

## 字段规则（已与用户对齐，勿自行更改）

### tags（单键 map 数组，14 字段，空值跳过）
星级(N星格式)/职业/分支/位置/性别/获取途径/势力/出身地/种族/生日/身高/战斗经验/是否感染者/上线时间。

**已明确删除**：稀有度_内部、情报编号、所属国家、词缀。除非用户明确要求，不要加回。

### answers 别名规则（build_answers）
- 永远以文件夹名开头
- `XXX 1.png` → 追加 `XXX精一`；`XXX 2.png` → 追加 `XXX精二`；`XXX skin*.png` → 追加 `XXX皮肤`
- 无后缀的 `XXX.png` → 仅文件夹名

### hint
- 优先 `../../hints_merged.json`（AI 生成）；无则回退确定性提取（客观履历 > 档案资料一 > 基础档案，去【】头、去干员名、按句累计 30 字）。

## 运行与验收

```powershell
python .workbuddy/skills/prts-full-pipeline/scripts/prts_generate_info.py
```

验收三查（每次都做）：
1. JSON 数 == PNG 数（`glob("Arknights_PRTS/*/*.json")` vs `*.png`），当前 1368:1368
2. 抽查 `name == 文件基名` 全量为 0 例外
3. hint 超长(>30) 与代号泄漏均为 0

## 迭代注意

用户会逐步提字段调整需求（裁剪/结构/规则），改完 TAG_FIELDS 或函数后**直接重跑全量**（秒级），不要写一次性补丁脚本。

## 交付到 arkfeets（数据消费方）

JSON 结构变更后需同步到猜谜游戏服务端：

- 目标：`D:\workspace\IdeaProjects\arkfeets\server\resource\full_data`
- 方式：三类文件**平铺**拷贝（无第二层文件夹）：
  - `Arknights_PRTS/*/*.png`（立绘）
  - `Arknights_PRTS/*/*.json`（信息 JSON）
  - `wiki_cache/*.wikitext`（干员原始 wikitext，2026-10-21 起纳入交付）
- 平铺前必须校验重名：PNG/JSON 由干员文件夹结构保证唯一；wikitext 文件名即干员名（注意文件名做过非法字符替换 `[\\/:*?"<>|]` → `_`，属预期）
- 幂等：按内容比对，相同跳过、不同覆盖
- 验收：目标 PNG/JSON 数与源一致、wikitext 数与 wiki_cache 一致 + 无子目录；目录内可能有 `demo.png`/`demo.json` 占位文件，属 arkfeets 项目自带，不删不覆盖
