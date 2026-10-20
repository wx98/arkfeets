---
name: prts-full-pipeline
description: 明日方舟 PRTS 猜谜游戏数据全量/增量生产流水线主控 skill（自包含，scripts/ 内置全部 4 个 Python 脚本）：立绘爬取 → 干员基础信息 → 干员档案 → 信息 JSON → AI hint → 平铺交付 arkfeets（png/json/wikitext）。支持指定干员名的增量补齐。This skill should be used when 用户要求整体重跑数据管线、指定干员名补齐数据、新干员入库、或将全部操作串成可复用流程时。
agent_created: true
---

# PRTS 数据流水线（主控）

这是 arknights_scraper 项目的**目标操作全集**，按固定顺序执行 6 个阶段。每个阶段的详细参数、踩坑记录在 4 个子 skill 中，本 skill 只做编排与验收；遇到失败先去对应子 skill 查坑。

## 脚本位置（本 skill 自包含）

全部 4 个 Python 脚本封装在本 skill 的 `../../../scripts` 目录，是**唯一权威副本**（项目根目录不再放脚本）：

```
.workbuddy/skills/prts-full-pipeline/
├── SKILL.md
└── scripts/
    ├── arknights_scraper_edge.py   # 阶段① 立绘爬取（Edge + Selenium + 单线程）
    ├── prts_operator_info.py       # 阶段② 干员基础信息（wikitext 解析）
    ├── prts_fetch_archives.py      # 阶段③ 干员档案（wiki_cache 缓存）
    └── prts_generate_info.py       # 阶段④ 信息 JSON 生成
```

脚本内置 `_find_project_root()`：从脚本位置向上查找含 `Arknights_PRTS` 的目录作为数据根，因此**在任意 cwd 下运行都能正确定位数据**，产物仍写到项目根（Arknights_PRTS/、prts_operators.json、wiki_cache/ 等）。

| 阶段 | 脚本（均在 scripts/ 下） | 产物 | 细节 skill |
|------|------|------|-----------|
| ① 立绘爬取 | `arknights_scraper_edge.py` | `Arknights_PRTS/<干员>/*.png` | prts-artwork-scraper |
| ② 基础信息 | `prts_operator_info.py` | `../../prts_operators.json` | prts-wiki-scraper |
| ③ 档案抓取 | `prts_fetch_archives.py` | `<干员>/<干员>.txt` + `wiki_cache/` | prts-wiki-scraper |
| ④ 信息 JSON | `prts_generate_info.py` | 每张 PNG 同名 `.json` | prts-guess-game-data |
| ⑤ AI hint | 30 批 lite agent 并行 | `../../hints_merged.json` → 回写 ④ | prts-batch-hint-agents |
| ⑥ 交付 | 内嵌拷贝逻辑 | `arkfeets/server/resource/full_data`（平铺） | prts-guess-game-data |

## 环境前提（硬性）

- Python 用 `D:\Program Files\python\Python313\python.exe`（系统版，有 requests/bs4/selenium）；托管版无第三方库。
- bash 下所有输出先包装 UTF-8 stdout，否则中文干员名乱码。
- 爬取阶段会被 prts.wiki WAF 限流：请求间隔 ≥0.8s，403/429 指数退避；`action=raw` 优先走 `wiki_cache/` 缓存。

## 场景 A：全量重建（从零或换数据源）

```powershell
cd D:\workspace\IdeaProjects\arknights_scraper
$D = "D:\Program Files\python\Python313\python.exe"
$S = ".workbuddy\skills\prts-full-pipeline\scripts"

# ① 立绘（需本机 Edge，耗时 ~40min，单线程 0.5s 间隔，失败落 failed_urls.txt）
& $D "$S\arknights_scraper_edge.py"

# ② 基础信息（默认名单=Arknights_PRTS 文件夹名，~8min）
& $D "$S\prts_operator_info.py" --interval 0.8

# ③ 档案（有 wiki_cache 缓存，重跑秒级；全新 ~8min）
& $D "$S\prts_fetch_archives.py" --interval 0.8

# ④+⑤ hint 缺失时先跑 AI hint 批次（见子 skill），再生成 JSON
& $D "$S\prts_generate_info.py"

# ⑥ 交付（平铺拷贝到 arkfeets，脚本见下）
```

## 场景 B：指定干员增量补齐（用户给干员名，补齐全部内容）

**触发**：用户指定一个或多个干员名称（新干员入库、或某个干员数据缺失/过期需补齐）。

**输入**：干员名列表（如 `电弧,Mon3tr`）。

**执行顺序**（每步完成后验证再进下一步）：

```powershell
$D = "D:\Program Files\python\Python313\python.exe"
$S = ".workbuddy\skills\prts-full-pipeline\scripts"
```

