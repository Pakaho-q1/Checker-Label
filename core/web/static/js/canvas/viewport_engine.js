/**
 * Viewport Transform Engine (Pure Math)
 * รับผิดชอบการแปลงพิกัดระหว่าง Screen / Canvas / Image และการคำนวณการซูมและจัดตำแหน่งภาพ
 * ปราศจาก Side Effects และไม่มีการอ้างอิง DOM ทำให้สามารถทำ Unit Test ได้ 100%
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ViewportEngine = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  class ViewportEngine {
    constructor(options = {}) {
      this.minScale = options.minScale || 0.05;
      this.maxScale = options.maxScale || 30.0;
    }

    /**
     * แปลงพิกัดจาก Image Space (ix, iy) ไปเป็น Canvas Space (cx, cy)
     */
    imgToCanvas(ix, iy, panX, panY, scale) {
      return {
        x: ix * scale + panX,
        y: iy * scale + panY
      };
    }

    /**
     * แปลงพิกัดจาก Canvas Space (cx, cy) ไปเป็น Image Space (ix, iy)
     */
    canvasToImg(cx, cy, panX, panY, scale) {
      if (scale === 0) return { x: 0, y: 0 };
      return {
        x: (cx - panX) / scale,
        y: (cy - panY) / scale
      };
    }

    /**
     * คำนวณ Scale และ Pan เพื่อจัดรูปภาพให้พอดีกับขนาดหน้าจอ (Fit to Viewport)
     * รักษาสัดส่วน Aspect Ratio 100% เสมอ
     */
    calculateFit(imgW, imgH, viewW, viewH, padding = 20) {
      if (imgW <= 0 || imgH <= 0 || viewW <= 0 || viewH <= 0) {
        return { scale: 1, panX: 0, panY: 0 };
      }

      const availableW = Math.max(10, viewW - padding * 2);
      const availableH = Math.max(10, viewH - padding * 2);

      const scale = Math.min(availableW / imgW, availableH / imgH);
      const clampedScale = Math.max(this.minScale, Math.min(this.maxScale, scale));

      const panX = (viewW - imgW * clampedScale) / 2;
      const panY = (viewH - imgH * clampedScale) / 2;

      return {
        scale: clampedScale,
        panX,
        panY
      };
    }

    /**
     * คำนวณการซูมเข้า/ออก โดยมีจุดโฟกัส (Focal Point / Anchor) อยู่ที่ (anchorX, anchorY)
     */
    calculateZoomAtPoint(factor, anchorX, anchorY, currentPanX, currentPanY, currentScale) {
      if (currentScale <= 0) currentScale = 1;

      const targetScale = currentScale * factor;
      const newScale = Math.max(this.minScale, Math.min(this.maxScale, targetScale));

      // คำนวณ Pan ใหม่เพื่อให้จุดเดิมใต้เม้าส์คงอยู่ที่ตำแหน่งหน้าจอเดิม
      const scaleRatio = newScale / currentScale;
      const newPanX = anchorX - (anchorX - currentPanX) * scaleRatio;
      const newPanY = anchorY - (anchorY - currentPanY) * scaleRatio;

      return {
        scale: newScale,
        panX: newPanX,
        panY: newPanY
      };
    }
  }

  return ViewportEngine;
}));
