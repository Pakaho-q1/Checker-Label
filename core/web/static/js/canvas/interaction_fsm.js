/**
 * Interaction Finite State Machine (FSM)
 * ควบคุมสถานะการโต้ตอบของผู้ใช้งานบน Canvas ให้เป็นแบบ Mutually Exclusive
 * ป้องกัน Impossible States ไม่ให้ทำงานพร้อมกันโดยเด็ดขาด
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['../constants/enums'], factory);
  } else if (typeof module === 'object' && module.exports) {
    const enums = require('../constants/enums');
    module.exports = factory(enums);
  } else {
    root.InteractionFSM = factory(root.Enums);
  }
}(typeof self !== 'undefined' ? self : this, function (Enums) {
  'use strict';

  const { InteractionState, isValidInteractionState } = Enums;

  // กฎการเปลี่ยนผ่านสถานะที่ได้รับอนุญาต (Allowed Transition Table)
  const ALLOWED_TRANSITIONS = {
    [InteractionState.IDLE]: new Set([
      InteractionState.PANNING,
      InteractionState.DRAWING,
      InteractionState.DRAGGING_SHAPE,
      InteractionState.RESIZING_SHAPE,
      InteractionState.PINCH_ZOOMING,
      InteractionState.POTENTIAL_TAP
    ]),
    [InteractionState.PANNING]: new Set([InteractionState.IDLE, InteractionState.PINCH_ZOOMING]),
    [InteractionState.DRAWING]: new Set([InteractionState.IDLE, InteractionState.PINCH_ZOOMING]),
    [InteractionState.DRAGGING_SHAPE]: new Set([InteractionState.IDLE, InteractionState.PINCH_ZOOMING]),
    [InteractionState.RESIZING_SHAPE]: new Set([InteractionState.IDLE, InteractionState.PINCH_ZOOMING]),
    [InteractionState.PINCH_ZOOMING]: new Set([InteractionState.IDLE, InteractionState.PANNING]),
    [InteractionState.POTENTIAL_TAP]: new Set([
      InteractionState.IDLE,
      InteractionState.DRAGGING_SHAPE, // เมื่อเริ่มลากเกินเกณฑ์ Threshold จากการแตะ
      InteractionState.PINCH_ZOOMING
    ])
  };

  class InteractionFSM {
    constructor(options = {}) {
      this._state = InteractionState.IDLE;
      this._context = {};
      this._onEnterHooks = new Map();
      this._onExitHooks = new Map();
      this.strict = options.strict !== undefined ? options.strict : true;
    }

    get currentState() {
      return this._state;
    }

    get context() {
      return this._context;
    }

    is(state) {
      return this._state === state;
    }

    canTransitionTo(nextState) {
      if (!isValidInteractionState(nextState)) return false;
      const allowed = ALLOWED_TRANSITIONS[this._state];
      return allowed ? allowed.has(nextState) : false;
    }

    /**
     * เปลี่ยนผ่านสถานะ (State Transition)
     * @param {string} nextState - สถานะถัดไปจาก InteractionState Enum
     * @param {object} context - ข้อมูลบริบทที่เกี่ยวข้องกับสถานะนั้น
     * @returns {boolean} สำเร็จหรือไม่
     */
    transition(nextState, context = {}) {
      if (this._state === nextState) {
        // อัปเดตบริบทโดยไม่เปลี่ยนสถานะ
        this._context = { ...this._context, ...context };
        return true;
      }

      if (!this.canTransitionTo(nextState)) {
        const errorMsg = `[FSM] Invalid state transition from "${this._state}" to "${nextState}"`;
        if (this.strict) {
          throw new Error(errorMsg);
        } else {
          console.warn(errorMsg);
          return false;
        }
      }

      const prevState = this._state;
      const prevContext = this._context;

      // 1. เรียก Exit Hook ของสถานะเดิม
      this._runHooks(this._onExitHooks, prevState, prevContext);

      // 2. ปรับเปลี่ยนสถานะและบันทึก Context ใหม่
      this._state = nextState;
      this._context = nextState === InteractionState.IDLE ? {} : { ...context };

      // 3. เรียก Enter Hook ของสถานะใหม่
      this._runHooks(this._onEnterHooks, nextState, this._context);

      return true;
    }

    /**
     * บังคับรีเซ็ตกลับสู่สถานะ IDLE อย่างปลอดภัย
     */
    reset() {
      if (this._state !== InteractionState.IDLE) {
        this._runHooks(this._onExitHooks, this._state, this._context);
        this._state = InteractionState.IDLE;
        this._context = {};
        this._runHooks(this._onEnterHooks, InteractionState.IDLE, this._context);
      }
    }

    onEnter(state, hook) {
      if (!this._onEnterHooks.has(state)) {
        this._onEnterHooks.set(state, new Set());
      }
      this._onEnterHooks.get(state).add(hook);
      return () => this._onEnterHooks.get(state).delete(hook);
    }

    onExit(state, hook) {
      if (!this._onExitHooks.has(state)) {
        this._onExitHooks.set(state, new Set());
      }
      this._onExitHooks.get(state).add(hook);
      return () => this._onExitHooks.get(state).delete(hook);
    }

    _runHooks(hookMap, state, context) {
      if (!hookMap.has(state)) return;
      for (const hook of hookMap.get(state)) {
        try {
          hook(context, state);
        } catch (err) {
          console.error(`[FSM Hook Error] in state "${state}":`, err);
        }
      }
    }
  }

  return InteractionFSM;
}));
