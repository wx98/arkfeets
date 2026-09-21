import unittest

import numpy as np

from generate_foot_questions import expand_crop, flatten_tags, foot_crop, question_id


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

    def test_crop_rejects_single_foot(self):
        image = np.zeros((512, 512, 3), dtype=np.uint8)
        with self.assertRaisesRegex(ValueError, "双脚"):
            foot_crop(image, [{"score": 0.9, "foot_boxes": [[1, 2, 3, 4]]}])

    def test_expand_crop_doubles_size_and_clamps_to_image(self):
        original = {"x": 80, "y": 75, "width": 20, "height": 30, "sourceWidth": 100, "sourceHeight": 100}
        expanded = expand_crop(original, 2)
        self.assertEqual(expanded, {
            "x": 60, "y": 40, "width": 40, "height": 60, "sourceWidth": 100, "sourceHeight": 100,
        })

    def test_metadata_helpers(self):
        self.assertEqual(question_id("阿 1-脚"), "阿-1-脚")
        self.assertEqual(flatten_tags([{"职业": "特种"}, {"星级": "6星"}]), ["职业:特种", "星级:6星"])


if __name__ == "__main__":
    unittest.main()
