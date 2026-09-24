/**
 * Canvas Rendering Component
 * รับผิดชอบการวาดภาพ, Bounding Boxes, Labels และ 8-point Resize Handles
 */
class CanvasRenderer {
  constructor() {
    this.wrap = document.getElementById('canvas-wrap');
    this.cImg = document.getElementById('canvas-img');
    this.cAnno = document.getElementById('canvas-anno');
    this.cUi = document.getElementById('canvas-ui');

    this.ctxImg = this.cImg.getContext('2d');
    this.ctxAnno = this.cAnno.getContext('2d');
    this.ctxUi = this.cUi.getContext('2d');

    // Drawing in progress
    this.drawStart = null;
    this.drawEnd = null;

    this.initResizeListener();
    this.resizeCanvases();
  }

  initResizeListener() {
    window.addEventListener('resize', () => {
      this.resizeCanvases();
      if (window.app) window.app.updateZoomDisplay();
    });
  }

  resizeCanvases() {
    const w = this.wrap.clientWidth || (window.innerWidth - 420);
    const h = this.wrap.clientHeight || (window.innerHeight - 78);
    if (w <= 0 || h <= 0) return;
    [this.cImg, this.cAnno, this.cUi].forEach(c => {
      if (c.width !== w) c.width = w;
      if (c.height !== h) c.height = h;
    });
    this.renderAll();
  }

  fitImageToView() {
    const S = window.appState;
    if (!S.imgBitmap) return;

    const w = this.wrap.clientWidth;
    const h = this.wrap.clientHeight;
    if (w > 0 && h > 0) {
      [this.cImg, this.cAnno, this.cUi].forEach(c => {
        c.width = w;
        c.height = h;
      });
    }

    const vw = this.cImg.width;
    const vh = this.cImg.height;
    const iw = S.currentData.width || S.imgBitmap.width;
    const ih = S.currentData.height || S.imgBitmap.height;
    if (iw <= 0 || ih <= 0 || vw <= 0 || vh <= 0) return;

    const sc = Math.min(vw / iw, vh / ih) * 0.94;
    S.scale = sc;
    S.panX = (vw - iw * sc) / 2;
    S.panY = (vh - ih * sc) / 2;
  }

  // แปลงพิกัดภาพ -> แคนวาส
  imgToCanvas(ix, iy) {
    const S = window.appState;
    return { x: ix * S.scale + S.panX, y: iy * S.scale + S.panY };
  }

  // แปลงพิกัดแคนวาส -> ภาพ
  canvasToImg(cx, cy) {
    const S = window.appState;
    return { x: (cx - S.panX) / S.scale, y: (cy - S.panY) / S.scale };
  }

  renderAll() {
    this.renderImage();
    this.renderAnnotations();
    this.renderUI();
  }

  renderImage() {
    const S = window.appState;
    const w = this.cImg.width;
    const h = this.cImg.height;
    this.ctxImg.clearRect(0, 0, w, h);

    if (!S.imgBitmap) return;
    const iw = S.currentData.width || S.imgBitmap.width;
    const ih = S.currentData.height || S.imgBitmap.height;
    this.ctxImg.drawImage(S.imgBitmap, S.panX, S.panY, iw * S.scale, ih * S.scale);
  }

  renderAnnotations() {
    const S = window.appState;
    const w = this.cAnno.width;
    const h = this.cAnno.height;
    this.ctxAnno.clearRect(0, 0, w, h);

    S.currentData.shapes.forEach((sh, i) => {
      const pts = sh.points;
      if (!pts || pts.length < 2) return;

      const isPolygon = (sh.shape_type === 'polygon' || sh.shape_type === 'rotation') && pts.length >= 4;
      const isSelected = i === S.selectedShapeIdx;
      const isHovered = i === S.hoveredShapeIdx;
      const color = S.getColor(sh.label);

      this.ctxAnno.save();

      if (isPolygon) {
        // วาด Polygon 4-Point (OBB)
        this.ctxAnno.beginPath();
        const p0 = this.imgToCanvas(pts[0][0], pts[0][1]);
        this.ctxAnno.moveTo(p0.x, p0.y);
        for (let j = 1; j < pts.length; j++) {
          const pj = this.imgToCanvas(pts[j][0], pts[j][1]);
          this.ctxAnno.lineTo(pj.x, pj.y);
        }
        this.ctxAnno.closePath();
        this.ctxAnno.fillStyle = this._hexToRgba(color, isSelected ? 0.28 : 0.12);
        this.ctxAnno.fill();
        this.ctxAnno.strokeStyle = color;
        this.ctxAnno.lineWidth = isSelected ? 3 : isHovered ? 2 : 1.5;
        this.ctxAnno.stroke();
      } else {
        // วาด Bounding Box ทั่วไป (รองรับทั้ง 2 จุด และ 4 จุด)
        const b = S.getShapeBounds(sh);
        const c1 = this.imgToCanvas(b.minX, b.minY);
        const c2 = this.imgToCanvas(b.maxX, b.maxY);
        const bw = c2.x - c1.x;
        const bh = c2.y - c1.y;

        this.ctxAnno.fillStyle = this._hexToRgba(color, isSelected ? 0.28 : 0.12);
        this.ctxAnno.fillRect(c1.x, c1.y, bw, bh);
        this.ctxAnno.strokeStyle = color;
        this.ctxAnno.lineWidth = isSelected ? 3 : isHovered ? 2 : 1.5;
        this.ctxAnno.strokeRect(c1.x, c1.y, bw, bh);
      }

      // วาดป้ายชื่อ Label Tag
      const b = S.getShapeBounds(sh);
      const tagPos = this.imgToCanvas(b.minX, b.minY);
      const tagText = sh.label + (sh.score ? ` ${(sh.score * 100).toFixed(0)}%` : '');
      const fs = Math.max(10, Math.min(13, 12 * S.scale));
      this.ctxAnno.font = `600 ${fs}px Inter, sans-serif`;
      const tw = this.ctxAnno.measureText(tagText).width;
      const th = fs + 6;

      this.ctxAnno.fillStyle = color;
      this.ctxAnno.fillRect(tagPos.x - 1, tagPos.y - th, tw + 8, th);
      this.ctxAnno.fillStyle = '#fff';
      this.ctxAnno.fillText(tagText, tagPos.x + 3, tagPos.y - 4);

      // วาด 8-Point Resize Handles (สำหรับกล่องที่เลือก)
      if (isSelected && !isPolygon) {
        this._renderHandles(sh, color);
      }

      this.ctxAnno.restore();
    });
  }

