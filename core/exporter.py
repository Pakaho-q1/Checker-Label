from pathlib import Path
import yaml
from ultralytics import YOLO

def export_model(
    weights_path: str,
    imgsz: int = 640,
    opset: int = 12,
    generate_anylabeling_yaml: bool = True
):
    print("=" * 60)
    print("📦 [START] Exporting YOLO Model to ONNX")
    print(f"📦 Model Weights: {weights_path}")
    print("=" * 60)

    weights = Path(weights_path).resolve()
    model = YOLO(str(weights))

    onnx_file = model.export(
        format="onnx",
        dynamic=False,
        opset=opset,
        imgsz=imgsz
    )
    print(f"✅ ONNX Exported successfully: {onnx_file}")

    if generate_anylabeling_yaml:
        onnx_path = Path(onnx_file).resolve()
        yaml_out = onnx_path.parent / "custom_model.yaml"

        # ดึง class names จากโมเดล
        names = model.names
        if isinstance(names, dict):
            class_list = [names[i] for i in sorted(names.keys())]
        else:
            class_list = list(names)

        anylabeling_config = {
            "type": "yolov8",
            "name": onnx_path.stem,
            "display_name": f"{onnx_path.stem.upper()} Detector",
            "model_path": str(onnx_path).replace("\\", "/"),
            "confidence_threshold": 0.5,
            "nms_threshold": 0.45,
            "classes": class_list
        }

        with open(yaml_out, "w", encoding="utf-8") as f:
            yaml.dump(anylabeling_config, f, default_flow_style=False, sort_keys=False, allow_unicode=True)

        print(f"✅ AnyLabeling Config Generated: {yaml_out}")

    return onnx_file
