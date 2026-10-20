# -*- coding: utf-8 -*-
"""
PRTS 干员基础信息批量抓取
=========================
原理：每个干员页的 wikitext 源码（?action=raw）中，
{{干员信息}} / {{人员档案set}} / {{干员获得方式}} 模板
以 `|字段=值` 形式存放全部结构化数据，纯 requests 即可获取，
无需 Selenium、无需解析 HTML。

用法：
    python prts_operator_info.py                     # 默认扫描 Arknights_PRTS/ 下
                                                     # 的干员文件夹名作为名单
    python prts_operator_info.py --names 电弧,阿米娅  # 指定干员名（逗号分隔）
    python prts_operator_info.py --names-file names.txt
    python prts_operator_info.py --interval 1.0      # 请求间隔秒数（默认 0.8）

输出：
    prts_operators.csv   （UTF-8-BOM，Excel 可直接打开）
    prts_operators.json
    failed_operators.txt （抓取失败的名单，可直接重跑）

注意：
    - PRTS 对高频请求有限流，403 时脚本会自动指数退避重试；
      若长时间 403，请增大 --interval 或过段时间再跑。
    - "稀有度" 字段为 0 起算内部值（5=6星），脚本已换算为玩家习惯的星级。
"""

import argparse
import csv
import json
import os
import re
import sys
import time
from urllib.parse import quote

try:
    import requests
except ImportError:
    print("缺少 requests，请先安装：pip install requests")
    sys.exit(1)

BASE_RAW = "https://prts.wiki/index.php?title={title}&action=raw"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "zh-CN,zh;q=0.9",
}

# 要提取的字段：输出列名 -> wikitext 字段名
FIELDS = {
    "星级": None,          # 由 稀有度+1 换算
    "稀有度_内部": "稀有度",
    "职业": "职业",
    "分支": "分支",
    "位置": "位置",
    "性别": "性别",
    "获取途径": "获得方式",
    "词缀": "标签",
    "势力": "所属组织",
    "所属国家": "所属国家",
    "出身地": "出身地",
    "种族": "种族",
    "情报编号": "情报编号",
    "生日": "生日",
    "身高": "身高",
    "战斗经验": "战斗经验",
    "是否感染者": "是否感染者",
    "上线时间": "上线时间",
}


def clean_wiki(text):
    """去掉 wikitext 标记，保留可读文本。"""
    if not text:
        return ""
    # {{color|orange|岁}} -> 岁
    while True:
        m = re.search(r"\{\{color\|[^|}]+\|([^}]*)\}\}", text)
        if not m:
            break
        text = text[: m.start()] + m.group(1) + text[m.end():]
    # [[a|b]] -> b ；[[a]] -> a
    text = re.sub(r"\[\[[^\]|]*\|([^\]]*)\]\]", r"\1", text)
    text = text.replace("[[", "").replace("]]", "")
    # 剩余内联模板 {{xxx}} 直接剔除
    text = re.sub(r"\{\{[^}]*\}\}", "", text)
    return text.strip()


def parse_field(wikitext, field):
    """从 wikitext 中提取 `|字段=值`，返回清理后的值。"""
    m = re.search(rf"\|\s*{re.escape(field)}\s*=\s*([^\n|}}]+)", wikitext)
    return clean_wiki(m.group(1)) if m else ""


def parse_operator(wikitext):
    """把一份干员 wikitext 解析为字段字典。"""
    row = {}
    for col, field in FIELDS.items():
        if col == "星级":
            raw = parse_field(wikitext, "稀有度")
            try:
                row[col] = int(raw) + 1 if raw else ""
            except ValueError:
                row[col] = ""
        else:
            row[col] = parse_field(wikitext, field)
    return row


