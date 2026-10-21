# -*- coding: utf-8 -*-
"""
为 Arknights_PRTS 下每个干员文件夹中的每张图片生成同名 .json 信息文件。

数据来源:
  - tags:  prts_operators.json（此前抓取的干员基础信息）
  - hint:  Arknights_PRTS/<干员>/<干员>.txt（档案文本，取客观履历/档案资料一汇总，≤30字）
  - answers: 文件夹名（+ 可能的别名）

用法: python prts_generate_info.py
"""
import json
import os
import re
import sys
import io
sys.dont_write_bytecode = True
from prts_paths import WORK_DIR, IMAGE_DIR, OPERATORS_JSON, HINTS_JSON, prepare_workspace
prepare_workspace()


def _force_utf8_stdio():
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

ROOT = str(WORK_DIR)
IMG_DIR = str(IMAGE_DIR)
OPS_JSON = str(OPERATORS_JSON)
AI_HINTS_JSON = str(HINTS_JSON)  # AI 生成的提示（优先使用）

# tags 字段顺序
TAG_FIELDS = ["星级", "职业", "分支", "位置", "性别", "获取途径",
              "势力", "出身地", "种族",
              "生日", "身高", "战斗经验", "是否感染者", "上线时间"]

DIFFICULTY = ["simple", "medium", "hard", "hell"]

# hint 取材优先级：客观履历 > 档案资料一 > 基础档案
HINT_SECTION_PRIORITY = ["客观履历", "档案资料一", "基础档案"]


def read_archive_section(txt_path: str, section: str) -> str:
    """从档案 txt 中取指定分节的正文。"""
    try:
        content = open(txt_path, encoding="utf-8").read()
    except OSError:
        return ""
    m = re.search(rf"== {re.escape(section)} ==\n(.*?)(?=\n== |\Z)", content, flags=re.S)
    return m.group(1).strip() if m else ""


def make_hint(name: str, txt_path: str, max_len: int = 30) -> str:
    """从档案汇总一句不超过 max_len 字的提示。"""
    for section in HINT_SECTION_PRIORITY:
        text = read_archive_section(txt_path, section)
        if not text:
            continue
        # 去掉【...】标记头
        text = re.sub(r"【[^】]*】", " ", text)
        # 去掉干员名本身（含变体名前缀）
        for n in {name, re.split(r"[·]", name)[-1]}:
            if n:
                text = text.replace(n, " ")
        # 压缩空白
        text = re.sub(r"\s+", " ", text).strip()
        text = text.lstrip("，,。、；;：: ")
        if not text:
            continue
        # 按句切分，累计填满 max_len
        sentences = re.split(r"(?<=[。！？!?])", text)
        out = ""
        for s in sentences:
            s = s.strip()
            if not s:
                continue
            if len(out) + len(s) <= max_len:
                out += s
            else:
                out += s[: max_len - len(out)]  # 剩余空间截断
                break
            if len(out) >= max_len:
                break
        if out:
            return out.rstrip("，,、；;：: ")
    return ""


def build_tags(record: dict) -> list:
    tags = []
    if not record:
        return tags
    for field in TAG_FIELDS:
        val = record.get(field, "")
        if val is None or str(val).strip() == "":
            continue
        if field == "星级":
            tags.append({"星级": f"{val}星"})
        else:
            tags.append({field: str(val).strip()})
    return tags


def build_answers(folder: str, base: str) -> list:
    """按图片文件名推导答案别名：
    XXX 1.png     -> [XXX, XXX精一]
    XXX 2.png     -> [XXX, XXX精二]
    XXX skin1.png -> [XXX, XXX皮肤]
    """
    answers = [folder]
    m = re.match(rf"^{re.escape(folder)} (.+)$", base)
    if m:
        suffix = m.group(1)
        if suffix.lower().startswith("skin"):
            answers.append(f"{folder}皮肤")
        elif suffix.startswith("1"):
            answers.append(f"{folder}精一")
        elif suffix.startswith("2"):
            answers.append(f"{folder}精二")
    return answers


def main():
    _force_utf8_stdio()
    ops = {r["名称"]: r for r in json.load(open(OPS_JSON, encoding="utf-8"))}
    ai_hints = {}
    if os.path.exists(AI_HINTS_JSON):
        ai_hints = json.load(open(AI_HINTS_JSON, encoding="utf-8"))
        print(f"加载 AI 提示: {len(ai_hints)} 条")

    folders = sorted(d for d in os.listdir(IMG_DIR)
                     if os.path.isdir(os.path.join(IMG_DIR, d)))
    total_json, no_record, no_hint = 0, [], []

    for folder in folders:
        fdir = os.path.join(IMG_DIR, folder)
        record = ops.get(folder)
        if record is None:
            no_record.append(folder)
        txt_path = os.path.join(fdir, f"{folder}.txt")
        hint = ai_hints.get(folder, "") or make_hint(folder, txt_path)
        if not hint:
            no_hint.append(folder)
        tags = build_tags(record)

        for fn in os.listdir(fdir):
            base, ext = os.path.splitext(fn)
            if ext.lower() != ".png":
                continue
            info = {
                "name": base,  # 与文件名一致（如 电弧 1）
                "answers": build_answers(folder, base),
                "hint": hint,
                "difficulty": DIFFICULTY,
                "tags": tags,
            }
            out_path = os.path.join(fdir, base + ".json")
            with open(out_path, "w", encoding="utf-8", newline="\n") as f:
                json.dump(info, f, ensure_ascii=False, indent=2)
            total_json += 1

    print(f"文件夹: {len(folders)} 个，生成 JSON: {total_json} 个")
    print(f"无基础信息记录({len(no_record)}): {no_record}")
    print(f"无档案 hint({len(no_hint)}): {no_hint}")


if __name__ == "__main__":
    main()
