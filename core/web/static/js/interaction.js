/**
 * Interaction Manager (Production-Grade Refactored)
 * ควบคุมการโต้ตอบด้วย Mouse / Touch / Pen ผ่าน Finite State Machine (FSM)
 * - แยกแยะท่าทาง 2 นิ้ว Pinch-to-zoom, Pan, Draw, Drag, Resize 8-point handles
 * - ป้องกัน Impossible States ไม่ให้ทำงานทับซ้อนกันเด็ดขาด
 * - รองรับ Drag & Drop Label จากแถบขวามาวางทับ Bbox หรือวางที่ว่าง
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['./constants/enums', './canvas/interaction_fsm'], factory);
  } else if (typeof module === 'object' && module.exports) {
    const enums = require('./constants/enums');
    const InteractionFSM = require('./canvas/interaction_fsm');
    module.exports = factory(enums, InteractionFSM);
  } else {
    root.InteractionManager = factory(root.Enums, root.InteractionFSM);
  }
}(typeof self !== 'undefined' ? self : this, function (Enums, InteractionFSM) {
  'use strict';

  const { InteractionState, ToolType, InputMode } = Enums;

  class InteractionManager {
    constructor(options = {}) {
      this.fsm = options.fsm || (InteractionFSM ? new InteractionFSM() : null);

      if (typeof document !== 'undefined') {
        this.wrap = document.getElementById('canvas-wrap');
        this.cUi = document.getElementById('canvas-ui');
        this.ghost = document.getElementById('drag-ghost');

        // Multi-touch Pointer Tracking
        this.activePointers = new Map();
        this.lastPinchDist = null;

        this.bindEvents();
      }
    }

    // ── Backward-compatible Getters เชื่อมต่อไปยัง FSM ──
    get isDraggingShape() { return this.fsm ? this.fsm.is(InteractionState.DRAGGING_SHAPE) : false; }
    get isResizing() { return this.fsm ? this.fsm.is(InteractionState.RESIZING_SHAPE) : false; }
    get isPanning() { return this.fsm ? this.fsm.is(InteractionState.PANNING) : false; }
    get isDrawing() { return this.fsm ? this.fsm.is(InteractionState.DRAWING) : false; }
    get isPotentialBlankTap() { return this.fsm ? this.fsm.is(InteractionState.POTENTIAL_TAP) : false; }

    bindEvents() {
      if (!this.cUi) return;

      this.cUi.addEventListener('pointerdown', e => this.onPointerDown(e));
      this.cUi.addEventListener('pointermove', e => this.onPointerMove(e));
      this.cUi.addEventListener('pointerup', e => this.onPointerUp(e));
      this.cUi.addEventListener('pointercancel', e => this.onPointerUp(e));
      this.cUi.addEventListener('wheel', e => this.onWheel(e), { passive: false });
      this.cUi.addEventListener('contextmenu', e => e.preventDefault());

      this.initDragDrop();
    }

    detectInputMode(e) {
      const S = typeof window !== 'undefined' ? window.appState : null;
      if (!S) return;
      const mode = e.pointerType === 'touch' ? InputMode.TOUCH : InputMode.MOUSE;
      if (S.inputMode !== mode) {
        S.setInputMode(mode);
        if (window.canvasRenderer) window.canvasRenderer.renderAnnotations();
      }
    }

    getCanvasPos(e) {
      if (!this.cUi) return { x: e.clientX, y: e.clientY };
      const r = this.cUi.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    onPointerDown(e) {
      this.detectInputMode(e);
      try {
        this.cUi.setPointerCapture(e.pointerId);
      } catch (err) {}
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      const S = typeof window !== 'undefined' ? window.appState : null;
      const R = typeof window !== 'undefined' ? window.canvasRenderer : null;
      if (!S || !R) return;

      const pos = this.getCanvasPos(e);
      const imgPos = R.canvasToImg(pos.x, pos.y);

      // ── กรณีที่ 1: ตรวจพบ 2 นิ้ว (Multi-touch Pinch to Zoom & Pan) ──
      if (this.activePointers.size >= 2) {
        R.drawStart = null;
        R.drawEnd = null;
        R.renderUI();

        const pts = Array.from(this.activePointers.values());
        const lastDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const r = this.cUi.getBoundingClientRect();
        const midCanvas = {
          x: (pts[0].x + pts[1].x) / 2 - r.left,
          y: (pts[0].y + pts[1].y) / 2 - r.top
        };

        this.lastPinchDist = lastDist;
        this.lastMid = midCanvas;
        this.fsm.transition(InteractionState.PINCH_ZOOMING, { lastDist, panStart: midCanvas });
        return;
      }

      // ── กรณีที่ 2: โหมดเลื่อนภาพ (Pan Tool หรือคลิกกลาง/คลิกขวา) ──
      if (S.activeTool === ToolType.PAN || e.button === 1 || e.button === 2) {
        e.preventDefault();
        const panStart = { x: pos.x - S.panX, y: pos.y - S.panY };
        this.cUi.style.cursor = 'grabbing';
        this.fsm.transition(InteractionState.PANNING, { panStart });
        return;
      }

      if (e.button !== 0 && e.pointerType === 'mouse') return;

      // ── กรณีที่ 3: โหมดวาดกรอบใหม่ (Draw Tool) ──
      if (S.activeTool === ToolType.DRAW) {
        S.pushHistory();
        R.drawStart = { x: imgPos.x, y: imgPos.y };
        R.drawEnd = { x: imgPos.x, y: imgPos.y };
        R.renderUI();
        this.fsm.transition(InteractionState.DRAWING, { startPos: imgPos });
        return;
      }

      // ── กรณีที่ 4: โหมดเลือก / แก้ไข (Select Tool) ──
      if (S.activeTool === ToolType.SELECT) {
        // 4.1 ตรวจจับการแตะที่ 8-Point Resize Handles ของกล่องที่เลือกอยู่
        if (S.selectedShapeIdx >= 0) {
          const selShape = S.currentData.shapes[S.selectedShapeIdx];
          if (selShape && selShape.shape_type !== 'polygon') {
            const handleIdx = R.hitHandle(selShape, pos.x, pos.y);
            if (handleIdx >= 0) {
              S.pushHistory();
              const b = S.getShapeBounds(selShape);
              const anchor = { x1: b.minX, y1: b.minY, x2: b.maxX, y2: b.maxY };

              if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(20);
              this.fsm.transition(InteractionState.RESIZING_SHAPE, { handleIdx, anchor });
              return;
            }
          }
        }

        // 4.2 ตรวจจับการแตะที่ตัวกล่อง Bbox เพื่อเลือกหรือเตรียมลากย้าย
        const hitIdx = R.hitShape(pos.x, pos.y);
        if (hitIdx >= 0) {
          S.selectShape(hitIdx);
          const hitShape = S.currentData.shapes[hitIdx];
          const b = S.getShapeBounds(hitShape);
          const dragOffset = { x: imgPos.x - b.minX, y: imgPos.y - b.minY };

          S.pushHistory();
          if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(25);
          R.renderAnnotations();
          if (window.app) window.app.renderLabelList();

          this.fsm.transition(InteractionState.DRAGGING_SHAPE, { shapeIdx: hitIdx, dragOffset });
          return;
        }

        // 4.3 ตรวจจับการแตะที่ตัวกล่อง Low-Conf Candidate (แตะรับเข้า shapes ทันที)
        const hitLowIdx = R.hitLowConfShape(pos.x, pos.y);
        if (hitLowIdx >= 0 && R.visibleLowConfShapes && R.visibleLowConfShapes[hitLowIdx]) {
          const candidate = R.visibleLowConfShapes[hitLowIdx];
          S.promoteLowConfShape(candidate);
          if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(30);
          R.renderAnnotations();
          if (window.app) {
            window.app.renderLabelList();
            window.app.showToast(`✅ ยอมรับกรอบ '${candidate.label}' [${Math.round((candidate.score || 0)*100)}%] เรียบร้อย`, 1200);
          }
          return;
        }

        // 4.4 แตะพื้นที่ว่าง
        if (S.selectedShapeIdx >= 0) {
          S.selectShape(-1);
          R.renderAnnotations();
          if (window.app) window.app.renderLabelList();
          return;
        }

        // เตรียมสร้าง Bbox แบบแตะด่วน
        R.drawStart = { x: imgPos.x, y: imgPos.y };
        R.drawEnd = { x: imgPos.x, y: imgPos.y };
        this.fsm.transition(InteractionState.POTENTIAL_TAP, { startPos: pos, imgPos: imgPos });
      }
    }

    onPointerMove(e) {
      this.detectInputMode(e);
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      const S = typeof window !== 'undefined' ? window.appState : null;
      const R = typeof window !== 'undefined' ? window.canvasRenderer : null;
      if (!S || !R) return;

      const pos = this.getCanvasPos(e);
      const imgPos = R.canvasToImg(pos.x, pos.y);

      // ตรวจจับ 2 นิ้วขึ้นไประหว่าง Move หากยังไม่ได้อยู่ในสถานะ PINCH_ZOOMING ให้สลับทันที
      if (this.activePointers.size >= 2 && this.fsm.currentState !== InteractionState.PINCH_ZOOMING) {
        R.drawStart = null;
        R.drawEnd = null;
        R.renderUI();
        const pts = Array.from(this.activePointers.values());
        const lastDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const r = this.cUi.getBoundingClientRect();
        const midCanvas = {
          x: (pts[0].x + pts[1].x) / 2 - r.left,
          y: (pts[0].y + pts[1].y) / 2 - r.top
        };
        this.lastPinchDist = lastDist;
        this.lastMid = midCanvas;
        this.fsm.transition(InteractionState.PINCH_ZOOMING, { lastDist, panStart: midCanvas });
        return;
      }

      // ── Dispatch ตามสถานะปัจจุบันของ FSM ──
      switch (this.fsm.currentState) {
        case InteractionState.PINCH_ZOOMING: {
          if (this.activePointers.size >= 2) {
            const pts = Array.from(this.activePointers.values());
            const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
            const r = this.cUi.getBoundingClientRect();
            const canvasMidX = (pts[0].x + pts[1].x) / 2 - r.left;
            const canvasMidY = (pts[0].y + pts[1].y) / 2 - r.top;

            if (this.lastPinchDist && this.lastPinchDist > 0 && this.lastMid) {
              const factor = dist / this.lastPinchDist;
              const refMid = this.lastMid;
              const newScale = Math.max(0.05, Math.min(30, S.scale * factor));
              const scaleRatio = newScale / S.scale;

              const nextPanX = canvasMidX - (refMid.x - S.panX) * scaleRatio;
              const nextPanY = canvasMidY - (refMid.y - S.panY) * scaleRatio;
              const dx = canvasMidX - refMid.x;
              const dy = canvasMidY - refMid.y;

              S.panX = nextPanX + dx;
              S.panY = nextPanY + dy;
              S.scale = newScale;
              R.renderAll();
            }
            this.lastPinchDist = dist;
            this.lastMid = { x: canvasMidX, y: canvasMidY };
          }
          return;
        }

        case InteractionState.PANNING: {
          const panStart = this.fsm.context.panStart || { x: 0, y: 0 };
          S.panX = pos.x - panStart.x;
          S.panY = pos.y - panStart.y;
          R.renderAll();
          return;
        }

        case InteractionState.POTENTIAL_TAP: {
          const startPos = this.fsm.context.startPos;
          if (startPos) {
            const dist = Math.hypot(pos.x - startPos.x, pos.y - startPos.y);
            if (dist > 10) {
              // เปลี่ยนผ่านสถานะไปเป็น DRAWING เมื่อลากเกิน 10px
              S.pushHistory();
              this.fsm.transition(InteractionState.DRAWING, { startPos: this.fsm.context.imgPos });
            }
          }
          return;
        }

        case InteractionState.DRAWING: {
          R.drawEnd = {
            x: Math.max(0, Math.min(S.currentData.width, imgPos.x)),
            y: Math.max(0, Math.min(S.currentData.height, imgPos.y))
          };
          R.renderUI();
          return;
        }

        case InteractionState.DRAGGING_SHAPE: {
          if (S.selectedShapeIdx >= 0) {
            const sh = S.currentData.shapes[S.selectedShapeIdx];
            if (sh && sh.shape_type !== 'polygon') {
              const b = S.getShapeBounds(sh);
              const dragOffset = this.fsm.context.dragOffset || { x: 0, y: 0 };

              const newX1 = Math.max(0, Math.min(S.currentData.width - b.w, imgPos.x - dragOffset.x));
              const newY1 = Math.max(0, Math.min(S.currentData.height - b.h, imgPos.y - dragOffset.y));

              if (sh.points.length === 4) {
                sh.points = [
                  [Math.round(newX1), Math.round(newY1)],
                  [Math.round(newX1 + b.w), Math.round(newY1)],
                  [Math.round(newX1 + b.w), Math.round(newY1 + b.h)],
                  [Math.round(newX1), Math.round(newY1 + b.h)]
                ];
              } else {
                sh.points = [
                  [Math.round(newX1), Math.round(newY1)],
                  [Math.round(newX1 + b.w), Math.round(newY1 + b.h)]
                ];
              }
              R.renderAnnotations();
            }
          }
          return;
        }

        case InteractionState.RESIZING_SHAPE: {
          if (S.selectedShapeIdx >= 0) {
            const sh = S.currentData.shapes[S.selectedShapeIdx];
            const anchor = this.fsm.context.anchor;
            const handleIdx = this.fsm.context.handleIdx;

            if (sh && anchor) {
              let { x1, y1, x2, y2 } = anchor;
              const cx = Math.max(0, Math.min(S.currentData.width, imgPos.x));
              const cy = Math.max(0, Math.min(S.currentData.height, imgPos.y));

              switch (handleIdx) {
                case 0: x1 = cx; y1 = cy; break;
                case 1: y1 = cy; break;
                case 2: x2 = cx; y1 = cy; break;
                case 3: x2 = cx; break;
                case 4: x2 = cx; y2 = cy; break;
                case 5: y2 = cy; break;
                case 6: x1 = cx; y2 = cy; break;
                case 7: x1 = cx; break;
              }

              const minX = Math.round(Math.min(x1, x2));
              const minY = Math.round(Math.min(y1, y2));
              const maxX = Math.round(Math.max(x1, x2));
              const maxY = Math.round(Math.max(y1, y2));

              if (sh.points.length === 4) {
                sh.points = [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
              } else {
                sh.points = [[minX, minY], [maxX, maxY]];
              }
              R.renderAnnotations();
            }
          }
          return;
        }

        case InteractionState.IDLE:
        default: {
          // ควบคุม Cursor และการ Hover วัตถุ (Mouse Mode)
          if (S.inputMode === InputMode.MOUSE) {
            if (S.activeTool === ToolType.PAN) {
              this.cUi.style.cursor = 'grab';
            } else if (S.activeTool === ToolType.DRAW) {
              this.cUi.style.cursor = 'crosshair';
            } else if (S.activeTool === ToolType.SELECT) {
              // ตรวจจับ Handle ของกล่องที่เลือก
              let foundHandle = false;
              if (S.selectedShapeIdx >= 0) {
                const selShape = S.currentData.shapes[S.selectedShapeIdx];
                if (selShape && selShape.shape_type !== 'polygon') {
                  const handleIdx = R.hitHandle(selShape, pos.x, pos.y);
                  if (handleIdx >= 0) {
                    const cursorMap = ['nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize'];
                    this.cUi.style.cursor = cursorMap[handleIdx] || 'pointer';
                    foundHandle = true;
                  }
                }
              }

              if (!foundHandle) {
                const hIdx = R.hitShape(pos.x, pos.y);
                const hLowIdx = R.hitLowConfShape(pos.x, pos.y);

                if (hIdx >= 0) {
                  this.cUi.style.cursor = 'move';
                  S.hoverShape(hIdx);
                } else if (hLowIdx >= 0) {
                  this.cUi.style.cursor = 'copy';
                  S.hoverLowConf(hLowIdx);
                } else {
                  this.cUi.style.cursor = 'default';
                  S.hoverShape(-1);
                  S.hoverLowConf(-1);
                }
              }
            }
          }
          break;
        }
      }
    }

    onPointerUp(e) {
      try {
        this.cUi.releasePointerCapture(e.pointerId);
      } catch (err) {}
      this.activePointers.delete(e.pointerId);

      const S = typeof window !== 'undefined' ? window.appState : null;
      const R = typeof window !== 'undefined' ? window.canvasRenderer : null;
      if (!S || !R) {
        if (this.fsm) this.fsm.reset();
        return;
      }

      if (this.activePointers.size < 2) {
        this.lastPinchDist = null;
        this.lastMid = null;
      }

      const currentState = this.fsm.currentState;

      // ── จบการซูมแบบ Pinch ──
      if (currentState === InteractionState.PINCH_ZOOMING) {
        if (this.activePointers.size === 1) {
          const remainingPtr = Array.from(this.activePointers.values())[0];
          const r = this.cUi.getBoundingClientRect();
          const pPos = { x: remainingPtr.x - r.left, y: remainingPtr.y - r.top };
          this.fsm.transition(InteractionState.PANNING, { panStart: { x: pPos.x - S.panX, y: pPos.y - S.panY } });
        } else {
          this.fsm.reset();
        }
        return;
      }

      // ── จบการแตะพื้นที่ว่าง (Potential Blank Tap) ──
      if (currentState === InteractionState.POTENTIAL_TAP) {
        const imgPos = this.fsm.context.imgPos;
        if (imgPos && S.activeDrawLabel) {
          // สร้างกล่องสี่เหลี่ยมขนาดกะทัดรัด (120x120) ณ จุดที่แตะ
          const boxSize = 120;
          const half = boxSize / 2;
          const x1 = Math.max(0, Math.min(S.currentData.width - boxSize, Math.round(imgPos.x - half)));
          const y1 = Math.max(0, Math.min(S.currentData.height - boxSize, Math.round(imgPos.y - half)));

          const newShape = {
            label: S.activeDrawLabel,
            points: [[x1, y1], [x1 + boxSize, y1 + boxSize]],
            group_id: null,
            shape_type: 'rectangle',
            flags: {}
          };
          S.pushHistory();
          S.currentData.shapes.push(newShape);
          S.selectShape(S.currentData.shapes.length - 1);
          S._checkDirty();
          R.renderAnnotations();
          if (window.app) window.app.renderLabelList();
        }
        R.drawStart = null;
        R.drawEnd = null;
        R.renderUI();
      }

      // ── จบการวาดกรอบใหม่ (Commit New Shape) ──
      else if (currentState === InteractionState.DRAWING) {
        if (R.drawStart && R.drawEnd) {
          const x1 = Math.round(Math.min(R.drawStart.x, R.drawEnd.x));
          const y1 = Math.round(Math.min(R.drawStart.y, R.drawEnd.y));
          const x2 = Math.round(Math.max(R.drawStart.x, R.drawEnd.x));
          const y2 = Math.round(Math.max(R.drawStart.y, R.drawEnd.y));

          // ต้องมีขนาดกว้างและสูงอย่างน้อย 6px จึงจะยอมรับเป็น Bbox
          if ((x2 - x1) >= 6 && (y2 - y1) >= 6) {
            const label = S.activeDrawLabel || (S.classes.length > 0 ? S.classes[0] : 'object');
            const newShape = {
              label: label,
              points: [[x1, y1], [x2, y2]],
              group_id: null,
              shape_type: 'rectangle',
              flags: {}
            };
            S.currentData.shapes.push(newShape);
            S.selectShape(S.currentData.shapes.length - 1);
            S._checkDirty();
            R.renderAnnotations();
            if (window.app) window.app.renderLabelList();
          }
        }
        R.drawStart = null;
        R.drawEnd = null;
        R.renderUI();
      }

      // ── จบการลากหรือปรับขนาด (Commit Modification to Store) ──
      else if (currentState === InteractionState.DRAGGING_SHAPE || currentState === InteractionState.RESIZING_SHAPE) {
        S._checkDirty();
        R.renderAnnotations();
      }

      // รีเซ็ต FSM กลับสู่ IDLE อย่างสมบูรณ์
      this.fsm.reset();

      if (S.inputMode === InputMode.MOUSE) {
        this.cUi.style.cursor = S.activeTool === ToolType.PAN ? 'grab' : (S.activeTool === ToolType.DRAW ? 'crosshair' : 'default');
      }
    }

    onWheel(e) {
      e.preventDefault();
      const S = typeof window !== 'undefined' ? window.appState : null;
      const R = typeof window !== 'undefined' ? window.canvasRenderer : null;
      if (!S || !R) return;

      const factor = e.deltaY < 0 ? 1.15 : 0.87;
      const pos = this.getCanvasPos(e);

      if (R.viewportEngine) {
        const zoomed = R.viewportEngine.calculateZoomAtPoint(factor, pos.x, pos.y, S.panX, S.panY, S.scale);
        S.scale = zoomed.scale;
        S.panX = zoomed.panX;
        S.panY = zoomed.panY;
      } else {
        const newScale = Math.max(0.05, Math.min(30, S.scale * factor));
        S.panX = pos.x - (pos.x - S.panX) * (newScale / S.scale);
        S.panY = pos.y - (pos.y - S.panY) * (newScale / S.scale);
        S.scale = newScale;
      }

      R.renderAll();
      if (window.app) window.app.updateZoomDisplay();
    }

    initDragDrop() {
      if (!this.cUi) return;

      this.cUi.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      });

      this.cUi.addEventListener('drop', e => {
        e.preventDefault();
        const label = e.dataTransfer.getData('text/plain');
        if (!label) return;

        const S = typeof window !== 'undefined' ? window.appState : null;
        const R = typeof window !== 'undefined' ? window.canvasRenderer : null;
        if (!S || !R) return;

        const pos = this.getCanvasPos(e);
        const hitIdx = R.hitShape(pos.x, pos.y);

        if (hitIdx >= 0) {
          // วางทับ Bbox ที่มีอยู่ -> เปลี่ยนชื่อคลาสของ Bbox นั้น
          S.pushHistory();
          S.currentData.shapes[hitIdx].label = label;
          S.selectShape(hitIdx);
          S._checkDirty();
          R.renderAnnotations();
          if (window.app) window.app.renderLabelList();
        } else {
          // วางบนที่ว่าง -> สร้าง Bbox ใหม่ขนาด 150x150
          const imgPos = R.canvasToImg(pos.x, pos.y);
          const boxSize = 150;
          const half = boxSize / 2;
          const x1 = Math.max(0, Math.min(S.currentData.width - boxSize, Math.round(imgPos.x - half)));
          const y1 = Math.max(0, Math.min(S.currentData.height - boxSize, Math.round(imgPos.y - half)));

          const newShape = {
            label: label,
            points: [[x1, y1], [x1 + boxSize, y1 + boxSize]],
            group_id: null,
            shape_type: 'rectangle',
            flags: {}
          };
          S.pushHistory();
          S.currentData.shapes.push(newShape);
          S.selectShape(S.currentData.shapes.length - 1);
          S._checkDirty();
          R.renderAnnotations();
          if (window.app) window.app.renderLabelList();
        }
      });
    }
  }

  if (typeof window !== 'undefined') {
    window.interactionManager = new InteractionManager();
  }

  return InteractionManager;
}));
