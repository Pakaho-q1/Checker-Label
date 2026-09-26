/**
 * Toolbar Component (Left Vertical Thumb Bar)
 * รับผิดชอบการผูกปุ่มเครื่องมือและการสะท้อนสถานะ Active Tool ตาม ToolType Enum
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['../constants/enums'], factory);
  } else if (typeof module === 'object' && module.exports) {
    const enums = require('../constants/enums');
    module.exports = factory(enums);
  } else {
    root.ToolbarComponent = factory(root.Enums);
  }
}(typeof self !== 'undefined' ? self : this, function (Enums) {
  'use strict';

  const { ToolType, AppEvent } = Enums;

  class ToolbarComponent {
    constructor(store, options = {}) {
      this.store = store;
      this.container = options.container || (typeof document !== 'undefined' ? document.getElementById('left-toolbar') : null);
      this.canvasWrap = options.canvasWrap || (typeof document !== 'undefined' ? document.getElementById('canvas-wrap') : null);

      this.buttons = new Map();
      this.init();
    }

    init() {
      if (!this.container) return;

      const btnElements = this.container.querySelectorAll('.tool-btn');
      btnElements.forEach(btn => {
        const tool = btn.dataset.tool;
        if (!tool) return;

        this.buttons.set(tool, btn);

        btn.addEventListener('click', e => {
          e.preventDefault();
          this.handleToolClick(tool);
        });
      });

      // ดักฟังการเปลี่ยนแปลง Tool จาก Store
      if (this.store && this.store.eventBus) {
        this.store.eventBus.on(AppEvent.TOOL_CHANGED, (newTool) => {
          this.updateActiveUI(newTool);
        });
      }

      // ซิงค์สถานะเริ่มต้น
      if (this.store) {
        this.updateActiveUI(this.store.activeTool);
      }
    }

    handleToolClick(tool) {
      if (!this.store) return;

      if (tool === ToolType.DELETE) {
        this.store.deleteSelectedShape();
        if (window.canvasRenderer) window.canvasRenderer.renderAnnotations();
        return;
      }

      if (tool === ToolType.UNDO) {
        if (typeof window !== 'undefined' && window.app && window.app.handleUndo) {
          window.app.handleUndo();
        } else {
          this.store.undo();
          if (window.canvasRenderer) window.canvasRenderer.renderAnnotations();
        }
        return;
      }

      this.store.setTool(tool);
    }

    updateActiveUI(activeTool) {
      this.buttons.forEach((btn, tool) => {
        if (tool === activeTool) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });

      if (this.canvasWrap) {
        this.canvasWrap.className = `mode-${activeTool}`;
      }
    }
  }

  return ToolbarComponent;
}));
