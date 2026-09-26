/**
 * Main Application Controller (Production-Grade Refactored)
 * ทำหน้าที่เป็น Root Orchestrator สำหรับรวบรวม Services, Components, State, และ Rendering
 * ปราศจาก Logic ซ้ำซ้อน มีขนาดกะทัดรัด สะอาด และบำรุงรักษาง่าย (High Cohesion, Low Coupling)
 */
class AppController {
  constructor() {
    this.store = window.appState;
    this.renderer = window.canvasRenderer;
    this.interaction = window.interactionManager;

    this.apiClient = new ApiClient();
    this.isNavigating = false;
    this.loadAbortController = null;
    this.toastTimer = null;

    this.initComponents();
    this.init();
  }

  initComponents() {
    // 1. แถบเครื่องมือแนวตั้งด้านซ้าย (Left Toolbar)
    this.toolbar = new ToolbarComponent(this.store);

    // 2. แถบควบคุมด้านบน (Topbar)
    this.topbar = new TopbarComponent(this.store, {
      onPrev: () => this.prevItem(),
      onNext: () => this.nextItem(),
      onConfirm: () => this.confirmAndNext(),
      onFilterChange: (val) => this.selectFilter(val),
      onToggleLabels: () => this.toggleLabelsDrawer(),
      onToggleFullscreen: () => this.toggleFullscreen()
    });

    // 3. แผงรายการคลาสด้านขวา (Label Drawer)
    this.labelDrawer = new LabelDrawerComponent(this.store);

    // 4. ตัวควบคุมการซูม (Zoom Controls)
    this.zoomControls = new ZoomControlsComponent(this.store, this.renderer);

    // 5. ตัวกระจายคำสั่งลัดคีย์บอร์ด (Global Shortcuts Router)
    this.shortcuts = new KeyboardShortcutManager({
      onPrev: () => this.prevItem(),
      onNext: () => this.nextItem(),
      onConfirmNext: () => this.confirmAndNext(),
      onDelete: () => this.deleteSelectedShape(),
      onUndo: () => this.handleUndo(),
      onSetTool: (tool) => this.store.setTool(tool),
      onZoomBy: (factor) => this.zoomControls.zoomBy(factor),
      onZoomFit: () => this.zoomControls.fitToView(),
      onZoomActual: () => this.zoomControls.setActualSize(),
      onEscape: () => {
        this.labelDrawer.close();
        this.store.selectShape(-1);
        this.renderer.renderAnnotations();
      }
    });

    this.initFullscreenListener();
  }

  handleUndo() {
    const success = this.store.undo();
    if (success) {
      this.renderer.renderAnnotations();
      this.labelDrawer.render();
      this.updateStatusDisplay();
      this.showToast('↩️ เลิกทำ (Undo)', 800);
    } else {
      this.showToast('ℹ️ ไม่มีประวัติให้เลิกทำ', 800);
    }
  }

  async init() {
    this.subscribeEvents();

    // เริ่มต้นดึงข้อมูล Overview และรูปภาพแรก
    await this.fetchSummary();
    if (this.store.total > 0) {
      await this.loadItem(0);
    }
  }

  subscribeEvents() {
    if (!this.store || !this.store.eventBus) return;
    const bus = this.store.eventBus;
    const { AppEvent } = Enums;

    bus.on(AppEvent.DIRTY_CHANGED, () => this.updateStatusDisplay());
    bus.on(AppEvent.SELECTION_CHANGED, () => this.labelDrawer.render());
    bus.on(AppEvent.SHAPES_UPDATED, () => {
      this.renderer.renderAnnotations();
      this.labelDrawer.render();
      this.updateStatusDisplay();
    });
  }

  // ==========================================
  // API & Filter Workflows
  // ==========================================

  async fetchSummary() {
    try {
      const data = await this.apiClient.getSummary();
      this.store.setSummary(data);

      this.topbar.populateFilterOptions(data, this.store.activeFilter);
      this.labelDrawer.render();
      this.updateStatusDisplay();
    } catch (err) {
      console.error('[AppController] fetchSummary error:', err);
      this.showToast('❌ ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้');
    }
  }

