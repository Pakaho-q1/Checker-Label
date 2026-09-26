/**
 * Label Drawer Component (Right Sidebar)
 * จัดการรายการคลาส การเรียงลำดับ การเปลี่ยนสี และ Drag-and-drop badge
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['../constants/enums'], factory);
  } else if (typeof module === 'object' && module.exports) {
    const enums = require('../constants/enums');
    module.exports = factory(enums);
  } else {
    root.LabelDrawerComponent = factory(root.Enums);
  }
}(typeof self !== 'undefined' ? self : this, function (Enums) {
  'use strict';

  const { SortOrder, AppEvent } = Enums;

  class LabelDrawerComponent {
    constructor(store, options = {}) {
      this.store = store;
      this.panel = options.panel || (typeof document !== 'undefined' ? document.getElementById('right-panel') : null);
      this.labelList = options.labelList || (typeof document !== 'undefined' ? document.getElementById('label-list') : null);
      this.btnClose = options.btnClose || (typeof document !== 'undefined' ? document.getElementById('btn-close-labels') : null);
      this.colorInput = options.colorInput || (typeof document !== 'undefined' ? document.getElementById('color-picker-input') : null);
      this.sortControls = options.sortControls || (typeof document !== 'undefined' ? document.getElementById('sort-controls') : null);

      this.init();
    }

    init() {
      if (this.btnClose && this.panel) {
        this.btnClose.addEventListener('click', () => this.close());
      }

      if (this.sortControls) {
        this.sortControls.querySelectorAll('.sort-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const mode = btn.dataset.sort;
            if (this.store && mode) {
              this.store.setLabelSort(mode);
              this.render();
            }
          });
        });
      }

      if (this.colorInput) {
        this.colorInput.addEventListener('input', e => {
          const label = this.colorInput.dataset.targetLabel;
          if (label && this.store) {
            this.store.setColor(label, e.target.value);
            this.render();
            if (window.canvasRenderer) window.canvasRenderer.renderAnnotations();
          }
        });
      }

      // ดักฟังอีเวนต์จาก Store
      if (this.store && this.store.eventBus) {
        this.store.eventBus.on(AppEvent.COLORS_CHANGED, () => this.render());
        this.store.eventBus.on(AppEvent.SORT_CHANGED, () => this.render());
      }
    }

    toggle() {
      if (!this.panel) return;
      this.panel.classList.toggle('drawer-open');
    }

    open() {
      if (!this.panel) return;
      this.panel.classList.add('drawer-open');
    }

    close() {
      if (!this.panel) return;
      this.panel.classList.remove('drawer-open');
    }

    render() {
      if (!this.labelList || !this.store) return;
      const S = this.store;

      // อัปเดตปุ่ม Sort Active
      if (this.sortControls) {
        this.sortControls.querySelectorAll('.sort-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.sort === S.labelSort);
        });
      }

      const shapes = S.currentData.shapes || [];
      const counts = {};
      shapes.forEach(sh => { counts[sh.label] = (counts[sh.label] || 0) + 1; });

      // ดึงรายการ Classes ตามโหมดการเรียงลำดับ
      let displayClasses = [...S.classes];
      if (S.labelSort === SortOrder.ALPHA) {
        displayClasses.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      }

      this.labelList.innerHTML = '';

      displayClasses.forEach(cls => {
        const color = S.getColor(cls);
        const count = counts[cls] || 0;
        const isDrawActive = S.activeDrawLabel === cls;
        const selectedShape = (S.selectedShapeIdx >= 0 && S.currentData && S.currentData.shapes) ? S.currentData.shapes[S.selectedShapeIdx] : null;
        const isMatchedSelected = selectedShape && selectedShape.label === cls;

        const card = document.createElement('div');
        const classNames = ['label-card'];
        if (isDrawActive) classNames.push('active-class');
        if (isMatchedSelected) classNames.push('matched-class');
        card.className = classNames.join(' ');
        card.draggable = true;
        card.dataset.label = cls;

        card.innerHTML = `
          <div class="label-info">
            <div class="label-dot" style="background: ${color};"></div>
            <span class="label-name">${cls}</span>
          </div>
          ${count > 0 ? `<span class="label-count-tag">${count}</span>` : ''}
        `;

        // คลิกจุดสีเพื่อเปิด Color Picker
        const dot = card.querySelector('.label-dot');
        dot.addEventListener('click', e => {
          e.stopPropagation();
          if (this.colorInput) {
            this.colorInput.dataset.targetLabel = cls;
            this.colorInput.value = color;
            this.colorInput.click();
          }
        });

        // คลิกการ์ดคลาส:
        card.addEventListener('click', () => {
          if (S.selectedShapeIdx >= 0) {
            // ถ้ามี Bbox ถูกเลือกอยู่ -> เปลี่ยนคลาสของ Bbox นั้น
            S.pushHistory();
            S.currentData.shapes[S.selectedShapeIdx].label = cls;
            S._checkDirty();
            if (window.canvasRenderer) window.canvasRenderer.renderAnnotations();
            this.render();
          } else {
            // ถ้าไม่มี Bbox ถูกเลือก -> สลับโหมด Active Draw Class
            if (S.activeDrawLabel === cls) {
              S.activeDrawLabel = '';
            } else {
              S.activeDrawLabel = cls;
              S.setTool(Enums.ToolType.DRAW);
            }
            this.render();
          }
        });

        // Drag and Drop
        card.addEventListener('dragstart', e => {
          e.dataTransfer.setData('text/plain', cls);
          e.dataTransfer.effectAllowed = 'copy';
        });

        this.labelList.appendChild(card);
      });
    }
  }

  return LabelDrawerComponent;
}));
