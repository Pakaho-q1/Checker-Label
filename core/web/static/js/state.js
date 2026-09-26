/**
 * Single Source of Truth (SSOT) สำหรับ Frontend State
 * Refactored to delegate directly to production-grade Store & Enums
 */
(function (root) {
  'use strict';

  const Enums = root.Enums || (typeof require !== 'undefined' ? require('./constants/enums') : null);
  const EventBus = root.EventBus || (typeof require !== 'undefined' ? require('./core/event_bus') : null);
  const Store = root.Store || (typeof require !== 'undefined' ? require('./core/store') : null);

  if (typeof module === 'object' && module.exports) {
    module.exports = Store;
  } else {
    root.StateManager = Store;
    // สร้าง Instance กลางตัวเดียว (SSOT Singleton)
    if (!root.appState) {
      root.appState = new Store({
        eventBus: root.globalEventBus || (EventBus ? new EventBus() : null)
      });
    }
  }
}(typeof self !== 'undefined' ? self : this));
