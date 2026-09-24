/**
 * Single Source of Truth (SSOT) สำหรับ Frontend State
 */
class StateManager {
  constructor() {
    this.total = 0;
    this.confirmedCount = 0;
    this.currentIndex = 0;
    this.classes = [];
    this.labelColors = {};

    // ข้อมูลภาพปัจจุบัน
    this.currentData = {
      index: 0,
      filename: "",
      width: 0,
      height: 0,
      shapes: [],
      confirmed: false
    };

    // การติดตามการเปลี่ยนแปลง (Dirty State Tracking) เพื่อบันทึกเฉพาะตอนที่มีการแก้ไขจริงเท่านั้น
    this.isDirty = false;
    this.initialShapesStr = "[]";
    this.initialConfirmed = false;

    // ภาพ Bitmap สำหรับแคนวาส
    this.imgBitmap = null;

    // Viewport transform
    this.panX = 0;
    this.panY = 0;
    this.scale = 1;

    // Active tool: 'select' | 'draw' | 'pan'
    this.activeTool = 'select';
    this.selectedShapeIdx = -1;
    this.hoveredShapeIdx = -1;
    this.activeDrawLabel = "";

    // Label Sort: 'alpha' (A-Z) | 'data' (ตามไฟล์ข้อมูล)
    this.labelSort = localStorage.getItem('yolo_label_sort') || 'alpha';

    // Device Input Mode: 'mouse' | 'touch'
    this.inputMode = 'mouse';

    // Undo history
    this.history = [];

    // Listeners
    this.listeners = [];

    this._initDefaultColors();
  }

  _initDefaultColors() {
    const palette = [
      '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6',
      '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16',
      '#f43f5e', '#a855f7', '#0ea5e9', '#10b981', '#f59e0b',
      '#6366f1', '#64748b', '#d946ef', '#78716c'
    ];
    // โหลดสีจาก localStorage ถ้ามี
    try {
      const saved = localStorage.getItem('yolo_label_colors');
      if (saved) this.labelColors = JSON.parse(saved);
    } catch (e) {}

    this.palette = palette;
  }

  getColor(label) {
    if (!this.labelColors[label]) {
      const ci = this.classes.indexOf(label);
      this.labelColors[label] = this.palette[ci >= 0 ? ci % this.palette.length : Math.floor(Math.random() * this.palette.length)];
    }
    return this.labelColors[label];
  }

  setColor(label, hex) {
    this.labelColors[label] = hex;
    try {
      localStorage.setItem('yolo_label_colors', JSON.stringify(this.labelColors));
    } catch (e) {}
    this.notify('colors');
  }

  setLabelSort(mode) {
    this.labelSort = mode;
    try {
      localStorage.setItem('yolo_label_sort', mode);
    } catch (e) {}
    this.notify('sort_change');
  }

  subscribe(fn) {
    this.listeners.push(fn);
  }

  notify(event, data) {
    this.listeners.forEach(fn => fn(event, data));
  }

  pushHistory() {
    this.history.push(JSON.parse(JSON.stringify(this.currentData.shapes)));
    if (this.history.length > 30) this.history.shift();
  }

  undo() {
    if (this.history.length > 0) {
      this.currentData.shapes = this.history.pop();
      this.selectedShapeIdx = -1;
      this.isDirty = true;
      this.notify('shapes_change');
    }
  }

  setLoadedData(data) {
    this.currentData = data;
    this.initialShapesStr = JSON.stringify(data.shapes || []);
    this.initialConfirmed = Boolean(data.confirmed);
    this.isDirty = false;
  }

  hasChanged(newConfirmed = null) {
    const confirmedToCheck = newConfirmed !== null ? Boolean(newConfirmed) : Boolean(this.currentData.confirmed);
    if (confirmedToCheck !== this.initialConfirmed) return true;
    if (this.isDirty) return true;
    const currentStr = JSON.stringify(this.currentData.shapes || []);
    return currentStr !== this.initialShapesStr;
  }

  markClean(confirmed = null) {
    this.initialShapesStr = JSON.stringify(this.currentData.shapes || []);
    if (confirmed !== null) {
      this.currentData.confirmed = Boolean(confirmed);
      this.initialConfirmed = Boolean(confirmed);
    }
    this.isDirty = false;
  }

  /**
   * คำนวณขอบเขต {minX, minY, maxX, maxY, w, h} ของรูปทรงใดๆ
   * รองรับทั้ง Bbox 2 จุด [[x1,y1], [x2,y2]] และ Rectangle/Polygon 4 จุดขึ้นไป
   */
  getShapeBounds(sh) {
    if (!sh || !sh.points || sh.points.length === 0) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0 };
    }
    const pts = sh.points;
    let minX = pts[0][0], maxX = pts[0][0];
    let minY = pts[0][1], maxY = pts[0][1];

    for (let i = 1; i < pts.length; i++) {
      const x = pts[i][0];
      const y = pts[i][1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    return {
      minX,
      minY,
      maxX,
      maxY,
      w: maxX - minX,
      h: maxY - minY
    };
  }
}

// Instance กลางตัวเดียว
window.appState = new StateManager();
