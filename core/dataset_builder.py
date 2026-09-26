import os
import sys
import json
import shutil
from pathlib import Path
from typing import Dict, List, Tuple, Set, Optional
from collections import defaultdict, Counter
import yaml
from PIL import Image

# ปรับ encoding สำหรับ Windows console
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}

try:
    from tqdm import tqdm
except ImportError:
    def tqdm(iterable, desc="", unit=""):
        items = list(iterable)
        total = len(items)
        for idx, item in enumerate(items, 1):
            percent = (idx / total) * 100 if total > 0 else 100.0
            print(f"\r{desc}: {idx}/{total} [{percent:.1f}%]", end="", flush=True)
            yield item
        print()


def parse_split_ratio(split_str: str) -> Tuple[float, float, float]:
    """
    แปลงสตริง split ratio เช่น '70/20/10' หรือ '80-10-10' หรือ '80/20'
    ให้เป็น tuple (train_pct, val_pct, test_pct) ที่ normalize รวมกันได้ 1.0
    """
    clean_str = split_str.replace("-", "/").replace(":", "/").replace(",", "/")
    parts = [float(p.strip()) for p in clean_str.split("/") if p.strip()]

    if len(parts) == 2:
        train_val = parts[0], parts[1], 0.0
    elif len(parts) == 3:
        train_val = parts[0], parts[1], parts[2]
    else:
        raise ValueError(
            f"รูปแบบ Split ไม่ถูกต้อง: '{split_str}'. ควรรองรับรูปแบบเช่น '70/20/10', '80-10-10' หรือ '80/20'"
        )

    total = sum(train_val)
    if total <= 0:
        raise ValueError("ผลรวมของสัดส่วน Split ต้องมากกว่า 0")

    return train_val[0] / total, train_val[1] / total, train_val[2] / total


def detect_input_dirs(paths: List[str]) -> Tuple[Path, Path]:
    """
    วิเคราะห์ paths ที่ส่งมาจาก --source / --inputs:
    - ถ้าส่งมา 1 path: โฟลเดอร์นั้นมีทั้งรูปภาพและ json
    - ถ้าส่งมา 2 paths: ตรวจสอบว่า path ไหนคือ images และ path ไหนคือ jsons อัตโนมัติ
    """
    resolved_paths = [Path(p).resolve() for p in paths]
    for p in resolved_paths:
        if not p.exists():
            raise FileNotFoundError(f"ไม่พบโฟลเดอร์: {p}")
        if not p.is_dir():
            raise NotADirectoryError(f"พาธต้องเป็นโฟลเดอร์: {p}")

    if len(resolved_paths) == 1:
        return resolved_paths[0], resolved_paths[0]

    p1, p2 = resolved_paths[0], resolved_paths[1]
    
    # นับจำนวนภาพและ json ในทั้ง 2 โฟลเดอร์
    p1_images = sum(1 for f in p1.iterdir() if f.is_file() and f.suffix.lower() in IMAGE_EXTENSIONS)
    p1_jsons = sum(1 for f in p1.iterdir() if f.is_file() and f.suffix.lower() == ".json")

    p2_images = sum(1 for f in p2.iterdir() if f.is_file() and f.suffix.lower() in IMAGE_EXTENSIONS)
    p2_jsons = sum(1 for f in p2.iterdir() if f.is_file() and f.suffix.lower() == ".json")

    # ตัดสินว่าใครคือ image_dir ใครคือ json_dir
    if p1_images >= p2_images and p2_jsons >= p1_jsons:
        return p1, p2
    elif p2_images >= p1_images and p1_jsons >= p2_jsons:
        return p2, p1
    else:
        # Fallback: ดูจากชื่อโฟลเดอร์
        if "img" in p1.name.lower() or "image" in p1.name.lower():
            return p1, p2
        return p2, p1


