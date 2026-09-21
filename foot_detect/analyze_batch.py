# -*- coding: utf-8 -*-
"""
批量诊断工具：定位"为什么 1500 张只有 200 张识别成功"

原理：以极低阈值对每张图只推理一次，记录模型输出的原始分数
      （max_person / max_face / max_ankle_vis），然后离线模拟
      【任意阈值组合】下的成功率，无需重复推理。

用法：
    python analyze_batch.py <图片文件夹> [--out 结果.csv] [--workers 4]

输出：
    1. CSV：每张图片的检测潜力（原始分数）
    2. 阈值模拟表：person阈值 × 踝关节可见性阈值 → 预估成功率
    3. 诊断结论：调低阈值是否有效 / 是否需要换模型方案
"""
import argparse
import csv
import json
import os
import sys
import time
from multiprocessing import Pool

import cv2
import numpy as np

from foot_detect_core import FootTrackNetDetector

IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
# 诊断用的低阈值（不依赖正式阈值，只探测模型"看到了什么"）
DIAG_SCORE = (0.01, 0.01)


def list_images(folder: str):
    files = []
    for root, _, names in os.walk(folder):
        for n in names:
            if os.path.splitext(n)[1].lower() in IMG_EXTS:
                files.append(os.path.join(root, n))
    return sorted(files)


def _worker_init(model_path: str):
    global _DET
    _DET = FootTrackNetDetector(model_path)


def _worker_diagnose(path: str):
    global _DET
    try:
        img = cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            return (path, -1.0, -1.0, -1.0, 0, [], "图片解码失败")
        d = _DET.diagnose(img)
        reason = "正常"
        return (path, d["max_person"], d["max_face"],
                d["max_ankle_vis"], d["n_ankles"], d["person_candidates"], reason)
    except Exception as e:
        return (path, -1.0, -1.0, -1.0, 0, [], f"异常:{e}")


def matching_feet(diag, person_thr, vis_thr):
    """Return the best foot count on one person, never combining different people."""
    return max((sum(vis >= vis_thr for vis in candidate["ankles"])
                for candidate in diag["person_candidates"]
                if candidate["score"] >= person_thr), default=0)


def simulate(diags, person_thrs, vis_thrs, min_feet=1):
    """Simulate detection using per-person score and valid ankle visibility."""
    n = len(diags)
    table = {}
    for p_thr in person_thrs:
        row = []
        for v_thr in vis_thrs:
            ok = sum(1 for d in diags if matching_feet(d, p_thr, v_thr) >= min_feet)
            row.append(ok / max(n, 1))
        table[p_thr] = row
    return table


