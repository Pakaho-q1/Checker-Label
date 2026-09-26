# 2. Advanced Auto-Labeling & Ensemble

The uto_label command supports ultra-fast batch inference using YOLOv8 models. It optimizes VRAM and Disk I/O by loading all models into memory at once and parsing each image batch directly.

## 2.1 Ensemble Config (ensemble_template.yaml)

Using a YAML config allows you to route specific classes to specific models. This is highly useful if one model excels at detecting "Cats" but struggles with "Dogs", while another model excels at "Dogs".

### Example Configuration:
`yaml
models:
  - path: "weights/yolov8_cats.pt"
    classes: ["CAT"]
    class_conf:
      CAT: 0.70
    conf_threshold: 0.50

  - path: "weights/yolov8_dogs.pt"
    classes: ["DOG"]
    class_conf:
      DOG: 0.65
    conf_threshold: 0.45

mutual_exclusions:
  iou_threshold: 0.80
  groups:
    - ["CAT", "DOG"]
`

## 2.2 Mutual Exclusions

In the example above, mutual_exclusions prevents overlapping detections of conflicting classes. If the models detect a CAT and a DOG at the exact same location (IoU > 0.80), the system will automatically discard the bounding box with the lower confidence score.

## 2.3 Running Auto-Label

`ash
python main.py auto_label --config ensemble_template.yaml -i data/images -o data/labels
`