1. **立绘**：`Arknights_PRTS/<干员名>/` 不存在则创建。
   - 首选：重跑阶段① 全量扫描（~40min，已下载的会自动跳过，适合新干员较多时）；
   - 干员少时也可手工把 PNG 放入文件夹，命名遵循 `<干员名>.png` / `<干员名> 1.png`（精一）/ `<干员名> 2.png`（精二）/ `<干员名> skin<N>.png`（皮肤）。
   - ⚠️ 当前 `arknights_scraper_edge.py` 不支持单干员模式，只有全量扫描；如需单干员定向抓图，先扩展脚本再加 `--names` 参数（改脚本即改本 skill 的 scripts/ 副本）。
2. **基础信息**：`& $D "$S\prts_operator_info.py" --names <干员名列表> --interval 0.8`
   - 注意：该脚本默认 **覆盖** `../../prts_operators.json`。增量跑时用 `--output-prefix` 输出到临时文件（如 `patch_ops`），再合并进主 `../../.ai-context/prts_operators.json`（按"名称"字段 upsert），避免清空其他干员记录。
3. **档案**：`& $D "$S\prts_fetch_archives.py" --names <干员名列表> --interval 0.8`
   - 产出 `<干员>/<干员>.txt` 与 `wiki_cache/<干员>.wikitext`；wiki 无此页时进 `prts_archives_failed.txt`，确认是否为已知例外类型（非干员条目/变体名）。
4. **AI hint**：为这批干员单独起 1 个 lite agent（人数>15 时才分批），读档案写 ≤30 字提示（禁含代号），合并进 `../../hints_merged.json`（按干员名 upsert）。
5. **信息 JSON**：`& $D "$S\prts_generate_info.py"` 全量重跑（秒级、幂等，无需单干员模式）。
6. **交付**：重跑阶段⑥（幂等拷贝，只会新增/更新该干员的文件）。

**增量验收**：该干员文件夹下 PNG/JSON/txt 三件齐全；`../../prts_operators.json` 含该干员记录且其他记录未丢失；`../../.ai-context/hints_merged.json` 含该干员提示；full_data 中该干员的 png/json/wikitext 均已就位。

## 阶段 ⑤ AI hint（概要，细节见 prts-batch-hint-agents）

1. 列出有 `<干员>.txt` 档案的干员，按 15 个/批切到 `hint_batches/batch_XX.txt`
2. 每批起一个 `model: lite` 后台 agent：读档案 → 写 ≤30 字提示（**禁含干员代号**）→ 落 `hint_batches/out_batch_XX.json`
3. 合并为 `../../hints_merged.json`，三重校验：0 超长 / 0 代号泄漏 / 与档案覆盖对齐
4. `prts_generate_info.py` 自动优先采用 AI hint

## 阶段 ⑥ 交付 arkfeets（平铺拷贝）

目标：`D:\workspace\IdeaProjects\arkfeets\server\resource\full_data`

规则：
- 三类文件全部**平铺**到目标根，禁止第二层文件夹：
  - `Arknights_PRTS/*/*.png`（立绘）
  - `Arknights_PRTS/*/*.json`（信息 JSON）
  - `wiki_cache/*.wikitext`（干员原始 wikitext，2026-10-21 起纳入交付）
- 拷贝前校验平铺重名（PNG/JSON 由干员文件夹结构保证唯一；wikitext 文件名即干员名，天然唯一。注意 wiki_cache 文件名做过非法字符替换 `[\\/:*?"<>|]` → `_`，如 `阿米娅(医疗)` 不受影响，但含半角特殊字符的干员名在目标处的文件名可能与文件夹名不完全一致，属预期）
- 幂等：内容相同跳过、不同覆盖
- 目标内 `demo.png`/`demo.json` 是 arkfeets 自带占位文件，不删不覆盖

## 总验收清单（全量/增量跑完都过一遍）

1. `PNG 数 == JSON 数`（当前 1368:1368）
2. `../../prts_operators.json` 记录数与干员文件夹数对账，差值都是已知例外目录（Mechanist/召唤物/装置/海猫等非干员条目，见 prts-wiki-scraper 例外表）
3. 抽查 JSON：`name == 文件基名`、`answers` 别名规则正确（精一/精二/皮肤）、tags 为 14 字段单键 map
4. hint 无超长、无代号泄漏
5. full_data 中 PNG/JSON 数与源一致、wikitext 数与 wiki_cache 一致、无子目录

## 已知例外（勿当 Bug 修）

- 8 个无档案/无 wiki 页目录：Mechanist、Misery、召唤物、装置、盟约·辅助干员、领主·Sharp、全知海猫、小色、海猫、终曲阿米娅、能天使精二A.png —— tags/hint 为空属正常
- 阿米娅(医疗)、阿米娅(近卫) 在 prts_operators.json 只有基础"阿米娅"条目，变体不硬套
- Sharp 与 领主·Sharp 有 1 组同图跨文件夹，属合理保留
