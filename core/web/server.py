import socket
from pathlib import Path
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, HTTPException, Body
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
import uvicorn
from pydantic import BaseModel

from core.web.dataset_manager import DatasetManager

app = FastAPI(title="BBox Reviewer Web Tool")
manager: Optional[DatasetManager] = None
STATIC_DIR = Path(__file__).parent / "static"


class SavePayload(BaseModel):
    shapes: List[Dict[str, Any]]
    confirmed: bool = False
    filename: Optional[str] = None
    stem: Optional[str] = None


@app.get("/", response_class=HTMLResponse)
def read_root():
    index_file = STATIC_DIR / "index.html"
    if not index_file.exists():
        raise HTTPException(status_code=404, detail="Index file not found")
    return HTMLResponse(content=index_file.read_text(encoding="utf-8"))


@app.get("/api/summary")
def get_summary():
    if not manager:
        raise HTTPException(status_code=500, detail="DatasetManager not initialized")
    return manager.get_summary()


@app.get("/api/item/{idx}")
def get_item(idx: int):
    if not manager:
        raise HTTPException(status_code=500, detail="DatasetManager not initialized")
    try:
        return manager.get_item(idx)
    except IndexError:
        raise HTTPException(status_code=404, detail="Index out of range")


@app.get("/api/image/{idx}")
def get_image(idx: int):
    if not manager:
        raise HTTPException(status_code=500, detail="DatasetManager not initialized")
    try:
        img_path = manager.get_image_path(idx)
        return FileResponse(img_path)
    except IndexError:
        raise HTTPException(status_code=404, detail="Image not found")


@app.post("/api/save/{idx}")
def save_item(idx: int, payload: SavePayload):
    if not manager:
        raise HTTPException(status_code=500, detail="DatasetManager not initialized")
    try:
        res = manager.save_item(
            idx,
            payload.shapes,
            confirmed=payload.confirmed,
            expected_stem=payload.stem,
            expected_filename=payload.filename
        )
        return res
    except IndexError:
        raise HTTPException(status_code=404, detail="Index out of range")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/save-by-stem/{stem}")
def save_item_by_stem(stem: str, payload: SavePayload):
    if not manager:
        raise HTTPException(status_code=500, detail="DatasetManager not initialized")
    try:
        idx = manager.stem_to_idx.get(stem)
        if idx is None:
            raise HTTPException(status_code=404, detail=f"Image stem '{stem}' not found")
        res = manager.save_item(
            idx,
            payload.shapes,
            confirmed=payload.confirmed,
            expected_stem=stem,
            expected_filename=payload.filename
        )
        return res
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# Mount static assets
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


def get_local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def start_web_server(
    images_dir: str,
    labels_dir: Optional[str] = None,
    classes_file: Optional[str] = None,
    host: str = "0.0.0.0",
    port: int = 8000
):
    global manager
    manager = DatasetManager(images_dir, labels_dir, classes_file)
    summary = manager.get_summary()
    local_ip = get_local_ip()

    print("=" * 65)
    print("🚀 [START] BBox Reviewer Web Server (Mobile & PC)")
    print("=" * 65)
    print(f"📁 Images:   {summary['images_dir']}")
    print(f"📂 Labels:   {summary['labels_dir']}")
    classes_src = summary.get('classes_file') or 'ตรวจจับจากไฟล์ JSON อัตโนมัติ'
    print(f"🏷️  Classes:  {len(summary['classes'])} คลาส (จาก: {classes_src})")
    print(f"📊 Dataset:  ทั้งหมด {summary['total']} ภาพ | ยืนยันแล้ว: {summary['confirmed_count']} ภาพ")
    print("-" * 65)
    print(f"💻 สำหรับเปิดบน PC:      http://localhost:{port}")
    print(f"📱 สำหรับเปิดบนมือถือ:   http://{local_ip}:{port}")
    print("=" * 65)
    print("💡 ข้อแนะนำ: เปิดบนมือถือในแนวนอน (Landscape) เพื่อการใช้งานที่ลื่นไหลที่สุด!")
    print("กด Ctrl+C เพื่อหยุดเซิร์ฟเวอร์\n")

    uvicorn.run(app, host=host, port=port, log_level="warning")
