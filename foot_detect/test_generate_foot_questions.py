import unittest
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import cv2
import numpy as np

import analyze_batch
from generate_foot_questions import expand_crop, flatten_tags, foot_crop, question_id
from analyze_batch import matching_feet


class FootQuestionGenerationTests(unittest.TestCase):
    def test_crop_contains_both_feet_and_uses_average_center(self):
        image = np.zeros((1024, 1024, 3), dtype=np.uint8)
        person = {
            "box": [120, 10, 500, 460],
            "score": 0.9,
            "foot_boxes": [[240, 340, 260, 370], [300, 345, 320, 375]],
        }
        crop = foot_crop(image, [person])
        scale = min(640 / 1024, 480 / 1024)
        pad_left = (640 - round(1024 * scale)) // 2
        pad_top = (480 - round(1024 * scale)) // 2
        for x1, y1, x2, y2 in person["foot_boxes"]:
            self.assertLessEqual(crop["x"], (x1 - pad_left) / scale)
            self.assertLessEqual(crop["y"], (y1 - pad_top) / scale)
            self.assertGreaterEqual(crop["x"] + crop["width"], (x2 - pad_left) / scale)
            self.assertGreaterEqual(crop["y"] + crop["height"], (y2 - pad_top) / scale)
        expected_center_x = ((240 + 260) / 2 + (300 + 320) / 2) / 2
        expected_center_x = (expected_center_x - pad_left) / scale
        self.assertAlmostEqual(crop["x"] + crop["width"] / 2, expected_center_x, delta=1)

    def test_crop_accepts_single_foot_and_rejects_no_foot(self):
        image = np.zeros((480, 640, 3), dtype=np.uint8)
        crop = foot_crop(image, [{"score": 0.9, "box": [1, 1, 100, 100], "foot_boxes": [[30, 40, 50, 60]]}])
        self.assertLessEqual(crop["x"], 30)
        self.assertLessEqual(crop["y"], 40)
        self.assertGreaterEqual(crop["x"] + crop["width"], 50)
        self.assertGreaterEqual(crop["y"] + crop["height"], 60)
        with self.assertRaisesRegex(ValueError, "脚部"):
            foot_crop(image, [{"score": 0.9, "foot_boxes": []}])

    def test_expand_crop_doubles_size_and_clamps_to_image(self):
        original = {"x": 80, "y": 75, "width": 20, "height": 30, "sourceWidth": 100, "sourceHeight": 100}
        expanded = expand_crop(original, 2)
        self.assertEqual(expanded, {
            "x": 60, "y": 40, "width": 40, "height": 60, "sourceWidth": 100, "sourceHeight": 100,
        })

    def test_metadata_helpers(self):
        self.assertEqual(question_id("阿 1-脚"), "阿-1-脚")
        self.assertEqual(flatten_tags([{"职业": "特种"}, {"星级": "6星"}]), ["职业:特种", "星级:6星"])

    def test_diagnosis_never_combines_person_and_ankles_from_different_people(self):
        diag = {"person_candidates": [
            {"score": 0.8, "ankles": [0.02, -1]},
            {"score": 0.4, "ankles": [0.8, 0.9]},
        ]}
        self.assertEqual(matching_feet(diag, 0.6, 0.1), 0)
        self.assertEqual(matching_feet(diag, 0.4, 0.1), 2)

    def test_diagnosis_reads_unicode_image_path(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "中文图片.png"
            cv2.imencode(".png", np.zeros((2, 2, 3), dtype=np.uint8))[1].tofile(str(path))
            result = {"max_person": 0.8, "max_face": 0.1,
                      "max_ankle_vis": 0.7, "n_ankles": 2,
                      "person_candidates": [{"score": 0.8, "ankles": [0.7, 0.6]}]}
            with patch.object(analyze_batch, "_DET", SimpleNamespace(diagnose=lambda image: result), create=True):
                row = analyze_batch._worker_diagnose(str(path))
            self.assertEqual(row[-1], "正常")
            self.assertEqual(row[1], 0.8)


if __name__ == "__main__":
    unittest.main()
