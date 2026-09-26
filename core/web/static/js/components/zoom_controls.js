/**
 * Zoom Controls Component
 * ควบคุมปุ่ม Zoom In, Out, Fit, 1:1 และการแสดงเปอร์เซ็นต์ระดับการซูม
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['../constants/enums'], factory);
  } else if (typeof module === 'object' && module.exports) {
    const enums = require('../constants/enums');
    module.exports = factory(enums);
  } else {
    root.ZoomControlsComponent = factory(root.Enums);
  }
}(typeof self !== 'undefined' ? self : this, function (Enums) {
  'use strict';

  class ZoomControlsComponent {
    constructor(store, canvasRenderer, options = {}) {
      this.store = store;
      this.renderer = canvasRenderer;

      if (typeof document !== 'undefined') {
        this.btnIn = document.getElementById('btn-zoom-in');
        this.btnOut = document.getElementById('btn-zoom-out');
        this.btnFit = document.getElementById('btn-zoom-fit');
        this.btn100 = document.getElementById('btn-zoom-100');
        this.zoomText = document.getElementById('zoom-text');

        this.bindEvents();
      }
    }

    bindEvents() {
      if (this.btnIn) this.btnIn.addEventListener('click', () => this.zoomBy(1.25));
      if (this.btnOut) this.btnOut.addEventListener('click', () => this.zoomBy(0.8));
      if (this.btnFit) this.btnFit.addEventListener('click', () => this.fitToView());
      if (this.btn100) this.btn100.addEventListener('click', () => this.setActualSize());
    }

    zoomBy(factor) {
      const S = this.store || (typeof window !== 'undefined' ? window.appState : null);
      const R = this.renderer || (typeof window !== 'undefined' ? window.canvasRenderer : null);
      if (!S || !R || !R.cUi) return;

      const vw = R.cUi.width;
      const vh = R.cUi.height;
      const cx = vw / 2;
      const cy = vh / 2;

      if (R.viewportEngine) {
        const zoomed = R.viewportEngine.calculateZoomAtPoint(factor, cx, cy, S.panX, S.panY, S.scale);
        S.scale = zoomed.scale;
        S.panX = zoomed.panX;
        S.panY = zoomed.panY;
      } else {
        const newScale = Math.max(0.05, Math.min(30, S.scale * factor));
        S.panX = cx - (cx - S.panX) * (newScale / S.scale);
        S.panY = cy - (cy - S.panY) * (newScale / S.scale);
        S.scale = newScale;
      }

      R.renderAll();
      this.updateDisplay();
    }

    fitToView() {
      const R = this.renderer || (typeof window !== 'undefined' ? window.canvasRenderer : null);
      if (!R) return;
      R.fitImageToView();
      R.renderAll();
      this.updateDisplay();
    }

    setActualSize() {
      const S = this.store || (typeof window !== 'undefined' ? window.appState : null);
      const R = this.renderer || (typeof window !== 'undefined' ? window.canvasRenderer : null);
      if (!S || !R || !S.imgBitmap || !R.cUi) return;

      const vw = R.cUi.width;
      const vh = R.cUi.height;
      const iw = S.imgBitmap.width;
      const ih = S.imgBitmap.height;

      S.scale = 1.0;
      S.panX = (vw - iw) / 2;
      S.panY = (vh - ih) / 2;

      R.renderAll();
      this.updateDisplay();
    }

    updateDisplay() {
      const S = this.store || (typeof window !== 'undefined' ? window.appState : null);
      if (!S || !this.zoomText) return;
      this.zoomText.textContent = `${Math.round(S.scale * 100)}%`;
    }
  }

  return ZoomControlsComponent;
}));
