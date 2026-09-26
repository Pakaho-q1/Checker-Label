import os
import sys
import json
import shutil
import tempfile
import unittest
from pathlib import Path

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from core.web.dataset_manager import DatasetManager
from PIL import Image


class TestDatasetManagerAtomicTmp(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp(prefix="test_dataset_manager_")
        self.images_dir = Path(self.test_dir) / "images"
        self.labels_dir = Path(self.test_dir) / "labels"
        self.images_dir.mkdir(parents=True)
        self.labels_dir.mkdir(parents=True)

        # Create dummy images
        for i in range(3):
            img_path = self.images_dir / f"sample_{i:03d}.jpg"
            img = Image.new("RGB", (640, 480), color=(100 + i * 20, 100, 100))
            img.save(img_path)

        # Create classes.txt
        classes_path = self.labels_dir / "classes.txt"
        classes_path.write_text("cat\ndog\ncar\n", encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_tmp_directory_created(self):
        dm = DatasetManager(str(self.images_dir), str(self.labels_dir))
        self.assertTrue(dm.tmp_dir.exists())
        self.assertEqual(dm.tmp_dir.name, ".label_tmp")

    def test_save_item_atomic_and_tmp_isolation(self):
        dm = DatasetManager(str(self.images_dir), str(self.labels_dir))

        # Perform save
        shapes = [
            {
                "label": "cat",
                "points": [[10, 10], [50, 50]],
                "shape_type": "rectangle"
            }
        ]
        res = dm.save_item(
            idx=0,
            shapes=shapes,
            confirmed=True,
            expected_stem="sample_000"
        )
        self.assertEqual(res["status"], "success")

        # Verify target JSON exists and is valid
        target_json = self.labels_dir / "sample_000.json"
        self.assertTrue(target_json.exists())
        with open(target_json, "r", encoding="utf-8") as f:
            data = json.load(f)
        self.assertEqual(data["checked"], True)
        self.assertEqual(len(data["shapes"]), 1)
        self.assertEqual(data["shapes"][0]["label"], "cat")

        # Verify no .tmp files left in labels_dir or .label_tmp
        label_tmp_files = list(dm.tmp_dir.glob("*.tmp"))
        self.assertEqual(len(label_tmp_files), 0, "No stale .tmp should remain after successful save")

        root_tmp_files = list(self.labels_dir.glob("*.tmp"))
        self.assertEqual(len(root_tmp_files), 0, "No .tmp should ever be written directly in labels_dir")

        # Verify SQLite DB is updated
        item = dm.get_item(0)
        self.assertTrue(item["confirmed"])
        self.assertEqual(len(item["shapes"]), 1)
        self.assertEqual(item["shapes"][0]["label"], "cat")

    def test_cleanup_stale_tmp_on_startup(self):
        # Pre-create a stale .tmp file in .label_tmp as if a crash happened
        tmp_dir = self.labels_dir / ".label_tmp"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        stale_file = tmp_dir / "orphaned_crash_12345.tmp"
        stale_file.write_text("corrupted json {", encoding="utf-8")
        self.assertTrue(stale_file.exists())

        # Starting DatasetManager should clean it up
        dm = DatasetManager(str(self.images_dir), str(self.labels_dir))
        self.assertFalse(stale_file.exists(), "Stale .tmp file should be cleaned up on DatasetManager init")

    def test_multi_class_and_status_filtering(self):
        dm = DatasetManager(str(self.images_dir), str(self.labels_dir))
        # Item 0: cat, confirmed=True
        dm.save_item(0, [{"label": "cat", "points": [[10, 10], [50, 50]], "shape_type": "rectangle"}], confirmed=True)
        # Item 1: dog, confirmed=False
        dm.save_item(1, [{"label": "dog", "points": [[20, 20], [60, 60]], "shape_type": "rectangle"}], confirmed=False)
        # Item 2: cat + car, confirmed=False
        dm.save_item(2, [
            {"label": "cat", "points": [[5, 5], [25, 25]], "shape_type": "rectangle"},
            {"label": "car", "points": [[30, 30], [80, 80]], "shape_type": "rectangle"}
        ], confirmed=False)

        # Filter by class only: cat -> should return [0, 2]
        cats = dm.get_filter_indices(status="all", classes=["cat"])
        self.assertEqual(cats, [0, 2])

        # Filter by status unverified + class cat -> should return [2] only
        unverified_cats = dm.get_filter_indices(status="unverified", classes=["cat"])
        self.assertEqual(unverified_cats, [2])

        # Filter by status verified + class cat -> should return [0]
        verified_cats = dm.get_filter_indices(status="verified", classes=["cat"])
        self.assertEqual(verified_cats, [0])

        # Multi-class: dog or car -> should return [1, 2]
        dog_or_car = dm.get_filter_indices(status="all", classes=["dog", "car"])
        self.assertEqual(dog_or_car, [1, 2])

        # Save Item 1 as empty shapes (negative), confirmed=False (unverified)
        dm.save_item(1, [], confirmed=False)
        # Filter unverified + negative (both checkboxes checked) -> should return [1]
        unverified_negative = dm.get_filter_indices(status=["unverified", "negative"])
        self.assertEqual(unverified_negative, [1])

        # Filter comma-separated string "unverified,negative" -> should return [1]
        unverified_negative_str = dm.get_filter_indices(status="unverified,negative")
        self.assertEqual(unverified_negative_str, [1])

    def test_confidence_range_filtering(self):
        dm = DatasetManager(str(self.images_dir), str(self.labels_dir))
        # Item 0: high-confidence cat (score 0.85)
        dm.save_item(0, [
            {"label": "cat", "score": 0.85, "points": [[10, 10], [50, 50]], "shape_type": "rectangle"}
        ], confirmed=True)

        # Item 1: low-confidence cat candidate (score 0.35 in raw_shapes)
        dm.save_item(1, [], confirmed=False, raw_shapes=[
            {"label": "cat", "score": 0.35, "points": [[20, 20], [60, 60]], "shape_type": "rectangle"}
        ])

        # Item 2: low-confidence dog candidate (score 0.45 in raw_shapes)
        dm.save_item(2, [], confirmed=False, raw_shapes=[
            {"label": "dog", "score": 0.45, "points": [[15, 15], [45, 45]], "shape_type": "rectangle"}
        ])

        # 1. Filter class 'cat' with confidence range [0.00, 0.60] (include_low_conf=True by default) -> should return [1]
        low_cats = dm.get_filter_indices(classes=["cat"], conf_min=0.0, conf_max=0.60)
        self.assertEqual(low_cats, [1])

        # 2. Filter class 'cat' with [0.00, 0.60] and include_low_conf=False -> should return [] (candidate in raw_shapes only)
        low_cats_no_raw = dm.get_filter_indices(classes=["cat"], conf_min=0.0, conf_max=0.60, include_low_conf=False)
        self.assertEqual(low_cats_no_raw, [])

        # 3. Filter class 'cat' with confidence range [0.70, 1.00] -> should return [0]
        high_cats = dm.get_filter_indices(classes=["cat"], conf_min=0.70, conf_max=1.00)
        self.assertEqual(high_cats, [0])

        # 4. Filter class 'dog' with confidence range [0.00, 0.60] -> should return [2]
        low_dogs = dm.get_filter_indices(classes=["dog"], conf_min=0.0, conf_max=0.60)
        self.assertEqual(low_dogs, [2])

        # 5. Filter class 'dog' with [0.00, 0.60] and include_low_conf=False -> should return []
        low_dogs_no_raw = dm.get_filter_indices(classes=["dog"], conf_min=0.0, conf_max=0.60, include_low_conf=False)
        self.assertEqual(low_dogs_no_raw, [])


if __name__ == "__main__":
    unittest.main()
