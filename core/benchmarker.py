from pathlib import Path
from ultralytics import YOLO

def benchmark_model(
    weights_path: str,
    data_yaml: str = "data.yaml",
    split: str = "test",
    imgsz: int = 640,
    batch: int = 16,
    workers: int = 2,
    device: str = "0"
):
    print("=" * 60)
    print("📊 [START] Benchmarking YOLO Model")
    print(f"📦 Model Weights: {weights_path}")
    print(f"📄 Data Config:   {data_yaml}")
    print(f"🎯 Split:         {split}")
    print("=" * 60)

    model = YOLO(weights_path)
    metrics = model.val(
        data=str(Path(data_yaml).resolve()),
        split=split,
        imgsz=imgsz,
        batch=batch,
        workers=workers,
        device=device,
        plots=True
    )

    print("\n" + "=" * 60)
    print(f"🏆 ผลการทดสอบ (Benchmark Results บน '{split}')")
    print("=" * 60)

    if hasattr(metrics, "box") and metrics.box.map50 > 0:
        print(f"📌 [Detection Bounding Box]")
        print(f"  • mAP50:     {metrics.box.map50:.4f}")
        print(f"  • mAP50-95:  {metrics.box.map:.4f}")
        print(f"  • Precision: {metrics.box.mp:.4f}")
        print(f"  • Recall:    {metrics.box.mr:.4f}")

    if hasattr(metrics, "obb") and metrics.obb.map50 > 0:
        print(f"📌 [Oriented Bounding Box (OBB 4-point)]")
        print(f"  • mAP50:     {metrics.obb.map50:.4f}")
        print(f"  • mAP50-95:  {metrics.obb.map:.4f}")
        print(f"  • Precision: {metrics.obb.mp:.4f}")
        print(f"  • Recall:    {metrics.obb.mr:.4f}")

    print("=" * 60 + "\n")
    return metrics
