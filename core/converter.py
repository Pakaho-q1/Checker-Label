import json
from pathlib import Path
from PIL import Image
import yaml

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


def load_yaml_config(yaml_path: Path):
    if not yaml_path.exists():
        raise FileNotFoundError(f"ไม่พบไฟล์ YAML: {yaml_path}")

    with open(yaml_path, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)

    base_path_str = config.get("path", "")
    if base_path_str:
        base_path = Path(base_path_str)
        if not base_path.is_absolute():
            base_path = (yaml_path.parent / base_path).resolve()
    else:
        base_path = yaml_path.parent

    raw_names = config.get("names", {})
    if isinstance(raw_names, list):
        id_to_name = {idx: str(name) for idx, name in enumerate(raw_names)}
    else:
        id_to_name = {int(k): str(v) for k, v in raw_names.items()}

    name_to_id = {v: k for k, v in id_to_name.items()}

    split_pairs = []
    seen_dirs = set()

    for split_key in ["train", "val", "test"]:
        if split_key not in config:
            continue
        val = str(config[split_key]).strip().replace("\\", "/")
        val_path = Path(val)

        cand_img = (base_path / "images" / val_path.name).resolve()
        cand_lbl = (base_path / "labels" / val_path.name).resolve()
        if cand_img.exists() and cand_img.is_dir():
            if str(cand_img) not in seen_dirs:
                seen_dirs.add(str(cand_img))
                split_pairs.append((val_path.name, cand_img, cand_lbl))
            continue

        cand_img = (base_path / val_path).resolve()
        if cand_img.exists() and cand_img.is_dir():
            if cand_img.name == "images":
                cand_lbl = (cand_img.parent / "labels").resolve()
            elif (cand_img.parent.parent / "labels" / cand_img.name).exists():
                cand_lbl = (cand_img.parent.parent / "labels" / cand_img.name).resolve()
            else:
                cand_lbl = (cand_img.parent / "labels" / cand_img.name).resolve()

            if str(cand_img) not in seen_dirs:
                seen_dirs.add(str(cand_img))
                split_pairs.append((split_key, cand_img, cand_lbl))
            continue

    if not split_pairs:
        cand_img = (base_path / "images").resolve()
        cand_lbl = (base_path / "labels").resolve()
        if cand_img.exists() and cand_img.is_dir():
            split_pairs.append(("dataset", cand_img, cand_lbl))

    return base_path, id_to_name, name_to_id, split_pairs


def convert_text_to_json(base_path: Path, splits: list, id_to_name: dict, limit: int = None):
    print("\n--- [START] YOLO TXT -> Annotation JSON ---")
    for item in splits:
        if isinstance(item, tuple) and len(item) == 3:
            split, images_dir, labels_dir = item
        else:
            split = str(item)
            images_dir = base_path / "images" / split
            labels_dir = base_path / "labels" / split

        if not images_dir.exists():
            print(f"[!] ข้าม {split}: ไม่พบโฟลเดอร์ {images_dir}")
            continue

        image_files = [f for f in images_dir.iterdir() if f.suffix.lower() in IMAGE_EXTENSIONS]
        if not image_files:
            print(f"[!] ไม่มีรูปภาพใน {split} ({images_dir})")
            continue

        if limit and limit > 0:
            image_files = image_files[:limit]

        count = 0
        pbar = tqdm(image_files, desc=f"Converting {split:5s}", unit="img")

        for img_path in pbar:
            txt_path = labels_dir / f"{img_path.stem}.txt"
            try:
                with Image.open(img_path) as img:
                    img_w, img_h = img.size
            except Exception:
                continue

            shapes = []
            if txt_path.exists():
                with open(txt_path, "r", encoding="utf-8") as f:
                    for line in f:
                        parts = line.strip().split()
                        if len(parts) < 5:
                            continue

                        class_id = int(parts[0])
                        label_name = id_to_name.get(class_id, str(class_id))

                        if len(parts) == 5:
                            # Standard Bbox: xc yc w h
                            xc, yc, w, h = map(float, parts[1:5])
                            x1 = (xc - w / 2) * img_w
                            y1 = (yc - h / 2) * img_h
                            x2 = (xc + w / 2) * img_w
                            y2 = (yc + h / 2) * img_h
                            pts = [[round(x1, 2), round(y1, 2)], [round(x2, 2), round(y2, 2)]]
                            shape_type = "rectangle"
                        elif len(parts) == 9:
                            # OBB 4-point: x1 y1 x2 y2 x3 y3 x4 y4
                            coords = [float(x) for x in parts[1:9]]
                            pts = [
                                [round(coords[i] * img_w, 2), round(coords[i+1] * img_h, 2)]
                                for i in range(0, 8, 2)
                            ]
                            shape_type = "polygon"
                        else:
                            continue

                        shapes.append({
                            "label": label_name,
                            "score": None,
                            "points": pts,
                            "group_id": None,
                            "description": "",
                            "difficult": False,
                            "shape_type": shape_type,
                            "flags": {},
                            "attributes": {},
                        })

            json_data = {
                "version": "0.4.0",
                "flags": {},
                "shapes": shapes,
                "imagePath": img_path.name,
                "imageData": None,
                "imageHeight": img_h,
                "imageWidth": img_w,
            }

            out_json = images_dir / f"{img_path.stem}.json"
            with open(out_json, "w", encoding="utf-8") as out_f:
                json.dump(json_data, out_f, indent=2, ensure_ascii=False)

            count += 1

        print(f"✓ {split}: บันทึกสำเร็จ {count}/{len(image_files)} ไฟล์\n")


