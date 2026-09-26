/**
 * Topbar Component (Production-Grade Unified Multi-Filter & Conf Range)
 * จัดการ Navigation, Single Unified Filter Popover (สถานะ + หลายคลาส), Low-Conf Toggle & Dual-Thumb Conf Range Slider
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['../constants/enums'], factory);
  } else if (typeof module === 'object' && module.exports) {
    const enums = require('../constants/enums');
    module.exports = factory(enums);
  } else {
    root.TopbarComponent = factory(root.Enums);
  }
}(typeof self !== 'undefined' ? self : this, function (Enums) {
  'use strict';

  const { AppEvent } = Enums;

  class TopbarComponent {
    constructor(store, callbacks = {}) {
      this.store = store;
      this.callbacks = callbacks;
      this.selectedClasses = new Set();
      this.allClasses = [];
      this.selectedStatuses = new Set();
      this.activeStatus = 'all';
      this.isPopoverOpen = false;

      if (typeof document !== 'undefined') {
        // Navigation
        this.btnPrev = document.getElementById('btn-prev');
        this.btnNext = document.getElementById('btn-next');
        this.btnConfirm = document.getElementById('btn-confirm');
        this.confirmBadge = document.getElementById('confirm-badge');
        this.statusLabel = document.getElementById('status-label');

        // Single Unified Filter Dropdown
        this.btnFilterTrigger = document.getElementById('btn-filter-trigger');
        this.filterPopover = document.getElementById('filter-popover');
        this.filterSummaryLabel = document.getElementById('filter-summary-label');
        this.btnCloseFilter = document.getElementById('btn-close-filter');

        this.chkStatusAll = document.getElementById('chk-status-all');
        this.statusCountAll = document.getElementById('status-count-all');
        this.statusCountUnverified = document.getElementById('status-count-unverified');
        this.statusCountVerified = document.getElementById('status-count-verified');
        this.statusCountNegative = document.getElementById('status-count-negative');
        this.statusCountLowConf = document.getElementById('status-count-lowconf');
        this.optLowConfWrap = document.getElementById('opt-low-conf-wrap');

        this.classSearchInput = document.getElementById('class-search-input');
        this.filterClassesChecklist = document.getElementById('filter-classes-checklist');
        this.btnSelectAllClasses = document.getElementById('btn-select-all-classes');
        this.btnClearClasses = document.getElementById('btn-clear-classes');
        this.filterSelect = document.getElementById('filter-select');

        // Conf Range & Low-Conf
        this.chkShowLowConf = document.getElementById('chk-show-low-conf');
        this.confTrack = document.getElementById('conf-track');
        this.confSliderHighlight = document.getElementById('conf-slider-highlight');
        this.confSliderMin = document.getElementById('conf-slider-min');
        this.confSliderMax = document.getElementById('conf-slider-max');
        this.confVal = document.getElementById('conf-val');

        // Fullscreen
        this.btnFullscreen = document.getElementById('btn-fullscreen');

        this.init();
      }
    }

    init() {
      // 1. Navigation & Actions
      if (this.btnPrev) {
        this.btnPrev.addEventListener('click', () => {
          if (this.callbacks.onPrev) this.callbacks.onPrev();
        });
      }

      if (this.btnNext) {
        this.btnNext.addEventListener('click', () => {
          if (this.callbacks.onNext) this.callbacks.onNext();
        });
      }

      if (this.btnConfirm) {
        this.btnConfirm.addEventListener('click', () => {
          if (this.callbacks.onConfirm) this.callbacks.onConfirm();
        });
      }

      if (this.btnFullscreen) {
        this.btnFullscreen.addEventListener('click', () => {
          if (this.callbacks.onToggleFullscreen) this.callbacks.onToggleFullscreen();
        });
      }

      // 2. Single Unified Filter Popover Toggle & Positioning
      if (this.btnFilterTrigger) {
        this.btnFilterTrigger.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.toggleFilterPopover();
        });
      }

      if (this.btnCloseFilter) {
        this.btnCloseFilter.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.closeFilterPopover();
        });
      }

      if (this.filterPopover) {
        this.filterPopover.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
        });
      }

      // ปิด Popover เมื่อคลิกหรือแตะด้านนอก
      if (typeof document !== 'undefined') {
        const handleOutside = (e) => {
          if (!this.isPopoverOpen) return;
          if (this.filterPopover && this.filterPopover.contains(e.target)) return;
          if (this.btnFilterTrigger && this.btnFilterTrigger.contains(e.target)) return;
          this.closeFilterPopover();
        };

        document.addEventListener('click', handleOutside);
        document.addEventListener('pointerdown', handleOutside);

        window.addEventListener('resize', () => {
          if (this.isPopoverOpen) this.repositionFilterPopover();
        });
      }

      // 3. Status Checkbox Selection (Multi-Status with All Mutual Exclusivity)
      if (this.chkStatusAll) {
        this.chkStatusAll.addEventListener('change', () => {
          if (this.chkStatusAll.checked) {
            this.selectedStatuses.clear();
            const items = document.querySelectorAll('.chk-status-item');
            items.forEach(chk => { chk.checked = false; });
            this.activeStatus = 'all';
            if (this.filterSelect) this.filterSelect.value = 'all';
            this.updateFilterSummaryLabel();
            this.triggerFilterChange();
          } else {
            // Cannot uncheck "all" if no other status is checked
            if (this.selectedStatuses.size === 0) {
              this.chkStatusAll.checked = true;
            }
          }
        });
      }

      if (typeof document !== 'undefined') {
        const statusItems = document.querySelectorAll('.chk-status-item');
        statusItems.forEach(chk => {
          chk.addEventListener('change', () => {
            if (chk.checked) {
              this.selectedStatuses.add(chk.value);
              if (this.chkStatusAll) this.chkStatusAll.checked = false;
            } else {
              this.selectedStatuses.delete(chk.value);
              if (this.selectedStatuses.size === 0) {
                if (this.chkStatusAll) this.chkStatusAll.checked = true;
              }
            }

            if (this.selectedStatuses.size === 0) {
              this.activeStatus = 'all';
              if (this.filterSelect) this.filterSelect.value = 'all';
            } else if (this.selectedStatuses.size === 1) {
              const singleVal = Array.from(this.selectedStatuses)[0];
              this.activeStatus = singleVal;
              if (this.filterSelect) this.filterSelect.value = singleVal;
            } else {
              const arr = Array.from(this.selectedStatuses).sort();
              this.activeStatus = arr.join(',');
              if (this.filterSelect) this.filterSelect.value = this.activeStatus;
            }

            this.updateFilterSummaryLabel();
            this.triggerFilterChange();
          });
        });
      }

      // 4. Class Search & Mass Selection
      if (this.classSearchInput) {
        this.classSearchInput.addEventListener('input', (e) => {
          this.filterClassChecklist(e.target.value);
        });
      }

      if (this.btnSelectAllClasses) {
        this.btnSelectAllClasses.addEventListener('click', () => {
          this.allClasses.forEach(c => this.selectedClasses.add(c));
          this.updateClassCheckboxes();
          this.updateFilterSummaryLabel();
          this.triggerFilterChange();
        });
      }

      if (this.btnClearClasses) {
        this.btnClearClasses.addEventListener('click', () => {
          this.selectedClasses.clear();
          this.updateClassCheckboxes();
          this.updateFilterSummaryLabel();
          this.triggerFilterChange();
        });
      }

      // 5. Fallback Filter Select Change (Programmatic & Tests)
      if (this.filterSelect) {
        this.filterSelect.addEventListener('change', () => {
          this.activeStatus = this.filterSelect.value;
          this.syncStatusRadios(this.activeStatus);
          this.updateFilterSummaryLabel();
          this.triggerFilterChange();
        });
      }

      // 6. Low-Conf Checkbox (เปิด/ปิดการแสดงวัตถุ Low-Conf)
      if (this.chkShowLowConf) {
        this.chkShowLowConf.checked = this.store ? this.store.showLowConf : true;
        this.chkShowLowConf.addEventListener('change', (e) => {
          if (this.store) this.store.setShowLowConf(e.target.checked);
          if (window.canvasRenderer) window.canvasRenderer.renderAnnotations();
          this.triggerFilterChange();
        });
      }

      // 7. Conf Range Dual Slider on Single Track (ทำงานตลอดเวลาเพื่อกรองช่วงคะแนน)
      if (this.confSliderMin && this.confSliderMax) {
        this.confSliderMin.value = this.store ? this.store.confMin : 0.05;
        this.confSliderMax.value = this.store ? this.store.confMax : 0.50;
        this.updateConfRangeDisplay(this.confSliderMin.value, this.confSliderMax.value);

        let debounceConfTimer = null;

        const onRangeInput = () => {
          let minVal = parseFloat(this.confSliderMin.value);
          let maxVal = parseFloat(this.confSliderMax.value);
          if (minVal > maxVal) {
            minVal = maxVal;
            this.confSliderMin.value = minVal;
          }
          this.updateConfRangeDisplay(minVal, maxVal);
          if (this.store) this.store.setConfRange(minVal, maxVal);
          if (window.canvasRenderer) window.canvasRenderer.renderAnnotations();

          // ทำงานตลอดเวลา กรองภาพตามช่วงคะแนนความมั่นใจ
          if (debounceConfTimer) clearTimeout(debounceConfTimer);
          debounceConfTimer = setTimeout(() => {
            this.triggerFilterChange();
          }, 300);
        };

        const onRangeChange = () => {
          if (debounceConfTimer) clearTimeout(debounceConfTimer);
          this.triggerFilterChange();
        };

        this.confSliderMin.addEventListener('input', onRangeInput);
        this.confSliderMax.addEventListener('input', onRangeInput);
        this.confSliderMin.addEventListener('change', onRangeChange);
        this.confSliderMax.addEventListener('change', onRangeChange);
      }

      // 9. Store Event Listeners
      if (this.store && this.store.eventBus) {
        this.store.eventBus.on(AppEvent.CONF_RANGE_CHANGED, (range) => {
          if (this.confSliderMin) this.confSliderMin.value = range.min;
          if (this.confSliderMax) this.confSliderMax.value = range.max;
          this.updateConfRangeDisplay(range.min, range.max);
        });

        this.store.eventBus.on(AppEvent.SHOW_LOW_CONF_CHANGED, (show) => {
          if (this.chkShowLowConf) this.chkShowLowConf.checked = show;
        });
      }
    }

    openFilterPopover() {
      if (!this.filterPopover) return;
      this.repositionFilterPopover();
      this.filterPopover.style.display = 'block';
      this.isPopoverOpen = true;

      if (this.classSearchInput) {
        this.classSearchInput.value = '';
        this.filterClassChecklist('');
      }
    }

    closeFilterPopover() {
      if (!this.filterPopover) return;
      this.filterPopover.style.display = 'none';
      this.isPopoverOpen = false;
    }

    toggleFilterPopover() {
      if (this.isPopoverOpen || (this.filterPopover && this.filterPopover.style.display === 'block')) {
        this.closeFilterPopover();
      } else {
        this.openFilterPopover();
      }
    }

    repositionFilterPopover() {
      if (!this.filterPopover) return;

      if (this.btnFilterTrigger && typeof window !== 'undefined') {
        const rect = this.btnFilterTrigger.getBoundingClientRect();
        this.filterPopover.style.top = `${Math.round(rect.bottom + 4)}px`;

        const popoverWidth = 290;
        let leftPos = Math.round(rect.left);
        if (leftPos + popoverWidth > window.innerWidth - 8) {
          leftPos = Math.max(8, window.innerWidth - popoverWidth - 8);
        }
        this.filterPopover.style.left = `${leftPos}px`;
      }
    }

    triggerFilterChange() {
      let status = 'all';
      if (this.selectedStatuses && this.selectedStatuses.size > 0) {
        status = this.selectedStatuses.size === 1
          ? Array.from(this.selectedStatuses)[0]
          : Array.from(this.selectedStatuses);
      } else if (this.activeStatus && this.activeStatus !== 'all') {
        if (typeof this.activeStatus === 'string' && this.activeStatus.includes(',')) {
          status = this.activeStatus.split(',').filter(Boolean);
        } else {
          status = this.activeStatus;
        }
      }
      const classes = Array.from(this.selectedClasses);
      const payload = { status, classes };
      if (this.confSliderMin || this.confSliderMax) {
        payload.confMin = this.store ? this.store.confMin : 0.05;
        payload.confMax = this.store ? this.store.confMax : 0.50;
        payload.includeLowConf = this.store ? Boolean(this.store.showLowConf) : true;
      }
      if (this.callbacks.onFilterChange) {
        this.callbacks.onFilterChange(payload);
      }
    }

    updateConfRangeDisplay(minVal, maxVal) {
      const minNum = Number(minVal);
      const maxNum = Number(maxVal);

      if (this.confVal) {
        this.confVal.textContent = `${minNum.toFixed(2)} - ${maxNum.toFixed(2)}`;
      }

      if (this.confSliderHighlight) {
        const leftPct = Math.max(0, Math.min(100, minNum * 100));
        const rightPct = Math.max(0, Math.min(100, maxNum * 100));
        this.confSliderHighlight.style.left = `${leftPct}%`;
        this.confSliderHighlight.style.width = `${Math.max(0, rightPct - leftPct)}%`;
      }
    }

    setStatus(text) {
      if (this.statusLabel) {
        this.statusLabel.textContent = text;
      }
    }

    setConfirmedBadge(isConfirmed) {
      if (this.confirmBadge) {
        this.confirmBadge.classList.toggle('show', Boolean(isConfirmed));
      }
    }

    syncStatusCheckboxes(statusVal) {
      if (typeof document === 'undefined') return;
      this.selectedStatuses.clear();

      const chkAll = this.chkStatusAll || document.getElementById('chk-status-all');
      const items = document.querySelectorAll('.chk-status-item');

      if (!statusVal || statusVal === 'all') {
        this.activeStatus = 'all';
        if (chkAll) chkAll.checked = true;
        items.forEach(chk => { chk.checked = false; });
        return;
      }

      let parts = [];
      if (Array.isArray(statusVal)) {
        parts = statusVal.filter(s => s && s !== 'all');
      } else if (typeof statusVal === 'string') {
        parts = statusVal.split(',').map(s => s.trim()).filter(s => s && s !== 'all');
      }

      if (parts.length === 0) {
        this.activeStatus = 'all';
        if (chkAll) chkAll.checked = true;
        items.forEach(chk => { chk.checked = false; });
        return;
      }

      parts.forEach(p => this.selectedStatuses.add(p));
      this.activeStatus = parts.length === 1 ? parts[0] : parts.join(',');

      if (chkAll) chkAll.checked = false;
      items.forEach(chk => {
        chk.checked = this.selectedStatuses.has(chk.value);
      });
    }

    syncStatusRadios(statusVal) {
      this.syncStatusCheckboxes(statusVal);
    }

    updateFilterSummaryLabel() {
      if (!this.filterSummaryLabel) return;
      const count = this.selectedClasses.size;

      let statusCount = 0;
      let singleStatusName = null;
      const statusMap = {
        unverified: 'ยังไม่ตรวจ',
        verified: 'ตรวจแล้ว',
        negative: 'ไม่มีวัตถุ',
        low_conf: 'Low-Conf'
      };

      if (this.selectedStatuses && this.selectedStatuses.size > 0) {
        statusCount = this.selectedStatuses.size;
        if (statusCount === 1) {
          const val = Array.from(this.selectedStatuses)[0];
          singleStatusName = statusMap[val] || val;
        }
      } else if (this.activeStatus && this.activeStatus !== 'all') {
        const parts = Array.isArray(this.activeStatus)
          ? this.activeStatus.filter(s => s && s !== 'all')
          : String(this.activeStatus).split(',').filter(s => s && s !== 'all');
        statusCount = parts.length;
        if (statusCount === 1) {
          singleStatusName = statusMap[parts[0]] || parts[0];
        }
      }

      const isFiltered = (statusCount > 0 || count > 0);

      if (this.btnFilterTrigger) {
        this.btnFilterTrigger.classList.toggle('active-filtered', isFiltered);
      }

      if (!isFiltered) {
        this.filterSummaryLabel.textContent = 'Filter';
      } else if (statusCount === 1 && count === 0) {
        this.filterSummaryLabel.textContent = `Filter: ${singleStatusName}`;
      } else if (statusCount === 0 && count === 1) {
        this.filterSummaryLabel.textContent = `Filter: ${Array.from(this.selectedClasses)[0]}`;
      } else {
        const total = statusCount + count;
        this.filterSummaryLabel.textContent = `Filter (${total})`;
      }
    }

    updateClassCheckboxes() {
      if (!this.filterClassesChecklist) return;
      this.filterClassesChecklist.querySelectorAll('input[type="checkbox"]').forEach(chk => {
        chk.checked = this.selectedClasses.has(chk.value);
      });
    }

    filterClassChecklist(query) {
      if (!this.filterClassesChecklist) return;
      const q = (query || '').toLowerCase().trim();
      this.filterClassesChecklist.querySelectorAll('.filter-class-item').forEach(item => {
        const name = (item.dataset.label || '').toLowerCase();
        item.style.display = (!q || name.includes(q)) ? 'flex' : 'none';
      });
    }

    populateFilterOptions(summary, activeFilter) {
      const src = summary || this.store || {};
      const total = src.total || (this.store ? this.store.total : 0) || 0;
      const verified = (src.confirmed_count !== undefined ? src.confirmed_count : src.confirmedCount) ??
                       (src.confirmed !== undefined ? src.confirmed : (this.store ? this.store.confirmedCount : 0)) ?? 0;
      const unverified = (src.unverified_count !== undefined ? src.unverified_count :
                         (src.unverified !== undefined ? src.unverified : Math.max(0, total - verified)));
      const neg = (src.negative_count !== undefined ? src.negative_count : src.negativeCount) ??
                  (src.neg_count !== undefined ? src.neg_count : (this.store ? this.store.negativeCount : 0)) ?? 0;
      const lowConf = (src.low_conf_count !== undefined ? src.low_conf_count : (this.store ? this.store.lowConfCount : 0)) ?? 0;
      const classes = src.classes || (this.store ? this.store.classes : []);
      const classCounts = src.class_counts || src.classCounts || (this.store ? this.store.classCounts : {}) || {};

      this.allClasses = classes;

      // 1. อัปเดตตัวเลข Status Counts ใน Popover
      if (this.statusCountAll) this.statusCountAll.textContent = total.toLocaleString();
      if (this.statusCountUnverified) this.statusCountUnverified.textContent = unverified.toLocaleString();
      if (this.statusCountVerified) this.statusCountVerified.textContent = verified.toLocaleString();
      if (this.statusCountNegative) this.statusCountNegative.textContent = neg.toLocaleString();
      if (this.statusCountLowConf) this.statusCountLowConf.textContent = lowConf.toLocaleString();
      if (this.optLowConfWrap) {
        this.optLowConfWrap.style.display = lowConf > 0 ? 'flex' : 'none';
      }

      // 2. เติมรายการ Checkboxes ใน Class Multi-Select Popover (รองรับได้เป็น 1000 คลาส)
      if (this.filterClassesChecklist) {
        this.filterClassesChecklist.innerHTML = '';
        classes.forEach(cls => {
          const color = this.store ? this.store.getColor(cls) : '#60a5fa';
          const count = classCounts[cls] || 0;
          const isChecked = this.selectedClasses.has(cls);

          const item = document.createElement('label');
          item.className = 'filter-class-item';
          item.dataset.label = cls;
          item.innerHTML = `
            <input type="checkbox" value="${cls}" ${isChecked ? 'checked' : ''}>
            <span class="label-dot" style="width: 10px; height: 10px; background: ${color};"></span>
            <span class="fc-name">${cls}</span>
            <span class="fc-count">${count}</span>
          `;

          const chk = item.querySelector('input');
          chk.addEventListener('change', () => {
            if (chk.checked) {
              this.selectedClasses.add(cls);
            } else {
              this.selectedClasses.delete(cls);
            }
            this.updateFilterSummaryLabel();
            this.triggerFilterChange();
          });

          this.filterClassesChecklist.appendChild(item);
        });
      }

      // 3. Fallback select element สำหรับ unit test suite และ API ภายนอก
      if (this.filterSelect) {
        this.filterSelect.innerHTML = `
          <option value="all">📂 ภาพทั้งหมด (${total})</option>
          <option value="unverified">⏳ ยังไม่ตรวจ (${unverified})</option>
          <option value="verified">✅ ตรวจแล้ว (${verified})</option>
          <option value="negative">⚪ ไม่มีวัตถุ (${neg})</option>
          ${lowConf > 0 ? `<option value="low_conf">⚠️ มี Low-Conf (${lowConf})</option>` : ''}
          <optgroup label="── แยกตามคลาส ──">
            ${classes.map(cls => `<option value="class:${cls}">🏷️ ${cls} (${classCounts[cls] || 0})</option>`).join('')}
          </optgroup>
        `;
        const initialStatus = activeFilter || (this.store ? (this.store.activeFilter || this.store.filterStatus) : 'all');
        this.filterSelect.value = initialStatus;
        this.activeStatus = initialStatus;
        this.syncStatusCheckboxes(initialStatus);
      } else {
        const initialStatus = activeFilter || (this.store ? (this.store.activeFilter || this.store.filterStatus) : 'all');
        this.activeStatus = initialStatus;
        this.syncStatusCheckboxes(initialStatus);
      }

      this.updateFilterSummaryLabel();
    }
  }

  return TopbarComponent;
}));
