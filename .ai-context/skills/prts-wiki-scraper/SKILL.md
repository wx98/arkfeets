---
name: prts-wiki-scraper
description: 从 PRTS wiki 抓取干员结构化基础信息（prts_operators.json）与档案文本（<干员>.txt）。This skill should be used when 需要获取/更新干员基础数据（星级/职业/分支/种族等 18 字段）或干员档案文本，或处理 prts.wiki 的 WAF 限流。
agent_created: true
---

# PRTS Wiki 结构化数据抓取

脚本：`.workbuddy/skills/prts-full-pipeline/scripts/` 下的 `prts_operator_info.py`（基础信息）、`prts_fetch_archives.py`（档案文本）。脚本内置项目根目录自动定位，任意目录可运行。

## 核心原理

PRTS 页面侧边信息栏是 JS 渲染的，HTML/markdown 转换拿不到。绕过方式：**直接抓 wikitext 源码**：

```
GET https://prts.wiki/index.php?title=<干员名>&action=raw
```

返回纯结构化文本，`{{CharinfoV2`（干员信息）与档案模板字段都在里面，正则即可提取。不需要 Selenium。

## 基础信息（prts_operator_info.py → prts_operators.csv/.json）

- 18 字段：名称/星级/稀有度_内部/职业/分支/位置/性别/获取途径/词缀/势力/所属国家/出身地/种族/情报编号/生日/身高/战斗经验/是否感染者/上线时间。
- **稀有度是 0 起算内部值**：`星级 = int(稀有度) + 1`（电弧 稀有度=5 → 6 星）。
- 用法：`--names 电弧,令` / `--names-file x.txt` / 默认全量（名单=Arknights_PRTS 下文件夹名，自动去变体后缀如 `Sharp(卫戍协议)`→`Sharp`）。

## 档案文本（prts_fetch_archives.py → Arknights_PRTS/<干员>/<干员>.txt）

- 解析字段：`|档案N=标题` + `|档案N文本=正文`（N=1~9：基础档案/综合体检测试/客观履历/临床诊断分析/档案资料一~四/晋升记录）。
- 正则必须是 `\|(档案\d+)(条件|文本)?=(.*?)\n(?=\|)`——"文本/条件"后缀要显式捕获，且**条件字段必须忽略**（否则会把"初始开放"当成节标题）。
- 清洗规则：去 `{{color|x|y}}`（取 y）、`[[a|b]]`→b、`<br>`→换行、`<ref>`、HTML 注释、粗斜体。

## 缓存与 WAF 应对（关键）

- **wiki_cache/<干员名>.wikitext**：每个页面抓一次就落盘，重跑先读缓存不发请求。新抓干员前先检查缓存。
- WAF 限流有两种形态：**HTTP 403/429**，或 **HTTP 200 但内容是 HTML 拦截页**（len<500、含 "403 Forbidden" 或以 `<!DOCTYPE` 开头）。必须做内容检测，后者也会被误判为"页面无字段"。
- 限流退避：30/60/120/240/300s 长退避；批量间隔 ≥0.8s。
- api.php、分类页、搜索页对沙箱 IP 全 403，只有 `/index.php?action=raw` 和 `/w/` 页面可用。

## 已知的非干员目录（不要再抓）

- 页面无档案字段：Mechanist、Misery、召唤物、装置、盟约·辅助干员、领主·Sharp
- wiki 404：全知海猫、小色、海猫、终曲阿米娅、能天使精二A.png（图片文件夹杂物）
- 变体无独立记录：阿米娅(医疗)、阿米娅(近卫)（prts_operators.json 只有 阿米娅 基础条目）