  async selectFilter(filterInput) {
    const S = this.store;
    let status = 'all';
    let classes = [];
    let confMin = null;
    let confMax = null;

    if (typeof filterInput === 'string') {
      if (filterInput.startsWith('class:')) {
        status = 'all';
        classes = [filterInput.substring(6)];
      } else {
        status = filterInput;
        classes = S.filterClasses || [];
      }
    } else if (filterInput && typeof filterInput === 'object') {
      status = filterInput.status || S.filterStatus || 'all';
      classes = filterInput.classes !== undefined ? filterInput.classes : (S.filterClasses || []);
      if (filterInput.confMin !== undefined) confMin = filterInput.confMin;
      if (filterInput.confMax !== undefined) confMax = filterInput.confMax;
    }

    // slider range ทำงานตลอดเวลา ไม่จำกัดเฉพาะ low-conf
    let includeLowConf = S.showLowConf !== false;
    if (filterInput && typeof filterInput === 'object' && filterInput.includeLowConf !== undefined) {
      includeLowConf = Boolean(filterInput.includeLowConf);
    }
    if (confMin === null && S.confMin !== undefined) confMin = S.confMin;
    if (confMax === null && S.confMax !== undefined) confMax = S.confMax;

    let statusStr = 'all';
    if (Array.isArray(status)) {
      const clean = status.filter(s => s && s !== 'all');
      statusStr = clean.length > 0 ? clean.sort().join(',') : 'all';
    } else if (typeof status === 'string') {
      statusStr = status;
    }

    const hasConfRange = (confMin !== null && confMax !== null && !(Number(confMin) <= 0.0 && Number(confMax) >= 1.0));
    const isAll = (statusStr === 'all' && classes.length === 0 && !hasConfRange);

    // สร้าง Unique Cache Key ประจำตัวกรอง
    let baseKey = statusStr;
    if (classes.length === 1 && statusStr === 'all') {
      baseKey = `class:${classes[0]}`;
    } else if (classes.length > 0) {
      baseKey = `${statusStr}:${classes.join(',')}`;
    }

    let filterKey = baseKey;
    if (hasConfRange) {
      filterKey += `@${Number(confMin).toFixed(2)}-${Number(confMax).toFixed(2)}${includeLowConf ? '' : ':passed'}`;
    }

    if (isAll) {
      S.setCombinedFilter('all', [], [], null, null, includeLowConf);
      this.updateStatusDisplay();
      if (this.topbar && this.topbar.setFilterCount) this.topbar.setFilterCount(null);
      this.showToast(`🔍 แสดงภาพทั้งหมด (${S.total.toLocaleString()} ภาพ)`);
      return;
    }

    if (!S.filterMap[filterKey] || !Array.isArray(S.filterMap[filterKey])) {
      this.showToast('⏳ กำลังคำนวณตัวกรอง...', 600);
      try {
        const queryOpts = { status: statusStr, classes };
        if (hasConfRange) {
          queryOpts.confMin = confMin;
          queryOpts.confMax = confMax;
          queryOpts.includeLowConf = includeLowConf;
        }
        const indices = await this.apiClient.getFilterIndices(queryOpts);
        S.filterMap[filterKey] = Array.isArray(indices) ? indices : [];
      } catch (err) {
        console.error('[AppController] Failed to load filter indices:', err);
      }
    }

    S.setCombinedFilter(statusStr, classes, S.filterMap[filterKey], confMin, confMax, includeLowConf);

    const count = S.filteredIndices.length;
    if (this.topbar && this.topbar.setFilterCount) {
      this.topbar.setFilterCount(count);
    }

    if (count > 0) {
      this.showToast(`🔍 กรอง: ${S.getFilterLabel()} (${count} ภาพ)`);
      if (!S.filteredIndices.includes(S.currentIndex)) {
        await this.loadItem(S.filteredIndices[0]);
      } else {
        S.filterPos = S.filteredIndices.indexOf(S.currentIndex);
        this.updateStatusDisplay();
      }
    } else {
      this.showToast(`ℹ️ ไม่พบรูปภาพสำหรับ: ${S.getFilterLabel()}`);
      this.updateStatusDisplay();
    }
  }

  // ==========================================
  // Image Loading & Navigation
  // ==========================================

