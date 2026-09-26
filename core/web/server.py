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

ANTI_CACHE_HEADERS = {
    "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0"
}


@app.middleware("http")
async def add_anti_cache_header(request, call_next):
    """
    ป้องกันเบราว์เซอร์มือถือและ PC แคชข้อมูลรูปภาพ, Annotation หรือ Script เก่าค้าง
    """
    response = await call_next(request)
    if request.url.path.startswith("/api/") or request.url.path.startswith("/static/") or request.url.path == "/":
        for k, v in ANTI_CACHE_HEADERS.items():
            response.headers[k] = v
    return response


class SavePayload(BaseModel):
    shapes: List[Dict[str, Any]]
    confirmed: bool = False
    filename: Optional[str] = None
    stem: Optional[str] = None
    raw_shapes: Optional[List[Dict[str, Any]]] = None


@app.get("/", response_class=HTMLResponse)
def read_root():
    index_file = STATIC_DIR / "index.html"
    if not index_file.exists():
        raise HTTPException(status_code=404, detail="Index file not found")
    return HTMLResponse(content=index_file.read_text(encoding="utf-8"), headers=ANTI_CACHE_HEADERS)


@app.get("/api/summary")
def get_summary():
    if not manager:
        raise HTTPException(status_code=500, detail="DatasetManager not initialized")
    return manager.get_summary()


@app.get("/api/filter-data")
def get_filter_data():
    if not manager:
        raise HTTPException(status_code=500, detail="DatasetManager not initialized")
    return manager.get_summary()


@app.get("/api/filter-indices")
def get_filter_indices(
    filter: str = "all",
    status: Optional[str] = None,
    classes: Optional[str] = None,
    conf_min: Optional[float] = None,
    conf_max: Optional[float] = None,
    include_low_conf: bool = True
):
    if not manager:
        raise HTTPException(status_code=500, detail="DatasetManager not initialized")
    cls_list = [c.strip() for c in classes.split(",") if c.strip()] if classes else None
    return manager.get_filter_indices(
        filter_name=filter,
        status=status,
        classes=cls_list,
        conf_min=conf_min,
        conf_max=conf_max,
        include_low_conf=include_low_conf
    )


@app.get("/api/item/{idx}")
def get_item(idx: int):
    if not manager:
        raise HTTPException(status_code=500, detail="DatasetManager not initialized")
    try:
        return manager.get_item(idx)
    except IndexError:
        raise HTTPException(status_code=404, detail="Index out of range")


@app.get("/api/image/{idx}")
def get_image(idx: int, stem: Optional[str] = None):
    if not manager:
        raise HTTPException(status_code=500, detail="DatasetManager not initialized")
    try:
        # หาก Client ระบุ stem มาด้วย ให้จับคู่ตรงตาม stem เพื่อป้องกัน Index Desync บนมือถือ
        if stem and stem in manager.image_by_stem:
            img_path = manager.image_by_stem[stem]
        else:
            img_path = manager.get_image_path(idx)
        return FileResponse(img_path, headers=ANTI_CACHE_HEADERS)
    except IndexError:
        raise HTTPException(status_code=404, detail="Image not found")


@app.get("/api/image-by-stem/{stem}")
def get_image_by_stem(stem: str):
    if not manager:
        raise HTTPException(status_code=500, detail="DatasetManager not initialized")
    img_path = manager.image_by_stem.get(stem)
    if not img_path:
        raise HTTPException(status_code=404, detail=f"Image stem '{stem}' not found")
    return FileResponse(img_path, headers=ANTI_CACHE_HEADERS)


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
            expected_filename=payload.filename,
            raw_shapes=payload.raw_shapes
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
            expected_filename=payload.filename,
            raw_shapes=payload.raw_shapes
        )
        return res
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# Mount static assets
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


def get_network_ips() -> List[tuple]:
    ips = []
    try:
        import psutil
        for iface, addrs in psutil.net_if_addrs().items():
            for addr in addrs:
                if addr.family == socket.AF_INET and not addr.address.startswith(('127.', '169.254.', '172.18.', '172.29.')):
                    ips.append((iface, addr.address))
    except Exception:
        pass
    if not ips:
        ips.append(("LAN", get_local_ip()))
    return ips


def get_local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def print_qr_code(url: str):
    try:
        import sys
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        import qrcode
        qr = qrcode.QRCode(border=1)
        qr.add_data(url)
        print("📱 [สแกน QR Code ด้วยกล้องมือถือเพื่อเข้าใช้งานทันที]")
        qr.print_ascii(invert=True)
    except Exception:
        pass


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
    net_ips = get_network_ips()
    primary_ip = net_ips[0][1] if net_ips else get_local_ip()
    mobile_url = f"http://{primary_ip}:{port}"

    print("=" * 68)
    print("🚀 [START] BBox Reviewer Web Server (Mobile & PC)")
    print("=" * 68)
    print(f"📁 Images:   {summary['images_dir']}")
    print(f"📂 Labels:   {summary['labels_dir']}")
    print(f"⚡ Database: {summary.get('db_path', 'dataset.db')} (High-Speed SQLite WAL Mode)")
    classes_src = summary.get('classes_file') or 'ตรวจจับจากไฟล์ JSON อัตโนมัติ'
    print(f"🏷️  Classes:  {len(summary['classes'])} คลาส (จาก: {classes_src})")
    print(f"📊 Dataset:  ทั้งหมด {summary['total']} ภาพ | ยืนยันแล้ว: {summary['confirmed_count']} ภาพ")
    print("-" * 68)
    print(f"💻 สำหรับเปิดบน PC:           http://localhost:{port}")
    for iface, ip in net_ips:
        tag = "Wi-Fi วงเดียวกัน" if "wi-fi" in iface.lower() else ("VPN / 4G/5G" if "tailscale" in iface.lower() else iface)
        print(f"📱 สำหรับเปิดบนมือถือ ({tag}):  http://{ip}:{port}")
    print("-" * 68)
    print_qr_code(mobile_url)
    print("⚠️  ข้อสำคัญสำหรับมือถือ:")
    print(" 1. ต้องพิมพ์ 'http://' (ห้ามมี 's' ด้านหลัง เพราะมือถือชอบเติม https:// อัตโนมัติ)")
    print(" 2. มือถือและคอมต้องต่อ Wi-Fi เดียวกัน (หรือเชื่อมผ่าน Tailscale)")
    print(" 3. หากเข้าไม่ได้ อาจเกิดจาก Router มีระบบ AP Isolation แนะนำให้เปิด Hotspot จากมือถือ")
    print("=" * 68)
    print("กด Ctrl+C เพื่อหยุดเซิร์ฟเวอร์\n")

    uvicorn.run(app, host=host, port=port, log_level="warning")
