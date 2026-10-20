# -*- coding: utf-8 -*-
"""
抓取 PRTS 每个干员的档案文本（基础档案/客观履历/档案资料一~四/晋升记录等），
保存为 Arknights_PRTS/<干员文件夹>/<干员名>.txt

用法:
  python prts_fetch_archives.py                 # 全量（跳过已存在的 txt）
  python prts_fetch_archives.py --names 电弧,令  # 指定干员
  python prts_fetch_archives.py --interval 1.5  # 被限流时加大间隔
"""
import argparse
import json
import os
import re
import sys
import time
import io

import requests


def _force_utf8_stdio():
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

BASE = "https://prts.wiki/index.php"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
}
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
IMG_DIR = os.path.join(ROOT, "Arknights_PRTS")
FAILED_LIST = os.path.join(ROOT, "prts_archives_failed.txt")
CACHE_DIR = os.path.join(ROOT, "wiki_cache")  # 原始 wikitext 缓存，抓一次后不再请求


def cache_path(name: str) -> str:
    safe = re.sub(r'[\\/:*?"<>|]', "_", name)
    return os.path.join(CACHE_DIR, safe + ".wikitext")


def load_cache(name: str):
    p = cache_path(name)
    if os.path.exists(p) and os.path.getsize(p) > 0:
        try:
            return open(p, encoding="utf-8").read()
        except OSError:
            return None
    return None


def save_cache(name: str, text: str):
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(cache_path(name), "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def clean_wikitext(s: str) -> str:
    """清洗 wikitext 标记为纯文本。"""
    s = re.sub(r"<!--.*?-->", "", s, flags=re.S)
    s = re.sub(r"<ref[^>]*/>", "", s)
    s = re.sub(r"<ref[^>]*>.*?</ref>", "", s, flags=re.S)
    s = re.sub(r"<br\s*/?>", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    # 模板：{{color|xxx|yyy}} -> yyy；其余 {{...}} 尽量取参数
    for _ in range(5):
        s = re.sub(r"\{\{[^{}]*\}\}", lambda m: _template_text(m.group(0)), s, flags=re.S)
    s = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]+)\]\]", r"\1", s)
    s = s.replace("'''", "").replace("''", "")
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def _template_text(t: str) -> str:
    inner = t[2:-2]
    parts = inner.split("|")
    if len(parts) >= 3:
        return parts[2]  # color 类模板取文本参数
    if len(parts) >= 2:
        return parts[1]
    return parts[0] if parts else ""


def extract_archives(wikitext: str) -> str:
    """提取 |档案N=标题 + |档案N文本=正文，拼为分节文本。"""
    fields = re.findall(r"\|(档案\d+)(条件|文本)?=(.*?)\n(?=\|)", wikitext, flags=re.S)
    titles = {}
    texts = {}
    for base, suffix, val in fields:
        val = val.strip()
        if suffix in (None, ""):
            titles[base] = clean_wikitext(val)
        elif suffix == "文本":
            texts[base] = clean_wikitext(val)
        # 条件 字段忽略
    if not texts:
        return ""
    out = []
    for k in sorted(texts, key=lambda x: int(re.search(r"\d+", x).group())):
        title = titles.get(k, k)
        out.append(f"== {title} ==")
        out.append(texts[k])
        out.append("")
    return "\n".join(out).strip()


def is_block_page(text: str) -> bool:
    """WAF 拦截页特征：HTML 响应或长度极小且无 wikitext 标记。"""
    head = text[:200].lstrip().lower()
    if head.startswith("<!doctype") or head.startswith("<html"):
        return True
    if "403 forbidden" in text[:500].lower():
        return True
    if len(text) < 300 and "{{" not in text and "[[" not in text and "=" not in text:
        return True
    return False