def main():
    ap = argparse.ArgumentParser(description="FootTrackNet 批量诊断")
    ap.add_argument("folder", help="图片文件夹路径")
    ap.add_argument("--out", default="", help="CSV 输出路径（默认：文件夹同级 diagnosis.csv）")
    ap.add_argument("--workers", type=int, default=4, help="并行进程数")
    ap.add_argument("--limit", type=int, default=0, help="仅诊断前 N 张，0 表示全部")
    ap.add_argument("--model", default="", help="模型路径（默认自动查找/下载）")
    args = ap.parse_args()

    if not os.path.isdir(args.folder):
        print(f"[错误] 文件夹不存在：{args.folder}")
        sys.exit(1)

    model_path = args.model or os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "foot_track_net-tflite-w8a8", "foot_track_net.tflite")

    files = list_images(args.folder)
    if args.limit > 0:
        files = files[:args.limit]
    if not files:
        print(f"[错误] 文件夹内没有图片（支持 {sorted(IMG_EXTS)}）")
        sys.exit(1)
    print(f"共发现 {len(files)} 张图片，使用 {args.workers} 个进程开始诊断...")

    t0 = time.time()
    results = []
    with Pool(max(1, args.workers), initializer=_worker_init, initargs=(model_path,)) as pool:
        for i, r in enumerate(pool.imap_unordered(_worker_diagnose, files, chunksize=16)):
            results.append(r)
            if (i + 1) % 100 == 0 or i + 1 == len(files):
                el = time.time() - t0
                print(f"  已处理 {i + 1}/{len(files)}  ({el:.0f}s)")
    print(f"诊断完成，耗时 {time.time() - t0:.0f}s")

    # 组织数据
    rows = []
    for path, mp, mf, mav, na, candidates, reason in results:
        rows.append({"file": os.path.relpath(path, args.folder),
                      "max_person": mp, "max_face": mf,
                      "max_ankle_vis": mav, "n_ankles": na,
                      "person_candidates": candidates, "note": reason})
    rows.sort(key=lambda r: r["file"])

    # 写 CSV
    out_csv = args.out or os.path.join(os.path.dirname(args.folder.rstrip("\\/")),
                                       "diagnosis.csv")
    with open(out_csv, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=["file", "max_person", "max_face",
                                          "max_ankle_vis", "n_ankles", "person_candidates", "note"])
        w.writeheader()
        w.writerows([{**row, "person_candidates": json.dumps(row["person_candidates"], ensure_ascii=False)}
                     for row in rows])
    print(f"\n明细已保存：{out_csv}")

    # 统计
    diags = [r for r in rows if r["max_person"] >= 0]
    n = len(diags)
    if n == 0:
        print("所有图片均读取失败，请检查图片格式。")
        sys.exit(1)
    print("\n================ 诊断报告 ================")
    print(f"有效图片 {n} 张")
    print(f"读取/推理失败 {len(rows) - n} 张")
    avg_p = np.mean([r["max_person"] for r in diags])
    print(f"person 置信度：平均 {avg_p:.3f}，"
          f"分布 >0.7: {sum(r['max_person']>0.7 for r in diags)} 张, "
          f">0.5: {sum(r['max_person']>0.5 for r in diags)} 张, "
          f">0.3: {sum(r['max_person']>0.3 for r in diags)} 张, "
          f">0.1: {sum(r['max_person']>0.1 for r in diags)} 张")
    print(f"踝关节可见性：平均 {np.mean([r['max_ankle_vis'] for r in diags]):.3f}，"
          f">=0.05: {sum(r['max_ankle_vis']>=0.05 for r in diags)} 张, "
          f">=0.3: {sum(r['max_ankle_vis']>=0.3 for r in diags)} 张")

    # 阈值模拟表：同一人物的置信度和踝关节可见性必须同时满足条件。
    for min_feet in (1, 2):
        print(f"\n---- 阈值 → 同一人物至少 {min_feet} 只脚成功率 ----")
        print("      (纵轴 person 阈值, 横轴踝可见性阈值)")
        header = "person\\vis | " + "  ".join(f"{v:.2f}" for v in (0.0, 0.05, 0.1, 0.2))
        print(header)
        for p_thr in (0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7):
            row = []
            for v_thr in (0.0, 0.05, 0.1, 0.2):
                ok = sum(1 for d in diags if matching_feet(d, p_thr, v_thr) >= min_feet)
                row.append(f"{ok / max(n, 1) * 100:5.1f}%")
            print(f"   {p_thr:.1f}    | " + "  ".join(row))

    # 结论
    lo = sum(1 for r in diags if r["max_person"] < 0.1)
    hi = sum(1 for r in diags if r["max_person"] >= 0.5)
    print("\n================ 结论 ================")
    if lo / max(n, 1) > 0.5:
        print(f"⚠ 超过 {lo / n * 100:.0f}% 的图片 person 置信度 < 0.1，"
              f"模型对这批图片几乎无响应（不是阈值问题）。")
        print("  建议：检查图片内容（是否全身照？人物是否过小/遮挡/模糊？），")
        print("  或换方案：YOLO 微调 / SAM 分割 / 换用更适合的模型。")
    elif hi / max(n, 1) > 0.5:
        print(f"{hi / n * 100:.0f}% 的图片存在 person 置信度 ≥ 0.5 的候选。")
        print("  这不等于脚部定位正确；应结合上方同人物脚数与样本预览选择阈值。")
    else:
        print("混合情况：部分图片分数高、部分很低。")
        print("  建议：先按上表选阈值，再看失败样本多为哪种类型，")
        print("  对失败类型单独处理（如裁剪放大、增强对比度）。")


if __name__ == "__main__":
    main()
#（注：内容由AI生成）
