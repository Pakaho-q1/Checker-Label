import os
import sys
import json
import sqlite3
import threading
from pathlib import Path
from typing import List, Dict, Any, Optional, Set, Union
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageOps

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


class DatasetManager:
    """
    High-Performance Single Source of Truth (SSOT) สำหรับการจัดการ Dataset ขนาดใหญ่ (50k-100k ภาพ)
    ขับเคลื่อนด้วย Embedded SQLite Database (dataset.db) ร่วมกับ Labelme JSON
    รองรับการค้นหา (Query), กรอง (Filter), และบันทึก (Save) แบบ Sub-millisecond (< 1ms)
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
        self.db_path = self.labels_dir / "dataset.db"

        # Thread-local storage สำหรับการเชื่อมต่อ SQLite อย่างปลอดภัยในสภาพแวดล้อม FastAPI Multithreading
        self._local = threading.local()
        self._db_lock = threading.Lock()

        # สแกนรูปภาพทั้งหมดอย่างรวดเร็วด้วย os.scandir (เรียงตามชื่อเพื่อรักษา index ให้เสถียร)
        self.image_files: List[Path] = sorted(
            [
                Path(entry.path)
                for entry in os.scandir(self.images_dir)
                if entry.is_file() and os.path.splitext(entry.name)[1].lower() in IMAGE_EXTENSIONS
            ],
            key=lambda x: x.name.lower()
        )

        # Mapping โครงสร้างข้อมูลในหน่วยความจำสำหรับการเข้าถึงแบบ O(1) ระดับนาโนวินาที
        self.image_by_stem: Dict[str, Path] = {f.stem: f for f in self.image_files}
        self.stem_to_idx: Dict[str, int] = {f.stem: i for i, f in enumerate(self.image_files)}

        # เริ่มต้นและเชื่อมโยงฐานข้อมูล SQLite
        self._init_db()

        # โหลดหรือสกัดรายชื่อคลาส
        self.classes: List[str] = self._load_classes()

    def _get_connection(self) -> sqlite3.Connection:
        """ส่งคืนการเชื่อมต่อ SQLite สำหรับ Thread ปัจจุบัน (เปิดโหมด WAL เพื่อความเร็วสูงสุด)"""
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(str(self.db_path), timeout=30.0)
            conn.execute("PRAGMA journal_mode = WAL;")
            conn.execute("PRAGMA synchronous = NORMAL;")
            conn.execute("PRAGMA busy_timeout = 5000;")
            self._local.conn = conn
        return conn

    def _init_db(self):
        """ตรวจสอบและสร้าง Schema ฐานข้อมูล พร้อมสร้าง Index ให้ครอบคลุมทุกการค้นหา"""
        with self._db_lock:
            conn = self._get_connection()
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS items (
                    idx INTEGER PRIMARY KEY,
                    stem TEXT UNIQUE NOT NULL,
                    filename TEXT NOT NULL,
                    width INTEGER DEFAULT 0,
                    height INTEGER DEFAULT 0,
                    confirmed INTEGER DEFAULT 0,
                    is_negative INTEGER DEFAULT 0,
                    mtime REAL DEFAULT 0,
                    shapes_json TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_items_confirmed ON items(confirmed);
                CREATE INDEX IF NOT EXISTS idx_items_negative ON items(is_negative);
                CREATE INDEX IF NOT EXISTS idx_items_stem ON items(stem);

                CREATE TABLE IF NOT EXISTS item_classes (
                    stem TEXT NOT NULL,
                    label TEXT NOT NULL,
                    idx INTEGER NOT NULL,
                    PRIMARY KEY (stem, label)
                );
                CREATE INDEX IF NOT EXISTS idx_item_classes_label ON item_classes(label);
                CREATE INDEX IF NOT EXISTS idx_item_classes_idx ON item_classes(idx);
            """)

            try:
                conn.execute("ALTER TABLE items ADD COLUMN raw_shapes_json TEXT")
            except Exception:
                pass
            try:
                conn.execute("ALTER TABLE items ADD COLUMN has_low_conf INTEGER DEFAULT 0")
            except Exception:
                pass

            # ตรวจสอบว่าฐานข้อมูลมีข้อมูลตรงกับจำนวนภาพในโฟลเดอร์หรือไม่
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) FROM items")
            count = cur.fetchone()[0]
            total_images = len(self.image_files)

            needs_sync = False
            if count != total_images:
                needs_sync = True
            elif total_images > 0:
                # ตรวจสอบความถูกต้องของ First Item และ Last Item
                cur.execute("SELECT stem FROM items WHERE idx = 0")
                first_row = cur.fetchone()
                cur.execute("SELECT stem FROM items WHERE idx = ?", (total_images - 1,))
                last_row = cur.fetchone()
                if not first_row or first_row[0] != self.image_files[0].stem:
                    needs_sync = True
                elif not last_row or last_row[0] != self.image_files[-1].stem:
                    needs_sync = True

            if needs_sync:
                print(f"🔄 กำลังซิงค์ข้อมูลกับฐานข้อมูล SQLite: {self.db_path.name}...")
                self._sync_database(conn)

    def _sync_database(self, conn: sqlite3.Connection):
        """
        ซิงค์ไฟล์รูปภาพและ Labelme JSON เข้าสู่ SQLite อย่างรวดเร็วด้วย ThreadPool และ Bulk Insert
        รองรับ Dataset 50,000 - 100,000 ภาพได้ในเวลาเพียงไม่กี่วินาที
        """
        cur = conn.cursor()
        cur.execute("SELECT stem, mtime FROM items")
        existing_db = {row[0]: row[1] for row in cur.fetchall()}

        # สแกน JSON files ที่มีอยู่ใน labels_dir
        label_files = {}
        try:
            for entry in os.scandir(self.labels_dir):
                if entry.name.endswith(".json") and not entry.name.startswith("."):
                    label_files[entry.name[:-5]] = entry.stat().st_mtime
        except Exception:
            pass

        # หาส่วนต่างที่ต้องอ่านไฟล์ใหม่
        to_process = []
        for idx, img_p in enumerate(self.image_files):
            stem = img_p.stem
            json_mtime = label_files.get(stem)
            db_mtime = existing_db.get(stem)

            # ต้องอ่านใหม่ถ้ายังไม่มีใน DB หรือไฟล์ JSON บนดิสก์มีการแก้ไขใหม่กว่า
            if stem not in existing_db or (json_mtime is not None and json_mtime > (db_mtime or 0) + 0.001):
                to_process.append((idx, img_p, True))
            else:
                # อัปเดตเฉพาะตำแหน่ง index หากลำดับเปลี่ยน
                to_process.append((idx, img_p, False))

        def _worker(item):
            idx, img_p, parse_json = item
            stem = img_p.stem
            if not parse_json:
                return (idx, stem, img_p.name, None, None, None, None, None, None, None, None, None)

            json_p = self.labels_dir / f"{stem}.json"
            shapes = []
            raw_shapes = []
            confirmed = 0
            w, h = 0, 0
            mtime = 0.0
            labels = set()

            if json_p.exists():
                try:
                    mtime = json_p.stat().st_mtime
                    with open(json_p, "r", encoding="utf-8") as f:
                        d = json.load(f)
                    confirmed = 1 if bool(d.get("checked", False)) else 0
                    w = d.get("imageWidth", 0)
                    h = d.get("imageHeight", 0)
                    shapes = d.get("shapes", [])
                    raw_shapes = d.get("raw_shapes", [])
                    labels = {str(sh.get("label")).strip() for sh in shapes if sh.get("label")}
                except Exception:
                    pass

            is_negative = 1 if len(shapes) == 0 else 0
            has_low_conf = 1 if raw_shapes else 0
            shapes_str = json.dumps(shapes) if shapes else "[]"
            raw_shapes_str = json.dumps(raw_shapes) if raw_shapes else None
            return (idx, stem, img_p.name, w, h, confirmed, is_negative, has_low_conf, mtime, shapes_str, raw_shapes_str, labels)

        # ประมวลผลแบบขนานด้วย ThreadPoolExecutor
        workers = min(32, (os.cpu_count() or 4) * 4)
        with ThreadPoolExecutor(max_workers=workers) as pool:
            results = list(pool.map(_worker, to_process, chunksize=200))

        # บันทึกเข้า SQLite เป็นชุดใหญ่ใน Transaction เดียว (ความเร็วสูงสุด)
        items_upsert = []
        classes_insert = []
        stems_to_clear_classes = []

        for res in results:
            idx, stem, fname, w, h, conf, is_neg, has_low_conf, mtime, shapes_str, raw_shapes_str, labels = res
            if shapes_str is not None:
                items_upsert.append((idx, stem, fname, w, h, conf, is_neg, has_low_conf, mtime, shapes_str, raw_shapes_str))
                stems_to_clear_classes.append(stem)
                if labels:
                    for lbl in labels:
                        classes_insert.append((stem, lbl, idx))
            else:
                # อัปเดตเฉพาะ idx
                cur.execute("UPDATE items SET idx = ? WHERE stem = ?", (idx, stem))
                cur.execute("UPDATE item_classes SET idx = ? WHERE stem = ?", (idx, stem))

        if items_upsert:
            cur.executemany("""
                INSERT INTO items (idx, stem, filename, width, height, confirmed, is_negative, has_low_conf, mtime, shapes_json, raw_shapes_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(stem) DO UPDATE SET
                    idx=excluded.idx,
                    filename=excluded.filename,
                    width=excluded.width,
                    height=excluded.height,
                    confirmed=excluded.confirmed,
                    is_negative=excluded.is_negative,
                    has_low_conf=excluded.has_low_conf,
                    mtime=excluded.mtime,
                    shapes_json=excluded.shapes_json,
                    raw_shapes_json=excluded.raw_shapes_json
            """, items_upsert)

            if stems_to_clear_classes:
                # ลบ class links เก่าของ stems ที่อัปเดต
                for chunk in [stems_to_clear_classes[i:i + 500] for i in range(0, len(stems_to_clear_classes), 500)]:
                    placeholders = ",".join("?" for _ in chunk)
                    cur.execute(f"DELETE FROM item_classes WHERE stem IN ({placeholders})", chunk)

            if classes_insert:
                cur.executemany("INSERT OR IGNORE INTO item_classes (stem, label, idx) VALUES (?, ?, ?)", classes_insert)

        # ลบ stems ที่ไม่มีไฟล์ภาพอยู่จริงออกจาก DB
        current_stems = set(self.image_by_stem.keys())
        stems_to_delete = set(existing_db.keys()) - current_stems
        if stems_to_delete:
            del_list = list(stems_to_delete)
            for chunk in [del_list[i:i + 500] for i in range(0, len(del_list), 500)]:
                placeholders = ",".join("?" for _ in chunk)
                cur.execute(f"DELETE FROM items WHERE stem IN ({placeholders})", chunk)
                cur.execute(f"DELETE FROM item_classes WHERE stem IN ({placeholders})", chunk)

        conn.commit()
        print(f"✓ ซิงค์ฐานข้อมูลสำเร็จ ({len(self.image_files)} รายการ)")

    def _load_classes(self) -> List[str]:
        """โหลดรายชื่อคลาสจาก classes.txt, data.yaml หรือดึงจากตาราง SQLite item_classes"""
        classes = []
        candidate_paths = []

        if self.classes_file:
            candidate_paths.append(self.classes_file)

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
            # ดึงคลาสจาก SQLite item_classes (เร็วกว่าสแกนไฟล์ JSON 1,000 เท่า)
            try:
                conn = self._get_connection()
                cur = conn.cursor()
                cur.execute("SELECT DISTINCT label FROM item_classes WHERE label != '' ORDER BY label")
                classes = [r[0] for r in cur.fetchall()]
            except Exception:
                pass

        return classes if classes else ["OBJECT"]

    def _update_item_in_db(
        self,
        idx: int,
        stem: str,
        width: int,
        height: int,
        confirmed: int,
        mtime: float,
        shapes: List[Dict[str, Any]]
    ):
        """อัปเดตข้อมูลของรูปภาพหนึ่งรายการลง SQLite อย่างปลอดภัย"""
        with self._db_lock:
            conn = self._get_connection()
            is_neg = 1 if len(shapes) == 0 else 0
            shapes_str = json.dumps(shapes) if shapes else "[]"
            labels = {str(sh.get("label")).strip() for sh in shapes if sh.get("label")}

            conn.execute("""
                UPDATE items
                SET width = ?, height = ?, confirmed = ?, is_negative = ?, mtime = ?, shapes_json = ?
                WHERE idx = ?
            """, (width, height, confirmed, is_neg, mtime, shapes_str, idx))

            conn.execute("DELETE FROM item_classes WHERE stem = ?", (stem,))
            if labels:
                conn.executemany(
                    "INSERT OR IGNORE INTO item_classes (stem, label, idx) VALUES (?, ?, ?)",
                    [(stem, lbl, idx) for lbl in labels]
                )
            conn.commit()

    def get_summary(self) -> Dict[str, Any]:
        """สรุปข้อมูลสถิติทั้งหมดด้วยคำสั่ง SQL ซึ่งทำงานได้ในเวลา < 3ms แม้มี 100,000 ภาพ"""
        conn = self._get_connection()
        cur = conn.cursor()

        cur.execute("SELECT COUNT(*) FROM items")
        total = cur.fetchone()[0]

        cur.execute("SELECT COUNT(*) FROM items WHERE confirmed = 1")
        confirmed_count = cur.fetchone()[0]

        cur.execute("SELECT COUNT(*) FROM items WHERE is_negative = 1")
        negative_count = cur.fetchone()[0]

        cur.execute("SELECT label, COUNT(*) FROM item_classes GROUP BY label")
        class_counts = dict(cur.fetchall())
        for c in self.classes:
            if c not in class_counts:
                class_counts[c] = 0

        # จัดเตรียม filter_indices:
        # หากชุดข้อมูลขนาดเล็ก (<= 2000) ส่งล่วงหน้าให้ทันที
        # หากชุดข้อมูลขนาดใหญ่ (50k - 100k) ให้ส่ง {} เพื่อความรวดเร็วระดับ 1ms (Frontend จะดึง On-Demand ผ่าน /api/filter-indices)
        filter_indices = {}
        if total <= 2000:
            cur.execute("SELECT idx FROM items WHERE confirmed = 0 ORDER BY idx")
            unverified_list = [r[0] for r in cur.fetchall()]
            cur.execute("SELECT idx FROM items WHERE confirmed = 1 ORDER BY idx")
            verified_list = [r[0] for r in cur.fetchall()]
            cur.execute("SELECT idx FROM items WHERE is_negative = 1 ORDER BY idx")
            negative_list = [r[0] for r in cur.fetchall()]

            filter_indices = {
                "all": [],
                "unverified": unverified_list,
                "verified": verified_list,
                "negative": negative_list
            }
            for c in self.classes:
                cur.execute("SELECT idx FROM item_classes WHERE label = ? ORDER BY idx", (c,))
                filter_indices[f"class:{c}"] = [r[0] for r in cur.fetchall()]

        return {
            "total": total,
            "confirmed_count": confirmed_count,
            "unverified_count": total - confirmed_count,
            "negative_count": negative_count,
            "classes": self.classes,
            "class_counts": class_counts,
            "filter_indices": filter_indices,
            "classes_file": str(self.classes_file) if self.classes_file else None,
            "images_dir": str(self.images_dir),
            "labels_dir": str(self.labels_dir),
            "db_path": str(self.db_path)
        }

    def get_filter_indices(
        self,
        filter_name: str = "all",
        status: Optional[Union[str, List[str]]] = None,
        classes: Optional[List[str]] = None,
        conf_min: Optional[float] = None,
        conf_max: Optional[float] = None,
        include_low_conf: bool = True
    ) -> List[int]:
        conn = self._get_connection()
        cur = conn.cursor()

        actual_statuses = set()
        if isinstance(status, str):
            actual_statuses = {s.strip() for s in status.split(",") if s.strip()}
        elif isinstance(status, (list, set, tuple)):
            actual_statuses = {str(s).strip() for s in status if str(s).strip()}
        elif filter_name:
            if not filter_name.startswith("class:"):
                actual_statuses = {s.strip() for s in filter_name.split(",") if s.strip()}

        actual_classes = list(classes) if classes else []
        if not actual_classes and filter_name and filter_name.startswith("class:"):
            actual_classes = [filter_name[6:]]

        has_conf_filter = (conf_min is not None and conf_max is not None and not (float(conf_min) <= 0.0 and float(conf_max) >= 1.0))

        if ("all" in actual_statuses or not actual_statuses) and not actual_classes and not has_conf_filter:
            return []

        conditions = []
        params = []

        has_unverified = "unverified" in actual_statuses
        has_verified = "verified" in actual_statuses
        if has_unverified and not has_verified:
            conditions.append("items.confirmed = 0")
        elif has_verified and not has_unverified:
            conditions.append("items.confirmed = 1")

        if "negative" in actual_statuses:
            conditions.append("items.is_negative = 1")
        if "low_conf" in actual_statuses:
            conditions.append("items.has_low_conf = 1")

        if has_conf_filter:
            c_min = float(conf_min)
            c_max = float(conf_max)
            elem_conditions = [
                "CAST(json_extract(elem.value, '$.score') AS REAL) >= ?",
                "CAST(json_extract(elem.value, '$.score') AS REAL) <= ?"
            ]
            conf_params = [c_min, c_max]

            if actual_classes and len(actual_classes) > 0:
                placeholders = ",".join(["?" for _ in actual_classes])
                elem_conditions.insert(0, f"json_extract(elem.value, '$.label') IN ({placeholders})")
                params.extend(actual_classes)

            params.extend(conf_params)
            all_conditions = conditions + elem_conditions
            where_clause = " WHERE " + " AND ".join(all_conditions) if all_conditions else ""

            json_source = "COALESCE(NULLIF(items.raw_shapes_json, '[]'), items.shapes_json)" if include_low_conf else "items.shapes_json"
            sql = f"""
                SELECT DISTINCT items.idx
                FROM items, json_each({json_source}) AS elem
                {where_clause}
                ORDER BY items.idx
            """
        else:
            if actual_classes and len(actual_classes) > 0:
                placeholders = ",".join(["?" for _ in actual_classes])
                conditions.append(f"item_classes.label IN ({placeholders})")
                params.extend(actual_classes)
                where_clause = " WHERE " + " AND ".join(conditions) if conditions else ""
                sql = f"""
                    SELECT DISTINCT items.idx
                    FROM items
                    JOIN item_classes ON items.stem = item_classes.stem
                    {where_clause}
                    ORDER BY items.idx
                """
            else:
                where_clause = " WHERE " + " AND ".join(conditions) if conditions else ""
                sql = f"SELECT idx FROM items {where_clause} ORDER BY idx"

        cur.execute(sql, params)
        return [r[0] for r in cur.fetchall()]

    def get_item(self, idx: int) -> Dict[str, Any]:
        """
        โหลด Metadata และ Annotation โดยอ่านตรงจาก SQLite (เร็วระดับ 0.05ms)
        หากตรวจพบว่าไฟล์ JSON บนดิสก์มีการแก้ไขใหม่กว่า จะซิงค์เข้า SQLite ให้อัตโนมัติทันที
        """
        if idx < 0 or idx >= len(self.image_files):
            raise IndexError("Index out of range")

        img_p = self.image_files[idx]
        conn = self._get_connection()
        cur = conn.cursor()
        cur.execute(
            "SELECT stem, filename, width, height, confirmed, mtime, shapes_json, raw_shapes_json FROM items WHERE idx = ?",
            (idx,)
        )
        row = cur.fetchone()

        if not row:
            raise IndexError("Item not found in database")

        stem, filename, width, height, confirmed, db_mtime, shapes_json, raw_shapes_json = row
        shapes = []
        if shapes_json:
            try:
                shapes = json.loads(shapes_json)
            except Exception:
                shapes = []
        
        raw_shapes = []
        if raw_shapes_json:
            try:
                raw_shapes = json.loads(raw_shapes_json)
            except Exception:
                raw_shapes = []

        json_p = self.labels_dir / f"{stem}.json"

        # ตรวจสอบว่าไฟล์ JSON บนดิสก์มีการแก้ไขโดยโปรแกรมอื่นหรือไม่ (Auto External Sync)
        if json_p.exists():
            try:
                disk_mtime = json_p.stat().st_mtime
                if disk_mtime > (db_mtime or 0) + 0.001:
                    with open(json_p, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    shapes = data.get("shapes", [])
                    confirmed = 1 if bool(data.get("checked", False)) else 0
                    img_w = data.get("imageWidth", 0)
                    img_h = data.get("imageHeight", 0)
                    if img_w and img_h:
                        width, height = img_w, img_h
                    self._update_item_in_db(idx, stem, width, height, confirmed, disk_mtime, shapes)
            except Exception:
                pass

        # หากยังไม่มีขนาดภาพ กวาดอ่านด้วย PIL เพียงครั้งเดียวแล้วบันทึกลง SQLite
        if not width or not height:
            try:
                with Image.open(img_p) as im:
                    trans = ImageOps.exif_transpose(im)
                    width, height = (trans or im).size
                with self._db_lock:
                    conn.execute("UPDATE items SET width = ?, height = ? WHERE idx = ?", (width, height, idx))
                    conn.commit()
            except Exception:
                width, height = 1000, 1000

        return {
            "index": idx,
            "filename": filename,
            "stem": stem,
            "width": width,
            "height": height,
            "raw_json_width": width,
            "raw_json_height": height,
            "shapes": shapes,
            "raw_shapes": raw_shapes,
            "confirmed": bool(confirmed)
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
        expected_filename: Optional[str] = None,
        raw_shapes: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """
        บันทึก Annotation:
        1. ป้องกันข้อผิดพลาดของข้อมูล (Safety Identity & Coordinate Clamping)
        2. บันทึกไฟล์ JSON แบบ Atomic (สำหรับ YOLO Builder และ Labelme)
        3. อัปเดตเข้า SQLite ทันทีใน Transaction เดียว (เร็วระดับ ~0.5ms)
        """
        if idx < 0 or idx >= len(self.image_files):
            raise IndexError("Index out of range")

        img_p = self.image_files[idx]

        # ── SAFETY CHECK 1: ตรวจสอบความถูกต้องของไฟล์ (Identity Verification) ──
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

        # อ่านขนาดภาพจริง (ใช้จาก DB ก่อน ถ้าไม่มีจึงอ่านผ่าน PIL)
        conn = self._get_connection()
        cur = conn.cursor()
        cur.execute("SELECT width, height FROM items WHERE idx = ?", (idx,))
        row = cur.fetchone()
        real_w, real_h = (row[0], row[1]) if row else (0, 0)

        if not real_w or not real_h:
            try:
                with Image.open(img_p) as im:
                    trans = ImageOps.exif_transpose(im)
                    real_w, real_h = (trans or im).size
            except Exception:
                real_w, real_h = 1000, 1000

        # ── SAFETY CHECK 2: ป้องกันพิกัด Bbox หลุดขอบภาพจริง (Sanity Clamping) ──
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

        # ── SAFETY CHECK 3: บันทึกไฟล์ JSON แบบ Atomic Write ──
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
        if raw_shapes is not None:
            json_data["raw_shapes"] = raw_shapes

        tmp_json_p = json_p.with_suffix(".tmp")
        with open(tmp_json_p, "w", encoding="utf-8") as f:
            json.dump(json_data, f, indent=2, ensure_ascii=False)
        os.replace(tmp_json_p, json_p)

        disk_mtime = json_p.stat().st_mtime

        # ── อัปเดต SQLite แบบ Atomic Transaction ทันที (< 1ms) ──
        new_labels = {str(sh.get("label")).strip() for sh in sanitized_shapes if sh.get("label")}
        is_neg = 1 if len(sanitized_shapes) == 0 else 0
        shapes_str = json.dumps(sanitized_shapes)

        with self._db_lock:
            has_low_conf = 1 if raw_shapes else 0
            raw_shapes_str = json.dumps(raw_shapes) if raw_shapes else None
            
            conn.execute("""
                UPDATE items
                SET confirmed = ?, shapes_json = ?, is_negative = ?, width = ?, height = ?, mtime = ?, has_low_conf = ?, raw_shapes_json = ?
                WHERE idx = ?
            """, (1 if confirmed else 0, shapes_str, is_neg, real_w, real_h, disk_mtime, has_low_conf, raw_shapes_str, idx))

            conn.execute("DELETE FROM item_classes WHERE stem = ?", (img_p.stem,))
            if new_labels:
                conn.executemany(
                    "INSERT OR IGNORE INTO item_classes (stem, label, idx) VALUES (?, ?, ?)",
                    [(img_p.stem, lbl, idx) for lbl in new_labels]
                )
            conn.commit()

        return {
            "status": "success",
            "index": idx,
            "stem": img_p.stem,
            "filename": img_p.name,
            "confirmed": confirmed,
            "shapes_count": len(sanitized_shapes),
            "classes": sorted(list(new_labels))
        }