def find_classes_file(specified: Optional[Path], candidate_dirs: List[Path]) -> Optional[Path]:
    """ค้นหาไฟล์ classes.txt อัตโนมัติจากพาธที่ระบุและโฟลเดอร์ที่เกี่ยวข้อง"""
    if specified and specified.exists():
        return specified

    # รายการชื่อไฟล์ที่มักจะใช้เก็บ class list
    target_names = ["classes.txt", "class.txt", "labels.txt"]
    for d in candidate_dirs:
        if not d:
            continue
        # ค้นในโฟลเดอร์ตรงๆ
        for name in target_names:
            c = d / name
            if c.exists():
                return c
        # ค้นในโฟลเดอร์แม่
        for name in target_names:
            c = d.parent / name
            if c.exists():
                return c

    # ค้นหาใน workspace root
    cwd = Path.cwd()
    for name in target_names:
        c = cwd / name
        if c.exists():
            return c

    return None


class JSONCache:
    def __init__(self, images_dir: Path, labels_dir: Path, classes_file: Optional[Path]):
        self.data_map = {}
        self.use_db = False
        
        try:
            from core.web.dataset_manager import DatasetManager
            import sqlite3
            print(f"🚀 [Speed Optimization] กำลังโหลดและซิงค์ข้อมูลด้วย DatasetManager (Multithreaded SQLite)...")
            
            # Use DatasetManager to guarantee DB is created and perfectly synced
            manager = DatasetManager(images_dir, labels_dir, classes_file)
            
            conn = manager._get_connection()
            conn.row_factory = sqlite3.Row
            rows = conn.execute("SELECT stem, width, height, confirmed, shapes_json FROM items").fetchall()
            for row in rows:
                shapes = json.loads(row["shapes_json"]) if row["shapes_json"] else []
                self.data_map[row["stem"]] = {
                    "imageWidth": row["width"],
                    "imageHeight": row["height"],
                    "checked": bool(row["confirmed"]),
                    "shapes": shapes
                }
            self.use_db = True
            print(f"⚡ โหลดแคชสำเร็จ {len(self.data_map)} รายการ อย่างรวดเร็ว!")
        except Exception as e:
            print(f"⚠️ ไม่สามารถซิงค์ DB ได้: {e} -> จะถอยกลับไปอ่านไฟล์ JSON โดยตรงทีละไฟล์")
            self.use_db = False
                
    def get_data(self, json_p: Path) -> dict:
        if self.use_db and json_p.stem in self.data_map:
            return self.data_map[json_p.stem]
        try:
            with open(json_p, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}