  async loadItem(idx) {
    const S = this.store;
    if (typeof idx !== 'number' || isNaN(idx) || idx < 0 || idx >= S.total) {
      console.warn(`[loadItem] Invalid index requested:`, idx);
      return;
    }

    if (this.loadAbortController) {
      this.loadAbortController.abort();
    }
    this.loadAbortController = new AbortController();
    const signal = this.loadAbortController.signal;

    this.isNavigating = true;
    this.updateNavButtonsState(true);
    this.showToast(`กำลังโหลดรูปที่ ${idx + 1}...`, 350);

    try {
      // 1. ดึง Metadata ของรูป
      const data = await this.apiClient.getItem(idx, signal);

      // 2. ดึง Blob รูปภาพ
      const blob = await this.apiClient.fetchImageBlob(idx, data.stem, signal);
      const bitmap = await createImageBitmap(blob);

      // 3. คำนวณ Aspect Ratio และสัดส่วนที่ถูกต้อง
      const jsonW = data.raw_json_width || data.width || bitmap.width;
      const jsonH = data.raw_json_height || data.height || bitmap.height;
      if (jsonW > 0 && jsonH > 0 && (jsonW !== bitmap.width || jsonH !== bitmap.height)) {
        const sx = bitmap.width / jsonW;
        const sy = bitmap.height / jsonH;
        (data.shapes || []).forEach(sh => {
          if (sh.points) {
            sh.points = sh.points.map(p => [p[0] * sx, p[1] * sy]);
          }
        });
      }
      data.width = bitmap.width;
      data.height = bitmap.height;

      // 4. บันทึกเข้า Store
      S.currentIndex = idx;
      S.setLoadedData(data);
      S.imgBitmap = bitmap;

      if (S.activeFilter !== 'all' && S.filteredIndices && S.filteredIndices.length > 0) {
        const fPos = S.filteredIndices.indexOf(idx);
        if (fPos >= 0) S.filterPos = fPos;
      } else {
        S.filterPos = idx;
      }

      // 5. ปรับการแสดงผลแคนวาส
      this.renderer.resizeCanvases();
      this.renderer.fitImageToView();
      this.renderer.renderAll();
      this.zoomControls.updateDisplay();

      this.updateStatusDisplay();
      this.labelDrawer.render();
    } catch (err) {
      if (err.name === 'AbortError') return;
      this.showToast('❌ โหลดภาพล้มเหลว: ' + err.message);
    } finally {
      this.isNavigating = false;
      this.updateNavButtonsState(false);
    }
  }

  async saveCurrentItem(confirmed = null) {
    const S = this.store;
    if (S.total === 0 || !S.currentData || !S.currentData.filename) return null;

    const targetConfirmed = (confirmed !== null) ? Boolean(confirmed) : Boolean(S.currentData.confirmed);

    if (!S.hasChanged(targetConfirmed)) {
      return { status: 'skipped', reason: 'no_changes' };
    }

    const targetIdx = S.currentIndex;
    const targetStem = S.currentData.stem;
    const targetFilename = S.currentData.filename;
    const targetShapes = JSON.parse(JSON.stringify(S.currentData.shapes));

    try {
      const payload = {
        shapes: targetShapes,
        confirmed: targetConfirmed,
        stem: targetStem,
        filename: targetFilename,
        raw_shapes: S.currentData.raw_shapes || targetShapes
      };

      const result = await this.apiClient.saveItem(targetIdx, payload);

      if (S.currentIndex === targetIdx) {
        if (targetConfirmed && !S.currentData.confirmed) {
          S.confirmedCount++;
          S.unverifiedCount = Math.max(0, S.total - S.confirmedCount);
        } else if (!targetConfirmed && S.currentData.confirmed) {
          S.confirmedCount = Math.max(0, S.confirmedCount - 1);
          S.unverifiedCount = Math.max(0, S.total - S.confirmedCount);
        }
        S.markClean(targetConfirmed);
        this.updateStatusDisplay();
        this.topbar.populateFilterOptions(S, S.activeFilter);
      }

      return result;
    } catch (err) {
      this.showToast('❌ บันทึกล้มเหลว: ' + err.message);
      return null;
    }
  }

  async confirmAndNext() {
    if (this.isNavigating) return;

    this.showToast('💾 กำลังบันทึกสถานะ...', 400);
    await this.saveCurrentItem(true);
    this.showToast('✅ ยืนยันแล้ว กำลังไปภาพถัดไป...', 500);

    const S = this.store;
    if (S.activeFilter !== 'all' && S.filteredIndices && S.filteredIndices.length > 0) {
      if (S.filterPos < S.filteredIndices.length - 1) {
        await this.loadItem(S.filteredIndices[S.filterPos + 1]);
      } else {
        this.showToast('🎉 ตรวจทานครบทุกภาพในตัวกรองนี้แล้ว!');
      }
    } else {
      if (S.currentIndex < S.total - 1) {
        await this.loadItem(S.currentIndex + 1);
      } else {
        this.showToast('🎉 ตรวจทานครบทุกภาพใน Dataset แล้ว!');
      }
    }
  }

  async prevItem() {
    if (this.isNavigating) return;
    await this.saveCurrentItem();
    const S = this.store;

    if (S.activeFilter !== 'all' && S.filteredIndices && S.filteredIndices.length > 0) {
      if (S.filterPos > 0) {
        await this.loadItem(S.filteredIndices[S.filterPos - 1]);
      } else {
        this.showToast('ภาพแรกของตัวกรองนี้แล้ว');
      }
    } else {
      if (S.currentIndex > 0) {
        await this.loadItem(S.currentIndex - 1);
      } else {
        this.showToast('ภาพแรกสุดแล้ว');
      }
    }
  }

