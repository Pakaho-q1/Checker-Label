/**
 * Interaction Manager
 * รับผิดชอบการแยกแยะ Touch (Android/Mobile) vs Mouse (PC)
 * รองรับการลาก Bbox, ยืดหด 8-point handles, Pinch-to-zoom 2 นิ้ว,
 * และ Drag & Drop Label จากแถบขวามาวางทับ Bbox หรือวางที่ว่าง
 */
class InteractionManager {
  constructor() {
    this.wrap = document.getElementById('canvas-wrap');
    this.cUi = document.getElementById('canvas-ui');
    this.ghost = document.getElementById('drag-ghost');

    // Pointer Tracking
    this.activePointers = new Map();
    this.lastPinchDist = null;

    // Drag / Resize State
    this.isDraggingShape = false;
    this.dragOffset = { x: 0, y: 0 };
    this.isResizing = false;
    this.resizeHandleIdx = -1;
    this.resizeAnchor = null;

    // Panning State
    this.isPanning = false;
    this.panStart = { x: 0, y: 0 };

    // Drawing State
    this.isDrawing = false;

    // Blank Tap State (สร้าง Bbox ด้วยการแตะที่ว่าง)
    this.isPotentialBlankTap = false;
    this.blankTapStartPos = null;
    this.blankTapImgPos = null;

    this.bindEvents();
  }

  bindEvents() {
    this.cUi.addEventListener('pointerdown', e => this.onPointerDown(e));
    this.cUi.addEventListener('pointermove', e => this.onPointerMove(e));
    this.cUi.addEventListener('pointerup', e => this.onPointerUp(e));
    this.cUi.addEventListener('pointercancel', e => this.onPointerUp(e));
    this.cUi.addEventListener('wheel', e => this.onWheel(e), { passive: false });
    this.cUi.addEventListener('contextmenu', e => e.preventDefault());
  }

  detectInputMode(e) {
    const S = window.appState;
    const mode = e.pointerType === 'touch' ? 'touch' : 'mouse';
    if (S.inputMode !== mode) {
      S.inputMode = mode;
      window.canvasRenderer.renderAnnotations();
    }
  }

