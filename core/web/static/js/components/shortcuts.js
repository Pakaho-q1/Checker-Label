/**
 * Keyboard Shortcut Manager
 * ศูนย์กลางการดักจับและกระจายคำสั่งลัดจากคีย์บอร์ด (Global Hotkey Router)
 * ป้องกันการแทรกแซงการพิมพ์ใน Input / Textarea / Select
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['../constants/enums'], factory);
  } else if (typeof module === 'object' && module.exports) {
    const enums = require('../constants/enums');
    module.exports = factory(enums);
  } else {
    root.KeyboardShortcutManager = factory(root.Enums);
  }
}(typeof self !== 'undefined' ? self : this, function (Enums) {
  'use strict';

  const { ToolType } = Enums;

  class KeyboardShortcutManager {
    constructor(actions = {}) {
      this.actions = actions;
      this.enabled = true;

      if (typeof window !== 'undefined') {
        window.addEventListener('keydown', e => this.handleKeyDown(e));
      }
    }

    handleKeyDown(e) {
      if (!this.enabled) return;

      // ป้องกันการดักจับคีย์เมื่อผู้ใช้กำลังพิมพ์ใน Textbox
      const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT')) {
        return;
      }

      // Space / Enter: ยืนยันและไปภาพถัดไป
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        if (this.actions.onConfirmNext) this.actions.onConfirmNext();
        return;
      }

      // A หรือ ArrowLeft: ภาพก่อนหน้า
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') {
        e.preventDefault();
        if (this.actions.onPrev) this.actions.onPrev();
        return;
      }

      // D หรือ ArrowRight: ภาพถัดไป
      if (e.code === 'KeyD' || e.code === 'ArrowRight') {
        e.preventDefault();
        if (this.actions.onNext) this.actions.onNext();
        return;
      }

      // Delete หรือ Backspace: ลบกล่องที่เลือก
      if (e.code === 'Delete' || e.code === 'Backspace') {
        e.preventDefault();
        if (this.actions.onDelete) this.actions.onDelete();
        return;
      }

      // Ctrl + Z: Undo
      if (e.ctrlKey && e.code === 'KeyZ') {
        e.preventDefault();
        if (this.actions.onUndo) this.actions.onUndo();
        return;
      }

      // 1, 2, 3: สลับ Tools
      if (e.code === 'Digit1') {
        if (this.actions.onSetTool) this.actions.onSetTool(ToolType.SELECT);
        return;
      }
      if (e.code === 'Digit2') {
        if (this.actions.onSetTool) this.actions.onSetTool(ToolType.DRAW);
        return;
      }
      if (e.code === 'Digit3') {
        if (this.actions.onSetTool) this.actions.onSetTool(ToolType.PAN);
        return;
      }

      // Zoom Shortcuts: + / -, F (Fit), 0 (100%)
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        if (this.actions.onZoomBy) this.actions.onZoomBy(1.25);
        return;
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        if (this.actions.onZoomBy) this.actions.onZoomBy(0.8);
        return;
      }
      if (e.code === 'KeyF') {
        e.preventDefault();
        if (this.actions.onZoomFit) this.actions.onZoomFit();
        return;
      }
      if (e.code === 'Digit0') {
        e.preventDefault();
        if (this.actions.onZoomActual) this.actions.onZoomActual();
        return;
      }

      // Escape: ปิด Drawer หรือยกเลิกการเลือก
      if (e.code === 'Escape') {
        if (this.actions.onEscape) this.actions.onEscape();
      }
    }
  }

  return KeyboardShortcutManager;
}));
