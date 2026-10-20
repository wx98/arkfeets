---
name: prts-artwork-scraper
description: 抓取 PRTS（prts.wiki）明日方舟干员立绘图片及后续验收。This skill should be used when 需要爬取/补抓 PRTS 干员立绘、修复下载失败、或验收图片数据完整性（查重、计数对账）。
agent_created: true
---

# PRTS 立绘爬取与验收

主脚本：`.workbuddy/skills/prts-full-pipeline/scripts/arknights_scraper_edge.py`（Edge 驱动版，脚本内置项目根目录自动定位，任意目录可运行）。旧脚本 `arknights_final_scraper.py` 已废弃（10 线程必然触发限速、平铺存图会覆盖皮肤），不要再用。

## 爬取流程

1. Selenium + Edge 无头模式分页抓 PRTS 图片搜索结果（搜索词"立绘"，每页 500，offset 翻页），收集文件页链接。
2. 用 `requests.Session` **单线程顺序下载**，每个请求间隔 0.5s，失败重试 5 次指数退避（2/4/8/16/32s）。
3. 存图结构：`Arknights_PRTS/<干员名>/<干员名> <皮肤编号>.png`（`立绘 X 1.png`→`X 1.png`，`X skin1.png` 为皮肤；跳过"预备干员"）。

## 反爬铁律（踩坑记录）

- **禁止并发下载**：5 线程即触发 prts.wiki 限速（429/403），"失败即终止"策略会丢掉 1500+ 张任务。单线程 + Session 复用 + 0.5s 间隔的实际吞吐反而最高。
- **禁止失败即终止**：失败链接写入 `Arknights_PRTS/failed_urls.txt`，跑完统一报告，可单独重试。
- `tqdm.update()` 多线程不安全，并发会导致进度条计数与失败计数对不上（曾出现 6/1505 却累计 10 次失败）。
- 请求头需补全 Accept / Accept-Language / Connection，只有 User-Agent 容易被识别为爬虫。

## 验收标准

每次重跑/补抓后必须对账：

1. **PNG 总数**：`glob("Arknights_PRTS/*/*.png")` 计数，与链接总数减跳过数核对。
2. **跨文件夹重名**：文件名 sort + uniq -d，应为 0。
3. **MD5 查重**：内容完全相同的分组；注意 PRTS 源头本身会把同一张图传多个文件名（如卫戍协议皮肤 1/2 同图、Sharp 与 领主·Sharp 同图），这类是数据源特征不是 Bug，跨干员文件夹的同名同图属合理保留。
4. **损坏检查**：<1KB 文件应为 0。
5. **failed_urls.txt**：应为空。

## 环境

- 使用系统 Python：`D:\Program Files\python\Python313\python.exe`（有 requests/bs4/selenium）；bash 默认 python 是 WorkBuddy 托管版、无第三方库。