  getCanvasPos(e) {
    const r = this.cUi.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  onPointerDown(e) {
    this.detectInputMode(e);
    try {
      this.cUi.setPointerCapture(e.pointerId);
    } catch (err) {}
    this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const S = window.appState;
    const R = window.canvasRenderer;
    const pos = this.getCanvasPos(e);
    const imgPos = R.canvasToImg(pos.x, pos.y);

    // ── 2 นิ้ว: Pinch to Zoom & Pan (Mobile Touch) ──
    if (this.activePointers.size === 2) {
      this.isDrawing = false;
      this.isDraggingShape = false;
      this.isResizing = false;
      R.drawStart = null;
      R.drawEnd = null;

      const pts = Array.from(this.activePointers.values());
      this.lastPinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      this.panStart = {
        x: (pts[0].x + pts[1].x) / 2 - S.panX,
        y: (pts[0].y + pts[1].y) / 2 - S.panY
      };
      return;
    }

    // ── โหมดเลื่อนภาพ: Pan Tool หรือ คลิกกลาง หรือ คลิกขวา ──
    if (S.activeTool === 'pan' || e.button === 1 || e.button === 2) {
      e.preventDefault();
      this.isPanning = true;
      this.panStart = { x: pos.x - S.panX, y: pos.y - S.panY };
      this.cUi.style.cursor = 'grabbing';
      return;
    }

    if (e.button !== 0 && e.pointerType === 'mouse') return;

    // ── โหมดวาดกรอบใหม่ (Draw Tool) ──
    if (S.activeTool === 'draw') {
      S.pushHistory();
      this.isDrawing = true;
      R.drawStart = { x: imgPos.x, y: imgPos.y };
      R.drawEnd = { x: imgPos.x, y: imgPos.y };
      R.renderUI();
      return;
    }

    // ── โหมดเลือก / แก้ไข (Select Tool) ──
    if (S.activeTool === 'select') {
      // 1. ตรวจจับการแตะที่ 8-Point Resize Handles ของกล่องที่เลือก
      if (S.selectedShapeIdx >= 0) {
        const selShape = S.currentData.shapes[S.selectedShapeIdx];
        if (selShape && selShape.shape_type !== 'polygon') {
          const handleIdx = R.hitHandle(selShape, pos.x, pos.y);
          if (handleIdx >= 0) {
            S.pushHistory();
            this.isResizing = true;
            this.resizeHandleIdx = handleIdx;
            const b = S.getShapeBounds(selShape);
            this.resizeAnchor = { x1: b.minX, y1: b.minY, x2: b.maxX, y2: b.maxY };

            if (navigator.vibrate) navigator.vibrate(20);
            return;
          }
        }
      }

      // 2. ตรวจจับการแตะที่ตัวกล่อง Bbox
      const hitIdx = R.hitShape(pos.x, pos.y);
      if (hitIdx >= 0) {
        S.selectedShapeIdx = hitIdx;
        const hitShape = S.currentData.shapes[hitIdx];
        const b = S.getShapeBounds(hitShape);

        this.isDraggingShape = true;
        this.dragOffset = { x: imgPos.x - b.minX, y: imgPos.y - b.minY };
        S.pushHistory();

        if (navigator.vibrate) navigator.vibrate(25);
        R.renderAnnotations();
        S.notify('selection_change');
        if (window.app) window.app.renderLabelList();
        return;
      }

      // 3. แตะพื้นที่ว่าง
      // ถ้าเดิมมี Bbox ถูกเลือกอยู่ -> แตะพื้นที่ว่างเพื่อยกเลิกการเลือก
      if (S.selectedShapeIdx >= 0) {
        S.selectedShapeIdx = -1;
        R.renderAnnotations();
        S.notify('selection_change');
        if (window.app) window.app.renderLabelList();
        return;
      }

      // ถ้าไม่มี Bbox ถูกเลือกอยู่ -> เตรียมสร้าง Bbox ของคลาสที่เลือก (activeDrawLabel)
      this.isPotentialBlankTap = true;
      this.blankTapStartPos = { x: pos.x, y: pos.y };
      this.blankTapImgPos = { x: imgPos.x, y: imgPos.y };
      R.drawStart = { x: imgPos.x, y: imgPos.y };
      R.drawEnd = { x: imgPos.x, y: imgPos.y };
    }
  }

  onPointerMove(e) {
    this.detectInputMode(e);
    this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const S = window.appState;
    const R = window.canvasRenderer;
    const pos = this.getCanvasPos(e);
    const imgPos = R.canvasToImg(pos.x, pos.y);

    // ── 2 นิ้ว: Pinch-to-zoom (Touch) ──
    if (this.activePointers.size === 2) {
      const pts = Array.from(this.activePointers.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const mid = {
        x: (pts[0].x + pts[1].x) / 2,
        y: (pts[0].y + pts[1].y) / 2
      };

      if (this.lastPinchDist) {
        const factor = dist / this.lastPinchDist;
        const newScale = Math.max(0.1, Math.min(15, S.scale * factor));
        // ซูมเข้าหาจุดกึ่งกลางระหว่าง 2 นิ้ว
        S.panX = mid.x - (mid.x - S.panX) * (newScale / S.scale);
        S.panY = mid.y - (mid.y - S.panY) * (newScale / S.scale);
        S.scale = newScale;
        R.renderAll();
      }
      this.lastPinchDist = dist;
      return;
    }

    // ── เลื่อนภาพ (Pan) ──
    if (this.isPanning) {
      S.panX = pos.x - this.panStart.x;
      S.panY = pos.y - this.panStart.y;
      R.renderAll();
      return;
    }

    // ── วาดกรอบใหม่ หรือลากบนพื้นที่ว่าง ──
    if (this.isPotentialBlankTap && this.blankTapStartPos) {
      const dist = Math.hypot(pos.x - this.blankTapStartPos.x, pos.y - this.blankTapStartPos.y);
      if (dist > 10) {
        this.isPotentialBlankTap = false;
        this.isDrawing = true;
        S.pushHistory();
      }
    }

    if (this.isDrawing) {
      R.drawEnd = {
        x: Math.max(0, Math.min(S.currentData.width, imgPos.x)),
        y: Math.max(0, Math.min(S.currentData.height, imgPos.y))
      };
      R.renderUI();
      return;
    }

    // ── ย้ายตำแหน่งกรอบที่เลือก ──
    if (this.isDraggingShape && S.selectedShapeIdx >= 0) {
      const sh = S.currentData.shapes[S.selectedShapeIdx];
      if (sh && sh.shape_type !== 'polygon') {
        const b = S.getShapeBounds(sh);
        const w = b.w;
        const h = b.h;

        const newX1 = Math.max(0, Math.min(S.currentData.width - w, imgPos.x - this.dragOffset.x));
        const newY1 = Math.max(0, Math.min(S.currentData.height - h, imgPos.y - this.dragOffset.y));

        if (sh.points.length === 4) {
          sh.points = [
            [Math.round(newX1), Math.round(newY1)],
            [Math.round(newX1 + w), Math.round(newY1)],
            [Math.round(newX1 + w), Math.round(newY1 + h)],
            [Math.round(newX1), Math.round(newY1 + h)]
          ];
        } else {
          sh.points = [
            [Math.round(newX1), Math.round(newY1)],
            [Math.round(newX1 + w), Math.round(newY1 + h)]
          ];
        }
        R.renderAnnotations();
      }
      return;
    }

    // ── ปรับขนาดกล่อง (8-Point Resize) ──
    if (this.isResizing && S.selectedShapeIdx >= 0) {
      const sh = S.currentData.shapes[S.selectedShapeIdx];
      if (sh && this.resizeAnchor) {
        let { x1, y1, x2, y2 } = this.resizeAnchor;
        const cx = Math.max(0, Math.min(S.currentData.width, imgPos.x));
        const cy = Math.max(0, Math.min(S.currentData.height, imgPos.y));

        // 8 Handles: 0:TL, 1:TC, 2:TR, 3:ML, 4:MR, 5:BL, 6:BC, 7:BR
        switch (this.resizeHandleIdx) {
          case 0: x1 = cx; y1 = cy; break;
          case 1: y1 = cy; break;
          case 2: x2 = cx; y1 = cy; break;
          case 3: x1 = cx; break;
          case 4: x2 = cx; break;
          case 5: x1 = cx; y2 = cy; break;
          case 6: y2 = cy; break;
          case 7: x2 = cx; y2 = cy; break;
        }

        const minX = Math.round(Math.min(x1, x2));
        const minY = Math.round(Math.min(y1, y2));
        const maxX = Math.round(Math.max(x1, x2));
        const maxY = Math.round(Math.max(y1, y2));

        if (sh.points.length === 4) {
          sh.points = [
            [minX, minY],
            [maxX, minY],
            [maxX, maxY],
            [minX, maxY]
          ];
        } else {
          sh.points = [
            [minX, minY],
            [maxX, maxY]
          ];
        }
        R.renderAnnotations();
      }
      return;
    }

    // ── Mouse Hover Check & Cursor Feedback (PC Only) ──
    if (S.inputMode === 'mouse') {
      if (this.isPanning) {
        this.cUi.style.cursor = 'grabbing';
      } else if (S.activeTool === 'pan') {
        this.cUi.style.cursor = 'grab';
      } else if (S.activeTool === 'draw') {
        this.cUi.style.cursor = 'crosshair';
      } else if (S.activeTool === 'select') {
        let cursor = 'default';
        if (S.selectedShapeIdx >= 0) {
          const selShape = S.currentData.shapes[S.selectedShapeIdx];
          if (selShape && selShape.shape_type !== 'polygon') {
            const hIdx = R.hitHandle(selShape, pos.x, pos.y);
            if (hIdx >= 0) {
              const cursors = ['nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize', 'ew-resize', 'nesw-resize', 'ns-resize', 'nwse-resize'];
              cursor = cursors[hIdx] || 'pointer';
            }
          }
        }
        if (cursor === 'default') {
          const hitIdx = R.hitShape(pos.x, pos.y);
          if (hitIdx >= 0) {
            cursor = 'move';
          }
        }
        this.cUi.style.cursor = cursor;

        const hoverIdx = R.hitShape(pos.x, pos.y);
        if (hoverIdx !== S.hoveredShapeIdx) {
          S.hoveredShapeIdx = hoverIdx;
          R.renderAnnotations();
        }
      }
    }
  }

  onPointerUp(e) {
    this.activePointers.delete(e.pointerId);
    if (this.activePointers.size < 2) {
      this.lastPinchDist = null;
    }

    const S = window.appState;
    const R = window.canvasRenderer;

    // สิ้นสุดการวาดกรอบ
    if (this.isDrawing && R.drawStart && R.drawEnd) {
      this.isDrawing = false;
      const x1 = Math.round(Math.min(R.drawStart.x, R.drawEnd.x));
      const y1 = Math.round(Math.min(R.drawStart.y, R.drawEnd.y));
      const x2 = Math.round(Math.max(R.drawStart.x, R.drawEnd.x));
      const y2 = Math.round(Math.max(R.drawStart.y, R.drawEnd.y));

      // สร้างกล่องถ้าขนาดมากกว่า 8px
      if ((x2 - x1) > 8 && (y2 - y1) > 8) {
        const label = S.activeDrawLabel || (S.classes[0] || 'OBJECT');
        const newShape = {
          label: label,
          score: null,
          points: [[x1, y1], [x2, y2]],
          group_id: null,
          description: "",
          difficult: false,
          shape_type: "rectangle",
          flags: {},
          attributes: {}
        };
        S.currentData.shapes.push(newShape);
        S.selectedShapeIdx = S.currentData.shapes.length - 1;

        if (navigator.vibrate) navigator.vibrate([20, 50, 20]);
        window.app.showToast(`สร้างกรอบ '${label}' สำเร็จ`);
      }

      R.drawStart = null;
      R.drawEnd = null;
      R.renderAll();
      S.notify('shapes_change');
      if (window.app) window.app.renderLabelList();
      return;
    }

    // ── แตะที่ว่าง (Tap on blank canvas) -> สร้าง Bbox ตามคลาสที่เลือกทันที ──
    if (this.isPotentialBlankTap && this.blankTapImgPos) {
      this.isPotentialBlankTap = false;
      const bPos = this.blankTapImgPos;
      this.blankTapImgPos = null;

      const defaultW = Math.max(50, Math.round(130 / S.scale));
      const defaultH = Math.max(40, Math.round(100 / S.scale));
      const x1 = Math.max(0, Math.round(bPos.x - defaultW / 2));
      const y1 = Math.max(0, Math.round(bPos.y - defaultH / 2));
      const x2 = Math.min(S.currentData.width, x1 + defaultW);
      const y2 = Math.min(S.currentData.height, y1 + defaultH);

      S.pushHistory();
      const label = S.activeDrawLabel || (S.classes[0] || 'OBJECT');
      const newShape = {
        label: label,
        score: null,
        points: [[x1, y1], [x2, y2]],
        group_id: null,
        description: "",
        difficult: false,
        shape_type: "rectangle",
        flags: {},
        attributes: {}
      };
      S.currentData.shapes.push(newShape);
      S.selectedShapeIdx = S.currentData.shapes.length - 1;

      R.renderAnnotations();
      S.notify('shapes_change');
      if (window.app) window.app.renderLabelList();

      if (navigator.vibrate) navigator.vibrate([20, 50, 20]);
      window.app.showToast(`✨ สร้างกรอบ '${label}' สำเร็จ`);
      return;
    }

    this.isPotentialBlankTap = false;
    this.blankTapImgPos = null;

    if (this.isDraggingShape || this.isResizing) {
      this.isDraggingShape = false;
      this.isResizing = false;
      this.resizeHandleIdx = -1;
      this.resizeAnchor = null;
      S.notify('shapes_change');
    }

    if (this.isPanning) {
      this.isPanning = false;
      if (S.inputMode === 'mouse') {
        this.cUi.style.cursor = S.activeTool === 'pan' ? 'grab' : (S.activeTool === 'draw' ? 'crosshair' : 'default');
      }
    }
  }

  // ── Wheel Zoom (PC Mouse) ──
  onWheel(e) {
    e.preventDefault();
    const S = window.appState;
    const R = window.canvasRenderer;
    const pos = this.getCanvasPos(e);

    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
    const newScale = Math.max(0.05, Math.min(30, S.scale * zoomFactor));

    S.panX = pos.x - (pos.x - S.panX) * (newScale / S.scale);
    S.panY = pos.y - (pos.y - S.panY) * (newScale / S.scale);
    S.scale = newScale;
    R.renderAll();
    if (window.app) window.app.updateZoomDisplay();
  }
}

window.interactionManager = new InteractionManager();
