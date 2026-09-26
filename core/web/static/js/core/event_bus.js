/**
 * Typed EventBus สำหรับ YOLO BBox Reviewer
 * ทำหน้าที่เป็นศูนย์กลางการสื่อสารแบบ Decoupled Pub/Sub ระหว่างคอมโพเนนต์
 * ป้องกัน Memory Leak และมี Error Boundary ไม่ให้ Listener ที่ผิดพลาดทำลายระบบ
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['../constants/enums'], factory);
  } else if (typeof module === 'object' && module.exports) {
    const enums = require('../constants/enums');
    module.exports = factory(enums);
  } else {
    root.EventBus = factory(root.Enums);
  }
}(typeof self !== 'undefined' ? self : this, function (Enums) {
  'use strict';

  class EventBus {
    constructor(options = {}) {
      this._listeners = new Map();
      this._strict = options.strict !== undefined ? options.strict : false;
      this._enums = Enums || (typeof window !== 'undefined' ? window.Enums : null);
    }

    /**
     * ลงทะเบียนผู้ฟังเหตุการณ์ (Subscribe)
     * @param {string} eventName - ชื่ออีเวนต์จาก AppEvent Enum
     * @param {Function} handler - Callback function
     * @returns {Function} ฟังก์ชันสำหรับ Unsubscribe อัตโนมัติ
     */
    on(eventName, handler) {
      if (typeof handler !== 'function') {
        throw new TypeError(`EventBus.on: handler must be a function, got ${typeof handler}`);
      }

      this._validateEvent(eventName);

      if (!this._listeners.has(eventName)) {
        this._listeners.set(eventName, new Set());
      }
      this._listeners.get(eventName).add(handler);

      // คืน Unsubscribe closure เพื่อความสะดวกในการ Clean up
      return () => this.off(eventName, handler);
    }

    /**
     * ลงทะเบียนรับฟังเหตุการณ์เพียงครั้งเดียว (Subscribe Once)
     */
    once(eventName, handler) {
      if (typeof handler !== 'function') {
        throw new TypeError(`EventBus.once: handler must be a function, got ${typeof handler}`);
      }

      const wrapper = (...args) => {
        this.off(eventName, wrapper);
        handler(...args);
      };
      wrapper._originalHandler = handler;
      return this.on(eventName, wrapper);
    }

    /**
     * ยกเลิกการรับฟังเหตุการณ์ (Unsubscribe)
     */
    off(eventName, handler) {
      if (!this._listeners.has(eventName)) return;

      const set = this._listeners.get(eventName);
      if (!handler) {
        this._listeners.delete(eventName);
        return;
      }

      for (const fn of set) {
        if (fn === handler || fn._originalHandler === handler) {
          set.delete(fn);
          break;
        }
      }

      if (set.size === 0) {
        this._listeners.delete(eventName);
      }
    }

    /**
     * ส่งกระจายเหตุการณ์ไปยังผู้รับฟังทั้งหมด (Publish / Emit)
     * มี Error Boundary เพื่อป้องกันไม่ให้ Listener ตัวใดตัวหนึ่งแครชแล้วทำให้ตัวอื่นหยุดทำงาน
     */
    emit(eventName, payload) {
      this._validateEvent(eventName);

      if (!this._listeners.has(eventName)) return;

      const set = this._listeners.get(eventName);
      // ทำสำเนาเพื่อความปลอดภัยหากมีการ unsubscribe ระหว่างที่วน loop
      const callbacks = Array.from(set);

      for (const fn of callbacks) {
        try {
          fn(payload, eventName);
        } catch (err) {
          console.error(`[EventBus Error] Exception in listener for event "${eventName}":`, err);
        }
      }
    }

    /**
     * คืนค่าจำนวนผู้รับฟังของอีเวนต์
     */
    listenerCount(eventName) {
      if (!eventName) {
        let total = 0;
        for (const set of this._listeners.values()) total += set.size;
        return total;
      }
      return this._listeners.has(eventName) ? this._listeners.get(eventName).size : 0;
    }

    /**
     * ล้าง Listener ทั้งหมด
     */
    clear(eventName) {
      if (eventName) {
        this._listeners.delete(eventName);
      } else {
        this._listeners.clear();
      }
    }

    _validateEvent(eventName) {
      if (!eventName || typeof eventName !== 'string') {
        throw new TypeError(`EventBus: eventName must be a non-empty string, got ${eventName}`);
      }

      if (this._strict && this._enums && this._enums.isValidAppEvent) {
        if (!this._enums.isValidAppEvent(eventName)) {
          throw new Error(`[EventBus] Invalid AppEvent "${eventName}". Must be one of AppEvent enum.`);
        }
      }
    }
  }

  return EventBus;
}));
