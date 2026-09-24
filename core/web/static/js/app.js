/**
 * Main Application Controller
 * ผูก API, UI Components, Keyboard Shortcuts และ Business Logic เข้าด้วยกัน
 */
class AppController {
  constructor() {
    this.toastTimer = null;
    this.autoSaveTimer = null;
    this.isNavigating = false;
    this.init();
  }

  async init() {
    this.bindUI();
    this.bindKeyboardShortcuts();
    this.subscribeState();

    // เริ่มต้นโหลด Overview จากเซิร์ฟเวอร์
    await this.fetchSummary();
    if (window.appState.total > 0) {
      await this.loadItem(0);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // API CALLS
  // ═══════════════════════════════════════════════════════════════
  async fetchSummary() {
    try {
      const res = await fetch('/api/summary');
      const data = await res.json();
      const S = window.appState;
      S.total = data.total;
      S.confirmedCount = data.confirmed_count;
      S.classes = data.classes;
      S.activeDrawLabel = data.classes[0] || 'OBJECT';

      this.renderLabelList();
      this.updateStatusDisplay();
    } catch (err) {
      this.showToast('❌ ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้');
    }
  }

  async loadItem(idx) {
    const S = window.appState;
    if (idx < 0 || idx >= S.total) return;
    if (this.isNavigating) return;

    this.isNavigating = true;
    this.updateNavButtonsState(true);
    this.showToast(`กำลังโหลดรูปที่ ${idx + 1}...`, 600);

    try {
      // 1. ดึง Annotation & Metadata ของรูปปลายทางล่วงหน้า (ยังไม่เปลี่ยน S.currentIndex เพื่อป้องกัน race condition)
      const resMeta = await fetch(`/api/item/${idx}`);
      if (!resMeta.ok) throw new Error(`HTTP ${resMeta.status}: โหลด Metadata ไม่สำเร็จ`);
      const data = await resMeta.json();

      // 2. โหลด Image Binary
      const resImg = await fetch(`/api/image/${idx}`);
      if (!resImg.ok) throw new Error(`HTTP ${resImg.status}: โหลด Image ไม่สำเร็จ`);
      const blob = await resImg.blob();
      const bitmap = await createImageBitmap(blob);

      // 3. ปรับ State แบบ Atomic พร้อมกันทั้งหมดเมื่อข้อมูลพร้อม 100%
      S.currentIndex = idx;
      S.setLoadedData(data);
      S.imgBitmap = bitmap;
      S.selectedShapeIdx = -1;
      S.hoveredShapeIdx = -1;
      S.history = [];

      // จัดตำแหน่งภาพให้พอดีหน้าจอ
      window.canvasRenderer.resizeCanvases();
      window.canvasRenderer.fitImageToView();
      window.canvasRenderer.renderAll();
      this.updateZoomDisplay();

      this.updateStatusDisplay();
      this.renderLabelList();
    } catch (err) {
      this.showToast('❌ โหลดภาพล้มเหลว: ' + err.message);
    } finally {
      this.isNavigating = false;
      this.updateNavButtonsState(false);
    }
  }

  async saveCurrentItem(confirmed = null) {
    const S = window.appState;
    if (S.total === 0 || !S.currentData || !S.currentData.filename) return null;

    const targetConfirmed = (confirmed !== null) ? Boolean(confirmed) : Boolean(S.currentData.confirmed);

    // ── ตรวจสอบการเปลี่ยนแปลง: ถ้าไม่มีการแก้ไข Bbox และสถานะยืนยันไม่เปลี่ยน ให้ข้ามการเซฟทันที ──
    if (!S.hasChanged(targetConfirmed)) {
      return { status: 'skipped', reason: 'no_changes' };
    }

    // Snapshot ข้อมูลภาพ ณ วินาทีที่สั่ง Save ป้องกันการอ้างอิง State ที่ถูกสลับระหว่าง Request
    const targetIdx = S.currentIndex;
    const targetStem = S.currentData.stem;
    const targetFilename = S.currentData.filename;
    const targetShapes = JSON.parse(JSON.stringify(S.currentData.shapes));

    try {
      const payload = {
        shapes: targetShapes,
        confirmed: targetConfirmed,
        stem: targetStem,
        filename: targetFilename
      };

      const res = await fetch(`/api/save/${targetIdx}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        console.error('🚨 Save Rejected by Server:', errJson);
        this.showToast(`⚠️ บันทึกไม่สำเร็จ: ${errJson.detail || 'เซิร์ฟเวอร์ปฏิเสธข้อมูล'}`, 3500);
        return null;
      }

      const result = await res.json();

      // เมื่อบันทึกสำเร็จ รีเซ็ตสถานะ Dirty และบันทึก baseline ใหม่
      if (S.currentIndex === targetIdx) {
        if (targetConfirmed && !S.currentData.confirmed) {
          S.confirmedCount++;
        } else if (!targetConfirmed && S.currentData.confirmed) {
          S.confirmedCount = Math.max(0, S.confirmedCount - 1);
        }
        S.markClean(targetConfirmed);
        this.updateStatusDisplay();
      }

      return result;
    } catch (err) {
      this.showToast('❌ บันทึกล้มเหลว: ' + err.message);
      return null;
    }
  }

  triggerDebouncedAutoSave() {
    clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = setTimeout(() => {
      if (!this.isNavigating && window.appState.hasChanged()) {
        this.saveCurrentItem();
      }
    }, 800);
  }

  updateNavButtonsState(disabled) {
    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');
    const btnConfirm = document.getElementById('btn-confirm');
    if (btnPrev) btnPrev.style.pointerEvents = disabled ? 'none' : 'auto';
    if (btnNext) btnNext.style.pointerEvents = disabled ? 'none' : 'auto';
    if (btnConfirm) btnConfirm.style.pointerEvents = disabled ? 'none' : 'auto';
  }

  // ═══════════════════════════════════════════════════════════════
  // UI EVENT BINDING
  // ═══════════════════════════════════════════════════════════════
  bindUI() {
    const S = window.appState;

    // ปุ่มก่อนหน้า / ถัดไป
    document.getElementById('btn-prev').addEventListener('click', async () => {
      if (this.isNavigating) return;
      clearTimeout(this.autoSaveTimer);
      if (S.hasChanged()) {
        await this.saveCurrentItem();
      }
      if (S.currentIndex > 0) {
        await this.loadItem(S.currentIndex - 1);
      }
    });

    document.getElementById('btn-next').addEventListener('click', async () => {
      if (this.isNavigating) return;
      clearTimeout(this.autoSaveTimer);
      if (S.hasChanged()) {
        await this.saveCurrentItem();
      }
      if (S.currentIndex < S.total - 1) {
        await this.loadItem(S.currentIndex + 1);
      }
    });

    // ปุ่มยืนยัน (Confirm & Next)
    document.getElementById('btn-confirm').addEventListener('click', async () => {
      if (this.isNavigating) return;
      clearTimeout(this.autoSaveTimer);
      if (navigator.vibrate) navigator.vibrate([40, 60, 40]);

      if (S.hasChanged(true)) {
        await this.saveCurrentItem(true);
        this.showToast('✅ บันทึกและยืนยันข้อมูลสำเร็จ!');
      } else {
        this.showToast('✅ ยืนยันข้อมูลเรียบร้อย');
      }

      // ไปรูปถัดไปทันที
      if (S.currentIndex < S.total - 1) {
        await this.loadItem(S.currentIndex + 1);
      }
    });



    // ปุ่มโหมดเต็มจอ (Fullscreen)
    const btnFullscreen = document.getElementById('btn-fullscreen');
    if (btnFullscreen) {
      btnFullscreen.addEventListener('click', () => {
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
          const docEl = document.documentElement;
          if (docEl.requestFullscreen) {
            docEl.requestFullscreen().catch(() => {});
          } else if (docEl.webkitRequestFullscreen) {
            docEl.webkitRequestFullscreen();
          }
        } else {
          if (document.exitFullscreen) {
            document.exitFullscreen().catch(() => {});
          } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
          }
        }
      });

      const onFullscreenChange = () => {
        const isFull = !!(document.fullscreenElement || document.webkitFullscreenElement);
        btnFullscreen.innerHTML = isFull ? '🗗 ออกเต็มจอ' : '⛶ เต็มจอ';
        setTimeout(() => {
          window.canvasRenderer.resizeCanvases();
          window.canvasRenderer.fitImageToView();
          window.canvasRenderer.renderAll();
          this.updateZoomDisplay();
        }, 180);
      };

      document.addEventListener('fullscreenchange', onFullscreenChange);
      document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    }

    // แถบ Tools
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        const tool = btn.dataset.tool;
        if (!tool) return;

        if (tool === 'delete') {
          this.deleteSelectedShape();
          return;
        }
        if (tool === 'undo') {
          S.undo();
          return;
        }

        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        S.activeTool = tool;

        const wrap = document.getElementById('canvas-wrap');
        wrap.className = `mode-${tool}`;
      });
    });

    // Color picker input listener
    const colorInput = document.getElementById('color-picker-input');
    colorInput.addEventListener('input', e => {
      const label = colorInput.dataset.targetLabel;
      if (label) {
        S.setColor(label, e.target.value);
        this.renderLabelList();
        window.canvasRenderer.renderAnnotations();
      }
    });

    // ปุ่มควบคุมการซูม (Floating Zoom Controls)
    document.getElementById('btn-zoom-in').addEventListener('click', () => this.zoomBy(1.25));
    document.getElementById('btn-zoom-out').addEventListener('click', () => this.zoomBy(0.8));
    document.getElementById('btn-zoom-fit').addEventListener('click', () => {
      window.canvasRenderer.fitImageToView();
      window.canvasRenderer.renderAll();
      this.updateZoomDisplay();
    });
    document.getElementById('btn-zoom-100').addEventListener('click', () => {
      const R = window.canvasRenderer;
      const vw = R.cUi.width;
      const vh = R.cUi.height;
      const iw = S.currentData.width || 640;
      const ih = S.currentData.height || 640;
      S.scale = 1.0;
      S.panX = (vw - iw) / 2;
      S.panY = (vh - ih) / 2;
      R.renderAll();
      this.updateZoomDisplay();
    });

    // ปุ่มเลือกการเรียงลำดับ Labels (Sort: A-Z หรือ Data ID)
    document.querySelectorAll('.sort-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.sort;
        if (mode && S.labelSort !== mode) {
          S.setLabelSort(mode);
          this.renderLabelList();
          this.showToast(mode === 'alpha' ? '🔤 เรียงตามตัวอักษร (A-Z)' : '📋 เรียงตามลำดับไฟล์ (Data ID)');
        }
      });
    });
  }

  bindKeyboardShortcuts() {
    window.addEventListener('keydown', async e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (this.isNavigating) return;

      const S = window.appState;

      // Enter หรือ Space: ยืนยันและไปรูปถัดไป
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        document.getElementById('btn-confirm').click();
        return;
      }

      // A หรือ ArrowLeft: ก่อนหน้า
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') {
        e.preventDefault();
        document.getElementById('btn-prev').click();
        return;
      }

      // D หรือ ArrowRight: ถัดไป
      if (e.code === 'KeyD' || e.code === 'ArrowRight') {
        e.preventDefault();
        document.getElementById('btn-next').click();
        return;
      }

      // Delete หรือ Backspace: ลบกล่องที่เลือก
      if (e.code === 'Delete' || e.code === 'Backspace') {
        e.preventDefault();
        this.deleteSelectedShape();
        return;
      }

      // Ctrl + Z: Undo
      if (e.ctrlKey && e.code === 'KeyZ') {
        e.preventDefault();
        S.undo();
        return;
      }

      // 1, 2, 3: สลับ Tools
      if (e.code === 'Digit1') document.querySelector('[data-tool="select"]').click();
      if (e.code === 'Digit2') document.querySelector('[data-tool="draw"]').click();
      if (e.code === 'Digit3') document.querySelector('[data-tool="pan"]').click();

      // Zoom Shortcuts: + / -, F (Fit), 0 (100%)
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        this.zoomBy(1.25);
        return;
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        this.zoomBy(0.8);
        return;
      }
      if (e.code === 'KeyF') {
        e.preventDefault();
        window.canvasRenderer.fitImageToView();
        window.canvasRenderer.renderAll();
        this.updateZoomDisplay();
        return;
      }
      if (e.code === 'Digit0') {
        e.preventDefault();
        document.getElementById('btn-zoom-100').click();
        return;
      }
    });
  }

  zoomBy(factor) {
    const S = window.appState;
    const R = window.canvasRenderer;
    const vw = R.cUi.width;
    const vh = R.cUi.height;
    const cx = vw / 2;
    const cy = vh / 2;

    const newScale = Math.max(0.05, Math.min(30, S.scale * factor));
    S.panX = cx - (cx - S.panX) * (newScale / S.scale);
    S.panY = cy - (cy - S.panY) * (newScale / S.scale);
    S.scale = newScale;
    R.renderAll();
    this.updateZoomDisplay();
  }

  updateZoomDisplay() {
    const el = document.getElementById('zoom-text');
    if (el) {
      el.textContent = `${Math.round(window.appState.scale * 100)}%`;
    }
  }

  subscribeState() {
    const S = window.appState;
    S.subscribe((event, data) => {
      if (event === 'shapes_change') {
        window.canvasRenderer.renderAnnotations();
        this.renderLabelList();
        S.isDirty = true;
        this.triggerDebouncedAutoSave();
      }
      if (event === 'colors') {
        this.renderLabelList();
        window.canvasRenderer.renderAnnotations();
      }
    });
  }

  deleteSelectedShape() {
    const S = window.appState;
    if (S.selectedShapeIdx >= 0) {
      S.pushHistory();
      const removed = S.currentData.shapes.splice(S.selectedShapeIdx, 1);
      S.selectedShapeIdx = -1;
      S.isDirty = true;
      window.canvasRenderer.renderAnnotations();
      this.renderLabelList();
      this.showToast(`🗑️ ลบกรอบ '${removed[0].label}' เรียบร้อย`);
      this.triggerDebouncedAutoSave();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDER UI HELPERS
  // ═══════════════════════════════════════════════════════════════
  updateStatusDisplay() {
    const S = window.appState;
    const label = document.getElementById('status-label');
    const badge = document.getElementById('confirm-badge');
    const bottomInfo = document.getElementById('bottom-info');

    label.textContent = `📷 ${S.currentIndex + 1} / ${S.total} (ยืนยันแล้ว: ${S.confirmedCount})`;

    if (S.currentData.confirmed) {
      badge.classList.add('show');
    } else {
      badge.classList.remove('show');
    }

    bottomInfo.textContent = `ไฟล์: ${S.currentData.filename || '—'} | ขนาด: ${S.currentData.width}x${S.currentData.height} | วัตถุ: ${S.currentData.shapes.length}`;
  }

  renderLabelList() {
    const S = window.appState;
    const container = document.getElementById('label-list');
    container.innerHTML = '';

    // อัปเดตสถานะปุ่ม Sort
    document.querySelectorAll('.sort-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.sort === S.labelSort);
    });

    // นับจำนวนกล่องของแต่ละคลาสในรูปปัจจุบัน
    const countMap = {};
    S.currentData.shapes.forEach(sh => {
      countMap[sh.label] = (countMap[sh.label] || 0) + 1;
    });

    const selShape = S.selectedShapeIdx >= 0 ? S.currentData.shapes[S.selectedShapeIdx] : null;

    // จัดเรียงคลาสตามตัวเลือก: 'alpha' (A-Z) หรือ 'data' (ลำดับเดิม)
    let displayClasses = [...S.classes];
    if (S.labelSort === 'alpha') {
      displayClasses.sort((a, b) => a.localeCompare(b));
    }

    displayClasses.forEach(label => {
      const color = S.getColor(label);
      const count = countMap[label] || 0;

      const card = document.createElement('div');
      card.className = 'label-card';

      // ไฮไลต์ถ้าตรงกับ Bbox ที่เลือกอยู่ หรือกำลังเป็น Active สำหรับวาด
      if (selShape && selShape.label === label) {
        card.classList.add('matched-class');
      } else if (S.activeDrawLabel === label) {
        card.classList.add('active-class');
      }

      card.innerHTML = `
        <div class="label-info">
          <span class="label-dot" style="background: ${color}" title="คลิกเปลี่ยนสี"></span>
          <span class="label-name" title="${label}">${label}</span>
        </div>
        ${count > 0 ? `<span class="label-count-tag">${count}</span>` : ''}
      `;

      // ── คลิกที่จุดสีเพื่อเปิด Color Picker ──
      const dot = card.querySelector('.label-dot');
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openColorPicker(label, e.clientX, e.clientY);
      });

      // ── คลิกที่การ์ด Label ──
      card.addEventListener('click', (e) => {
        // กรณีที่ 1: มีการเลือก Bbox บน Canva อยู่ -> เปลี่ยนชื่อ Label ของ Bbox นั้นทันที!
        if (S.selectedShapeIdx >= 0) {
          const currentSelShape = S.currentData.shapes[S.selectedShapeIdx];
          const oldLabel = currentSelShape.label;
          if (oldLabel !== label) {
            S.pushHistory();
            currentSelShape.label = label;
            S.activeDrawLabel = label;
            S.isDirty = true;
            window.canvasRenderer.renderAnnotations();
            this.renderLabelList();
            this.triggerDebouncedAutoSave();

            if (navigator.vibrate) navigator.vibrate([30, 40]);
            this.showToast(`🏷️ เปลี่ยน '${oldLabel}' เป็น '${label}' สำเร็จ`);
            return;
          }
        }

        // กรณีที่ 2: ไม่ได้เลือก Bbox -> กำหนด Label นี้เป็น Active เพื่อเตรียมสร้าง Bbox
        S.activeDrawLabel = label;
        this.renderLabelList();
        if (navigator.vibrate) navigator.vibrate(20);
        this.showToast(`📌 เลือก '${label}' (แตะที่ว่างบนภาพเพื่อสร้างกรอบ)`);
      });

      // แตะแช่ 500ms หรือคลิกขวาเพื่อเปลี่ยนสี
      let longPressTimer = null;
      card.addEventListener('pointerdown', (e) => {
        longPressTimer = setTimeout(() => {
          this.openColorPicker(label, e.clientX, e.clientY);
        }, 500);
      });
      card.addEventListener('pointerup', () => clearTimeout(longPressTimer));
      card.addEventListener('pointermove', () => clearTimeout(longPressTimer));

      card.addEventListener('contextmenu', e => {
        e.preventDefault();
        this.openColorPicker(label, e.clientX, e.clientY);
      });

      container.appendChild(card);
    });
  }

  openColorPicker(label, x, y) {
    const S = window.appState;
    const input = document.getElementById('color-picker-input');
    input.dataset.targetLabel = label;
    input.value = S.getColor(label);
    input.click();
    if (navigator.vibrate) navigator.vibrate([30, 50]);
  }

  showToast(msg, duration = 1800) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, duration);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new AppController();
});
