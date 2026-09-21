# -*- coding: utf-8 -*-
"""Use FootTrackNet to generate one foot-crop question for every source image."""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
import unicodedata
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from foot_detect_core import (DEFAULT_SCORE_THRESHOLDS,
                              DEFAULT_VISIBILITY_THRESHOLD, FootTrackNetDetector)


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
DEFAULT_DIFFICULTIES = ["simple", "medium", "hard", "hell"]


def parse_args() -> argparse.Namespace:
    project_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description="批量识别原图双脚并生成题目")
    parser.add_argument("--resource-dir", type=Path, default=project_root / "server" / "resource")
    parser.add_argument(
        "--model",
        type=Path,
        default=Path(__file__).resolve().parent / "foot_track_net-tflite-w8a8" / "foot_track_net.tflite",
    )
    parser.add_argument("--failure-file", type=Path, default=None)
    parser.add_argument("--failed-only", action="store_true", help="只重试失败清单中的原图")
    parser.add_argument("--person-threshold", type=float, default=DEFAULT_SCORE_THRESHOLDS[1], help="person 置信度阈值")
    parser.add_argument("--visibility-threshold", type=float, default=DEFAULT_VISIBILITY_THRESHOLD, help="踝关节可见性阈值")
    parser.add_argument("--enable-new", action="store_true", help="直接启用新题目；默认保持待审核草稿")
    parser.add_argument("--limit", type=int, default=0, help="只处理前 N 张待处理图片，0 表示不限")
    parser.add_argument("--force", action="store_true", help="重新推理并覆盖已有自动脚部题目")
    parser.add_argument(
        "--expand-existing-crops",
        type=float,
        default=1.0,
        help="运行推理前将已有脚部题目的裁切宽高按中心放大指定倍数",
    )
    parser.add_argument("--dry-run", action="store_true", help="执行推理但不写题目、目录和失败文件")
    parser.add_argument("--existing-only", action="store_true", help="只规范已有脚部题目，不执行模型推理")
    parser.add_argument("--checkpoint", type=int, default=25, help="每生成多少题保存一次目录和失败文件")
    return parser.parse_args()


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json_atomic(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def read_image(path: Path) -> np.ndarray:
    image = cv2.imdecode(np.fromfile(str(path), dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("图片解码失败")
    return image


def question_id(title: str) -> str:
    normalized = unicodedata.normalize("NFKC", title).strip()
    safe = "".join(char if (char.isalnum() or char in "._-") else "-" for char in normalized)
    while "--" in safe:
        safe = safe.replace("--", "-")
    return safe.strip("-")[:80] or "foot-question"


def flatten_tags(tags: Any) -> list[str]:
    result: list[str] = []
    if not isinstance(tags, list):
        return result
    for tag in tags:
        if isinstance(tag, dict) and len(tag) == 1:
            key, value = next(iter(tag.items()))
            if str(key).strip():
                result.append(f"{str(key).strip()}:{str(value).strip()}")
        elif isinstance(tag, str) and tag.strip():
            result.append(tag.strip())
    return result[:30]


def foot_crop(image: np.ndarray, persons: list[dict[str, Any]]) -> dict[str, int]:
    source_height, source_width = image.shape[:2]
    scale = min(640 / source_width, 480 / source_height)
    resized_width = round(source_width * scale)
    resized_height = round(source_height * scale)
    pad_left = (640 - resized_width) // 2
    pad_top = (480 - resized_height) // 2

    candidates: list[tuple[int, float, list[list[float]]]] = []
    for person in persons:
        boxes = person.get("foot_boxes") or []
        if not boxes:
            continue
        person_box = person.get("box") or [0, 0, 0, 0]
        area = max(0, person_box[2] - person_box[0]) * max(0, person_box[3] - person_box[1])
        candidates.append((min(len(boxes), 2), float(person.get("score", 0)) * area, boxes[:2]))
    if not candidates:
        raise ValueError("未检测到脚部")

    _, _, canvas_boxes = max(candidates, key=lambda item: (item[0], item[1]))
    boxes: list[tuple[float, float, float, float]] = []
    for x1, y1, x2, y2 in canvas_boxes:
        left = min(source_width, max(0.0, (x1 - pad_left) / scale))
        top = min(source_height, max(0.0, (y1 - pad_top) / scale))
        right = min(source_width, max(0.0, (x2 - pad_left) / scale))
        bottom = min(source_height, max(0.0, (y2 - pad_top) / scale))
        if right <= left or bottom <= top:
            raise ValueError("双脚坐标映射到原图后无效")
        boxes.append((left, top, right, bottom))

    centers = [((box[0] + box[2]) / 2, (box[1] + box[3]) / 2) for box in boxes]
    center_x = sum(point[0] for point in centers) / len(centers)
    center_y = sum(point[1] for point in centers) / len(centers)
    min_x = min(box[0] for box in boxes)
    min_y = min(box[1] for box in boxes)
    max_x = max(box[2] for box in boxes)
    max_y = max(box[3] for box in boxes)
    half_width = max(abs(center_x - min_x), abs(max_x - center_x))
    half_height = max(abs(center_y - min_y), abs(max_y - center_y))
    width = min(source_width, math.ceil(max(half_width * 5.0, source_width * 0.20)))
    height = min(source_height, math.ceil(max(half_height * 5.0, source_height * 0.20)))
    x = round(center_x - width / 2)
    y = round(center_y - height / 2)
    x = min(max(0, x), source_width - width)
    y = min(max(0, y), source_height - height)
    return {
        "x": x,
        "y": y,
        "width": width,
        "height": height,
        "sourceWidth": source_width,
        "sourceHeight": source_height,
    }


def expand_crop(crop: dict[str, Any], factor: float) -> dict[str, int]:
    source_width = int(crop["sourceWidth"])
    source_height = int(crop["sourceHeight"])
    width = min(source_width, max(1, math.ceil(float(crop["width"]) * factor)))
    height = min(source_height, max(1, math.ceil(float(crop["height"]) * factor)))
    center_x = float(crop["x"]) + float(crop["width"]) / 2
    center_y = float(crop["y"]) + float(crop["height"]) / 2
    x = min(max(0, round(center_x - width / 2)), source_width - width)
    y = min(max(0, round(center_y - height / 2)), source_height - height)
    return {
        "x": x,
        "y": y,
        "width": width,
        "height": height,
        "sourceWidth": source_width,
        "sourceHeight": source_height,
    }


def is_foot_question(record: dict[str, Any], image_name: str) -> bool:
    return record.get("originalImage") == image_name and (
        str(record.get("title", "")).rstrip().endswith("-脚")
        or str(record.get("id", "")).rstrip().endswith("-脚")
    )


def verify_generated_dataset(resource_dir: Path, images: list[Path], failure_path: Path) -> dict[str, int]:
    catalogue: list[dict[str, str]] = read_json(resource_dir / "catalogue.json")
    image_names = {path.name for path in images}
    successes: set[str] = set()
    for entry in catalogue:
        record = read_json(resource_dir / entry["file"])
        image_name = str(record.get("originalImage", ""))
        if not is_foot_question(record, image_name):
            continue
        if image_name in successes:
            raise ValueError(f"原图存在多道脚部题目：{image_name}")
        expected_title = f"{Path(image_name).stem}-脚"
        if record.get("title") != expected_title:
            raise ValueError(f"脚部题目标题不符合约定：{entry['id']}")
        crop = record.get("question")
        if not isinstance(crop, dict):
            raise ValueError(f"脚部题目缺少裁切：{entry['id']}")
        if (
            crop["x"] < 0
            or crop["y"] < 0
            or crop["width"] <= 0
            or crop["height"] <= 0
            or crop["x"] + crop["width"] > crop["sourceWidth"]
            or crop["y"] + crop["height"] > crop["sourceHeight"]
        ):
            raise ValueError(f"脚部题目裁切越界：{entry['id']}")
        successes.add(image_name)
    failures = read_json(failure_path)
    failure_names = [str(item.get("originalImage", "")) for item in failures]
    if len(failure_names) != len(set(failure_names)):
        raise ValueError("失败清单包含重复原图")
    failed = set(failure_names)
    overlap = successes & failed
    missing = image_names - successes - failed
    unknown = (successes | failed) - image_names
    if overlap:
        raise ValueError(f"成功题目与失败清单重叠：{sorted(overlap)[:3]}")
    if missing:
        raise ValueError(f"存在未处理原图：{sorted(missing)[:3]}")
    if unknown:
        raise ValueError(f"结果包含不存在的原图：{sorted(unknown)[:3]}")
    return {"images": len(image_names), "successes": len(successes), "failures": len(failed)}


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace")
    args = parse_args()
    if not 0 <= args.person_threshold <= 1 or not 0 <= args.visibility_threshold <= 1:
        raise ValueError("检测阈值必须在 0 到 1 之间")
    resource_dir = args.resource_dir.resolve()
    full_data = resource_dir / "full_data"
    question_data = resource_dir / "question_data"
    catalogue_path = resource_dir / "catalogue.json"
    failure_path = (args.failure_file or resource_dir / "foot_detection_failures.json").resolve()
    catalogue: list[dict[str, str]] = read_json(catalogue_path)
    entries_by_id = {entry["id"]: entry for entry in catalogue}
    existing_by_image: dict[str, tuple[str, dict[str, Any]]] = {}
    for entry in catalogue:
        path = resource_dir / entry["file"]
        try:
            record = read_json(path)
            if is_foot_question(record, str(record.get("originalImage", ""))):
                existing_by_image[str(record["originalImage"])] = (entry["id"], record)
        except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
            continue

    images = sorted(
        (path for path in full_data.iterdir() if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS),
        key=lambda path: path.name.casefold(),
    )

    if args.expand_existing_crops < 1:
        raise ValueError("--expand-existing-crops 不能小于 1")
    expanded = 0
    normalized_titles = 0
    for image_name, (identifier, record) in existing_by_image.items():
        changed = False
        expected_title = f"{Path(image_name).stem}-脚"
        if record.get("title") != expected_title:
            record["title"] = expected_title
            normalized_titles += 1
            changed = True
        crop = record.get("question")
        if args.expand_existing_crops > 1 and isinstance(crop, dict):
            record["question"] = expand_crop(crop, args.expand_existing_crops)
            expanded += 1
            changed = True
        if changed and not args.dry_run:
            write_json_atomic(resource_dir / entries_by_id[identifier]["file"], record)
    if normalized_titles:
        print(f"已规范 {normalized_titles} 道已有脚部题目的标题", flush=True)
    if expanded:
        print(f"已将 {expanded} 道已有脚部题目的裁切宽高放大 {args.expand_existing_crops:g} 倍", flush=True)
    if args.existing_only:
        if not args.dry_run:
            print(f"校验通过：{verify_generated_dataset(resource_dir, images, failure_path)}", flush=True)
        return 0

    previous_failures = read_json(failure_path) if failure_path.exists() else []
    if args.failed_only and not failure_path.exists():
        raise ValueError(f"失败清单不存在：{failure_path}")
    failed_names = {
        str(item["originalImage"])
        for item in previous_failures
        if isinstance(item, dict) and item.get("originalImage")
    }
    pending = [
        path for path in images
        if (args.force or path.name not in existing_by_image)
        and (not args.failed_only or path.name in failed_names)
    ]
    skipped_existing = len(images) - len(pending)
    deferred_by_limit = 0
    if args.limit > 0:
        deferred_by_limit = max(0, len(pending) - args.limit)
        pending = pending[: args.limit]
    print(f"原图 {len(images)} 张，已有脚部题目 {len(existing_by_image)} 道，本次处理 {len(pending)} 张", flush=True)
    detector = FootTrackNetDetector(
        str(args.model.resolve()),
        score_thr=(DEFAULT_SCORE_THRESHOLDS[0], args.person_threshold),
        vis_thr=args.visibility_threshold,
    )
    failures_by_image: dict[str, dict[str, Any]] = {
        str(item["originalImage"]): item
        for item in previous_failures
        if isinstance(item, dict) and item.get("originalImage")
    }
    for image_name in existing_by_image:
        failures_by_image.pop(image_name, None)
    failed_this_run = 0
    generated = 0
    started = time.perf_counter()

    def checkpoint() -> None:
        if args.dry_run:
            return
        write_json_atomic(catalogue_path, catalogue)
        write_json_atomic(failure_path, sorted(failures_by_image.values(), key=lambda item: item["originalImage"].casefold()))

    try:
        for index, image_path in enumerate(pending, start=1):
            try:
                metadata_path = image_path.with_suffix(".json")
                metadata = read_json(metadata_path)
                answers = [str(value).strip() for value in metadata.get("answers", []) if str(value).strip()]
                if not answers:
                    raise ValueError("同名元数据缺少答案")
                image = read_image(image_path)
                _, result = detector.detect(image)
                crop = foot_crop(image, result.get("persons", []))
                feet = max((len(person.get("foot_boxes") or []) for person in result.get("persons", [])), default=0)
                title = f"{image_path.stem}-脚"
                identifier = question_id(title)
                existing_entry = entries_by_id.get(identifier)
                existing_record = None
                if existing_entry:
                    existing_record = read_json(resource_dir / existing_entry["file"])
                    if not is_foot_question(existing_record, image_path.name):
                        raise ValueError(f"题目 ID 冲突：{identifier}")
                record = {
                    "id": identifier,
                    "title": title,
                    "answers": answers[:30],
                    "hint": str(metadata.get("hint", "")).strip(),
                    "difficulty": metadata.get("difficulty") or DEFAULT_DIFFICULTIES,
                    "tags": flatten_tags(metadata.get("tags", [])),
                    "originalImage": image_path.name,
                    "question": crop,
                    "enabled": existing_record["enabled"] if existing_record else args.enable_new,
                }
                if not args.dry_run:
                    write_json_atomic(question_data / f"{identifier}.json", record)
                    if not existing_entry:
                        entry = {"id": identifier, "file": f"question_data/{identifier}.json"}
                        catalogue.append(entry)
                        entries_by_id[identifier] = entry
                failures_by_image.pop(image_path.name, None)
                generated += 1
                status = f"生成 {identifier} ({min(feet, 2)} 只脚) crop={crop['x']},{crop['y']},{crop['width']}x{crop['height']}"
            except Exception as error:  # Keep the batch running and report every per-image failure.
                failed_this_run += 1
                if image_path.name in existing_by_image:
                    status = f"重算失败，保留已有题目 {image_path.name}: {error}"
                else:
                    failures_by_image[image_path.name] = {"originalImage": image_path.name, "reason": str(error)}
                    status = f"失败 {image_path.name}: {error}"
            elapsed = max(time.perf_counter() - started, 0.001)
            print(f"[{index}/{len(pending)}] {status} | {index / elapsed:.1f} 张/秒", flush=True)
            if index % max(1, args.checkpoint) == 0:
                checkpoint()
    finally:
        checkpoint()

    print(
        f"完成：生成/更新 {generated} 道，跳过已有 {skipped_existing} 道，本轮失败 {failed_this_run} 张，"
        f"失败清单共 {len(failures_by_image)} 张，"
        f"因 limit 未处理 {deferred_by_limit} 张；"
        f"失败清单：{failure_path}",
        flush=True,
    )
    if not args.dry_run and not deferred_by_limit:
        print(f"校验通过：{verify_generated_dataset(resource_dir, images, failure_path)}", flush=True)
    return 0 if not failed_this_run else 2


if __name__ == "__main__":
    sys.exit(main())
