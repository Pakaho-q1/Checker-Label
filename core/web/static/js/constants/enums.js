/**
 * Production-Grade Domain Enums for YOLO BBox Reviewer
 * ปิดผนึกด้วย Object.freeze ป้องกันการกลายพันธุ์ของค่า (Immutable Constants)
 * รองรับทั้ง Browser (window.Enums) และ Node.js (module.exports / require)
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Enums = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * เครื่องมือหลัก (Active Tool Types)
   */
  const ToolType = Object.freeze({
    SELECT: 'select',
    DRAW: 'draw',
    PAN: 'pan',
    UNDO: 'undo',
    DELETE: 'delete'
  });

  /**
   * สถานะการโต้ตอบแบบ Finite State Machine (FSM)
   * ป้องกัน Impossible States ไม่ให้ทำงานทับซ้อนกันเด็ดขาด
   */
  const InteractionState = Object.freeze({
    IDLE: 'IDLE',                         // อยู่เฉยๆ รอคำสั่ง
    PANNING: 'PANNING',                   // กำลังเลื่อนมุมมองภาพ
    DRAWING: 'DRAWING',                   // กำลังคลิกลากสร้าง Bbox ใหม่
    DRAGGING_SHAPE: 'DRAGGING_SHAPE',     // กำลังลากย้าย Bbox
    RESIZING_SHAPE: 'RESIZING_SHAPE',     // กำลังยืด/หด Handle 8 จุด
    PINCH_ZOOMING: 'PINCH_ZOOMING',       // กำลังใช้ 2 นิ้วซูม/หมุน (Touch)
    POTENTIAL_TAP: 'POTENTIAL_TAP'        // กำลังแตะเพื่อเลือก/สร้างด่วน
  });

  /**
   * โหมดของอุปกรณ์นำเข้า (Input Mode)
   */
  const InputMode = Object.freeze({
    MOUSE: 'mouse',
    TOUCH: 'touch',
    PEN: 'pen'
  });

  /**
   * ประเภทตัวกรองข้อมูลรูปภาพ (Filter Types)
   */
  const FilterType = Object.freeze({
    ALL: 'all',
    UNVERIFIED: 'unverified',
    VERIFIED: 'verified',
    NEGATIVE: 'negative',
    LOW_CONF: 'low_conf',
    CLASS: 'class'
  });

  /**
   * รูปแบบการเรียงลำดับคลาส (Label Sort Order)
   */
  const SortOrder = Object.freeze({
    ALPHA: 'alpha',
    DATA_ORDER: 'data'
  });

  /**
   * ชนิดของ Event ที่ได้รับอนุญาตบน Typed EventBus
   */
  const AppEvent = Object.freeze({
    STATE_CHANGED: 'state_changed',
    TOOL_CHANGED: 'tool_changed',
    IMAGE_LOADED: 'image_loaded',
    SHAPES_UPDATED: 'shapes_updated',
    SELECTION_CHANGED: 'selection_changed',
    HOVER_CHANGED: 'hover_changed',
    DIRTY_CHANGED: 'dirty_changed',
    FILTER_CHANGED: 'filter_changed',
    CONF_THRESHOLD_CHANGED: 'conf_threshold_changed',
    CONF_RANGE_CHANGED: 'conf_range_changed',
    SHOW_LOW_CONF_CHANGED: 'show_low_conf_changed',
    VIEWPORT_CHANGED: 'viewport_changed',
    COLORS_CHANGED: 'colors_changed',
    SORT_CHANGED: 'sort_changed',
    HISTORY_CHANGED: 'history_changed',
    TOAST_NOTIFY: 'toast_notify'
  });

  /**
   * ดัชนีจุดหมุดควบคุม 8 จุดสำหรับ Resize Handle
   */
  const ResizeHandle = Object.freeze({
    TOP_LEFT: 0,
    TOP_MID: 1,
    TOP_RIGHT: 2,
    MID_RIGHT: 3,
    BOT_RIGHT: 4,
    BOT_MID: 5,
    BOT_LEFT: 6,
    MID_LEFT: 7
  });

  /**
   * ตรวจสอบความถูกต้องของ ToolType
   */
  function isValidToolType(tool) {
    return Object.values(ToolType).includes(tool);
  }

  /**
   * ตรวจสอบความถูกต้องของ InteractionState
   */
  function isValidInteractionState(state) {
    return Object.values(InteractionState).includes(state);
  }

  /**
   * ตรวจสอบความถูกต้องของ InputMode
   */
  function isValidInputMode(mode) {
    return Object.values(InputMode).includes(mode);
  }

  /**
   * ตรวจสอบความถูกต้องของ AppEvent
   */
  function isValidAppEvent(evt) {
    return Object.values(AppEvent).includes(evt);
  }

  return {
    ToolType,
    InteractionState,
    InputMode,
    FilterType,
    SortOrder,
    AppEvent,
    ResizeHandle,
    isValidToolType,
    isValidInteractionState,
    isValidInputMode,
    isValidAppEvent
  };
}));
