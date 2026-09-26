/**
 * Hit Test Engine (Pure Geometry Math)
 * รับผิดชอบการคำนวณการตรวจจับการคลิก/แตะโดนวัตถุ, หมุดปรับขนาด 8 จุด, และวัตถุ Low-Conf
 * ไม่มี Dependency ใดๆ กับ DOM ทำให้เป็น Pure Function ที่เชื่อถือได้และทดสอบได้ 100%
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.HitTestEngine = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  class HitTestEngine {
    /**
     * ตรวจสอบว่าพิกัด (px, py) อยู่ภายในกล่องสี่เหลี่ยมหรือไม่
     */
    static isPointInBox(px, py, minX, minY, maxX, maxY) {
      return px >= minX && px <= maxX && py >= minY && py <= maxY;
    }

    /**
     * คำนวณตำแหน่งของ Resize Handles ทั้ง 8 จุด
     * ดัชนีตรงกับ ResizeHandle Enum:
     * 0: TOP_LEFT, 1: TOP_MID, 2: TOP_RIGHT, 3: MID_RIGHT
     * 4: BOT_RIGHT, 5: BOT_MID, 6: BOT_LEFT, 7: MID_LEFT
     */
    static calculateHandlePositions(minX, minY, maxX, maxY) {
      const midX = (minX + maxX) / 2;
      const midY = (minY + maxY) / 2;

      return [
        { handleIdx: 0, x: minX, y: minY, cursor: 'nwse-resize' }, // TOP_LEFT
        { handleIdx: 1, x: midX, y: minY, cursor: 'ns-resize' },   // TOP_MID
        { handleIdx: 2, x: maxX, y: minY, cursor: 'nesw-resize' }, // TOP_RIGHT
        { handleIdx: 3, x: maxX, y: midY, cursor: 'ew-resize' },   // MID_RIGHT
        { handleIdx: 4, x: maxX, y: maxY, cursor: 'nwse-resize' }, // BOT_RIGHT
        { handleIdx: 5, x: midX, y: maxY, cursor: 'ns-resize' },   // BOT_MID
        { handleIdx: 6, x: minX, y: maxY, cursor: 'nesw-resize' }, // BOT_LEFT
        { handleIdx: 7, x: minX, y: midY, cursor: 'ew-resize' }    // MID_LEFT
      ];
    }

    /**
     * ตรวจหาว่าจุด (cx, cy) บน Canvas โดน Handle อันใดอันหนึ่งในรัศมี radius หรือไม่
     */
    static getHandleAt(cx, cy, canvasHandles, radius = 8) {
      if (!Array.isArray(canvasHandles)) return null;

      for (const h of canvasHandles) {
        const dist = Math.hypot(cx - h.x, cy - h.y);
        if (dist <= radius) {
          return h;
        }
      }
      return null;
    }

    /**
     * ตรวจหาว่าพิกัดบนภาพ (imgX, imgY) อยู่ใน Bbox รูปร่างใดบ้าง (ค้นหาจากชั้นบนสุดลงล่าง)
     */
    static findHitShape(imgX, imgY, shapes, getBoundsFn) {
      if (!Array.isArray(shapes) || shapes.length === 0) return null;

      for (let i = shapes.length - 1; i >= 0; i--) {
        const sh = shapes[i];
        const b = getBoundsFn ? getBoundsFn(sh) : sh;
        if (this.isPointInBox(imgX, imgY, b.minX, b.minY, b.maxX, b.maxY)) {
          return { shape: sh, index: i };
        }
      }
      return null;
    }

    /**
     * ตรวจหาว่าพิกัดบนภาพโดนวัตถุ Low-Conf Candidate อันใด
     * กรองเฉพาะวัตถุที่มีคะแนนต่ำกว่า confThreshold และยังไม่ถูกรับเข้า shapes จริง
     */
    static findHitLowConf(imgX, imgY, rawShapes, primaryShapes, confThreshold, getBoundsFn, confMin = 0.0, showLowConf = true, allowedClasses = null) {
      if (showLowConf === false) return null;
      if (!Array.isArray(rawShapes) || rawShapes.length === 0) return null;

      const primaryShapesStr = JSON.stringify(primaryShapes || []);

      for (let i = rawShapes.length - 1; i >= 0; i--) {
        const rawSh = rawShapes[i];
        const score = typeof rawSh.score === 'number' ? rawSh.score : 1.0;

        // ข้ามวัตถุที่อยู่นอกช่วงความมั่นใจ
        if (score > confThreshold || score < confMin) continue;

        // ข้ามวัตถุที่ไม่ตรงกับคลาสที่เลือกในฟิลเตอร์
        if (Array.isArray(allowedClasses) && allowedClasses.length > 0) {
          if (!allowedClasses.includes(rawSh.label)) continue;
        }

        // ข้ามวัตถุที่ถูกรับเข้า primary shapes แล้ว
        const rawStr = JSON.stringify(rawSh.points);
        if (primaryShapesStr.includes(rawStr)) continue;

        const b = getBoundsFn ? getBoundsFn(rawSh) : rawSh;
        if (this.isPointInBox(imgX, imgY, b.minX, b.minY, b.maxX, b.maxY)) {
          return { shape: rawSh, index: i };
        }
      }
      return null;
    }
  }

  return HitTestEngine;
}));
