"""Merge an AI-generated hint patch without discarding existing hints."""

import argparse
import json
import os
import sys
from pathlib import Path

sys.dont_write_bytecode = True
from prts_paths import HINTS_JSON, WORK_DIR, prepare_workspace


def merge_hints(current, patch):
    if not isinstance(current, dict) or not isinstance(patch, dict) or not patch:
        raise ValueError("补丁必须是非空的 {干员名: 提示} JSON 对象")
    for name, hint in patch.items():
        if not isinstance(name, str) or not isinstance(hint, str) or not name or not hint or len(hint) > 30 or name in hint:
            raise ValueError(f"提示不合规：{name}（必须非空、最多 30 字且不能包含干员名）")
    return {**current, **patch}


def main():
    prepare_workspace()
    parser = argparse.ArgumentParser(description="合并新干员 AI 提示")
    parser.add_argument("input", help="位于 tmp/Arknights_PRTS 内的 JSON 补丁文件")
    args = parser.parse_args()
    source = Path(args.input).resolve()
    if not source.is_relative_to(WORK_DIR.resolve()) or source == HINTS_JSON:
        parser.error("补丁文件必须位于 tmp/Arknights_PRTS 内，且不能是汇总文件本身")
    patch = json.loads(source.read_text(encoding="utf-8"))
    current = json.loads(HINTS_JSON.read_text(encoding="utf-8")) if HINTS_JSON.exists() else {}
    try:
        current = merge_hints(current, patch)
    except ValueError as error:
        parser.error(str(error))
    temporary = WORK_DIR / f".hints_merged.{os.getpid()}.json.tmp"
    try:
        temporary.write_text(json.dumps(current, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary, HINTS_JSON)
    finally:
        temporary.unlink(missing_ok=True)
    print(f"已合并 {len(patch)} 条提示，总计 {len(current)} 条：{HINTS_JSON}")


if __name__ == "__main__":
    main()
