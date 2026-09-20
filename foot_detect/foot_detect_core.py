# -*- coding: utf-8 -*-
"""
FootTrackNet 检测核心模块（Win10 可用）
- 检测：face / person
- 脚部定位：解码 person 的 17 个关键点（含左右踝关节），在踝关节下方派生"脚部框"
参考解码逻辑：Qualcomm ai-hub-models qai_hub_models/models/foot_track_net/app.py
"""
import os
import shutil
import tempfile
import urllib.request
import zipfile
import numpy as np

try:
    import ai_edge_litert.interpreter as tflite  # 新版 TFLite 运行时（优先）
    _BACKEND = "ai-edge-litert"
except ImportError:
    import tensorflow.lite as tflite              # 回退到 tensorflow
    _BACKEND = "tensorflow"

import cv2

# 模型下载源（高通官方 S3 资产，含 foot_track_net.tflite）
MODEL_ZIP_URL = ("https://qaihub-public-assets.s3.us-west-2.amazonaws.com/"
                 "qai-hub-models/models/foot_track_net/releases/v0.46.0/"
                 "foot_track_net-tflite-w8a8.zip")
MIN_MODEL_SIZE = 1_000_000  # 有效模型约 2.7MB，小于 1MB 视为损坏/无效

INPUT_H, INPUT_W = 480, 640   # 模型输入尺寸
STRIDE = 4                    # 输出特征图相对输入的步长
HM_H, HM_W = 120, 160         # 特征图尺寸
N_LMK = 17                    # 关键点数

# heatmap 三通道顺序：0=face 1=person 2=third(官方 demo 不使用，语义不可靠)
CLASS_NAMES = ["face", "person"]
# person 17 关键点名称（COCO 风格，由模型解码顺序给出）
LMK_NAMES = ["nose", "leye", "reye", "lear", "rear",
             "lsho", "rsho", "lelb", "relb", "lwri", "rwri",
             "lhip", "rhip", "lknee", "rknee", "lankle", "rankle"]
# 脚部相关关键点索引
ANKLE_IDX = [15, 16]          # lankle / rankle
KNEE_IDX = [13, 14]

COLORS = {
    "person": (255, 0, 0),     # BGR 红
    "foot": (0, 170, 0),       # BGR 绿
    "landmark": (0, 200, 255), # BGR 黄
    "face": (255, 170, 0),     # BGR 蓝绿
}


def _dequant(t: np.ndarray, scale: float, zp: float) -> np.ndarray:
    return (t.astype(np.float32) - zp) * scale


def _find_any_tflite(search_root: str):
    """在目录树中查找第一个有效的 .tflite 模型文件"""
    for root, _, files in os.walk(search_root):
        for f in files:
            if f.lower().endswith(".tflite"):
                p = os.path.join(root, f)
                try:
                    if os.path.getsize(p) > MIN_MODEL_SIZE:
                        return p
                except OSError:
                    continue
    return None


def ensure_model_file(model_path: str):
    """
    确保模型文件存在且有效（>1MB）。
    策略：已有效则直接用；否则自动在整个脚本目录树中搜索可用的 .tflite；
    再否则从高通官方地址自动下载并解压。
    返回 (model_path 或 None, 状态说明)
    """
    if os.path.exists(model_path) and os.path.getsize(model_path) > MIN_MODEL_SIZE:
        return model_path, f"模型文件已就绪：{model_path}"

    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(model_path)))
    target_dir = os.path.dirname(os.path.abspath(model_path))

    # 1) 自动搜索脚本目录下任何可用的 tflite 模型（用户可能把模型放到了别处）
    found = _find_any_tflite(base_dir)
    if found:
        try:
            os.makedirs(target_dir, exist_ok=True)
            shutil.copy(found, model_path)
            return model_path, f"已在 {found} 找到模型，已复制到 {model_path}"
        except OSError as e:
            return None, f"找到模型但复制失败：{e}"

    # 2) 自动下载
    print("[FootTrackNet] 未找到有效模型文件（应约 2.7MB），正在自动下载，请稍候...")
    tmp = tempfile.mkdtemp()
    try:
        zip_path = os.path.join(tmp, "model.zip")
        urllib.request.urlretrieve(MODEL_ZIP_URL, zip_path)
        with zipfile.ZipFile(zip_path) as z:
            z.extractall(tmp)
        tflite_file = _find_any_tflite(tmp)
        if tflite_file:
            os.makedirs(target_dir, exist_ok=True)
            shutil.copy(tflite_file, model_path)
            return model_path, f"自动下载完成，模型已保存到 {model_path}"
        return None, "下载的压缩包内未找到 tflite 模型"
    except Exception as e:
        return None, f"自动下载失败：{e}"
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