def load_classes(classes_file: Optional[Path], all_json_files: List[Path], candidate_dirs: Optional[List[Path]] = None, cache: Optional[JSONCache] = None) -> Tuple[List[str], Dict[str, int]]:
    """
    โหลดรายชื่อคลาสจากไฟล์ classes.txt หรือถ้าไม่มีจะดึงคลาสทั้งหมดที่มีใน JSONs
    """
    classes = []
    resolved_classes_file = find_classes_file(classes_file, candidate_dirs or [])
    if resolved_classes_file and resolved_classes_file.exists():
        print(f"📖 โหลดคลาสจากไฟล์: {resolved_classes_file}")
        with open(resolved_classes_file, "r", encoding="utf-8") as f:
            classes = [line.strip() for line in f if line.strip()]

    # สแกนหา class ที่อาจมีเพิ่มเติมใน json
    found_labels = set()
    for jf in all_json_files:
        try:
            data = cache.get_data(jf) if cache else {}
            if not data and not cache:
                with open(jf, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    
            for shape in data.get("shapes", []):
                lbl = shape.get("label")
                if lbl:
                    found_labels.add(str(lbl).strip())
        except Exception:
            continue

    for lbl in sorted(list(found_labels)):
        if lbl not in classes:
            classes.append(lbl)

    name_to_id = {name: idx for idx, name in enumerate(classes)}
    return classes, name_to_id


def greedy_multilabel_split(
    samples: List[Tuple],
    ratios: Tuple[float, float, float],
    prioritize_verified: bool = False
) -> Dict[str, List[Tuple]]:
    """
    Greedy Multi-label Stratified Split เพื่อเกลี่ยให้แต่ละ split มีการกระจายของทุก class
    ใกล้เคียงกับสัดส่วน target (train, val, test) มากที่สุด
    หาก prioritize_verified=True จะให้ความสำคัญกับไฟล์ที่ตรวจสอบแล้วลงใน Val/Test ก่อนเสมอ
    โดยไม่ทำให้เสียสมดุลการกระจายคลาส
    """
    r_train, r_val, r_test = ratios
    split_names = []
    split_weights = []
    if r_train > 0:
        split_names.append("train")
        split_weights.append(r_train)
    if r_val > 0:
        split_names.append("val")
        split_weights.append(r_val)
    if r_test > 0:
        split_names.append("test")
        split_weights.append(r_test)

    if not split_names or not samples:
        return {name: [] for name in (split_names or ["train"])}

    # ปรับ normalize ผลรวม weights ให้เท่ากับ 1.0
    total_w = sum(split_weights)
    if total_w > 0:
        split_weights = [w / total_w for w in split_weights]

    total_samples = len(samples)
    target_sizes = {s: round(total_samples * w) for s, w in zip(split_names, split_weights)}
    diff = total_samples - sum(target_sizes.values())
    if split_names:
        target_sizes[split_names[0]] += diff

    # คำนวณ class frequencies รวม
    class_total = Counter()
    for item in samples:
        labels = item[2]
        for lbl in set(labels):
            class_total[lbl] += 1

    # คำนวณ target count สำหรับแต่ละ class ในแต่ละ split
    target_counts = {
        name: {lbl: class_total[lbl] * weight for lbl in class_total}
        for name, weight in zip(split_names, split_weights)
    }

    current_counts = {name: Counter() for name in split_names}
    split_samples = {name: [] for name in split_names}

    # จัดลำดับ samples
    def sample_sort_key(item):
        labels = item[2]
        # หา rarity
        rarity = min((class_total[lbl] for lbl in labels), default=999999)
        # ถ้า prioritize_verified ให้ไฟล์ verified (item[3] == True) ถูกประมวลผลก่อน (ค่า 0)
        is_verified = item[3] if len(item) > 3 else False
        priority = 0 if (prioritize_verified and is_verified) else 1
        return (priority, rarity)

    sorted_samples = sorted(samples, key=sample_sort_key)

    for item in sorted_samples:
        labels = item[2]
        lbl_set = set(labels)
        is_verified = item[3] if len(item) > 3 else False

        best_split = None
        best_score = -float("inf")

        for s_name in split_names:
            cap_left = target_sizes[s_name] - len(split_samples[s_name])
            if cap_left <= 0:
                cap_factor = 0.05  # ป้องกันไม่ให้ split ที่เต็มแล้วแย่ง sample เพิ่ม
            else:
                cap_factor = cap_left / max(target_sizes[s_name], 1)

            if lbl_set:
                rel_deficit = 0.0
                can_bias = True
                for lbl in lbl_set:
                    t = target_counts[s_name][lbl]
                    c = current_counts[s_name][lbl]
                    if t > 0:
                        rel_deficit += (t - c) / t
                    else:
                        rel_deficit -= 1.0
                    
                    if c >= t:
                        can_bias = False

                score = rel_deficit * cap_factor
                
                # Bias พิเศษดึง verified เข้า Val/Test
                # โดยจะดึงก็ต่อเมื่อ "ทุกคลาส" ในภาพนั้นๆ ยังไม่ล้นโควต้าของ split นี้
                if prioritize_verified and is_verified and s_name in ["val", "test"]:
                    if can_bias:
                        score += 10.0
            else:
                score = cap_factor
                # ภาพไม่มี object ให้กระจายตามปกติ แต่ถ้า verified ให้อยู่ val/test (ถ้ายังไม่เต็ม)
                if prioritize_verified and is_verified and s_name in ["val", "test"]:
                    if cap_left > 0:
                        score += 10.0

            if score > best_score:
                best_score = score
                best_split = s_name

        if best_split is None:
            best_split = split_names[0]

        split_samples[best_split].append(item)
        for lbl in lbl_set:
            current_counts[best_split][lbl] += 1

    return split_samples


def split_dataset_with_verification(
    samples: List[Tuple[Path, Optional[Path], List[str], bool]],
    ratios: Tuple[float, float, float],
    prioritize_verified: bool = True,
    only_verified: bool = False,
    strict_val_test: bool = True
) -> Dict[str, List[Tuple[Path, Optional[Path], List[str], bool]]]:
    """
    แบ่งชุดข้อมูลตามสัดส่วน โดยจัดสรรไฟล์ที่ผ่านการยืนยันแล้ว (checked: true)
    ให้ไปเป็น Val และ Test ก่อนเสมอ แต่ "ต้องรักษา" สัดส่วน Class Distribution
    และเป้าหมายของ Train/Val/Test ให้สมดุลกันเสมอตามที่ระบุใน ratios (เช่น 80/10/10)
    """
    r_train, r_val, r_test = ratios

    if only_verified:
        verified_samples = [s for s in samples if s[3]]
        if not verified_samples:
            raise ValueError(
                "❌ ไม่พบไฟล์ที่ได้รับการยืนยัน (checked: true) เลยในชุดข้อมูล แต่มีการระบุ --only-verified"
            )
        print(f"🔒 [Mode: Only-Verified] ใช้เฉพาะไฟล์ที่ผ่านการตรวจสอบ {len(verified_samples)} ภาพเท่านั้น (ตัดภาพที่ยังไม่ตรวจออก)")
        return greedy_multilabel_split(verified_samples, ratios, prioritize_verified=False)

    verified_samples = [s for s in samples if s[3]]
    total_samples = len(samples)

    if not prioritize_verified or len(verified_samples) == 0:
        if len(verified_samples) == 0 and prioritize_verified:
            print("ℹ️  ไม่พบไฟล์ที่ได้รับการยืนยัน (checked: true) ในชุดข้อมูล -> ดำเนินการแบ่งข้อมูลทั้งหมดตามปกติ")
        else:
            print("ℹ️  โหมด Prioritize-Verified ปิดอยู่ -> ดำเนินการกระจายข้อมูลทั้งหมดตามปกติโดยไม่แยก Verified")
        return greedy_multilabel_split(samples, ratios, prioritize_verified=False)

    # กรณี prioritize_verified = True และมี verified_samples > 0
    print(f"🛡️  [Mode: Prioritize-Verified (Stratified Balanced)] พบไฟล์ยืนยันแล้ว {len(verified_samples)} ภาพ (จากทั้งหมด {total_samples} ภาพ)")
    print(f"  • จัดสรรไฟล์ Verified ลง Val และ Test ก่อน โดยยังคงรักษาสัดส่วนสมดุลของทุกคลาส (Train {r_train*100}%, Val {r_val*100}%, Test {r_test*100}%)")
    print(f"  • หากคลาสใดใน Val/Test ขาด Verified จะนำ Unverified มาเติมให้เต็มโควต้า")

    # ใช้ Greedy Multilabel Split โดยให้ bias ดึง verified เข้า val/test อย่างชาญฉลาด
    splits = greedy_multilabel_split(samples, ratios, prioritize_verified=True)

    # แสดงผลลัพธ์
    for s_name in ["train", "val", "test"]:
        if s_name in splits:
            v_count = sum(1 for item in splits[s_name] if item[3])
            u_count = len(splits[s_name]) - v_count
            print(f"    - {s_name.capitalize()}: {len(splits[s_name])} ภาพ (Verified {v_count}, Unverified {u_count})")

    return splits


def create_hardlink_or_copy(src: Path, dst: Path):
    """
    สร้าง hardlink จาก src ไปยัง dst หากปลายทางมีอยู่แล้วจะลบก่อน
    ถ้าทำ hardlink ล้มเหลว (เช่น ข้าม drive) จะ fallback เป็น copy
    """
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        try:
            dst.unlink()
        except Exception:
            pass

    try:
        os.link(src, dst)
    except OSError:
        # Fallback copy
        shutil.copy2(src, dst)


def convert_shape_to_yolo_line(
    shape: dict,
    img_w: int,
    img_h: int,
    name_to_id: Dict[str, int],
    task: str = "detect"
) -> Optional[str]:
    """
    แปลง shape จาก Annotation JSON เป็น YOLO line ตาม task:
    - detect: class_id xc yc w h
    - obb: class_id x1 y1 x2 y2 x3 y3 x4 y4 (normalized 0-1)
    """
    label = shape.get("label")
    if not label or label not in name_to_id:
        return None

    class_id = name_to_id[label]
    points = shape.get("points", [])
    if not points:
        return None

    shape_type = shape.get("shape_type", "").lower()

    if task == "obb":
        # กรณี OBB: ต้องการ 4 จุด (x1, y1, x2, y2, x3, y3, x4, y4)
        if len(points) == 2:
            # Rectangle: top-left, bottom-right -> แปลงเป็น 4 จุดรอบสี่เหลี่ยม
            x1, y1 = points[0]
            x2, y2 = points[1]
            min_x, max_x = min(x1, x2), max(x1, x2)
            min_y, max_y = min(y1, y2), max(y1, y2)
            obb_pts = [
                (min_x, min_y),
                (max_x, min_y),
                (max_x, max_y),
                (min_x, max_y),
            ]
        elif len(points) == 4:
            obb_pts = points
        else:
            # Polygon มากกว่า 4 จุด: คำนวณ min/max bbox หรือ 4 มุม
            xs = [p[0] for p in points]
            ys = [p[1] for p in points]
            min_x, max_x = min(xs), max(xs)
            min_y, max_y = min(ys), max(ys)
            obb_pts = [
                (min_x, min_y),
                (max_x, min_y),
                (max_x, max_y),
                (min_x, max_y),
            ]

        # Normalize ให้อยู่ในช่วง 0.0 - 1.0
        norm_coords = []
        for px, py in obb_pts:
            nx = max(0.0, min(1.0, px / img_w))
            ny = max(0.0, min(1.0, py / img_h))
            norm_coords.append(f"{nx:.6f} {ny:.6f}")

        return f"{class_id} " + " ".join(norm_coords)

    else:
        # กรณี Detect ปกติ (Bbox: xc, yc, w, h)
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]

        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)

        box_w = (max_x - min_x) / img_w
        box_h = (max_y - min_y) / img_h
        xc = (min_x + max_x) / (2.0 * img_w)
        yc = (min_y + max_y) / (2.0 * img_h)

        xc = max(0.0, min(1.0, xc))
        yc = max(0.0, min(1.0, yc))
        box_w = max(0.0, min(1.0, box_w))
        box_h = max(0.0, min(1.0, box_h))

        return f"{class_id} {xc:.6f} {yc:.6f} {box_w:.6f} {box_h:.6f}"


