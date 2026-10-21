---
name: prts-full-pipeline
description: 从 PRTS 补抓明日方舟立绘、基础资料和档案，生成 AI 猜图提示及同名信息 JSON，校验后交付 arkfeets 题库。可删除的过程数据在 tmp/Arknights_PRTS，可提交的中间交付物在 .ai-context。
agent_created: true
---

# PRTS 干员数据流水线

这是 `.ai-context/skills` 中唯一的 PRTS skill。按需执行：立绘 → 基础信息 → 档案 → AI hint → 图片同名 JSON → 交付。游戏运行、题目裁切与本流水线互不依赖；交付资源不会自动创建题目。

## 路径与边界

- 从本文件向下使用 `scripts/`；脚本通过 `prts_paths.py` 定位仓库，不依赖当前工作目录。
- **可删除的过程目录**：仓库根目录 `tmp/Arknights_PRTS/`。`operators/<干员>/*.png|*.txt|*.json` 是工作副本；`hint_batches/`、CSV、失败列表、调试页、Edge 配置及 Python/Selenium 临时文件也在这里。
- **可提交的中间交付目录**：`.ai-context/`。`wiki_cache/*.wikitext` 保留 wiki 原文，`prts_operators.json` 和 `hints_merged.json` 保留审核后的基础资料与 AI 提示。它们不随 `tmp/` 清理，可提交到 Git。
- `tmp/` 被 Git 忽略；仅在完成交付与核对后清理。若还需重新生成 JSON 或补抓图片，先备份工作副本。
- **唯一交付目录**：`server/resource/full_data/`，只平铺最终 PNG、同名 JSON 和 wikitext。`server/resource/catalogue.json` 与 `question_data/` 由游戏后台维护，不由本流水线改写。
- 使用 `python -B` 运行脚本；脚本也禁止在源码目录生成 `__pycache__`，并把 Selenium Manager 与 Edge 的工作路径指定到过程目录。安装 Python 包及浏览器自身的系统级管理行为不属于本项目文件输出。

以下命令在项目根目录运行（PowerShell）：

```powershell
$S = '.ai-context/skills/prts-full-pipeline/scripts'
python -B "$S/arknights_scraper_edge.py"
python -B "$S/prts_operator_info.py" --interval 0.8
python -B "$S/prts_fetch_archives.py" --interval 0.8
python -B "$S/prts_generate_info.py"
python -B "$S/prts_deliver.py" --dry-run
python -B "$S/prts_deliver.py"
```

需要 `requests`、`beautifulsoup4`、`tqdm`、`selenium` 和本机 Edge/EdgeDriver；信息和档案抓取不需要 Selenium。PRTS 限流时增大间隔，不要并发抓图。

## 立绘抓取

`arknights_scraper_edge.py` 使用 Edge 读取 PRTS 图片搜索分页，用 `requests.Session` 顺序下载；已有 PNG 跳过，下载间隔 0.5 秒、失败最多重试 5 次并退避。文件名为 `<干员>.png`、`<干员> 1.png`、`<干员> 2.png`、`<干员> skinN.png` 等；预备干员跳过。失败列表在 `tmp/Arknights_PRTS/failed_urls.txt`，页面结构异常时调试 HTML 也写在此目录。

该脚本目前只支持全量扫描，**没有单干员抓图参数**。少量新干员可以将有权使用的 PNG 放进 `operators/<干员>/`；多名新干员再重跑全量扫描，已有图会跳过。验收 PNG 数、跨文件夹同名、文件大小和失败列表；源站确有不同文件名但内容相同的立绘，不能仅凭哈希相同删除。

## 基础信息与档案

PRTS 侧栏经 JS 渲染，脚本直接读取 `https://prts.wiki/index.php?title=<干员名>&action=raw` 的 wikitext。`prts_operator_info.py` 解析星级、职业、分支等字段；星级为内部稀有度加一。默认名单是 `operators/` 下的文件夹名；支持 `--names 电弧,令` 或 `--names-file <文件>`。默认 JSON 写到 `.ai-context/prts_operators.json`；CSV、失败名单及自定义 `--output-prefix` 的试运行结果留在过程目录。**增量时使用 `--merge`**，按“名称”更新已有记录，避免只抓一个人却覆盖全表。

