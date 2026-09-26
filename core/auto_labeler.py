import os
import json
import warnings
import yaml
import gc
import torch
warnings.filterwarnings("ignore")
from pathlib import Path
from typing import Optional, List, Dict, Any
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


def calculate_iou(boxA, boxB):
    # box format: [[x1, y1], [x2, y2]]
    xA = max(boxA[0][0], boxB[0][0])
    yA = max(boxA[0][1], boxB[0][1])
    xB = min(boxA[1][0], boxB[1][0])
    yB = min(boxA[1][1], boxB[1][1])

    interArea = max(0, xB - xA) * max(0, yB - yA)
    if interArea == 0:
        return 0.0

    boxAArea = (boxA[1][0] - boxA[0][0]) * (boxA[1][1] - boxA[0][1])
    boxBArea = (boxB[1][0] - boxB[0][0]) * (boxB[1][1] - boxB[0][1])
    iou = interArea / float(boxAArea + boxBArea - interArea)
    return iou

def apply_mutual_exclusion(shapes, exclusion_cfg):
    if not exclusion_cfg or not exclusion_cfg.get("groups"):
        return shapes
    
    iou_thresh = exclusion_cfg.get("iou_threshold", 0.80)
    groups = exclusion_cfg.get("groups", [])
    
    to_remove = set()
    for i in range(len(shapes)):
        if i in to_remove: continue
        for j in range(i + 1, len(shapes)):
            if j in to_remove: continue
            
            label_i = shapes[i]['label']
            label_j = shapes[j]['label']
            
            # Check if both labels are in the SAME mutual exclusion group
            is_exclusive = False
            for group in groups:
                if label_i in group and label_j in group:
                    is_exclusive = True
                    break
            
            if is_exclusive:
                iou = calculate_iou(shapes[i]['points'], shapes[j]['points'])
                if iou >= iou_thresh:
                    # Overlapping mutually exclusive boxes! Keep the one with higher score
                    if shapes[i]['score'] < shapes[j]['score']:
                        to_remove.add(i)
                        break  # shape i is removed, move to next i
                    else:
                        to_remove.add(j)
                        
    return [s for idx, s in enumerate(shapes) if idx not in to_remove]


def load_auto_label_config(config_path: str) -> tuple:
    """Load and parse the YAML config for ensemble auto-labeling. Returns (models, mutual_exclusions)"""
    with open(config_path, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)
    return config.get("models", []), config.get("mutual_exclusions", {})


