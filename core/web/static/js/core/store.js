/**
 * Production-Grade Single Source of Truth (SSOT) Store
 * ควบคุมวงจรชีวิตของข้อมูลและ State ทั้งหมดของระบบ YOLO BBox Reviewer
 * - ป้องกันการกลายพันธุ์ของสถานะแบบไม่พึงประสงค์ (Controlled State Mutations)
 * - บันทึกและคำนวณ Dirty Tracking อัตโนมัติ
 * - มี History Stack สำหรับ Undo / Redo
 * - สื่อสารผ่าน Typed EventBus และ Enums
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['../constants/enums', './event_bus'], factory);
  } else if (typeof module === 'object' && module.exports) {
    const enums = require('../constants/enums');
    const EventBus = require('./event_bus');
    module.exports = factory(enums, EventBus);
  } else {
    root.Store = factory(root.Enums, root.EventBus);
  }
}(typeof self !== 'undefined' ? self : this, function (Enums, EventBus) {
  'use strict';

  const { ToolType, InputMode, SortOrder, FilterType, AppEvent, isValidToolType } = Enums;

  class Store {
    constructor(options = {}) {
      this.eventBus = options.eventBus || new EventBus();
      this.maxHistory = options.maxHistory || 30;

      // Backward-compatible listeners array
      this.listeners = [];

      // ── ข้อมูลสถิติรวมของ Dataset ──
      this.total = 0;
      this.confirmedCount = 0;
      this.negativeCount = 0;
      this.unverifiedCount = 0;
      this.lowConfCount = 0;
      this.currentIndex = 0;
      this.classes = [];
      this.labelColors = {};

      // ── ข้อมูลภาพปัจจุบัน ──
      this.currentData = {
        index: 0,
        filename: '',
        width: 0,
        height: 0,
        shapes: [],
        raw_shapes: [],
        has_low_conf: false,
        confirmed: false
      };

      // ── Confidence Range & Low-Conf Checkbox State ──
      const savedConf = typeof localStorage !== 'undefined' ? parseFloat(localStorage.getItem('yolo_conf_threshold')) : NaN;
      const savedConfMin = typeof localStorage !== 'undefined' ? parseFloat(localStorage.getItem('yolo_conf_min')) : NaN;
      const savedConfMax = typeof localStorage !== 'undefined' ? parseFloat(localStorage.getItem('yolo_conf_max')) : NaN;
      const savedShowLow = typeof localStorage !== 'undefined' ? localStorage.getItem('yolo_show_low_conf') : null;

      this.confMin = !isNaN(savedConfMin) ? savedConfMin : 0.05;
      this.confMax = !isNaN(savedConfMax) ? savedConfMax : (!isNaN(savedConf) ? savedConf : 0.50);
      this.confThreshold = this.confMax;
      this.showLowConf = savedShowLow !== null ? savedShowLow === 'true' : true;
      this.lowConfCount = 0;
      this.hoveredLowConfIdx = -1;

      // ── การติดตามการเปลี่ยนแปลง (Dirty State Tracking) ──
      this.isDirty = false;
      this.initialShapesStr = '[]';
      this.initialConfirmed = false;

      // ── ภาพ Bitmap สำหรับแคนวาส ──
      this.imgBitmap = null;

      // ── Viewport Transform ──
      this.panX = 0;
      this.panY = 0;
      this.scale = 1;

      // ── Active Tool & Selection (ควบคุมผ่าน ToolType Enum) ──
      this.activeTool = ToolType.SELECT;
      this.selectedShapeIdx = -1;
      this.hoveredShapeIdx = -1;
      this.activeDrawLabel = '';

      // ── Label Sort (ควบคุมผ่าน SortOrder Enum) ──
      const savedSort = typeof localStorage !== 'undefined' ? localStorage.getItem('yolo_label_sort') : null;
      this.labelSort = savedSort || SortOrder.ALPHA;

      // ── Device Input Mode (ควบคุมผ่าน InputMode Enum) ──
      this.inputMode = InputMode.MOUSE;

      // ── History Stack สำหรับ Undo ──
      this.history = [];

      // ── Multi-select Filter State ──
      this.filterMap = {};
      this.classCounts = {};
      this.filterStatus = 'all';
      this.filterClasses = [];
      this.filterConfMin = null;
      this.filterConfMax = null;
      this.activeFilter = FilterType.ALL;
      this.filteredIndices = [];
      this.filterPos = 0;

      this._initDefaultColors();
    }

    // ==========================================
    // Tool & Mode Actions
    // ==========================================

    setTool(tool) {
      if (!isValidToolType(tool)) {
        console.warn(`[Store] Invalid ToolType: "${tool}". Defaulting to SELECT.`);
        tool = ToolType.SELECT;
      }
      if (this.activeTool !== tool) {
        this.activeTool = tool;
        this.eventBus.emit(AppEvent.TOOL_CHANGED, tool);
        this.notify('tool_change', tool);
      }
    }

    setInputMode(mode) {
      if (this.inputMode !== mode) {
        this.inputMode = mode;
        this.eventBus.emit(AppEvent.STATE_CHANGED, { inputMode: mode });
      }
    }

    setLabelSort(order) {
      this.labelSort = order;
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem('yolo_label_sort', order);
        } catch (e) {}
      }
      this.eventBus.emit(AppEvent.SORT_CHANGED, order);
      this.notify('sort_change', order);
    }

    setShowLowConf(show) {
      this.showLowConf = Boolean(show);
      if (typeof localStorage !== 'undefined') {
        try { localStorage.setItem('yolo_show_low_conf', this.showLowConf.toString()); } catch (e) {}
      }
      this.eventBus.emit(AppEvent.SHOW_LOW_CONF_CHANGED, this.showLowConf);
      this.notify('show_low_conf_change', this.showLowConf);
    }

    setConfRange(min, max) {
      const minNum = Math.max(0.00, Math.min(1.00, parseFloat(min) || 0.05));
      const maxNum = Math.max(0.00, Math.min(1.00, parseFloat(max) || 0.50));
      this.confMin = Math.round(Math.min(minNum, maxNum) * 100) / 100;
      this.confMax = Math.round(Math.max(minNum, maxNum) * 100) / 100;
      this.confThreshold = this.confMax;
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem('yolo_conf_min', this.confMin.toString());
          localStorage.setItem('yolo_conf_max', this.confMax.toString());
          localStorage.setItem('yolo_conf_threshold', this.confMax.toString());
        } catch (e) {}
      }
      this.eventBus.emit(AppEvent.CONF_RANGE_CHANGED, { min: this.confMin, max: this.confMax });
      this.eventBus.emit(AppEvent.CONF_THRESHOLD_CHANGED, this.confThreshold);
      this.notify('conf_range_change', { min: this.confMin, max: this.confMax });
    }

    setConfThreshold(val) {
      const num = Math.max(0.05, Math.min(1.0, parseFloat(val) || 0.45));
      this.confThreshold = Math.round(num * 100) / 100;
      this.confMax = this.confThreshold;
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem('yolo_conf_threshold', this.confThreshold.toString());
          localStorage.setItem('yolo_conf_max', this.confMax.toString());
        } catch (e) {}
      }
      this.eventBus.emit(AppEvent.CONF_THRESHOLD_CHANGED, this.confThreshold);
      this.eventBus.emit(AppEvent.CONF_RANGE_CHANGED, { min: this.confMin, max: this.confMax });
      this.notify('conf_threshold_change', this.confThreshold);
    }

    // ==========================================
    // Data Loading & Image Actions
    // ==========================================

    setSummary(data) {
      if (!data) return;
      this.total = data.total || 0;
      this.confirmedCount = (data.confirmed_count !== undefined ? data.confirmed_count : data.confirmed) || 0;
      this.negativeCount = (data.negative_count !== undefined ? data.negative_count : data.neg_count) || 0;
      this.unverifiedCount = (data.unverified_count !== undefined ? data.unverified_count : Math.max(0, this.total - this.confirmedCount));
      this.lowConfCount = data.low_conf_count || 0;
      this.classes = data.classes || [];
      this.classCounts = data.class_counts || {};
      if (data.classes && data.classes.length > 0 && !this.activeDrawLabel) {
        this.activeDrawLabel = data.classes[0];
      }
      this.setFilterMap(data.filter_indices || {}, data.class_counts);
      this.eventBus.emit(AppEvent.STATE_CHANGED, { summary: data });
    }

    setLoadedData(data) {
      this.currentData = {
        ...data,
        shapes: Array.isArray(data.shapes) ? JSON.parse(JSON.stringify(data.shapes)) : [],
        raw_shapes: Array.isArray(data.raw_shapes) ? JSON.parse(JSON.stringify(data.raw_shapes)) : (data.shapes || [])
      };
      this.initialShapesStr = JSON.stringify(this.currentData.shapes);
      this.initialConfirmed = Boolean(data.confirmed);
      this.isDirty = false;
      this.selectedShapeIdx = -1;
      this.hoveredShapeIdx = -1;
      this.hoveredLowConfIdx = -1;
      this.history = [];

      this.eventBus.emit(AppEvent.IMAGE_LOADED, this.currentData);
      this.eventBus.emit(AppEvent.DIRTY_CHANGED, false);
      this.notify('image_loaded', this.currentData);
    }

    setFilterMap(filterIndices, classCounts = {}) {
      this.filterMap = filterIndices || {};
      this.classCounts = classCounts || {};
      this.applyActiveFilter(this.activeFilter);
    }

    applyActiveFilter(filterKey) {
      this.activeFilter = filterKey || FilterType.ALL;
      if (filterKey && !filterKey.startsWith('class:') && Object.values(FilterType).includes(filterKey)) {
        this.filterStatus = filterKey;
      }
      if (this.activeFilter === FilterType.ALL) {
        this.filteredIndices = [];
        this.filterPos = this.currentIndex;
      } else {
        this.filteredIndices = this.filterMap[this.activeFilter] || [];
        const foundPos = this.filteredIndices.indexOf(this.currentIndex);
        this.filterPos = foundPos >= 0 ? foundPos : 0;
      }
      this.eventBus.emit(AppEvent.FILTER_CHANGED, { activeFilter: this.activeFilter, count: this.filteredIndices.length });
      this.notify('filter_change', this.activeFilter);
    }

    setCombinedFilter(status = 'all', classes = [], indices = null, confMin = null, confMax = null, includeLowConf = true) {
      if (Array.isArray(status)) {
        const clean = status.filter(s => s && s !== 'all');
        this.filterStatus = clean.length > 0 ? clean.sort().join(',') : 'all';
      } else {
        this.filterStatus = status || 'all';
      }
      this.filterClasses = Array.isArray(classes) ? [...classes] : [];
      this.filterConfMin = (confMin !== null && confMin !== undefined) ? Number(confMin) : null;
      this.filterConfMax = (confMax !== null && confMax !== undefined) ? Number(confMax) : null;
      this.filterIncludeLowConf = (includeLowConf !== undefined) ? Boolean(includeLowConf) : Boolean(this.showLowConf);

      let baseKey = this.filterStatus;
      if (this.filterClasses.length === 1 && this.filterStatus === 'all') {
        baseKey = `class:${this.filterClasses[0]}`;
      } else if (this.filterClasses.length > 0) {
        baseKey = `${this.filterStatus}:${this.filterClasses.join(',')}`;
      }

      const hasConf = (this.filterConfMin !== null && this.filterConfMax !== null && !(this.filterConfMin <= 0.0 && this.filterConfMax >= 1.0));
      if (hasConf) {
        this.activeFilter = `${baseKey}@${this.filterConfMin.toFixed(2)}-${this.filterConfMax.toFixed(2)}${this.filterIncludeLowConf ? '' : ':passed'}`;
      } else {
        this.activeFilter = baseKey;
      }

      if (indices !== null && Array.isArray(indices)) {
        this.filterMap[this.activeFilter] = indices;
        this.filteredIndices = indices;
      } else {
        this.filteredIndices = this.filterMap[this.activeFilter] || [];
      }

      if (this.activeFilter === FilterType.ALL && this.filterClasses.length === 0 && !hasConf) {
        this.filteredIndices = [];
        this.filterPos = this.currentIndex;
      } else {
        const foundPos = this.filteredIndices.indexOf(this.currentIndex);
        this.filterPos = foundPos >= 0 ? foundPos : 0;
      }

      this.eventBus.emit(AppEvent.FILTER_CHANGED, {
        activeFilter: this.activeFilter,
        status: this.filterStatus,
        classes: this.filterClasses,
        confMin: this.filterConfMin,
        confMax: this.filterConfMax,
        includeLowConf: this.filterIncludeLowConf,
        count: this.filteredIndices.length
      });
      this.notify('filter_change', this.activeFilter);
    }

    getFilterLabel() {
      const statusMap = {
        unverified: 'ยังไม่ตรวจ',
        verified: 'ตรวจแล้ว',
        negative: 'ไม่มีวัตถุ',
        low_conf: 'มี Low-Conf'
      };
      const cur = this.filterStatus || 'all';
      let statusNames = [];
      if (cur !== 'all') {
        const parts = Array.isArray(cur) ? cur : String(cur).split(',');
        statusNames = parts.filter(p => p && p !== 'all').map(p => statusMap[p] || p);
      }
      const statusLabel = statusNames.join(' + ');

      let labelText = '';
      if (this.filterClasses && this.filterClasses.length > 0) {
        const clsLabel = this.filterClasses.length === 1 ? this.filterClasses[0] : `${this.filterClasses[0]} +${this.filterClasses.length - 1}`;
        if (statusLabel) {
          labelText = `${statusLabel} [${clsLabel}]`;
        } else {
          labelText = clsLabel;
        }
      } else if (statusLabel) {
        labelText = statusLabel;
      } else {
        labelText = 'ทั้งหมด';
      }

      const hasConf = (this.filterConfMin !== null && this.filterConfMax !== null && !(this.filterConfMin <= 0.0 && this.filterConfMax >= 1.0));
      if (hasConf) {
        const tag = (!this.filterIncludeLowConf) ? ' ผ่าน' : '';
        labelText += ` (${this.filterConfMin.toFixed(2)} - ${this.filterConfMax.toFixed(2)}${tag})`;
      }

      return labelText;
    }

    // ==========================================
    // Shape & Annotation Actions
    // ==========================================

    selectShape(idx) {
      if (this.selectedShapeIdx !== idx) {
        this.selectedShapeIdx = idx;
        this.eventBus.emit(AppEvent.SELECTION_CHANGED, idx);
        this.notify('selection_change', idx);
      }
    }

    hoverShape(idx) {
      if (this.hoveredShapeIdx !== idx) {
        this.hoveredShapeIdx = idx;
        this.eventBus.emit(AppEvent.HOVER_CHANGED, { type: 'shape', index: idx });
      }
    }

    hoverLowConf(idx) {
      if (this.hoveredLowConfIdx !== idx) {
        this.hoveredLowConfIdx = idx;
        this.eventBus.emit(AppEvent.HOVER_CHANGED, { type: 'low_conf', index: idx });
      }
    }

    updateShapes(newShapes, markDirty = true) {
      this.pushHistory();
      this.currentData.shapes = JSON.parse(JSON.stringify(newShapes));
      if (markDirty) {
        this._checkDirty();
      }
      this.eventBus.emit(AppEvent.SHAPES_UPDATED, this.currentData.shapes);
      this.notify('shapes_change', this.currentData.shapes);
    }

    promoteLowConfShape(rawShape) {
      this.pushHistory();
      const shapeCopy = JSON.parse(JSON.stringify(rawShape));
      this.currentData.shapes.push(shapeCopy);
      this.selectedShapeIdx = this.currentData.shapes.length - 1;
      this._checkDirty();
      this.eventBus.emit(AppEvent.SHAPES_UPDATED, this.currentData.shapes);
      this.notify('shapes_change', this.currentData.shapes);
    }

    promoteAllVisibleLowConf(shapesList) {
      if (!shapesList || shapesList.length === 0) return;
      this.pushHistory();
      shapesList.forEach(rawSh => {
        this.currentData.shapes.push(JSON.parse(JSON.stringify(rawSh)));
      });
      this._checkDirty();
      this.eventBus.emit(AppEvent.SHAPES_UPDATED, this.currentData.shapes);
      this.notify('shapes_change', this.currentData.shapes);
    }

    deleteSelectedShape() {
      if (this.selectedShapeIdx < 0 || this.selectedShapeIdx >= this.currentData.shapes.length) {
        return false;
      }
      this.pushHistory();
      this.currentData.shapes.splice(this.selectedShapeIdx, 1);
      this.selectedShapeIdx = -1;
      this._checkDirty();
      this.eventBus.emit(AppEvent.SHAPES_UPDATED, this.currentData.shapes);
      this.notify('shapes_change', this.currentData.shapes);
      return true;
    }

    // ==========================================
    // History & Undo Actions
    // ==========================================

    pushHistory() {
      const currentShapes = this.currentData.shapes || [];
      if (this.history.length > 0) {
        const lastState = this.history[this.history.length - 1];
        if (JSON.stringify(lastState) === JSON.stringify(currentShapes)) {
          return; // ป้องกันการบันทึกประวัติซ้ำซ้อนเมื่อข้อมูลไม่มีการเปลี่ยนแปลงจริง
        }
      }
      this.history.push(JSON.parse(JSON.stringify(currentShapes)));
      if (this.history.length > this.maxHistory) {
        this.history.shift();
      }
      this.eventBus.emit(AppEvent.HISTORY_CHANGED, { canUndo: this.history.length > 0 });
    }

    undo() {
      if (this.history.length > 0) {
        this.currentData.shapes = this.history.pop();
        this.selectedShapeIdx = -1;
        this._checkDirty();
        this.eventBus.emit(AppEvent.SHAPES_UPDATED, this.currentData.shapes);
        this.eventBus.emit(AppEvent.HISTORY_CHANGED, { canUndo: this.history.length > 0 });
        this.notify('shapes_change', this.currentData.shapes);
        return true;
      }
      return false;
    }

    // ==========================================
    // Dirty State Tracking Actions
    // ==========================================

    _checkDirty() {
      const changed = this.hasChanged();
      if (this.isDirty !== changed) {
        this.isDirty = changed;
        this.eventBus.emit(AppEvent.DIRTY_CHANGED, this.isDirty);
        this.notify('dirty_change', this.isDirty);
      }
    }

    hasChanged(newConfirmed = null) {
      const confirmedToCheck = newConfirmed !== null ? Boolean(newConfirmed) : Boolean(this.currentData.confirmed);
      if (confirmedToCheck !== this.initialConfirmed) return true;
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
      this.eventBus.emit(AppEvent.DIRTY_CHANGED, false);
      this.notify('dirty_change', false);
    }

    // ==========================================
    // Color Palette & Management
    // ==========================================

    _initDefaultColors() {
      this.palette = [
        '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6',
        '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16',
        '#f43f5e', '#a855f7', '#0ea5e9', '#10b981', '#f59e0b',
        '#6366f1', '#64748b', '#d946ef', '#78716c'
      ];
      if (typeof localStorage !== 'undefined') {
        try {
          const saved = localStorage.getItem('yolo_label_colors');
          if (saved) this.labelColors = JSON.parse(saved);
        } catch (e) {}
      }
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
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem('yolo_label_colors', JSON.stringify(this.labelColors));
        } catch (e) {}
      }
      this.eventBus.emit(AppEvent.COLORS_CHANGED, { label, color: hex });
      this.notify('colors', this.labelColors);
    }

    // ==========================================
    // Geometric Math Helpers
    // ==========================================

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

    // ==========================================
    // Backward Compatibility Bridge
    // ==========================================

    subscribe(fn) {
      if (!this.listeners) this.listeners = [];
      this.listeners.push(fn);
    }

    notify(event, data) {
      if (!this.listeners) return;
      this.listeners.forEach(fn => {
        try {
          fn(event, data);
        } catch (err) {
          console.error('[Store Error] Listener error:', err);
        }
      });
    }
  }

  return Store;
}));