def build_dataset(
    source_paths: Optional[List[str]] = None,
    output_dir: Path = Path("datasets"),
    split_str: str = "70/20/10",
    task: str = "detect",
    classes_file: Optional[Path] = None,
    data_yaml_path: Optional[Path] = None,
    prioritize_verified: bool = True,
    only_verified: bool = False,
    strict_val_test: bool = True,
    xanylabeling_paths: Optional[List[str]] = None
):
    """
    ฟังก์ชันหลักในการสร้าง Dataset:
    1. ตรวจจับและจับคู่รูปภาพกับ Annotation JSON พร้อมตรวจสถานะการยืนยัน (checked: true)
    2. ทำ Stratified Split ตามสัดส่วน โดยจัดสรรไฟล์ที่ผ่านการตรวจสอบไปเป็น Val/Test เพื่อความแม่นยำสูงสุด
    3. ทำ Hardlink ไฟล์ภาพไปยัง datasets/images/<split>/
    4. แปลง JSON เป็น YOLO Text TXT ไปยัง datasets/labels/<split>/
    5. อัปเดต/สร้าง data.yaml ให้พร้อมสั่งเทรนได้ทันที
    """
    raw_paths = source_paths or xanylabeling_paths
    if not raw_paths:
        raise ValueError("จำเป็นต้องระบุพาธโฟลเดอร์รูปภาพและ Label ต้นทาง (--source)")

    print("=" * 70)
    print("🚀 [START] Building YOLO Dataset from Annotation JSONs")
    print("=" * 70)

    # 1. ตรวจสอบโฟลเดอร์อินพุต
    image_dir, json_dir = detect_input_dirs(raw_paths)
    print(f"📁 Images Source: {image_dir}")
    print(f"📁 JSONs Source:  {json_dir}")

    # 2. แปลง Split Ratio
    ratios = parse_split_ratio(split_str)
    print(f"📊 Target Split:  Train: {ratios[0]*100:.1f}% | Val: {ratios[1]*100:.1f}% | Test: {ratios[2]*100:.1f}%")
    print(f"🎯 Target Task:   {task.upper()} ({'4-point OBB' if task == 'obb' else 'Bounding Box'})")

    # 3. จับคู่ไฟล์ภาพและ JSON พร้อมตรวจหา Negative Samples (Background)
    image_map = {}
    for f in image_dir.iterdir():
        if f.is_file() and f.suffix.lower() in IMAGE_EXTENSIONS:
            image_map[f.stem] = f

    json_files = {f.stem: f for f in json_dir.glob("*.json")}

    # รวบรวม JSON ที่มีอยู่เพื่อหา class names
    all_valid_jsons = list(json_files.values())

    # สร้าง Cache เพื่อโหลดข้อมูลจาก DB (ถ้ามี) แทนการอ่านไฟล์รัวๆ
    cache = JSONCache(image_dir, json_dir, classes_file)

    # 4. โหลด Class Names
    classes, name_to_id = load_classes(classes_file, all_valid_jsons, candidate_dirs=[image_dir, json_dir], cache=cache)
    print(f"🏷️  Classes ({len(classes)}): {classes}")

    # 5. สกัด Labels จาก JSON และจับคู่ภาพ (รวมภาพ Negative และตรวจสอบสถานะ verified)
    samples_with_labels = []
    pure_neg_count = 0
    empty_json_count = 0
    pos_count = 0
    verified_count = 0

    for stem, img_p in image_map.items():
        json_p = json_files.get(stem)
        labels = []
        is_verified = False

        if json_p is not None:
            try:
                data = cache.get_data(json_p)
                is_verified = bool(data.get("checked", False) or data.get("verified", False))
                labels = [
                    shape.get("label")
                    for shape in data.get("shapes", [])
                    if shape.get("label") in name_to_id
                ]
            except Exception:
                labels = []
                is_verified = False

            if not labels:
                empty_json_count += 1
            else:
                pos_count += 1
        else:
            pure_neg_count += 1

        if is_verified:
            verified_count += 1

        samples_with_labels.append((img_p, json_p, labels, is_verified))

    total_samples = len(samples_with_labels)
    total_negatives = pure_neg_count + empty_json_count
    unverified_count = total_samples - verified_count

    print(f"🔍 สแกนพบรูปภาพทั้งหมด: {total_samples} ภาพ")
    print(f"  • Verified Images (ตรวจแล้ว):     {verified_count} ภาพ ({verified_count/total_samples*100:.1f}%)" if total_samples > 0 else "")
    print(f"  • Unverified Images (ยังไม่ตรวจ):  {unverified_count} ภาพ ({unverified_count/total_samples*100:.1f}%)" if total_samples > 0 else "")
    print(f"  • Positive Images (มี Object):     {pos_count} ภาพ")
    print(f"  • Negative Images (Background):    {total_negatives} ภาพ (ไม่มี JSON: {pure_neg_count}, JSON ว่าง: {empty_json_count})")
    if total_samples > 0:
        print(f"  💡 สัดส่วน Background: {total_negatives / total_samples * 100:.1f}%")

    # 6. ทำการแบ่งชุดข้อมูลตามสัดส่วนและการจัดสรร Verified
    splits_dict = split_dataset_with_verification(
        samples=samples_with_labels,
        ratios=ratios,
        prioritize_verified=prioritize_verified,
        only_verified=only_verified,
        strict_val_test=strict_val_test
    )

    # 7. เตรียมโครงสร้างโฟลเดอร์ปลายทาง
    output_dir = output_dir.resolve()
    images_base = output_dir / "images"
    labels_base = output_dir / "labels"

    # 8. เริ่มสร้าง Hardlink และสร้าง YOLO TXT
    split_stats = defaultdict(lambda: Counter())
    split_neg_stats = defaultdict(int)
    split_ver_stats = defaultdict(int)
    split_unver_stats = defaultdict(int)

    for split_name, items in splits_dict.items():
        if not items:
            continue

        split_img_dir = images_base / split_name
        split_lbl_dir = labels_base / split_name
        split_img_dir.mkdir(parents=True, exist_ok=True)
        split_lbl_dir.mkdir(parents=True, exist_ok=True)

        desc = f"Processing {split_name:5s}"
        for item in tqdm(items, desc=desc, unit="file"):
            img_p, json_p, labels = item[0], item[1], item[2]
            is_verified = item[3] if len(item) > 3 else False

            if is_verified:
                split_ver_stats[split_name] += 1
            else:
                split_unver_stats[split_name] += 1

            # A. ทำ Hardlink ภาพ
            dst_img = split_img_dir / img_p.name
            create_hardlink_or_copy(img_p, dst_img)

            # B. แปลงเป็น YOLO Line
            yolo_lines = []
            if json_p is not None and labels:
                try:
                    data = cache.get_data(json_p)

                    img_w = data.get("imageWidth")
                    img_h = data.get("imageHeight")
                    if not img_w or not img_h:
                        with Image.open(img_p) as im:
                            img_w, img_h = im.size

                    for shape in data.get("shapes", []):
                        line = convert_shape_to_yolo_line(shape, img_w, img_h, name_to_id, task=task)
                        if line:
                            yolo_lines.append(line)
                            lbl = shape.get("label")
                            split_stats[split_name][lbl] += 1
                except Exception as e:
                    print(f"[!] Warning: ไม่สามารถแปลง {json_p.name}: {e}")
            else:
                # Negative Sample (Background image) -> ไม่ต้องมีบรรทัด object ใน txt
                split_neg_stats[split_name] += 1

            # บันทึกไฟล์ txt (สำหรับ Negative จะได้ไฟล์ว่างเปล่า 0 bytes ตามสเปก YOLO)
            dst_lbl = split_lbl_dir / f"{img_p.stem}.txt"
            with open(dst_lbl, "w", encoding="utf-8") as lf:
                if yolo_lines:
                    lf.write("\n".join(yolo_lines))
                else:
                    lf.write("")

    # 9. สรุปผลตารางสถิติ (แบ่งเป็น 2 ตารางที่อ่านง่าย ชัดเจน และไม่ตกขอบจอ)
    active_splits = [s for s in ["train", "val", "test"] if s in splits_dict and splits_dict[s]]

    # ตารางที่ 1: ภาพรวมการจัดสรรชุดข้อมูล (Dataset Overview)
    h1 = f"{'Split':<8} | {'Images':>8} | {'Verified (%)':<16} | {'Unverified (%)':<16} | {'Neg (BG)':<14} | {'Total Bboxes':>12}"
    border1 = "=" * len(h1)
    print("\n" + border1)
    print("📊 [ตารางที่ 1] สรุปชุดข้อมูลแต่ละ Split (Dataset & Verification Overview)")
    print(border1)
    print(h1)
    print("-" * len(h1))

    total_all_img = sum(len(splits_dict[s]) for s in active_splits)
    total_all_ver = sum(split_ver_stats[s] for s in active_splits)
    total_all_unver = sum(split_unver_stats[s] for s in active_splits)
    total_all_neg = sum(split_neg_stats[s] for s in active_splits)
    total_all_bboxes = sum(sum(split_stats[s].values()) for s in active_splits)

    for s_name in active_splits:
        img_cnt = len(splits_dict[s_name])
        v_cnt = split_ver_stats[s_name]
        u_cnt = split_unver_stats[s_name]
        neg_cnt = split_neg_stats[s_name]
        b_cnt = sum(split_stats[s_name].values())
        v_pct = f"{v_cnt} ({v_cnt/img_cnt*100:.1f}%)" if img_cnt > 0 else "0 (0.0%)"
        u_pct = f"{u_cnt} ({u_cnt/img_cnt*100:.1f}%)" if img_cnt > 0 else "0 (0.0%)"
        neg_pct = f"{neg_cnt} ({neg_cnt/img_cnt*100:.1f}%)" if img_cnt > 0 else "0 (0.0%)"
        print(f"{s_name:<8} | {img_cnt:>8} | {v_pct:<16} | {u_pct:<16} | {neg_pct:<14} | {b_cnt:>12}")

    print("-" * len(h1))
    t_v_pct = f"{total_all_ver} ({total_all_ver/total_all_img*100:.1f}%)" if total_all_img > 0 else "0 (0.0%)"
    t_u_pct = f"{total_all_unver} ({total_all_unver/total_all_img*100:.1f}%)" if total_all_img > 0 else "0 (0.0%)"
    t_neg_pct = f"{total_all_neg} ({total_all_neg/total_all_img*100:.1f}%)" if total_all_img > 0 else "0 (0.0%)"
    print(f"{'Total':<8} | {total_all_img:>8} | {t_v_pct:<16} | {t_u_pct:<16} | {t_neg_pct:<14} | {total_all_bboxes:>12}")
    print(border1)

    # ตารางที่ 2: สถิติการกระจายของแต่ละ Class (Class Distribution Matrix)
    # แสดงเป็นตารางแนวตั้ง จัดเรียงตาม ID คลาส ทำให้อ่านง่ายและไม่ล้นหน้าจอไม่ว่าจะกี่คลาสก็ตาม
    if classes:
        max_c_len = max(max(len(c) for c in classes), len("Class Name"))
        split_cols_hdr = " | ".join(f"{s_name.capitalize() + ' (%)':<16}" for s_name in active_splits)
        h2 = f"{'ID':<4} | {'Class Name':<{max_c_len}} | {split_cols_hdr} | {'Total':>8}"
        border2 = "=" * len(h2)

        print("\n" + border2)
        print("🏷️  [ตารางที่ 2] สถิติการกระจายของแต่ละ Class (Class Distribution per Split)")
        print(border2)
        print(h2)
        print("-" * len(h2))

        for idx, c in enumerate(classes):
            c_total = sum(split_stats[s][c] for s in active_splits)
            split_vals = []
            for s in active_splits:
                cnt = split_stats[s][c]
                pct = f"{cnt/c_total*100:.1f}%" if c_total > 0 else "0.0%"
                split_vals.append(f"{cnt} ({pct})")
            split_cols_str = " | ".join(f"{v:<16}" for v in split_vals)
            print(f"{idx:<4} | {c:<{max_c_len}} | {split_cols_str} | {c_total:>8}")

        print(border2)

    # 10. สร้าง / อัปเดต data.yaml
    if data_yaml_path is None:
        data_yaml_path = output_dir.parent / "data.yaml"

    yaml_config = {
        "path": str(output_dir).replace("\\", "/"),
        "train": "images/train",
        "val": "images/val",
        "names": {idx: name for idx, name in enumerate(classes)}
    }
    if ratios[2] > 0 and (images_base / "test").exists():
        yaml_config["test"] = "images/test"

    with open(data_yaml_path, "w", encoding="utf-8") as yf:
        yaml.dump(yaml_config, yf, default_flow_style=False, sort_keys=False, allow_unicode=True)

    print(f"✅ บันทึก config สำเร็จ: {data_yaml_path}")
    print(f"🎉 สร้าง Dataset สำเร็จเรียบร้อย! มีทั้ง Positive และ Negative พร้อมเทรนทันที\n")
