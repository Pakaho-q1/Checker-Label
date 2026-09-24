import os
import json
import warnings
warnings.filterwarnings("ignore")
from pathlib import Path
from typing import Optional, List
from ultralytics import YOLO

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


def run_auto_label(
    model_path: str,
    images_dir: str,
    output_dir: Optional[str] = None,
    conf_threshold: float = 0.45,
    iou_threshold: float = 0.45,
    batch_size: int = 16,
    imgsz: int = 640,
    device: str = "0",
    half: bool = True
):
    print("=" * 60)
    print("🤖 [START] Batch Auto-Labeling on GPU for X-AnyLabeling")
    print(f"📦 Model:       {model_path}")
    print(f"📁 Images Dir:  {images_dir}")
    if output_dir:
        print(f"📂 Output JSON: {output_dir} (แยกโฟลเดอร์)")
    else:
        print("📂 Output JSON: บันทึกเคียงข้างรูปภาพ")
    print(f"⚙️  Batch: {batch_size} | Device: {device} | Conf: {conf_threshold} | FP16: {half}")
    print("=" * 60)

    # 1. ตรวจสอบโฟลเดอร์ภาพ
    img_dir_path = Path(images_dir).resolve()
    if not img_dir_path.exists():
        raise FileNotFoundError(f"ไม่พบโฟลเดอร์รูปภาพ: {img_dir_path}")

    image_files = [
        f for f in img_dir_path.iterdir()
        if f.is_file() and f.suffix.lower() in IMAGE_EXTENSIONS
    ]
    if not image_files:
        print(f"[!] ไม่พบรูปภาพใน {img_dir_path}")
        return

    print(f"🔍 ตรวจพบรูปภาพทั้งหมด: {len(image_files)} รูป")

    # 2. เตรียมโฟลเดอร์ปลายทาง
    out_dir_path = Path(output_dir).resolve() if output_dir else None
    if out_dir_path:
        out_dir_path.mkdir(parents=True, exist_ok=True)

    # 3. โหลดโมเดล YOLO
    model = YOLO(model_path)
    is_obb = hasattr(model, "task") and model.task == "obb"
    names = model.names

    # ตรวจสอบว่าโมเดล ONNX เป็นแบบ Fixed Batch Size = 1 หรือไม่
    model_file = Path(model_path)
    if model_file.suffix.lower() == ".onnx":
        try:
            import onnx
            m = onnx.load(str(model_file.resolve()))
            input_dim = m.graph.input[0].type.tensor_type.shape.dim
            if input_dim and input_dim[0].HasField("dim_value") and input_dim[0].dim_value == 1:
                if batch_size > 1:
                    print("💡 โมเดล ONNX เป็นแบบ Fixed Shape (Batch=1) ระบบปรับการประมวลผลเป็นทีละ 1 ภาพบน GPU อัตโนมัติ")
                    batch_size = 1
        except Exception:
            pass

    # จัดการ Option FP16: สำหรับ Ultralytics รุ่นใหม่ใช้ quantize=16 แทน half
    predict_common_opts = {
        "conf": conf_threshold,
        "iou": iou_threshold,
        "imgsz": imgsz,
        "device": device,
        "verbose": False
    }
    if model_file.suffix.lower() == ".pt" and half and str(device).lower() != "cpu":
        predict_common_opts["quantize"] = 16

    # GPU Warmup 1 ครั้ง เพื่อคอมไพล์ CUDA Kernels ล่วงหน้า
    if len(image_files) > 0 and str(device).lower() != "cpu":
        try:
            model.predict(source=str(image_files[0]), **predict_common_opts)
        except Exception:
            pass

    # 4. รัน Inference ทีละ Batch
    total_boxes = 0
    pbar = tqdm(total=len(image_files), desc="Auto Labeling", unit="img")

    for i in range(0, len(image_files), batch_size):
        batch_paths = image_files[i : i + batch_size]
        batch_strs = [str(p) for p in batch_paths]

        # สั่งรันโมเดลบน GPU โดยไม่ส่งคีย์ 'half' เพื่อไม่ให้มี Warning กวนใจ
        results = model.predict(
            source=batch_strs,
            batch=len(batch_paths),
            **predict_common_opts
        )

        for img_p, res in zip(batch_paths, results):
            img_h, img_w = res.orig_shape
            shapes = []

            # กรณีโมเดลเป็น OBB (4-point polygon)
            if hasattr(res, "obb") and res.obb is not None and len(res.obb) > 0:
                for obb in res.obb:
                    cls_id = int(obb.cls.item())
                    score = float(obb.conf.item())
                    label = names.get(cls_id, str(cls_id))

                    # พิกัด 4 จุด xyxyxyxy
                    pts_xy = obb.xyxyxyxy[0].cpu().numpy().tolist()
                    shapes.append({
                        "label": label,
                        "score": round(score, 4),
                        "points": [[round(x, 2), round(y, 2)] for x, y in pts_xy],
                        "group_id": None,
                        "description": "",
                        "difficult": False,
                        "shape_type": "polygon",
                        "flags": {},
                        "attributes": {}
                    })
                    total_boxes += 1

            # กรณีโมเดลเป็น Bounding Box ทั่วไป
            elif hasattr(res, "boxes") and res.boxes is not None and len(res.boxes) > 0:
                for box in res.boxes:
                    cls_id = int(box.cls.item())
                    score = float(box.conf.item())
                    label = names.get(cls_id, str(cls_id))

                    xyxy = box.xyxy[0].cpu().numpy().tolist()
                    x1, y1, x2, y2 = xyxy
                    shapes.append({
                        "label": label,
                        "score": round(score, 4),
                        "points": [
                            [round(x1, 2), round(y1, 2)],
                            [round(x2, 2), round(y2, 2)]
                        ],
                        "group_id": None,
                        "description": "",
                        "difficult": False,
                        "shape_type": "rectangle",
                        "flags": {},
                        "attributes": {}
                    })
                    total_boxes += 1

            # สร้าง JSON สำหรับ AnyLabeling
            json_data = {
                "version": "0.4.0",
                "flags": {},
                "shapes": shapes,
                "imagePath": img_p.name,
                "imageData": None,
                "imageHeight": img_h,
                "imageWidth": img_w
            }

            # บันทึกไฟล์ JSON
            if out_dir_path:
                target_json = out_dir_path / f"{img_p.stem}.json"
            else:
                target_json = img_p.parent / f"{img_p.stem}.json"

            with open(target_json, "w", encoding="utf-8") as jf:
                json.dump(json_data, jf, indent=2, ensure_ascii=False)

            pbar.update(1)

    pbar.close()
    print("\n" + "=" * 60)
    print("🎉 Auto-Labeling สำเร็จเรียบร้อย!")
    print(f"📊 ประมวลผล: {len(image_files)} ภาพ")
    print(f"🏷️  ตรวจพบ Object ทั้งหมด: {total_boxes} วัตถุ")
    save_loc = out_dir_path if out_dir_path else img_dir_path
    print(f"💾 ไฟล์ JSON ถูกบันทึกไว้ที่: {save_loc}")
    print("=" * 60 + "\n")
