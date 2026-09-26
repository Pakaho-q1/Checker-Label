import yaml
import sys
from pathlib import Path
from ultralytics import YOLO

def train_yolo(
    model_name: str = "yolo11n.pt",
    data_yaml: str = "data.yaml",
    epochs: int = 100,
    imgsz: int = 640,
    batch: int = 16,
    device: str = "0",
    workers: int = 4,
    patience: int = 20,
    project: str = "runs/train",
    name: str = "yolo_model",
    exist_ok: bool = True,
    auto_export: bool = True,
    resume: bool = False,
    freeze: int = None,
    lr0: float = None,
    # === Data Augmentation Parameters (Default: เปิดใช้งาน) ===
    augment: bool = True,
    degrees: float = 180.0,     # สุ่มหมุนภาพ 360 องศา (รองรับรูปเอียง/นอน/ตะแคง)
    fliplr: float = 0.5,        # สุ่มพลิกซ้าย-ขวา 50%
    flipud: float = 0.5,        # สุ่มพลิกบน-ล่าง 50% (รองรับการถ่ายกลับหัว)
    perspective: float = 0.001, # ปรับมุมมองเบี้ยว/มุมเงย
    shear: float = 5.0,         # ปรับมุมเฉียง
    scale: float = 0.5,         # ซูมเข้า-ออก (+/- 50%)
    hsv_v: float = 0.4,         # ปรับความสว่าง (ทนต่อแสงสะท้อน/เงา)
    close_mosaic: int = 10      # ปิด Mosaic ช่วง 10 รอบสุดท้ายเพื่อความแม่นยำของกรอบ
):
    print("=" * 60)
    print("🚀 [START] Training / Fine-Tuning YOLO Model")
    print(f"📦 Model / Checkpoint: {model_name}")
    print(f"📄 Data Config:        {data_yaml}")
    print(f"⚙️  Epochs: {epochs} | Batch: {batch} | ImgSz: {imgsz} | Device: {device}")
    
    if augment:
        print(f"🔄 Augmentation: ENABLED (Deg={degrees}°, FlipUD={flipud}, FlipLR={fliplr}, Shear={shear}, Scale={scale}, CloseMosaic={close_mosaic})")
    else:
        print("🔄 Augmentation: DISABLED (Clean Training)")

    if resume:
        print("🔄 Mode: RESUME Training from checkpoint")
    elif any(kw in model_name.lower() for kw in ["best.pt", "last.pt"]):
        print("🎯 Mode: FINE-TUNING (FT) from existing weights")
    if freeze is not None:
        print(f"🔒 Freeze Layers:      {freeze} backbone layers")
    if lr0 is not None:
        print(f"📉 Initial LR (lr0):   {lr0}")
    print("=" * 60)

    # 1. โหลดโมเดล
    model = YOLO(model_name)

    # 2. ตั้งค่า Parameters สำหรับการเทรน
    train_kwargs = {
        "data": str(Path(data_yaml).resolve()),
        "epochs": epochs,
        "imgsz": imgsz,
        "batch": batch,
        "device": device,
        "workers": workers,
        "patience": patience,
        "project": project,
        "name": name,
        "exist_ok": exist_ok,
        "plots": True
    }

    # จัดการ Augmentation parameters
    if augment:
        train_kwargs.update({
            "degrees": degrees,
            "fliplr": fliplr,
            "flipud": flipud,
            "perspective": perspective,
            "shear": shear,
            "scale": scale,
            "hsv_v": hsv_v,
            "close_mosaic": close_mosaic
        })
    else:
        # ปิดการ Augment ทุกชนิดเพื่อเทรนแบบ Original Clean Data
        train_kwargs.update({
            "degrees": 0.0,
            "fliplr": 0.0,
            "flipud": 0.0,
            "perspective": 0.0,
            "shear": 0.0,
            "scale": 0.0,
            "hsv_v": 0.0,
            "mosaic": 0.0,
            "mixup": 0.0,
            "close_mosaic": 0
        })

    if resume:
        train_kwargs["resume"] = True
    if freeze is not None and freeze > 0:
        train_kwargs["freeze"] = freeze
    if lr0 is not None and lr0 > 0:
        train_kwargs["lr0"] = lr0

    # 3. เริ่มต้นเทรน
    results = model.train(**train_kwargs)

    print("\n" + "=" * 60)
    print("📊 [VALIDATION RESULTS หลังเทรนเสร็จ]")
    print("=" * 60)
    metrics = model.val()
    if hasattr(metrics, "box"):
        print(f"🎯 Box mAP50:    {metrics.box.map50:.4f}")
        print(f"🎯 Box mAP50-95: {metrics.box.map:.4f}")
    if hasattr(metrics, "obb"):
        print(f"🎯 OBB mAP50:    {metrics.obb.map50:.4f}")
        print(f"🎯 OBB mAP50-95: {metrics.obb.map:.4f}")

    # 4. Export ONNX อัตโนมัติถ้าเปิดไว้
    if auto_export:
        print("\n" + "=" * 60)
        print("📦 [EXPORT] Exporting best model to ONNX for AnyLabeling...")
        print("=" * 60)
        try:
            onnx_path = model.export(
                format="onnx",
                dynamic=False,
                opset=12
            )
            print(f"✅ ONNX Exported to: {onnx_path}")
        except Exception as e:
            print(f"[!] Warning: ไม่สามารถ Export ONNX ได้: {e}")

    return results