class FootTrackNetDetector:
    """FootTrackNet 检测器：加载 tflite 模型并实现完整预处理/推理/后处理"""

    def __init__(self, model_path: str, score_thr=(0.6, 0.7), iou_thr=0.3):
        self.model_path, msg = ensure_model_file(model_path)
        if not self.model_path:
            raise RuntimeError(
                "无法获取有效的模型文件：\n" + msg +
                "\n请确认脚本目录下存在 foot_track_net-tflite-w8a8/foot_track_net.tflite"
                "（约 2.7MB），或检查网络后重试（脚本会自动下载）。")
        print(f"[FootTrackNet] {msg}")
        self.score_thr = score_thr          # (face, person)
        self.iou_thr = iou_thr
        self.interp = tflite.Interpreter(model_path=self.model_path, num_threads=4)
        self.interp.allocate_tensors()
        self.inp = self.interp.get_input_details()[0]
        self.outs = {d["name"]: d for d in self.interp.get_output_details()}

    # ---------- 预处理 ----------
    def preprocess(self, img_bgr: np.ndarray):
        """letterbox 缩放至 640x480，返回 (输入张量, scale, (pad_l, pad_t))"""
        h, w = img_bgr.shape[:2]
        scale = min(INPUT_W / w, INPUT_H / h)
        nw, nh = int(round(w * scale)), int(round(h * scale))
        resized = cv2.resize(img_bgr, (nw, nh), interpolation=cv2.INTER_LINEAR)
        canvas = np.zeros((INPUT_H, INPUT_W, 3), dtype=np.uint8)
        pad_l, pad_t = (INPUT_W - nw) // 2, (INPUT_H - nh) // 2
        canvas[pad_t:pad_t + nh, pad_l:pad_l + nw] = resized
        return canvas[None].astype(np.uint8), scale, (pad_l, pad_t)

    # ---------- 推理 ----------
    def infer(self, tensor: np.ndarray):
        self.interp.set_tensor(self.inp["index"], tensor)
        self.interp.invoke()
        heat = _dequant(
            self.interp.get_tensor(self.outs["heatmap"]["index"]),
            0.00390625, 0)[0]                                  # [120,160,3]
        bbox = _dequant(
            self.interp.get_tensor(self.outs["bbox"]["index"]),
            0.34924495220184326, 81)[0]                        # [120,160,12]
        lmark = _dequant(
            self.interp.get_tensor(self.outs["landmark"]["index"]),
            2.1704514026641846, 114)[0]                        # [120,160,34]
        lvis = _dequant(
            self.interp.get_tensor(self.outs["landmark_visibility"]["index"]),
            0.00390625, 0)[0]                                  # [120,160,17]
        return heat, bbox, lmark, lvis

    # ---------- 后处理 ----------
    @staticmethod
    def _nms(dets, iou_thr=0.3):
        dets = sorted(dets, key=lambda d: -d[4])
        keep = []
        for d in dets:
            x1, y1, x2, y2, _ = d
            dup = False
            for k in keep:
                kx1, ky1, kx2, ky2, _ = k
                ix1, iy1 = max(x1, kx1), max(y1, ky1)
                ix2, iy2 = min(x2, kx2), min(y2, ky2)
                iw, ih = max(0, ix2 - ix1), max(0, iy2 - iy1)
                inter = iw * ih
                uni = (x2 - x1) * (y2 - y1) + (kx2 - kx1) * (ky2 - ky1) - inter
                if uni > 0 and inter / uni > iou_thr:
                    dup = True
                    break
            if not dup:
                keep.append(d)
        return keep

    def decode(self, heat, bbox, lmark, lvis):
        """解码 face / person 框 + person 关键点（坐标为 640x480 画布像素）"""
        dets = {0: [], 1: []}
        for c in (0, 1):
            hm = heat[..., c]
            flat = hm.reshape(-1)
            idx = np.argsort(-flat)[:500]
            thr = self.score_thr[c]
            for k in idx:
                sc = float(flat[k])
                if sc <= thr:
                    continue
                cy, cx = k // HM_W, k % HM_W
                x1, y1, x2, y2 = bbox[cy, cx, c * 4:(c + 1) * 4]
                x1, y1, x2, y2 = (np.array([cx, cy, cx, cy]) +
                                  np.array([-x1, -y1, x2, y2])) * STRIDE
                dets[c].append((float(x1), float(y1), float(x2), float(y2), sc))
        dets[0] = self._nms(dets[0], self.iou_thr)
        dets[1] = self._nms(dets[1], self.iou_thr)

        # person 关键点：取每个 person 检测峰值处的 landmark
        persons = []
        for x1, y1, x2, y2, sc in dets[1]:
            # 峰值位置 = 框中心对应的热图格
            cx, cy = int(round((x1 + x2) / 2 / STRIDE)), int(round((y1 + y2) / 2 / STRIDE))
            cx = min(max(cx, 0), HM_W - 1)
            cy = min(max(cy, 0), HM_H - 1)
            lm = lmark[cy, cx]
            xs = (lm[:N_LMK] + cx) * STRIDE
            ys = (lm[N_LMK:] + cy) * STRIDE
            vis = lvis[cy, cx]
            kps = [(float(xs[i]), float(ys[i]), float(vis[i])) for i in range(N_LMK)]
            persons.append((x1, y1, x2, y2, sc, kps))
        return dets[0], persons

    # ---------- 脚部框派生 ----------
    @staticmethod
    def derive_foot_boxes(person):
        """根据 person 框与踝关节派生脚部框：脚踝下方至 person 框底"""
        x1, y1, x2, y2, sc, kps = person
        w = x2 - x1
        foot_boxes = []
        for ai in ANKLE_IDX:
            ax, ay, vis = kps[ai]
            if vis < 0.05 or ax <= 0 or ay <= 0:
                continue
            half_w = max(w * 0.14, 12.0)          # 脚宽约 person 宽的 28%
            top = ay                              # 从踝关节开始
            bottom = max(y2, ay + 10)             # 到 person 框底部
            fb = (ax - half_w, top, ax + half_w, bottom)
            foot_boxes.append((fb, kps[ai], vis))
        return foot_boxes

    # ---------- 画图 ----------
    @staticmethod
    def draw(img_bgr, faces, persons, foot_boxes_list, scale, pad):
        """在原始输入图上绘制（坐标从 640x480 画布映射回原图）"""
        out = img_bgr.copy()
        h, w = img_bgr.shape[:2]
        pad_l, pad_t = pad

        def unpad(v, axis_len):
            return int(round((v - (pad_l if axis_len == 0 else pad_t)) / scale))

        def draw_box(x1, y1, x2, y2, color, label):
            X1, Y1 = unpad(x1, 0), unpad(y1, 1)
            X2, Y2 = unpad(x2, 0), unpad(y2, 1)
            X1, Y1 = max(0, X1), max(0, Y1)
            X2, Y2 = min(w, X2), min(h, Y2)
            cv2.rectangle(out, (X1, Y1), (X2, Y2), color, 2)
            if label:
                cv2.putText(out, label, (X1, max(Y1 - 6, 12)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2, cv2.LINE_AA)

        for x1, y1, x2, y2, sc in faces:
            draw_box(x1, y1, x2, y2, COLORS["face"], f"face {sc:.2f}")

        for (x1, y1, x2, y2, sc, kps), fbs in zip(persons, foot_boxes_list):
            draw_box(x1, y1, x2, y2, COLORS["person"], f"person {sc:.2f}")
            for fb, (ax, ay, avis), vis in fbs:
                draw_box(*fb, COLORS["foot"], f"foot {vis:.2f}")
                cv2.circle(out, (unpad(ax, 0), unpad(ay, 1)), 6, COLORS["landmark"], -1)
        return out

    # ---------- 端到端 ----------
    def detect(self, img_bgr: np.ndarray):
        """输入 BGR 图，返回 (标注图 BGR, 结构化结果 dict)"""
        tensor, scale, pad = self.preprocess(img_bgr)
        heat, bbox, lmark, lvis = self.infer(tensor)
        faces, persons = self.decode(heat, bbox, lmark, lvis)
        foot_boxes_list = [self.derive_foot_boxes(p) for p in persons]
        annotated = self.draw(img_bgr, faces, persons, foot_boxes_list, scale, pad)

        result = {
            "backend": _BACKEND,
            "faces": [{"box": [round(v) for v in b[:4]], "score": round(b[4], 3)}
                      for b in faces],
            "persons": [],
        }
        for (x1, y1, x2, y2, sc, kps), fbs in zip(persons, foot_boxes_list):
            result["persons"].append({
                "box": [round(x1), round(y1), round(x2), round(y2)],
                "score": round(sc, 3),
                "foot_boxes": [[round(v) for v in fb] for fb, _, _ in fbs],
                "ankles": [{"name": LMK_NAMES[ai], "x": round(ax), "y": round(ay),
                            "visibility": round(av, 3)}
                           for ai, (ax, ay, av) in
                           zip(ANKLE_IDX, [kps[i] for i in ANKLE_IDX])],
            })
        return annotated, result


if __name__ == "__main__":
    # 自测：加载模型并打印信息（无测试图时可仅验证模型加载）
    model = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                         "foot_track_net-tflite-w8a8", "foot_track_net.tflite")
    det = FootTrackNetDetector(model)
    print("模型加载 OK，后端:", _BACKEND)
    test_img = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_input.jpg")
    if os.path.exists(test_img):
        img = cv2.imread(test_img)
        ann, res = det.detect(img)
        print("faces:", res["faces"])
        for p in res["persons"]:
            print("person:", p["box"], "score:", p["score"],
                  "feet:", p["foot_boxes"], "ankles:", p["ankles"])
        cv2.imwrite(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                 "test_output.jpg"), ann)
        print("已输出 test_output.jpg")
    else:
        print("（未找到 test_input.jpg，跳过检测演示；模型加载验证通过）")
#（注：内容由AI生成）