def convert_json_to_text(base_path: Path, splits: list, name_to_id: dict, limit: int = None):
    print("\n--- [START] Annotation JSON -> YOLO TXT ---")
    for item in splits:
        if isinstance(item, tuple) and len(item) == 3:
            split, images_dir, labels_dir = item
        else:
            split = str(item)
            images_dir = base_path / "images" / split
            labels_dir = base_path / "labels" / split

        labels_dir.mkdir(parents=True, exist_ok=True)
        if not images_dir.exists():
            print(f"[!] ข้าม {split}: ไม่พบโฟลเดอร์ {images_dir}")
            continue

        json_files = list(images_dir.glob("*.json"))
        if not json_files:
            print(f"[!] ไม่พบไฟล์ JSON ใน {split} ({images_dir})")
            continue

        if limit and limit > 0:
            json_files = json_files[:limit]

        count = 0
        pbar = tqdm(json_files, desc=f"Exporting {split:5s}", unit="file")

        for json_path in pbar:
            with open(json_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            img_w = data.get("imageWidth")
            img_h = data.get("imageHeight")
            if not img_w or not img_h:
                img_name = data.get("imagePath", f"{json_path.stem}.jpg")
                img_file = images_dir / img_name
                if img_file.exists():
                    with Image.open(img_file) as img:
                        img_w, img_h = img.size
                else:
                    continue

            yolo_lines = []
            for shape in data.get("shapes", []):
                label = shape.get("label")
                points = shape.get("points", [])
                if not points:
                    continue

                if label in name_to_id:
                    class_id = name_to_id[label]
                elif str(label).isdigit():
                    class_id = int(label)
                else:
                    continue

                if len(points) == 4 and shape.get("shape_type") == "polygon":
                    # OBB 4-point format
                    norm_pts = []
                    for px, py in points:
                        norm_pts.append(f"{max(0.0, min(1.0, px/img_w)):.6f}")
                        norm_pts.append(f"{max(0.0, min(1.0, py/img_h)):.6f}")
                    yolo_lines.append(f"{class_id} " + " ".join(norm_pts))
                else:
                    # Bounding Box
                    xs = [p[0] for p in points]
                    ys = [p[1] for p in points]
                    x_min, x_max = min(xs), max(xs)
                    y_min, y_max = min(ys), max(ys)

                    box_w = max(0.0, min(1.0, (x_max - x_min) / img_w))
                    box_h = max(0.0, min(1.0, (y_max - y_min) / img_h))
                    x_center = max(0.0, min(1.0, (x_min + x_max) / (2.0 * img_w)))
                    y_center = max(0.0, min(1.0, (y_min + y_max) / (2.0 * img_h)))

                    yolo_lines.append(f"{class_id} {x_center:.6f} {y_center:.6f} {box_w:.6f} {box_h:.6f}")

            out_txt = labels_dir / f"{json_path.stem}.txt"
            with open(out_txt, "w", encoding="utf-8") as out_f:
                out_f.write("\n".join(yolo_lines))

            count += 1

        print(f"✓ {split}: บันทึกสำเร็จ {count}/{len(json_files)} ไฟล์ (เซฟลง: {labels_dir})\n")
