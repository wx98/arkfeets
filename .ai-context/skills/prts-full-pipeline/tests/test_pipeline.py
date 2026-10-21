import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
from prts_deliver import collect_files
from prts_merge_hints import merge_hints
import prts_operator_info
from prts_paths import CONTEXT_DIR, HINTS_JSON, IMAGE_DIR, OPERATORS_JSON, WIKI_CACHE_DIR, WORK_DIR, prepare_workspace


class PipelineTest(unittest.TestCase):
    def test_paths_separate_disposable_and_committable_data(self):
        self.assertEqual(IMAGE_DIR, WORK_DIR / "operators")
        self.assertEqual(WIKI_CACHE_DIR, CONTEXT_DIR / "wiki_cache")
        self.assertEqual(HINTS_JSON, CONTEXT_DIR / "hints_merged.json")
        self.assertEqual(OPERATORS_JSON, CONTEXT_DIR / "prts_operators.json")

    def test_hint_patch_preserves_other_operators(self):
        self.assertEqual(merge_hints({"旧干员": "旧提示"}, {"新干员": "新提示"}), {"旧干员": "旧提示", "新干员": "新提示"})
        with self.assertRaises(ValueError):
            merge_hints({}, {"新干员": "新干员的提示"})
        with self.assertRaises(ValueError):
            merge_hints({}, {"新干员": "提示" * 16})

    def test_delivery_requires_metadata_and_rejects_flat_name_collisions(self):
        prepare_workspace()
        with tempfile.TemporaryDirectory(dir=WORK_DIR / "temp") as temporary:
            root = Path(temporary)
            images = root / "operators"
            wiki = root / "wiki_cache"
            images.mkdir()
            wiki.mkdir()
            first = images / "甲"
            first.mkdir()
            (first / "甲.png").write_bytes(b"png")
            with self.assertRaisesRegex(ValueError, "缺少同名信息文件"):
                collect_files(images, wiki)
            (first / "甲.json").write_text("{}", encoding="utf-8")
            (wiki / "甲.wikitext").write_text("wiki", encoding="utf-8")
            self.assertEqual(set(collect_files(images, wiki)), {"甲.png", "甲.json", "甲.wikitext"})
            second = images / "乙"
            second.mkdir()
            (second / "甲.png").write_bytes(b"png")
            (second / "甲.json").write_text("{}", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "平铺文件名冲突"):
                collect_files(images, wiki)
            self.assertEqual(set(collect_files(images, wiki, {"甲"})), {"甲.png", "甲.json", "甲.wikitext"})

    def test_incremental_operator_fetch_keeps_existing_records(self):
        prepare_workspace()
        with tempfile.TemporaryDirectory(dir=WORK_DIR / "temp") as temporary:
            root = Path(temporary)
            curated = root / "curated.json"
            curated.write_text(json.dumps([{"名称": "旧干员", "职业": "先锋"}], ensure_ascii=False), encoding="utf-8")
            with patch.object(prts_operator_info, "ROOT", str(root)), \
                 patch.object(prts_operator_info, "OPERATORS_JSON", curated), \
                 patch.object(prts_operator_info, "fetch_wikitext", return_value="|稀有度=5\n|职业=近卫\n"), \
                 patch.object(prts_operator_info.time, "sleep"), \
                 patch.object(sys, "argv", ["prts_operator_info.py", "--names", "新干员", "--merge"]):
                prts_operator_info.main()
            records = json.loads(curated.read_text(encoding="utf-8"))
            self.assertEqual([row["名称"] for row in records], ["旧干员", "新干员"])
            self.assertEqual(records[1]["星级"], 6)


if __name__ == "__main__":
    unittest.main()
