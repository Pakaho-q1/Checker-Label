# BBox Reviewer & YOLO Dataset Manager

A high-performance, enterprise-grade toolkit for managing, auto-labeling, reviewing, and building YOLO datasets from Labelme JSON annotations. Designed for massive datasets (50k-100k+ images) with speed and concurrency in mind.

## 🚀 Key Features

*   **⚡ High-Speed Dataset Engine:** Uses an embedded SQLite Database (dataset.db) with WAL mode to cache and synchronize Labelme JSONs. Filtering, searching, and querying operations execute in under 1ms.
*   **🤖 Advanced Auto-Labeling (Ensemble Routing):** Run multiple YOLO models concurrently in VRAM. Configure specific models to target specific classes, set per-class confidence thresholds, and resolve overlapping detections automatically using IoU-based Mutual Exclusions. (See ensemble_template.yaml).
*   **🌐 Mobile-Ready Web UI:** A lightning-fast web interface (FastAPI) designed for rapid review and correction of bounding boxes on any device.
*   **📦 Intelligent Dataset Builder:** Compile datasets directly to YOLO format with automated stratified splitting (Train/Val/Test). The builder reads instantly from the SQLite cache.
*   **💾 Smart Exporter:** Extract only human-verified (checked: true) data instantly using the database layer.

## 📚 Documentation

For complete usage instructions and configuration details, please refer to our documentation:

- [1. Getting Started](docs/1_getting_started.md)
- [2. Advanced Auto-Labeling & Ensemble](docs/2_auto_labeling.md)
- [3. Building and Exporting Datasets](docs/3_dataset_tools.md)

## 🛠️ Installation

`ash
git clone https://github.com/your-username/yolo-dataset-manager.git
cd yolo-dataset-manager
conda create -n yolo_env python=3.11 -y
conda activate yolo_env
pip install -r requirements.txt
`

## 🎯 Quick Start

Start the Web UI to review your data:
`ash
python main.py web -i /path/to/images -l /path/to/labels
`

Run advanced auto-labeling with an ensemble config:
`ash
python main.py auto_label --config ensemble_template.yaml -i /path/to/images -o /path/to/labels
`
