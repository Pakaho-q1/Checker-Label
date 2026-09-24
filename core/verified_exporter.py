import os
import sys
import json
import shutil
from pathlib import Path
from typing import Optional, List, Tuple, Dict, Any
from PIL import Image

# ปรับ encoding สำหรับ Windows console
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from core.dataset_builder import (
    IMAGE_EXTENSIONS,
    create_hardlink_or_copy,
    load_classes,
    convert_shape_to_yolo_line,
    find_classes_file
)

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


def export_verified_dataset(
    source_images: str,
    source_labels: Optional[str] = None,
    output_image: Optional[str] = None,
    output_label: Optional[str] = None,
    output_base: Optional[str] = None,
    mode: str = "hardlink",
    to_yolo: bool = False,
    task: str = "detect",
    classes_file: Optional[str] = None
):
    """
    คัดแยก/คัดลอก/Hardlink เฉพาะไฟล์ภาพและ Label ที่ผ่านการตรวจสอบแล้ว (checked: true)
    ไปยังโฟลเดอร์ปลายทางที่กำหนด (--image, --label)
    """
    mode = mode.lower().strip()
    if mode not in ["hardlink", "copy", "move"]:
        raise ValueError(f"โหมดไม่ถูกต้อง: '{mode}'. เลือกระหว่าง 'hardlink', 'copy', หรือ 'move'")

    print("=" * 70)
    print("📦 [START] Exporting Verified Dataset (Human-in-the-Loop)")
    print("=" * 70)

    # 1. ตรวจสอบโฟลเดอร์ต้นทาง
    src_img_dir = Path(source_images).resolve()
    if not src_img_dir.exists():
        raise FileNotFoundError(f"ไม่พบโฟลเดอร์รูปภาพต้นทาง: {src_img_dir}")

    if source_labels:
        src_lbl_dir = Path(source_labels).resolve()
    else:
        # Auto-discover labels folder adjacent or inside
        candidate_lbl = src_img_dir.parent / "label"
        candidate_lbl2 = src_img_dir.parent / "labels"
        if candidate_lbl.exists():
            src_lbl_dir = candidate_lbl
        elif candidate_lbl2.exists():
            src_lbl_dir = candidate_lbl2
        else:
            src_lbl_dir = src_img_dir

    if not src_lbl_dir.exists():
        raise FileNotFoundError(f"ไม่พบโฟลเดอร์ Label ต้นทาง: {src_lbl_dir}")

    print(f"📁 Images Source:  {src_img_dir}")
    print(f"📂 Labels Source:  {src_lbl_dir}")

    # 2. จัดการโฟลเดอร์ปลายทาง
    if output_image and output_label:
        dst_img_dir = Path(output_image).resolve()
        dst_lbl_dir = Path(output_label).resolve()
    elif output_base:
        base = Path(output_base).resolve()
        dst_img_dir = base / "images"
        dst_lbl_dir = base / "labels"
    elif output_image:
        dst_img_dir = Path(output_image).resolve()
        dst_lbl_dir = dst_img_dir.parent / "labels"
    elif output_label:
        dst_lbl_dir = Path(output_label).resolve()
        dst_img_dir = dst_lbl_dir.parent / "images"
    else:
        base = Path("verified_dataset").resolve()
        dst_img_dir = base / "images"
        dst_lbl_dir = base / "labels"

    dst_img_dir.mkdir(parents=True, exist_ok=True)
    dst_lbl_dir.mkdir(parents=True, exist_ok=True)

    print(f"🎯 Output Images:  {dst_img_dir}")
    print(f"🎯 Output Labels:  {dst_lbl_dir}")
    print(f"⚙️  Operation Mode: {mode.upper()} ({'สร้าง Hardlink รวดเร็ว ไม่เปลืองพื้นที่' if mode == 'hardlink' else ('คัดลอกไฟล์จริง' if mode == 'copy' else 'ย้ายไฟล์')})")

    # 3. สแกนหาไฟล์รูปภาพต้นทาง
    image_map: Dict[str, Path] = {}
    for f in src_img_dir.iterdir():
        if f.is_file() and f.suffix.lower() in IMAGE_EXTENSIONS:
            image_map[f.stem] = f

    # 4. สแกนหาไฟล์ JSON ที่ผ่านการตรวจสอบแล้ว (checked: true)
    all_json_files = list(src_lbl_dir.glob("*.json"))
    verified_items: List[Tuple[Path, Path, Dict[str, Any]]] = []

    print(f"🔍 สแกนพบ Label ทั้งหมด {len(all_json_files)} ไฟล์...")
    for jf in all_json_files:
        try:
            with open(jf, "r", encoding="utf-8") as f:
                data = json.load(f)
            is_checked = bool(data.get("checked", False) or data.get("verified", False))
            if is_checked:
                # จับคู่กับไฟล์ภาพ
                img_p = image_map.get(jf.stem)
                if img_p and img_p.exists():
                    verified_items.append((img_p, jf, data))
                else:
                    # ตรวจสอบชื่อจาก imagePath ใน JSON
                    ip = data.get("imagePath")
                    if ip:
                        alt_img = src_img_dir / ip
                        if alt_img.exists():
                            verified_items.append((alt_img, jf, data))
        except Exception:
            continue

    total_verified = len(verified_items)
    print(f"✅ ตรวจพบไฟล์ที่ผ่านการตรวจสอบแล้ว (Verified): {total_verified} ไฟล์ (จากทั้งหมด {len(all_json_files)})")

    if total_verified == 0:
        print("⚠️ ไม่พบไฟล์ใดที่มีสถานะ 'checked': true ในโฟลเดอร์ต้นทาง!")
        print("💡 คุณสามารถใช้ Web UI ตรวจสอบและกด '✓ ยืนยัน' ก่อนรันคำสั่งนี้ได้")
        return

    # 5. โหลด Classes หากต้องการแปลงเป็น YOLO format
    name_to_id = {}
    if to_yolo:
        cls_path = Path(classes_file) if classes_file else None
        classes, name_to_id = load_classes(cls_path, [v[1] for v in verified_items], candidate_dirs=[src_img_dir, src_lbl_dir])
        print(f"🏷️  Classes for YOLO ({len(classes)}): {classes}")

    # 6. ดำเนินการ Hardlink / Copy / Move
    desc = f"Exporting ({mode})"
    exported_count = 0

    for img_p, json_p, data in tqdm(verified_items, desc=desc, unit="file"):
        target_img = dst_img_dir / img_p.name
        target_json = dst_lbl_dir / json_p.name

        if mode == "hardlink":
            create_hardlink_or_copy(img_p, target_img)
            create_hardlink_or_copy(json_p, target_json)
        elif mode == "copy":
            if target_img.exists():
                try: target_img.unlink()
                except Exception: pass
            if target_json.exists():
                try: target_json.unlink()
                except Exception: pass
            shutil.copy2(img_p, target_img)
            shutil.copy2(json_p, target_json)
        elif mode == "move":
            if target_img.exists():
                try: target_img.unlink()
                except Exception: pass
            if target_json.exists():
                try: target_json.unlink()
                except Exception: pass
            shutil.move(img_p, target_img)
            shutil.move(json_p, target_json)

        # ถ้าเปิดใช้งาน --to-yolo ให้สร้างไฟล์ .txt ควบคู่ไปด้วย
        if to_yolo:
            img_w = data.get("imageWidth")
            img_h = data.get("imageHeight")
            if not img_w or not img_h:
                try:
                    with Image.open(target_img if mode != "move" else target_img) as im:
                        img_w, img_h = im.size
                except Exception:
                    img_w, img_h = 1000, 1000

            yolo_lines = []
            for shape in data.get("shapes", []):
                line = convert_shape_to_yolo_line(shape, img_w, img_h, name_to_id, task=task)
                if line:
                    yolo_lines.append(line)

            target_txt = dst_lbl_dir / f"{img_p.stem}.txt"
            with open(target_txt, "w", encoding="utf-8") as tf:
                if yolo_lines:
                    tf.write("\n".join(yolo_lines))
                else:
                    tf.write("")

        exported_count += 1

    # 7. สรุปผล
    print("\n" + "=" * 70)
    print("🎉 Export Verified Dataset สำเร็จเรียบร้อย!")
    print(f"📊 จำนวนไฟล์ที่ส่งออก: {exported_count} คู่ (ภาพ + Label)")
    print(f"📁 โฟลเดอร์รูปภาพ:    {dst_img_dir}")
    print(f"📂 โฟลเดอร์ Label:    {dst_lbl_dir}")
    if mode == "hardlink":
        print("💡 หมายเหตุ: ใช้ Hardlink ไม่เปลืองพื้นที่จัดเก็บเพิ่มเติมบนดิสก์")
    elif mode == "move":
        print("💡 หมายเหตุ: ย้ายไฟล์ออกจากชุดเดิมเรียบร้อยแล้ว")
    print("=" * 70 + "\n")