def run_auto_label(
    model_path: Optional[str] = None,
    images_dir: str = "",
    output_dir: Optional[str] = None,
    conf_threshold: float = 0.45,
    conf_min: float = 0.15,
    iou_threshold: float = 0.45,
    batch_size: int = 16,
    imgsz: int = 640,
    device: str = "0",
    half: bool = True,
    config_file: Optional[str] = None
):
    print("=" * 60)
    print("🤖 [START] Advanced Auto-Labeling (Ensemble / Per-Class Config)")
    
    img_dir_path = Path(images_dir).resolve()
    if not img_dir_path.exists():
        raise FileNotFoundError(f"ไม่พบโฟลเดอร์รูปภาพ: {img_dir_path}")

    image_files = sorted([
        f for f in img_dir_path.iterdir()
        if f.is_file() and f.suffix.lower() in IMAGE_EXTENSIONS
    ])
    if not image_files:
        print(f"[!] ไม่พบรูปภาพใน {img_dir_path}")
        return

    print(f"🔍 ตรวจพบรูปภาพทั้งหมด: {len(image_files)} รูป")

    out_dir_path = Path(output_dir).resolve() if output_dir else img_dir_path
    out_dir_path.mkdir(parents=True, exist_ok=True)
    tmp_dir = out_dir_path / ".label_tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)

    # Prepare model configs
    models_config = []
    mutual_exclusions = {}
    if config_file and Path(config_file).exists():
        print(f"📄 โหลดตั้งค่า Ensemble จาก: {config_file}")
        models_config, mutual_exclusions = load_auto_label_config(config_file)
    else:
        if not model_path:
            raise ValueError("ต้องระบุ --model หรือ --config อย่างใดอย่างหนึ่ง")
        # Default single-model config
        models_config = [{
            "path": model_path,
            "classes": ["*"],
            "class_conf": {},
            "conf_threshold": conf_threshold,
            "conf_min": conf_min,
            "iou_threshold": iou_threshold
        }]

    # In-memory storage for JSONs
    json_results = {
        img_p.name: {
            "version": "0.4.0",
            "flags": {},
            "shapes": [],
            "raw_shapes": [],
            "imagePath": img_p.name,
            "imageData": None,
            "imageHeight": 0,
            "imageWidth": 0
        }
        for img_p in image_files
    }

    total_boxes = 0
    total_low_conf = 0

    # Load all models into memory at once
    loaded_models = []
    global_batch_size = batch_size
    
    for m_idx, m_cfg in enumerate(models_config):
        m_path = m_cfg.get("path")
        m_classes = set(m_cfg.get("classes", ["*"]))
        m_class_conf = m_cfg.get("class_conf", {})
        m_conf = m_cfg.get("conf_threshold", conf_threshold)
        m_conf_min = min(m_cfg.get("conf_min", conf_min), m_conf)
        m_iou = m_cfg.get("iou_threshold", iou_threshold)

        print(f"\n🚀 [Loading Model {m_idx+1}/{len(models_config)}]: {m_path}")
        print(f"   🎯 Classes: {list(m_classes)[:5]}... | Base Conf: {m_conf}")
        
        try:
            model = YOLO(m_path)
        except Exception as e:
            print(f"❌ โหลดโมเดลไม่สำเร็จ: {e}")
            continue
            
        current_batch = batch_size
        if Path(m_path).suffix.lower() == ".onnx":
            try:
                import onnx
                m_onnx = onnx.load(str(Path(m_path).resolve()))
                input_dim = m_onnx.graph.input[0].type.tensor_type.shape.dim
                if input_dim and input_dim[0].HasField("dim_value") and input_dim[0].dim_value == 1:
                    current_batch = 1
            except Exception:
                pass
                
        if current_batch < global_batch_size:
            global_batch_size = current_batch

        predict_opts = {
            "conf": m_conf_min,
            "iou": m_iou,
            "imgsz": imgsz,
            "device": device,
            "verbose": False
        }
        if Path(m_path).suffix.lower() == ".pt" and half and str(device).lower() != "cpu":
            predict_opts["quantize"] = 16

        # Warmup
        if str(device).lower() != "cpu":
            try:
                model.predict(source=str(image_files[0]), **predict_opts)
            except Exception:
                pass
                
        loaded_models.append({
            'model': model,
            'names': model.names,
            'classes': m_classes,
            'class_conf': m_class_conf,
            'conf': m_conf,
            'opts': predict_opts
        })

    print(f"\n⚙️ เริ่มประมวลผลพร้อมกันทุกโมเดล (Batch={global_batch_size})...")
    pbar = tqdm(total=len(image_files), desc="Ensemble Predicting", unit="img")
    
    import cv2
    for i in range(0, len(image_files), global_batch_size):
        batch_paths = image_files[i : i + global_batch_size]
        batch_strs = [str(p) for p in batch_paths]
        
        # Read images into memory using cv2 to save disk I/O when passing to multiple models
        # Ultralytics can accept a list of numpy arrays directly
        batch_imgs = []
        valid_paths = []
        for p in batch_strs:
            img = cv2.imread(p)
            if img is not None:
                batch_imgs.append(img)
                valid_paths.append(p)
                
        if not batch_imgs:
            pbar.update(len(batch_paths))
            continue

        for lm in loaded_models:
            model = lm['model']
            names = lm['names']
            m_classes = lm['classes']
            m_class_conf = lm['class_conf']
            m_conf = lm['conf']
            opts = lm['opts']
            
            results = model.predict(source=batch_imgs, batch=len(batch_imgs), **opts)

            for p_idx, res in enumerate(results):
                img_p = Path(valid_paths[p_idx])
                img_h, img_w = res.orig_shape
                json_results[img_p.name]["imageHeight"] = img_h
                json_results[img_p.name]["imageWidth"] = img_w

                if hasattr(res, "boxes") and res.boxes is not None:
                    for box in res.boxes:
                        cls_id = int(box.cls.item())
                        score = float(box.conf.item())
                        label = names.get(cls_id, str(cls_id))

                        if "*" not in m_classes and label not in m_classes:
                            continue

                        required_conf = float(m_class_conf.get(label, m_conf))

                        xyxy = box.xyxy[0].cpu().numpy().tolist()
                        x1, y1, x2, y2 = xyxy
                        shape_obj = {
                            "label": label,
                            "score": round(score, 4),
                            "points": [[round(x1, 2), round(y1, 2)], [round(x2, 2), round(y2, 2)]],
                            "group_id": None,
                            "description": "",
                            "difficult": False,
                            "shape_type": "rectangle",
                            "flags": {},
                            "attributes": {}
                        }
                        
                        json_results[img_p.name]["raw_shapes"].append(shape_obj)
                        
                        if score >= required_conf:
                            json_results[img_p.name]["shapes"].append(shape_obj)
                            total_boxes += 1
                        else:
                            total_low_conf += 1

        pbar.update(len(batch_paths))
    pbar.close()

    # Save all JSONs
    print("\n💾 กำลังบันทึกไฟล์ JSON...")
    save_pbar = tqdm(total=len(image_files), desc="Saving", unit="file")
    for img_p in image_files:
        target_json = out_dir_path / f"{img_p.stem}.json"
        tmp_json = tmp_dir / f"{img_p.stem}_{os.getpid()}.tmp"
        
        # Apply Mutual Exclusion Filtering
        if mutual_exclusions:
            json_results[img_p.name]["shapes"] = apply_mutual_exclusion(json_results[img_p.name]["shapes"], mutual_exclusions)
            json_results[img_p.name]["raw_shapes"] = apply_mutual_exclusion(json_results[img_p.name]["raw_shapes"], mutual_exclusions)
            
        with open(tmp_json, "w", encoding="utf-8") as jf:
            json.dump(json_results[img_p.name], jf, indent=2, ensure_ascii=False)
        os.replace(tmp_json, target_json)
        save_pbar.update(1)
    save_pbar.close()

    # Cleanup tmp
    try:
        if tmp_dir.exists():
            for f in os.scandir(tmp_dir):
                if f.is_file() and f.name.endswith(".tmp"):
                    try:
                        os.remove(f.path)
                    except Exception:
                        pass
            try:
                tmp_dir.rmdir()
            except Exception:
                pass
    except Exception:
        pass

    print("\n" + "=" * 60)
    print("🎉 Auto-Labeling (Ensemble) สำเร็จเรียบร้อย!")
    print(f"📊 ประมวลผล: {len(image_files)} ภาพ")
    print(f"🏷️  วัตถุหลัก (ผ่านเกณฑ์ Conf): {total_boxes} วัตถุ")
    print(f"⚠️  วัตถุสำรอง (Low-Conf): {total_low_conf} วัตถุ")
    print(f"💾 ไฟล์ถูกบันทึกไว้ที่: {out_dir_path}")
    print("=" * 60 + "\n")
