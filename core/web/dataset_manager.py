import os
import sys
import json
from pathlib import Path
from typing import List, Dict, Any, Optional
from PIL import Image

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


class DatasetManager:
    """
    Single Source of Truth (SSOT) สำหรับการจัดการไฟล์รูปภาพ, Annotations (JSON),
    รายชื่อ Classes และสถานะการตรวจสอบ (Confirmed)
    """

    def __init__(
        self,
        images_dir: str,
        labels_dir: Optional[str] = None,
        classes_file: Optional[str] = None,
    ):
        self.images_dir = Path(images_dir).resolve()
        if not self.images_dir.exists():
            raise FileNotFoundError(f"ไม่พบโฟลเดอร์รูปภาพ: {self.images_dir}")

        self.labels_dir = Path(labels_dir).resolve() if labels_dir else self.images_dir
        self.labels_dir.mkdir(parents=True, exist_ok=True)

        self.classes_file = Path(classes_file).resolve() if classes_file else None

        # สแกนรูปภาพทั้งหมด (เรียงตามชื่อเพื่อรักษา index ให้เสถียร)
        self.image_files: List[Path] = sorted(
            [f for f in self.images_dir.iterdir() if f.is_file() and f.suffix.lower() in IMAGE_EXTENSIONS],
            key=lambda x: x.name.lower()
        )

        # สร้าง Mapping โครงสร้างข้อมูลที่เชื่อมโยงกันอย่างแม่นยำ (Bi-directional Index)
        self.image_by_stem: Dict[str, Path] = {f.stem: f for f in self.image_files}
        self.stem_to_idx: Dict[str, int] = {f.stem: i for i, f in enumerate(self.image_files)}

        # โหลดหรือสกัดรายชื่อคลาส
        self.classes: List[str] = self._load_classes()

        # Cache สถานะ confirmed เพื่อความรวดเร็วในการนับ overview
        self._confirmed_cache: Dict[str, bool] = {}
        self._init_confirmed_cache()

    def _load_classes(self) -> List[str]:
        classes = []
        candidate_paths = []

        if self.classes_file:
            candidate_paths.append(self.classes_file)
            # รองรับกรณีพิมพ์ path ขาดคำว่า _datasets เช่น nsfw/classes.txt
            if "nsfw" in str(self.classes_file) and not self.classes_file.exists():
                alt = Path(str(self.classes_file).replace("nsfw", "nsfw_datasets"))
                if alt.exists():
                    candidate_paths.append(alt)

        # เพิ่ม candidate paths อัตโนมัติจากโฟลเดอร์ภาพ, โฟลเดอร์ label และ root
        candidate_paths.extend([
            self.images_dir / "classes.txt",
            self.images_dir.parent / "classes.txt",
            self.labels_dir / "classes.txt",
            self.labels_dir.parent / "classes.txt",
            Path.cwd() / "classes.txt",
            Path.cwd() / "data.yaml",
        ])

        for cp in candidate_paths:
            if cp and cp.exists() and cp.is_file():
                if cp.suffix.lower() == ".txt":
                    try:
                        with open(cp, "r", encoding="utf-8") as f:
                            classes = [line.strip() for line in f if line.strip()]
                        if classes:
                            self.classes_file = cp
                            break
                    except Exception:
                        pass
                elif cp.suffix.lower() in [".yaml", ".yml"]:
                    try:
                        import yaml
                        with open(cp, "r", encoding="utf-8") as f:
                            yd = yaml.safe_load(f)
                        names = yd.get("names", [])
                        if isinstance(names, dict):
                            classes = [str(names[k]) for k in sorted(names.keys())]
                        elif isinstance(names, list):
                            classes = [str(n) for n in names]
                        if classes:
                            self.classes_file = cp
                            break
                    except Exception:
                        pass

        if not classes:
            # Fallback: สแกนไฟล์ JSON เพื่อดึงคลาสให้ครบถ้วนทุกลาส
            found = set()
            json_list = list(self.labels_dir.glob("*.json"))
            for jf in json_list:
                try:
                    with open(jf, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    for sh in data.get("shapes", []):
                        if sh.get("label"):
                            found.add(str(sh.get("label")).strip())
                except Exception:
                    pass
            classes = sorted(list(found)) if found else ["OBJECT"]

        return classes

    def _init_confirmed_cache(self):
        for img_p in self.image_files:
            json_p = self.labels_dir / f"{img_p.stem}.json"
            if json_p.exists():
                try:
                    with open(json_p, "r", encoding="utf-8") as f:
                        d = json.load(f)
                    self._confirmed_cache[img_p.stem] = bool(d.get("checked", False))
                except Exception:
                    self._confirmed_cache[img_p.stem] = False
            else:
                self._confirmed_cache[img_p.stem] = False

    def get_summary(self) -> Dict[str, Any]:
        confirmed_count = sum(1 for v in self._confirmed_cache.values() if v)
        return {
            "total": len(self.image_files),
            "confirmed_count": confirmed_count,
            "classes": self.classes,
            "classes_file": str(self.classes_file) if self.classes_file else None,
            "images_dir": str(self.images_dir),
            "labels_dir": str(self.labels_dir)
        }

    def get_item(self, idx: int) -> Dict[str, Any]:
        if idx < 0 or idx >= len(self.image_files):
            raise IndexError("Index out of range")

        img_p = self.image_files[idx]
        json_p = self.labels_dir / f"{img_p.stem}.json"

        # โหลดขนาดภาพ
        img_w, img_h = 0, 0
        shapes = []
        checked = False

        if json_p.exists():
            try:
                with open(json_p, "r", encoding="utf-8") as f:
                    data = json.load(f)
                img_w = data.get("imageWidth", 0)
                img_h = data.get("imageHeight", 0)
                shapes = data.get("shapes", [])
                checked = bool(data.get("checked", False))
            except Exception:
                pass

        if not img_w or not img_h:
            try:
                with Image.open(img_p) as im:
                    img_w, img_h = im.size
            except Exception:
                img_w, img_h = 1000, 1000

        self._confirmed_cache[img_p.stem] = checked

        return {
            "index": idx,
            "filename": img_p.name,
            "stem": img_p.stem,
            "width": img_w,
            "height": img_h,
            "shapes": shapes,
            "confirmed": checked
        }

    def get_image_path(self, idx: int) -> Path:
        if idx < 0 or idx >= len(self.image_files):
            raise IndexError("Index out of range")
        return self.image_files[idx]

    def save_item(
        self,
        idx: int,
        shapes: List[Dict[str, Any]],
        confirmed: bool = False,
        expected_stem: Optional[str] = None,
        expected_filename: Optional[str] = None
    ) -> Dict[str, Any]:
        if idx < 0 or idx >= len(self.image_files):
            raise IndexError("Index out of range")

        img_p = self.image_files[idx]

        # ── SAFETY CHECK 1: ตรวจสอบความถูกต้องของไฟล์ที่ต้องการบันทึก (Identity Verification) ──
        if expected_stem and expected_stem != img_p.stem:
            raise ValueError(
                f"🚨 SAFETY REJECTION: ป้องกันข้อมูลทับซ้อนผิดไฟล์! "
                f"Client ส่งคำขอบันทึกของ '{expected_stem}' แต่ตำแหน่ง Index {idx} คือไฟล์ '{img_p.stem}'"
            )
        if expected_filename and expected_filename != img_p.name:
            raise ValueError(
                f"🚨 SAFETY REJECTION: ชื่อไฟล์ไม่ตรงกัน! "
                f"Client ส่ง '{expected_filename}' แต่เซิร์ฟเวอร์คือ '{img_p.name}'"
            )

        json_p = self.labels_dir / f"{img_p.stem}.json"

        # อ่านขนาดภาพจริงจากไฟล์โดยตรงเสมอ
        try:
            with Image.open(img_p) as im:
                real_w, real_h = im.size
        except Exception:
            real_w, real_h = 1000, 1000

        # ── SAFETY CHECK 2: ป้องกันพิกัด Bbox หลุดขอบภาพจริง (Sanity Check & Clamping) ──
        sanitized_shapes = []
        for sh in shapes:
            pts = sh.get("points", [])
            if not pts or len(pts) < 2:
                continue

            clamped_pts = []
            for p in pts:
                cx = max(0.0, min(float(real_w), float(p[0])))
                cy = max(0.0, min(float(real_h), float(p[1])))
                clamped_pts.append([round(cx, 2), round(cy, 2)])

            sh_copy = dict(sh)
            sh_copy["points"] = clamped_pts
            sanitized_shapes.append(sh_copy)

        # ── SAFETY CHECK 3: บันทึกแบบ Atomic Write (เขียนไฟล์ .tmp ก่อน os.replace) ──
        json_data = {
            "version": "0.4.0",
            "flags": {},
            "shapes": sanitized_shapes,
            "imagePath": img_p.name,
            "imageData": None,
            "imageHeight": real_h,
            "imageWidth": real_w,
            "checked": confirmed
        }

        tmp_json_p = json_p.with_suffix(".tmp")
        with open(tmp_json_p, "w", encoding="utf-8") as f:
            json.dump(json_data, f, indent=2, ensure_ascii=False)
        os.replace(tmp_json_p, json_p)

        self._confirmed_cache[img_p.stem] = confirmed
        return {
            "status": "success",
            "index": idx,
            "stem": img_p.stem,
            "filename": img_p.name,
            "confirmed": confirmed,
            "shapes_count": len(sanitized_shapes)
        }
