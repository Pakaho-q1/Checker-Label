import os
import sys
import shutil
from pathlib import Path
from typing import Optional, Dict, List, Tuple
from PIL import Image
import numpy as np
import yaml

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

from core.dataset_builder import IMAGE_EXTENSIONS, create_hardlink_or_copy

def compute_dhash(image: Image.Image, hash_size: int = 8) -> int:
    """คำนวณ Perceptual Hash (dHash) เพื่อใช้หาภาพซ้ำแม้จะถูกย่อขยายหรือเปลี่ยนสีเล็กน้อย"""
    # แปลงเป็น Grayscale และย่อขนาดเป็น 9x8
    image = image.convert('L').resize((hash_size + 1, hash_size), Image.Resampling.LANCZOS)
    pixels = np.asarray(image)
    # เปรียบเทียบพิกเซลที่ติดกัน
    diff = pixels[:, 1:] > pixels[:, :-1]
    # แปลง array เป็น integer 64-bit
    return sum([2 ** i for (i, v) in enumerate(diff.flatten()) if v])

def hamming_distance(hash1: int, hash2: int) -> int:
    """คำนวณความต่างของ Hash (ระยะห่าง)"""
    return bin(hash1 ^ hash2).count('1')

def run_audit(
    images_dir: str,
    labels_dir: Optional[str] = None,
    out_images: Optional[str] = None,
    out_labels: Optional[str] = None,
    mode: str = "move",
    min_width: int = 0,
    min_height: int = 0,
    dup_threshold: int = -1,
    config_file: Optional[str] = None
):
    if config_file and Path(config_file).exists():
        with open(config_file, 'r', encoding='utf-8') as f:
            cfg = yaml.safe_load(f) or {}
            
        # Overwrite defaults with YAML config if provided
        mode = cfg.get('mode', mode)
        
        # Dimensions
        dim_cfg = cfg.get('dimensions', {})
        min_width = dim_cfg.get('min_width', min_width)
        min_height = dim_cfg.get('min_height', min_height)
        
        # Duplicates
        dup_cfg = cfg.get('duplicates', {})
        # If enabled is false, set dup_threshold to -1 to disable
        if dup_cfg.get('enabled', True):
            dup_threshold = dup_cfg.get('threshold', dup_threshold)
        else:
            dup_threshold = -1

    print("=" * 60)
    print("🕵️ [START] Dataset Auditor (ตรวจสอบและคัดกรองข้อมูลขยะ)")
    if config_file:
        print(f"📄 โหลดตั้งค่าจาก: {config_file}")
    print("=" * 60)

    src_img = Path(images_dir).resolve()
    src_lbl = Path(labels_dir).resolve() if labels_dir else src_img

    if not src_img.exists():
        raise FileNotFoundError(f"ไม่พบโฟลเดอร์ภาพ: {src_img}")

    dst_img = Path(out_images).resolve() if out_images else None
    dst_lbl = Path(out_labels).resolve() if out_labels else (dst_img if dst_img else None)

    if dst_img:
        dst_img.mkdir(parents=True, exist_ok=True)
    if dst_lbl:
        dst_lbl.mkdir(parents=True, exist_ok=True)

    image_files = [f for f in src_img.iterdir() if f.is_file() and f.suffix.lower() in IMAGE_EXTENSIONS]
    print(f"🔍 สแกนพบรูปภาพทั้งหมด: {len(image_files)} ไฟล์")

    seen_hashes: List[Tuple[str, int]] = [] # list of (filename, hash_int)
    
    bad_files_small = []
    bad_files_dup = []

    desc = "Auditing Dataset"
    for img_p in tqdm(image_files, desc=desc, unit="file"):
        try:
            with Image.open(img_p) as img:
                w, h = img.size
                
                # 1. เช็กขนาด (Too Small)
                if (min_width > 0 and w < min_width) or (min_height > 0 and h < min_height):
                    bad_files_small.append(img_p)
                    continue
                
                # 2. เช็กภาพซ้ำ (Duplicate) ด้วย dHash
                if dup_threshold >= 0:
                    img_hash = compute_dhash(img)
                    is_dup = False
                    for seen_name, seen_hash in seen_hashes:
                        if hamming_distance(img_hash, seen_hash) <= dup_threshold:
                            is_dup = True
                            break
                    if is_dup:
                        bad_files_dup.append(img_p)
                        continue
                    else:
                        seen_hashes.append((img_p.name, img_hash))
                        
        except Exception as e:
            print(f"\n❌ Error อ่านภาพ {img_p.name}: {e}")
            bad_files_small.append(img_p) # ถือเป็นไฟล์เสีย

    all_bad = bad_files_small + bad_files_dup
    
    print("\n" + "=" * 60)
    print("📊 [AUDIT SUMMARY] สรุปผลการตรวจสอบคุณภาพ")
    print(f"  • รูปภาพทั้งหมด:     {len(image_files)} รูป")
    print(f"  • ภาพขนาดเล็กเกิน:  {len(bad_files_small)} รูป (กว้าง < {min_width} หรือ สูง < {min_height})")
    print(f"  • ภาพซ้ำ (Dup):     {len(bad_files_dup)} รูป (ระดับความเหมือน {dup_threshold})")
    print(f"  • รูปภาพที่ผ่านเกณฑ์: {len(image_files) - len(all_bad)} รูป")
    print("=" * 60)

    # ดำเนินการ Action กับไฟล์ที่ "ไม่ผ่านเกณฑ์ (Bad Files)"
    if dst_img and all_bad:
        print(f"\n🚛 กำลังดำเนินการ {mode.upper()} ไฟล์ที่ไม่ได้คุณภาพไปยังโฟลเดอร์ปลายทาง...")
        processed = 0
        for img_p in tqdm(all_bad, desc="Quarantine", unit="file"):
            json_p = src_lbl / f"{img_p.stem}.json"
            
            target_img = dst_img / img_p.name
            target_json = dst_lbl / json_p.name
            
            if mode == "move":
                shutil.move(str(img_p), str(target_img))
                if json_p.exists():
                    shutil.move(str(json_p), str(target_json))
            elif mode == "copy":
                shutil.copy2(img_p, target_img)
                if json_p.exists():
                    shutil.copy2(json_p, target_json)
            elif mode == "hardlink":
                create_hardlink_or_copy(img_p, target_img)
                if json_p.exists():
                    create_hardlink_or_copy(json_p, target_json)
            processed += 1
            
        print(f"✅ คัดแยกไฟล์ขยะสำเร็จ {processed} รายการ ไปที่ {dst_img}")
    elif all_bad:
        print("\n💡 พบไฟล์ขยะ แต่คุณไม่ได้ระบุ --out-images (-o) ระบบจึงไม่ได้ทำการย้ายไฟล์")
        print("คำแนะนำ: รันคำสั่งอีกครั้งพร้อมเติม -o bad_data -m move เพื่อย้ายไฟล์เหล่านี้ออกไป")