  _renderHandles(sh, color) {
    const S = window.appState;
    const handles = this.getHandles(sh);
    // Touch Mode: Handle ใหญ่ขึ้น 2.2 เท่า เพื่อให้นิ้วแตะง่าย
    const radius = S.inputMode === 'touch' ? 11 : 5.5;

    handles.forEach(hp => {
      const cp = this.imgToCanvas(hp.x, hp.y);
      this.ctxAnno.fillStyle = '#ffffff';
      this.ctxAnno.strokeStyle = color;
      this.ctxAnno.lineWidth = S.inputMode === 'touch' ? 2.5 : 1.5;
      this.ctxAnno.beginPath();
      this.ctxAnno.arc(cp.x, cp.y, radius, 0, Math.PI * 2);
      this.ctxAnno.fill();
      this.ctxAnno.stroke();
    });
  }

  renderUI() {
    const w = this.cUi.width;
    const h = this.cUi.height;
    this.ctxUi.clearRect(0, 0, w, h);

    // กำลังวาดกรอบใหม่
    if (this.drawStart && this.drawEnd) {
      const c1 = this.imgToCanvas(this.drawStart.x, this.drawStart.y);
      const c2 = this.imgToCanvas(this.drawEnd.x, this.drawEnd.y);
      const bx = Math.min(c1.x, c2.x);
      const by = Math.min(c1.y, c2.y);
      const bw = Math.abs(c2.x - c1.x);
      const bh = Math.abs(c2.y - c1.y);

      this.ctxUi.save();
      this.ctxUi.strokeStyle = '#3b82f6';
      this.ctxUi.lineWidth = 2;
      this.ctxUi.setLineDash([5, 4]);
      this.ctxUi.strokeRect(bx, by, bw, bh);
      this.ctxUi.fillStyle = 'rgba(59, 130, 246, 0.18)';
      this.ctxUi.fillRect(bx, by, bw, bh);
      this.ctxUi.restore();
    }
  }

  getHandles(sh) {
    const b = window.appState.getShapeBounds(sh);
    const mx = (b.minX + b.maxX) / 2;
    const my = (b.minY + b.maxY) / 2;

    return [
      { x: b.minX, y: b.minY }, { x: mx, y: b.minY }, { x: b.maxX, y: b.minY },
      { x: b.minX, y: my },                             { x: b.maxX, y: my },
      { x: b.minX, y: b.maxY }, { x: mx, y: b.maxY }, { x: b.maxX, y: b.maxY }
    ];
  }

  hitHandle(sh, cx, cy) {
    const S = window.appState;
    const handles = this.getHandles(sh);
    const hitThreshold = S.inputMode === 'touch' ? 22 : 10;

    for (let i = 0; i < handles.length; i++) {
      const cp = this.imgToCanvas(handles[i].x, handles[i].y);
      if (Math.hypot(cx - cp.x, cy - cp.y) <= hitThreshold) return i;
    }
    return -1;
  }

  hitShape(cx, cy) {
    const S = window.appState;
    for (let i = S.currentData.shapes.length - 1; i >= 0; i--) {
      const sh = S.currentData.shapes[i];
      if ((sh.shape_type === 'polygon' || sh.shape_type === 'rotation') && sh.points.length >= 3) {
        // Point in Polygon
        if (this._pointInPoly(cx, cy, sh.points)) return i;
      } else {
        const b = S.getShapeBounds(sh);
        const c1 = this.imgToCanvas(b.minX, b.minY);
        const c2 = this.imgToCanvas(b.maxX, b.maxY);
        if (cx >= c1.x && cx <= c2.x && cy >= c1.y && cy <= c2.y) return i;
      }
    }
    return -1;
  }

  _pointInPoly(cx, cy, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const pi = this.imgToCanvas(pts[i][0], pts[i][1]);
      const pj = this.imgToCanvas(pts[j][0], pts[j][1]);
      const intersect = ((pi.y > cy) !== (pj.y > cy)) &&
        (cx < (pj.x - pi.x) * (cy - pi.y) / (pj.y - pi.y) + pi.x);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  _hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
}

window.canvasRenderer = new CanvasRenderer();