def fetch_wikitext(session, name, max_retries=3, backoff=(5, 10, 20)):
    """抓取单个干员页的 wikitext，403/429 时指数退避。"""
    url = BASE_RAW.format(title=quote(name))
    for attempt in range(max_retries):
        try:
            r = session.get(url, timeout=30)
            if r.status_code == 200:
                return r.text
            if r.status_code in (403, 429) and attempt < max_retries - 1:
                wait = backoff[min(attempt, len(backoff) - 1)]
                print(f"\n  [{name}] HTTP {r.status_code}，退避 {wait}s 后重试...")
                time.sleep(wait)
                continue
            print(f"\n  [{name}] HTTP {r.status_code}，放弃")
            return None
        except requests.RequestException as e:
            if attempt < max_retries - 1:
                wait = backoff[min(attempt, len(backoff) - 1)]
                print(f"\n  [{name}] 网络异常 {type(e).__name__}，{wait}s 后重试...")
                time.sleep(wait)
                continue
            print(f"\n  [{name}] 网络异常，放弃: {e}")
            return None
    return None


def _find_project_root() -> str:
    """向上查找包含 Arknights_PRTS 的项目根目录。

    脚本可位于项目根目录，或封装在 .workbuddy/skills/<skill>/scripts/ 下，
    两种位置都能正确定位数据目录。
    """
    d = os.path.dirname(os.path.abspath(__file__))
    for _ in range(6):
        if os.path.isdir(os.path.join(d, "Arknights_PRTS")):
            return d
        d = os.path.dirname(d)
    return os.getcwd()


ROOT = _find_project_root()


def default_names():
    """默认名单：Arknights_PRTS/ 下的干员文件夹名（去掉 (卫戍协议) 等后缀查 wiki）。"""
    folder = os.path.join(ROOT, "Arknights_PRTS")
    if not os.path.isdir(folder):
        return []
    names = []
    for d in sorted(os.listdir(folder)):
        if os.path.isdir(os.path.join(folder, d)):
            # "Sharp(卫戍协议)" -> "Sharp"
            base = re.sub(r"[（(].*?[)）]\s*$", "", d).strip()
            if base and base not in names:
                names.append(base)
    return names


def main():
    ap = argparse.ArgumentParser(description="PRTS 干员基础信息批量抓取")
    ap.add_argument("--names", help="逗号分隔的干员名列表")
    ap.add_argument("--names-file", help="每行一个干员名的文本文件")
    ap.add_argument("--interval", type=float, default=0.8, help="请求间隔秒数")
    ap.add_argument("--output-prefix", default="prts_operators", help="输出文件前缀")
    args = ap.parse_args()

    if args.names:
        names = [n.strip() for n in args.names.split(",") if n.strip()]
    elif args.names_file:
        with open(args.names_file, encoding="utf-8-sig") as f:
            names = [ln.strip() for ln in f if ln.strip() and not ln.startswith("#")]
    else:
        names = default_names()
        print(f"未指定名单，默认扫描 Arknights_PRTS/ 得到 {len(names)} 个干员名")

    if not names:
        print("名单为空，退出。")
        return

    session = requests.Session()
    session.headers.update(HEADERS)

    rows, failed = [], []
    total = len(names)
    for i, name in enumerate(names, 1):
        print(f"[{i}/{total}] {name} ...", end="", flush=True)
        wikitext = fetch_wikitext(session, name)

        if wikitext and "稀有度" in wikitext:
            row = {"名称": name}
            row.update(parse_operator(wikitext))
            rows.append(row)
            print(f" {row.get('星级') or '?'}星 {row.get('职业') or '?'}/{row.get('分支') or '?'}")
        else:
            failed.append(name)
            print(" 失败")

        time.sleep(args.interval)

    # ---- 输出 ----
    if rows:
        cols = ["名称"] + list(FIELDS.keys())
        csv_path = os.path.join(ROOT, f"{args.output_prefix}.csv")
        with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=cols)
            w.writeheader()
            w.writerows(rows)

        json_path = os.path.join(ROOT, f"{args.output_prefix}.json")
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(rows, f, ensure_ascii=False, indent=2)

        print(f"\n完成：成功 {len(rows)}，失败 {len(failed)}")
        print(f"  已写出 {csv_path} / {json_path}")
    else:
        print("\n没有任何成功记录。")

    if failed:
        fail_path = os.path.join(ROOT, f"{args.output_prefix}_failed.txt")
        with open(fail_path, "w", encoding="utf-8") as f:
            f.write("\n".join(failed))
        print(f"  失败名单已写入 {fail_path}，可直接作为 --names-file 重跑")


if __name__ == "__main__":
    main()
