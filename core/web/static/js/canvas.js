/**
 * Canvas Rendering Component
 * รับผิดชอบการวาดภาพ, Bounding Boxes, Labels และ 8-point Resize Handles
 * แยกการคำนวณคณิตศาสตร์และเรขาคณิตไปยัง ViewportEngine และ HitTestEngine อย่างหมดจด
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['./canvas/viewport_engine', './canvas/hit_test_engine'], factory);
  } else if (typeof module === 'object' && module.exports) {
    const ViewportEngine = require('./canvas/viewport_engine');
    const HitTestEngine = require('./canvas/hit_test_engine');
    module.exports = factory(ViewportEngine, HitTestEngine);
  } else {
    root.CanvasRenderer = factory(root.ViewportEngine, root.HitTestEngine);
  }
}(typeof self !== 'undefined' ? self : this, function (ViewportEngine, HitTestEngine) {
  'use strict';

  class CanvasRenderer {
    constructor(options = {}) {
      this.viewportEngine = options.viewportEngine || (ViewportEngine ? new ViewportEngine() : null);
      this.hitTestEngine = options.hitTestEngine || HitTestEngine;

      if (typeof document !== 'undefined') {
        this.wrap = document.getElementById('canvas-wrap');
        this.cImg = document.getElementById('canvas-img');
        this.cAnno = document.getElementById('canvas-anno');
        this.cUi = document.getElementById('canvas-ui');

        if (this.cImg && this.cAnno && this.cUi) {
          this.ctxImg = this.cImg.getContext('2d');
          this.ctxAnno = this.cAnno.getContext('2d');
          this.ctxUi = this.cUi.getContext('2d');
        }

        // Drawing in progress
        this.drawStart = null;
        this.drawEnd = null;

        this.initResizeListener();
        this.resizeCanvases();
      }
    }

    initResizeListener() {
      if (typeof window === 'undefined') return;
      window.addEventListener('resize', () => {
        this.resizeCanvases();
        if (window.app) window.app.updateZoomDisplay();
      });
    }

    resizeCanvases() {
      if (!this.wrap || !this.cImg) return;
      const leftW = document.getElementById('left-toolbar')?.clientWidth || 50;
      const w = this.wrap.clientWidth || (window.innerWidth - leftW - (window.innerWidth <= 900 ? 0 : 230));
      const h = this.wrap.clientHeight || (window.innerHeight - 78);
      if (w <= 0 || h <= 0) return;
      [this.cImg, this.cAnno, this.cUi].forEach(c => {
        if (c.width !== w) c.width = w;
        if (c.height !== h) c.height = h;
      });
      this.renderAll();
    }

    fitImageToView() {
      const S = typeof window !== 'undefined' ? window.appState : null;
      if (!S || !S.imgBitmap) return;

      const w = this.wrap ? this.wrap.clientWidth : 0;
      const h = this.wrap ? this.wrap.clientHeight : 0;
      if (w > 0 && h > 0) {
        [this.cImg, this.cAnno, this.cUi].forEach(c => {
          if (c.width !== w) c.width = w;
          if (c.height !== h) c.height = h;
        });
      }

      const vw = this.cImg.width;
      const vh = this.cImg.height;
      const iw = S.imgBitmap.width;
      const ih = S.imgBitmap.height;
      if (iw <= 0 || ih <= 0 || vw <= 0 || vh <= 0) return;

      // มอบหมายให้ ViewportEngine คำนวณ Aspect Ratio Fit
      if (this.viewportEngine) {
        const fit = this.viewportEngine.calculateFit(iw, ih, vw, vh, 15);
        S.scale = fit.scale;
        S.panX = fit.panX;
        S.panY = fit.panY;
      } else {
        const sc = Math.min(vw / iw, vh / ih) * 0.95;
        S.scale = sc;
        S.panX = (vw - iw * sc) / 2;
        S.panY = (vh - ih * sc) / 2;
      }
    }

    // แปลงพิกัดภาพ -> แคนวาส
    imgToCanvas(ix, iy) {
      const S = typeof window !== 'undefined' ? window.appState : null;
      if (!S) return { x: ix, y: iy };
      if (this.viewportEngine) {
        return this.viewportEngine.imgToCanvas(ix, iy, S.panX, S.panY, S.scale);
      }
      return { x: ix * S.scale + S.panX, y: iy * S.scale + S.panY };
    }

    // แปลงพิกัดแคนวาส -> ภาพ
    canvasToImg(cx, cy) {
      const S = typeof window !== 'undefined' ? window.appState : null;
      if (!S) return { x: cx, y: cy };
      if (this.viewportEngine) {
        return this.viewportEngine.canvasToImg(cx, cy, S.panX, S.panY, S.scale);
      }
      return { x: (cx - S.panX) / S.scale, y: (cy - S.panY) / S.scale };
    }

    renderAll() {
      this.renderImage();
      this.renderAnnotations();
      this.renderUI();
    }

    renderImage() {
      const S = typeof window !== 'undefined' ? window.appState : null;
      if (!S || !this.ctxImg) return;
      const w = this.cImg.width;
      const h = this.cImg.height;
      this.ctxImg.clearRect(0, 0, w, h);

      if (!S.imgBitmap) return;
      const iw = S.imgBitmap.width;
      const ih = S.imgBitmap.height;
      this.ctxImg.drawImage(S.imgBitmap, S.panX, S.panY, iw * S.scale, ih * S.scale);
    }

    renderAnnotations() {
      const S = typeof window !== 'undefined' ? window.appState : null;
      if (!S || !this.ctxAnno) return;
      const w = this.cAnno.width;
      const h = this.cAnno.height;
      this.ctxAnno.clearRect(0, 0, w, h);

      // ── ชั้นที่ 1: วาด Low-Conf Candidates (กรอบประสีส้มทอง) ──
      this._renderLowConfCandidates();

      // ── ชั้นที่ 2: วาด Primary Bboxes ปกติ (แสดงทุกกล่องบนภาพตามความเป็นจริง ไม่ซ่อน BBox ใดๆ) ──
      const shapes = S.currentData.shapes || [];

      shapes.forEach((sh, idx) => {
        const isSelected = idx === S.selectedShapeIdx;
        const isHovered = idx === S.hoveredShapeIdx;

        const color = S.getColor(sh.label);

        this.ctxAnno.save();

        const isPolygon = (sh.shape_type === 'polygon' || sh.shape_type === 'rotation') && sh.points.length >= 3;
        if (isPolygon) {
          this.ctxAnno.beginPath();
          sh.points.forEach((pt, pi) => {
            const cp = this.imgToCanvas(pt[0], pt[1]);
            if (pi === 0) this.ctxAnno.moveTo(cp.x, cp.y);
            else this.ctxAnno.lineTo(cp.x, cp.y);
          });
          this.ctxAnno.closePath();
        } else {
          const b = S.getShapeBounds(sh);
          const c1 = this.imgToCanvas(b.minX, b.minY);
          const c2 = this.imgToCanvas(b.maxX, b.maxY);
          const bx = Math.min(c1.x, c2.x);
          const by = Math.min(c1.y, c2.y);
          const bw = Math.abs(c2.x - c1.x);
          const bh = Math.abs(c2.y - c1.y);

          this.ctxAnno.beginPath();
          this.ctxAnno.rect(bx, by, bw, bh);
        }

        // สไตล์เมื่อถูกเลือก หรือโฮเวอร์
        if (isSelected) {
          this.ctxAnno.fillStyle = this._hexToRgba(color, 0.28);
          this.ctxAnno.fill();
          this.ctxAnno.strokeStyle = '#ffffff';
          this.ctxAnno.lineWidth = S.inputMode === 'touch' ? 3.5 : 2.5;
          this.ctxAnno.stroke();
          this.ctxAnno.strokeStyle = color;
          this.ctxAnno.lineWidth = S.inputMode === 'touch' ? 2 : 1.5;
          this.ctxAnno.stroke();
        } else if (isHovered) {
          this.ctxAnno.fillStyle = this._hexToRgba(color, 0.18);
          this.ctxAnno.fill();
          this.ctxAnno.strokeStyle = color;
          this.ctxAnno.lineWidth = 2.5;
          this.ctxAnno.stroke();
        } else {
          this.ctxAnno.fillStyle = this._hexToRgba(color, 0.08);
          this.ctxAnno.fill();
          this.ctxAnno.strokeStyle = color;
          this.ctxAnno.lineWidth = 1.8;
          this.ctxAnno.stroke();
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

        // วาด 8-Point Resize Handles สำหรับกล่องที่เลือก
        if (isSelected && !isPolygon) {
          this._renderHandles(sh, color);
        }

        this.ctxAnno.restore();
      });
    }

    _renderLowConfCandidates() {
      const S = typeof window !== 'undefined' ? window.appState : null;
      if (!S || !S.currentData || !S.currentData.raw_shapes) return;

      // หากผู้ใช้ไม่ได้ติ๊กเลือกแสดง Low-Conf (ลายปะ) ให้เคลียร์และข้ามทันที
      if (S.showLowConf === false) {
        this.visibleLowConfShapes = [];
        S.lowConfCount = 0;
        return;
      }

      const rawShapes = S.currentData.raw_shapes;
      const confMin = S.confMin !== undefined ? S.confMin : 0.05;
      const confMax = S.confMax !== undefined ? S.confMax : (S.confThreshold || 0.50);
      const primaryShapesStr = JSON.stringify(S.currentData.shapes || []);

      const visibleCandidates = [];

      rawShapes.forEach((rawSh, rawIdx) => {
        const score = typeof rawSh.score === 'number' ? rawSh.score : 1.0;
        if (score < confMin || score > confMax) return;

        const rawStr = JSON.stringify(rawSh.points);
        if (primaryShapesStr.includes(rawStr)) return;

        visibleCandidates.push(rawSh);

        const b = S.getShapeBounds(rawSh);
        const c1 = this.imgToCanvas(b.minX, b.minY);
        const c2 = this.imgToCanvas(b.maxX, b.maxY);
        const bx = Math.min(c1.x, c2.x);
        const by = Math.min(c1.y, c2.y);
        const bw = Math.abs(c2.x - c1.x);
        const bh = Math.abs(c2.y - c1.y);

        const isHovered = S.hoveredLowConfIdx === rawIdx;

        this.ctxAnno.save();
        this.ctxAnno.strokeStyle = isHovered ? '#fbbf24' : '#eab308';
        this.ctxAnno.lineWidth = isHovered ? 2.5 : 1.6;
        this.ctxAnno.setLineDash([4, 3]);
        this.ctxAnno.strokeRect(bx, by, bw, bh);

        this.ctxAnno.fillStyle = isHovered ? 'rgba(234, 179, 8, 0.22)' : 'rgba(234, 179, 8, 0.08)';
        this.ctxAnno.fillRect(bx, by, bw, bh);

        const pctText = `[${Math.round(score * 100)}% ⚠️ คลิกรับ] ${rawSh.label || ''}`;
        const fs = Math.max(9, Math.min(12, 11 * S.scale));
        this.ctxAnno.font = `600 ${fs}px Inter, sans-serif`;
        const tw = this.ctxAnno.measureText(pctText).width;
        const th = fs + 4;

        this.ctxAnno.setLineDash([]);
        this.ctxAnno.fillStyle = isHovered ? '#f59e0b' : '#b45309';
        this.ctxAnno.fillRect(bx, by - th, tw + 6, th);
        this.ctxAnno.fillStyle = '#ffffff';
        this.ctxAnno.fillText(pctText, bx + 3, by - 3);

        this.ctxAnno.restore();
      });

      this.visibleLowConfShapes = visibleCandidates;
      S.lowConfCount = visibleCandidates.length;
    }

    _renderHandles(sh, color) {
      const S = typeof window !== 'undefined' ? window.appState : null;
      if (!S) return;
      const handles = this.getHandles(sh);
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
      if (!this.ctxUi) return;
      const w = this.cUi.width;
      const h = this.cUi.height;
      this.ctxUi.clearRect(0, 0, w, h);

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
      const S = typeof window !== 'undefined' ? window.appState : null;
      if (!S) return [];
      const b = S.getShapeBounds(sh);
      if (this.hitTestEngine) {
        return this.hitTestEngine.calculateHandlePositions(b.minX, b.minY, b.maxX, b.maxY);
      }
      const mx = (b.minX + b.maxX) / 2;
      const my = (b.minY + b.maxY) / 2;
      return [
        { x: b.minX, y: b.minY }, { x: mx, y: b.minY }, { x: b.maxX, y: b.minY },
        { x: b.minX, y: my },                             { x: b.maxX, y: my },
        { x: b.minX, y: b.maxY }, { x: mx, y: b.maxY }, { x: b.maxX, y: b.maxY }
      ];
    }

    hitHandle(sh, cx, cy) {
      const S = typeof window !== 'undefined' ? window.appState : null;
      if (!S) return -1;
      const handles = this.getHandles(sh);
      const hitThreshold = S.inputMode === 'touch' ? 22 : 10;

      for (let i = 0; i < handles.length; i++) {
        const cp = this.imgToCanvas(handles[i].x, handles[i].y);
        if (Math.hypot(cx - cp.x, cy - cp.y) <= hitThreshold) return i;
      }
      return -1;
    }

    hitShape(cx, cy) {
      const S = typeof window !== 'undefined' ? window.appState : null;
      if (!S) return -1;
      const imgPos = this.canvasToImg(cx, cy);

      if (this.hitTestEngine) {
        const hit = this.hitTestEngine.findHitShape(imgPos.x, imgPos.y, S.currentData.shapes, sh => S.getShapeBounds(sh));
        return hit ? hit.index : -1;
      }

      for (let i = S.currentData.shapes.length - 1; i >= 0; i--) {
        const sh = S.currentData.shapes[i];
        const b = S.getShapeBounds(sh);
        if (imgPos.x >= b.minX && imgPos.x <= b.maxX && imgPos.y >= b.minY && imgPos.y <= b.maxY) {
          return i;
        }
      }
      return -1;
    }

    hitLowConfShape(cx, cy) {
      const S = typeof window !== 'undefined' ? window.appState : null;
      if (!S || !this.visibleLowConfShapes || this.visibleLowConfShapes.length === 0) return -1;
      const imgPos = this.canvasToImg(cx, cy);

      for (let i = this.visibleLowConfShapes.length - 1; i >= 0; i--) {
        const sh = this.visibleLowConfShapes[i];
        const b = S.getShapeBounds(sh);
        if (imgPos.x >= b.minX && imgPos.x <= b.maxX && imgPos.y >= b.minY && imgPos.y <= b.maxY) {
          return i;
        }
      }
      return -1;
    }

    _hexToRgba(hex, alpha) {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
  }

  if (typeof window !== 'undefined') {
    window.canvasRenderer = new CanvasRenderer();
  }

  return CanvasRenderer;
}));
