# 1. Getting Started

Welcome to the BBox Reviewer & YOLO Dataset Manager. This system operates primarily on **Labelme JSON** format. Each image should have a corresponding .json file containing bounding box annotations.

## 1.1 Architecture & The Database Layer

To handle massive datasets efficiently, this system operates using a **Single Source of Truth (SSOT)** embedded SQLite database (dataset.db).

Whenever you run a command (such as web, uild_dataset, or export_verified), the system will automatically scan your labels directory and synchronize it into dataset.db. This allows tools to instantly filter and query your dataset without opening tens of thousands of JSON files.

> **Note:** The dataset.db is stored inside the directory you specify via the --labels (or -l) argument. If you do not specify -l, it defaults to the images directory.

## 1.2 Starting the Web UI

The Web UI allows you to review and correct bounding boxes efficiently on PC or mobile.

`ash
python main.py web -i data/images -l data/labels
`

### Hotkeys and Navigation
- The web interface caches filtering indices instantly via the DB.
- Toggle "Verified" on images you have confirmed are correct.
- Edits made in the UI are atomically written to the .json and instantly updated in .db.
