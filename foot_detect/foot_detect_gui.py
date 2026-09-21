# -*- coding: utf-8 -*-
"""
FootTrackNet 脚部检测界面（Gradio 网页版，支持实时调参）
- 上传图片 → 输出标注 person / face / foot 框的图片
- 左侧滑块可实时调整检测参数，观察成功率变化
- 运行：python foot_detect_gui.py   →  浏览器打开 http://127.0.0.1:7860
"""
import os
import json
import socket
import gradio as gr
import numpy as np
import cv2
from foot_detect_core import FootTrackNetDetector

MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          "foot_track_net-tflite-w8a8", "foot_track_net.tflite")

try:
    detector = FootTrackNetDetector(MODEL_PATH)
except RuntimeError as e:
    print("=" * 60)
    print("模型加载失败：")
    print(e)
    print("=" * 60)
    input("按回车退出...")
    raise SystemExit(1)

# 默认阈值（与核心模块一致）
DEFAULT = {"face": 0.6, "person": 0.7, "vis": 0.05, "iou": 0.3}


def process_image(image: np.ndarray | None,
                  face_thr: float = DEFAULT["face"],
                  person_thr: float = DEFAULT["person"],
                  vis_thr: float = DEFAULT["vis"],
                  iou_thr: float = DEFAULT["iou"]):
    """Gradio 回调：输入 RGB 图 + 参数，输出标注图 + 检测结果文本"""
    if image is None:
        return None, "请先上传图片"
    img_bgr = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)
    annotated, result = detector.detect(
        img_bgr,
        score_thr=(face_thr, person_thr),
        vis_thr=vis_thr,
        iou_thr=iou_thr)
    out_rgb = cv2.cvtColor(annotated, cv2.COLOR_BGR2RGB)

    lines = [f"当前参数：person阈值={person_thr:.2f}  踝可见性阈值={vis_thr:.2f}  "
             f"face阈值={face_thr:.2f}",
             f"检测到 person × {len(result['persons'])}，face × {len(result['faces'])}"]
    for i, p in enumerate(result["persons"]):
        lines.append(f"  person{i+1}: {p['box']} score={p['score']}")
        for j, fb in enumerate(p["foot_boxes"]):
            lines.append(f"    foot{j+1}: {fb}")
        for a in p["ankles"]:
            if a["visibility"] > vis_thr:
                lines.append(f"    {a['name']}: ({a['x']}, {a['y']}) vis={a['visibility']:.2f}")
    text = "\n".join(lines)
    return out_rgb, text


def find_free_port(start=7860, tries=20):
    """从 start 开始找一个空闲端口（解决 7860 被占用的问题）"""
    for port in range(start, start + tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    return None


with gr.Blocks(title="FootTrackNet 脚部检测（可调参）") as demo:
    gr.Markdown(
        "## FootTrackNet 脚部检测（可调参）\n"
        "上传图片后自动框选 **person（红）**、**face（橙）**、**foot（绿）**。\n\n"
        "**调参指南**：识别率低时，优先把 **person 阈值** 和 **踝可见性阈值** 调低"
        "（检出更多，但误检可能增加）；\n建议先用 `analyze_batch.py` 批量诊断一批图片，"
        "根据成功率模拟表选择最优阈值。"
    )
    with gr.Row():
        with gr.Column(scale=1):
            inp = gr.Image(label="输入图片", type="numpy")
            btn = gr.Button("开始检测", variant="primary")
            gr.Markdown("### 检测参数（拖动实时生效）")
            person_slider = gr.Slider(0.0, 0.9, value=DEFAULT["person"], step=0.05,
                                      label="person 置信度阈值（调低→检出更多，默认0.70）")
            vis_slider = gr.Slider(0.0, 0.5, value=DEFAULT["vis"], step=0.01,
                                   label="踝关节可见性阈值（调低→更多脚框，默认0.05）")
            face_slider = gr.Slider(0.0, 0.9, value=DEFAULT["face"], step=0.05,
                                    label="face 置信度阈值（默认0.60）")
            iou_slider = gr.Slider(0.1, 0.9, value=DEFAULT["iou"], step=0.05,
                                   label="NMS 去重阈值（默认0.30）")
        with gr.Column(scale=1):
            out_img = gr.Image(label="检测结果", type="numpy")
            out_txt = gr.Textbox(label="检测明细", lines=12)

    inputs = [inp, face_slider, person_slider, vis_slider, iou_slider]
    btn.click(process_image, inputs=inputs, outputs=[out_img, out_txt])
    for s in (face_slider, person_slider, vis_slider, iou_slider):
        s.change(process_image, inputs=inputs, outputs=[out_img, out_txt])
    inp.change(process_image, inputs=inputs, outputs=[out_img, out_txt])


if __name__ == "__main__":
    port = find_free_port() or 7860
    url = f"http://127.0.0.1:{port}"
    print("=" * 50)
    print(f"界面已启动，请用浏览器打开：{url}")
    if port != 7860:
        print(f"（说明：默认端口 7860 已被占用，已自动改用端口 {port}）")
    print("=" * 50)
    demo.launch(server_name="127.0.0.1", server_port=port, inbrowser=True)
#（注：内容由AI生成）
