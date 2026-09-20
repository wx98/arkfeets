# -*- coding: utf-8 -*-
"""
FootTrackNet 脚部检测界面（Gradio 网页版）
- 上传一张图片 → 输出标注了 person / face / foot 框的图片
- 运行：python foot_detect_gui.py  →  浏览器打开 http://127.0.0.1:7860
- 依赖：ai-edge-litert（或 tensorflow）opencv-python numpy gradio
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


def process_image(image: np.ndarray | None):
    """Gradio 回调：输入 BGR 图，输出标注图 + 检测结果文本"""
    if image is None:
        return None, "请先上传图片"
    # gradio 传入的是 RGB，转回 BGR
    img_bgr = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)
    annotated, result = detector.detect(img_bgr)
    out_rgb = cv2.cvtColor(annotated, cv2.COLOR_BGR2RGB)

    lines = [f"推理后端: {result['backend']}",
             f"检测到 person × {len(result['persons'])}，face × {len(result['faces'])}"]
    for i, p in enumerate(result["persons"]):
        lines.append(f"  person{i+1}: {p['box']} score={p['score']}")
        for j, fb in enumerate(p["foot_boxes"]):
            lines.append(f"    foot{j+1}: {fb}")
        for a in p["ankles"]:
            if a["visibility"] > 0.05:
                lines.append(f"    {a['name']}: ({a['x']}, {a['y']}) vis={a['visibility']:.2f}")
    text = "\n".join(lines)
    return out_rgb, text


def process_image_bytes(img_bytes):
    """备用：接收字节流（如多图批量可自行循环调用）"""
    arr = np.frombuffer(img_bytes, dtype=np.uint8)
    img_bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img_bgr is None:
        return None, "图片解码失败"
    annotated, result = detector.detect(img_bgr)
    ok, enc = cv2.imencode(".jpg", annotated)
    return enc.tobytes(), json.dumps(result, ensure_ascii=False, indent=2)


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


with gr.Blocks(title="FootTrackNet 脚部检测") as demo:
    gr.Markdown(
        "## FootTrackNet 脚部检测\n"
        "上传一张图片，自动框选 **person（红）**、**face（橙）**、**foot（绿）**，并给出坐标。\n\n"
        "提示：脚部框由 person 关键点中的踝关节定位派生；建议上传人物较完整、脚部可见的图片。"
    )
    with gr.Row():
        with gr.Column():
            inp = gr.Image(label="输入图片", type="numpy")
            btn = gr.Button("开始检测", variant="primary")
        with gr.Column():
            out_img = gr.Image(label="检测结果", type="numpy")
    out_txt = gr.Textbox(label="检测明细", lines=10)
    btn.click(process_image, inputs=inp, outputs=[out_img, out_txt])
    inp.change(process_image, inputs=inp, outputs=[out_img, out_txt])


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