def fetch_wikitext(session: requests.Session, name: str) -> str:
    url = f"{BASE}?title={requests.utils.quote(name)}&action=raw"
    last_err = None
    for attempt in range(6):
        try:
            r = session.get(url, timeout=30)
            if r.status_code == 200:
                r.encoding = "utf-8"
                if is_block_page(r.text):
                    wait = min(30 * (2 ** attempt), 300)
                    print(f"  WAF 拦截页，退避 {wait}s 后重试")
                    time.sleep(wait)
                    continue
                return r.text
            if r.status_code in (403, 429):
                wait = min(30 * (2 ** attempt), 300)
                print(f"  {r.status_code} 限流，退避 {wait}s 后重试")
                time.sleep(wait)
                continue
            last_err = f"HTTP {r.status_code}"
            break
        except Exception as e:
            last_err = str(e)
            time.sleep(2 ** attempt * 2)
    raise RuntimeError(last_err or "未知错误")


def main():
    _force_utf8_stdio()
    ap = argparse.ArgumentParser()
    ap.add_argument("--names", help="逗号分隔的干员名")
    ap.add_argument("--names-file", help="从文件读取干员名（每行一个）")
    ap.add_argument("--interval", type=float, default=0.8)
    ap.add_argument("--output-prefix", default="prts_archives")
    args = ap.parse_args()

    if args.names:
        names = [n.strip() for n in args.names.split(",") if n.strip()]
    elif args.names_file:
        names = [l.strip() for l in open(args.names_file, encoding="utf-8") if l.strip()]
    else:
        names = sorted(d for d in os.listdir(IMG_DIR)
                       if os.path.isdir(os.path.join(IMG_DIR, d)))

    # 断点续传：跳过已有 txt 的
    todo = []
    for n in names:
        p = os.path.join(IMG_DIR, n, f"{n}.txt")
        if os.path.exists(p) and os.path.getsize(p) > 0:
            continue
        todo.append(n)

    print(f"共 {len(names)} 个，已存在跳过 {len(names) - len(todo)} 个，待抓取 {len(todo)} 个")
    session = requests.Session()
    session.headers.update(HEADERS)

    ok, failed, no_archive = 0, [], []
    for i, name in enumerate(todo, 1):
        out_path = os.path.join(IMG_DIR, name, f"{name}.txt")
        try:
            wikitext = load_cache(name)
            if wikitext is not None:
                src = "缓存"
            else:
                wikitext = fetch_wikitext(session, name)
                save_cache(name, wikitext)
                src = "网络"
            if "{{干员信息" not in wikitext and "{{干员" not in wikitext:
                # 不是干员页（如 重定向/杂物），看是否有档案字段
                if "|档案1文本=" not in wikitext:
                    print(f"[{i}/{len(todo)}] {name}: 无干员模板/档案，跳过")
                    no_archive.append(name)
                    continue
            content = extract_archives(wikitext)
            if not content:
                print(f"[{i}/{len(todo)}] {name}: 页面无档案字段，跳过")
                no_archive.append(name)
                continue
            os.makedirs(os.path.dirname(out_path), exist_ok=True)
            with open(out_path, "w", encoding="utf-8", newline="\n") as f:
                f.write(content)
            ok += 1
            if i % 20 == 0 or i == len(todo):
                print(f"[{i}/{len(todo)}] {name}: 已保存({src}, {ok} 成功)")
        except Exception as e:
            print(f"[{i}/{len(todo)}] {name}: 失败 - {e}")
            failed.append(name)
        time.sleep(args.interval)

    if failed:
        with open(FAILED_LIST, "w", encoding="utf-8", newline="\n") as f:
            f.write("\n".join(failed))
    if no_archive:
        with open(FAILED_LIST.replace(".txt", "_noarchive.txt"), "w", encoding="utf-8", newline="\n") as f:
            f.write("\n".join(no_archive))

    print(f"\n完成: 成功 {ok}，无档案 {len(no_archive)}，失败 {len(failed)}")
    if failed:
        print("失败名单:", failed)


if __name__ == "__main__":
    main()
