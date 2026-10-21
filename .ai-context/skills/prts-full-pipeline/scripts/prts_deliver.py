"""Validate and copy generated resources into the game's flat full_data library."""

import argparse
import filecmp
import os
import re
import shutil
import sys
from pathlib import Path

sys.dont_write_bytecode = True
from prts_paths import FULL_DATA_DIR, IMAGE_DIR, WIKI_CACHE_DIR, WORK_DIR, prepare_workspace


def collect_files(image_dir, wiki_dir, names=None):
    folders = [path for path in image_dir.iterdir() if path.is_dir() and (names is None or path.name in names)]
    if names and names - {path.name for path in folders}:
        raise ValueError(f"工作目录中没有干员：{', '.join(sorted(names - {path.name for path in folders}))}")
    files = {}
    for folder in folders:
        for image in folder.glob("*.png"):
            info = image.with_suffix(".json")
            if not info.is_file():
                raise ValueError(f"缺少同名信息文件：{info}")
            for source in (image, info):
                if source.name in ("demo.png", "demo.json"):
                    raise ValueError("不能覆盖题库内置的 demo 文件")
                if source.name in files:
                    raise ValueError(f"平铺文件名冲突：{source.name}")
                files[source.name] = source
    if wiki_dir.exists():
        for source in wiki_dir.glob("*.wikitext"):
            if names is None or source.stem in names:
                files[source.name] = source
    return files


def main():
    prepare_workspace()
    parser = argparse.ArgumentParser(description="交付本地 PRTS 图片、信息和 wiki 原文")
    parser.add_argument("--names", help="只交付指定干员，使用英文逗号分隔")
    parser.add_argument("--dry-run", action="store_true", help="仅检查待交付文件，不写入题库")
    args = parser.parse_args()
    names = {name.strip() for name in args.names.split(",") if name.strip()} if args.names else None
    if names and any(re.search(r'[\\/:*?"<>|]', name) or name in (".", "..") for name in names):
        parser.error("干员名包含非法路径字符")
    try:
        files = collect_files(IMAGE_DIR, WIKI_CACHE_DIR, names)
    except ValueError as error:
        parser.error(str(error))

    if not files:
        parser.error(f"没有可交付文件：{WORK_DIR}")
    changed = [source for name, source in files.items()
               if not (FULL_DATA_DIR / name).exists() or not filecmp.cmp(source, FULL_DATA_DIR / name, shallow=False)]
    if args.dry_run:
        print(f"检查通过：{len(files)} 个文件，需新增或更新 {len(changed)} 个")
        return
    FULL_DATA_DIR.mkdir(parents=True, exist_ok=True)
    for source in changed:
        destination = FULL_DATA_DIR / source.name
        temporary = WORK_DIR / f".deliver-{os.getpid()}-{source.name}.tmp"
        try:
            shutil.copy2(source, temporary)
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)
    print(f"交付完成：新增或更新 {len(changed)} 个，未变化 {len(files) - len(changed)} 个：{FULL_DATA_DIR}")


if __name__ == "__main__":
    main()