  async nextItem() {
    if (this.isNavigating) return;
    await this.saveCurrentItem();
    const S = this.store;

    if (S.activeFilter !== 'all' && S.filteredIndices && S.filteredIndices.length > 0) {
      if (S.filterPos < S.filteredIndices.length - 1) {
        await this.loadItem(S.filteredIndices[S.filterPos + 1]);
      } else {
        this.showToast('ภาพสุดท้ายของตัวกรองนี้แล้ว');
      }
    } else {
      if (S.currentIndex < S.total - 1) {
        await this.loadItem(S.currentIndex + 1);
      } else {
        this.showToast('ภาพสุดท้ายแล้ว');
      }
    }
  }

  // ==========================================
  // UI Display & Feedback Helpers
  // ==========================================

  updateStatusDisplay() {
    const S = this.store;
    if (S.total === 0) {
      this.topbar.setStatus('ไม่มีข้อมูล');
      return;
    }

    const cur = S.currentIndex + 1;
    const total = S.total;
    const isConf = Boolean(S.currentData.confirmed);
    const hasUnsaved = S.hasChanged();

    let text = `[${cur} / ${total.toLocaleString()}]`;
    if (S.activeFilter !== 'all' && S.filteredIndices && S.filteredIndices.length > 0) {
      text = `[${S.getFilterLabel()}] ${S.filterPos + 1} / ${S.filteredIndices.length.toLocaleString()} (#${cur})`;
    }
    if (hasUnsaved) {
      text += ' *';
    }

    this.topbar.setStatus(text);
    this.topbar.setConfirmedBadge(isConf);

    const bottomInfo = document.getElementById('bottom-info');
    if (bottomInfo && S.currentData.filename) {
      bottomInfo.textContent = `ไฟล์: ${S.currentData.filename} | ภาพ: ${cur} / ${total.toLocaleString()} | ขนาด: ${S.currentData.width}×${S.currentData.height} | วัตถุ: ${S.currentData.shapes.length} กรอบ`;
    }
  }

  updateNavButtonsState(disabled) {
    if (this.topbar.btnPrev) this.topbar.btnPrev.disabled = disabled;
    if (this.topbar.btnNext) this.topbar.btnNext.disabled = disabled;
  }

  showToast(msg, duration = 2000) {
    const toast = document.getElementById('toast');
    if (!toast) return;

    if (this.toastTimer) clearTimeout(this.toastTimer);
    toast.textContent = msg;
    toast.classList.add('show');

    this.toastTimer = setTimeout(() => {
      toast.classList.remove('show');
      this.toastTimer = null;
    }, duration);
  }

  toggleLabelsDrawer() {
    this.labelDrawer.toggle();
    if (this.topbar.btnToggleLabels && this.labelDrawer.panel) {
      this.topbar.btnToggleLabels.classList.toggle('active', this.labelDrawer.panel.classList.contains('drawer-open'));
    }
  }

  toggleFullscreen() {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      const docEl = document.documentElement;
      if (docEl.requestFullscreen) docEl.requestFullscreen().catch(() => {});
      else if (docEl.webkitRequestFullscreen) docEl.webkitRequestFullscreen();
    } else {
      if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    }
  }

  initFullscreenListener() {
    const btnFs = document.getElementById('btn-fullscreen') || (this.topbar && this.topbar.btnFullscreen);

    const onFsChange = () => {
      const isFull = !!(document.fullscreenElement || document.webkitFullscreenElement);
      if (btnFs) {
        btnFs.innerHTML = isFull ? '<span class="tool-icon">🗗</span><span class="tool-txt">ย่อ</span>' : '<span class="tool-icon">⛶</span><span class="tool-txt">ขยาย</span>';
        btnFs.classList.toggle('active', isFull);
      }
      setTimeout(() => {
        this.renderer.resizeCanvases();
        this.renderer.fitImageToView();
        this.renderer.renderAll();
        this.zoomControls.updateDisplay();
      }, 180);
    };

    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);

    if (btnFs) {
      btnFs.addEventListener('click', (e) => {
        e.preventDefault();
        this.toggleFullscreen();
      });
    }
  }

  deleteSelectedShape() {
    const deleted = this.store.deleteSelectedShape();
    if (deleted) {
      this.renderer.renderAnnotations();
      this.labelDrawer.render();
    }
  }

  renderLabelList() {
    this.labelDrawer.render();
  }

  updateZoomDisplay() {
    this.zoomControls.updateDisplay();
  }
}

// เริ่มต้นแอปพลิเคชันเมื่อ DOM โหลดสมบูรณ์
window.addEventListener('DOMContentLoaded', () => {
  window.app = new AppController();
});