`prts_fetch_archives.py` 支持同样的名单参数，优先读取 `.ai-context/wiki_cache/<干员>.wikitext`，否则联网抓取并保存到该中间交付目录。提取档案文本到 `operators/<干员>/<干员>.txt`；`档案N条件` 不是正文，不能混入提示材料。无档案与抓取失败分别记录在过程目录的失败名单。Wiki 限流可能返回 403/429，或返回 HTTP 200 的 HTML 拦截页；不能将拦截页当作有效 wikitext，遇到时退避并稍后重试。

已知不适合按普通干员抓档案的条目包括 Mechanist、Misery、召唤物、装置、盟约·辅助干员、领主·Sharp；阿米娅(医疗)、阿米娅(近卫)共用基础阿米娅资料，不应伪造独立数据。其他新条目应先人工确认是否为干员。

## AI hint

仅对有非空档案且尚无提示的干员生成新提示；全量重做时按 15 人一批，将名单和输出放到 `tmp/Arknights_PRTS/hint_batches/`。可并行派发 AI agent，每个 agent 只读对应 `operators/<干员>/<干员>.txt`，直接写 `out_batch_XX.json`，结构为 `{"干员名":"提示"}`，回复只报告数量与路径。

提示使用中文，概括身份、出身、阵营或经历；**不含干员代号本身，最多 30 字**。合并前核对档案覆盖数、长度和代号泄漏。使用 `prts_merge_hints.py <补丁 JSON 路径>` 合并到 `.ai-context/hints_merged.json`，脚本会校验并按干员名覆盖，不清空已有提示。人工修改单个提示也使用补丁文件，避免直接重写整份汇总。

## 同名 JSON

`prts_generate_info.py` 为每张 PNG 写一份同名 JSON 到对应干员工作目录。`name` 是 PNG 文件基名，`answers` 永远先放文件夹名，并按 `1`/`2`/`skin*` 后缀追加精一、精二、皮肤别名；`difficulty` 固定为 simple/medium/hard/hell。`tags` 为单键 map 数组，字段依次为：星级、职业、分支、位置、性别、获取途径、势力、出身地、种族、生日、身高、战斗经验、是否感染者、上线时间，空值跳过。不要擅自加回稀有度_内部、情报编号、所属国家、词缀。

`hint` 优先取 AI 汇总；缺失时从客观履历、档案资料一、基础档案中确定性提取。脚本全量重跑是幂等的；规则变更后重跑即可，不要用一次性补丁逐个改文件。验收 PNG 与 JSON 一一对应、`name` 等于文件基名、hint 无超长或代号泄漏。

## 交付与复核

先运行 `prts_deliver.py --dry-run`；脚本检查每张 PNG 都有同名 JSON，以及跨文件夹平铺重名。通过后再正式运行，将工作目录的 PNG/JSON 和 `.ai-context/wiki_cache` 中的 wikitext 平铺交付到 `server/resource/full_data/`。内容相同跳过、不同内容原子替换；不会删除目标里已有文件或占位 `demo.*`。可以用 `--names 电弧,令` 只交付指定干员。

交付后在题库后台确认原图与元数据，选择主题、创建题目并裁切谜面；未完成这一步的资源不会自动进入对局。不要直接修改已有题目的 catalogue 或裁切坐标。

## 新干员增量流程

1. 在 `tmp/Arknights_PRTS/operators/<干员>/` 准备 PNG（脚本全量补抓或手工放入），先确认图片来源和命名。
2. `python -B "$S/prts_operator_info.py" --names <干员> --merge --interval 0.8`，检查汇总表中新增且旧记录仍在。
3. `python -B "$S/prts_fetch_archives.py" --names <干员> --interval 0.8`，检查档案 TXT 与 `.ai-context/wiki_cache`；无档案时记录原因，不编造内容。
4. AI 读档案生成最多 30 字、不含代号的 hint 补丁，写入过程目录 `hint_batches/`；运行 `prts_merge_hints.py` 合并。
5. 运行 `prts_generate_info.py`，校验该干员每张 PNG 的同名 JSON、别名、tags 和 hint。
6. `prts_deliver.py --names <干员> --dry-run` 后正式交付，再在题库后台创建对应题目并裁切。

完整的操作者步骤也见项目 [README.md](../../../README.md)。
