'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Enums = require('../../core/web/static/js/constants/enums');
const InteractionFSM = require('../../core/web/static/js/canvas/interaction_fsm');

const { InteractionState } = Enums;

// ==========================================
// 1. FSM State Transitions Unit Tests
// ==========================================
test('InteractionFSM: initial state is IDLE and context is empty', () => {
  const fsm = new InteractionFSM();
  assert.equal(fsm.currentState, InteractionState.IDLE);
  assert.equal(fsm.is(InteractionState.IDLE), true);
  assert.deepEqual(fsm.context, {});
});

test('InteractionFSM: allowed transitions from IDLE to all interaction states', () => {
  const fsm = new InteractionFSM();

  // IDLE -> PANNING -> IDLE
  assert.equal(fsm.canTransitionTo(InteractionState.PANNING), true);
  fsm.transition(InteractionState.PANNING, { panStart: { x: 10, y: 20 } });
  assert.equal(fsm.currentState, InteractionState.PANNING);
  assert.deepEqual(fsm.context.panStart, { x: 10, y: 20 });
  fsm.reset();
  assert.equal(fsm.currentState, InteractionState.IDLE);

  // IDLE -> DRAWING -> IDLE
  assert.equal(fsm.canTransitionTo(InteractionState.DRAWING), true);
  fsm.transition(InteractionState.DRAWING, { startPos: { x: 50, y: 50 } });
  assert.equal(fsm.currentState, InteractionState.DRAWING);
  fsm.reset();
  assert.equal(fsm.currentState, InteractionState.IDLE);

  // IDLE -> DRAGGING_SHAPE -> IDLE
  assert.equal(fsm.canTransitionTo(InteractionState.DRAGGING_SHAPE), true);
  fsm.transition(InteractionState.DRAGGING_SHAPE, { shapeIdx: 2 });
  assert.equal(fsm.currentState, InteractionState.DRAGGING_SHAPE);
  fsm.reset();

  // IDLE -> RESIZING_SHAPE -> IDLE
  assert.equal(fsm.canTransitionTo(InteractionState.RESIZING_SHAPE), true);
  fsm.transition(InteractionState.RESIZING_SHAPE, { handleIdx: 3 });
  assert.equal(fsm.currentState, InteractionState.RESIZING_SHAPE);
  fsm.reset();

  // IDLE -> PINCH_ZOOMING -> IDLE
  assert.equal(fsm.canTransitionTo(InteractionState.PINCH_ZOOMING), true);
  fsm.transition(InteractionState.PINCH_ZOOMING, { lastDist: 100 });
  assert.equal(fsm.currentState, InteractionState.PINCH_ZOOMING);
  fsm.reset();

  // IDLE -> POTENTIAL_TAP -> DRAWING (when dragged over 10px) -> IDLE
  assert.equal(fsm.canTransitionTo(InteractionState.POTENTIAL_TAP), true);
  fsm.transition(InteractionState.POTENTIAL_TAP, { startPos: { x: 5, y: 5 } });
  assert.equal(fsm.currentState, InteractionState.POTENTIAL_TAP);
  // Allowed to transition from POTENTIAL_TAP to DRAGGING_SHAPE
  assert.equal(fsm.canTransitionTo(InteractionState.DRAGGING_SHAPE), true);
  fsm.transition(InteractionState.DRAGGING_SHAPE, { shapeIdx: 1 });
  assert.equal(fsm.currentState, InteractionState.DRAGGING_SHAPE);
  fsm.reset();
  assert.equal(fsm.currentState, InteractionState.IDLE);
});

test('InteractionFSM: impossible concurrent transitions are strictly rejected', () => {
  const fsm = new InteractionFSM({ strict: true });

  // Start PANNING
  fsm.transition(InteractionState.PANNING);
  assert.equal(fsm.currentState, InteractionState.PANNING);

  // Attempt to DRAW while PANNING -> MUST THROW!
  assert.throws(() => {
    fsm.transition(InteractionState.DRAWING);
  }, /Invalid state transition/);

  // Attempt to RESIZE while PANNING -> MUST THROW!
  assert.throws(() => {
    fsm.transition(InteractionState.RESIZING_SHAPE);
  }, /Invalid state transition/);

  // Attempt to DRAG while PANNING -> MUST THROW!
  assert.throws(() => {
    fsm.transition(InteractionState.DRAGGING_SHAPE);
  }, /Invalid state transition/);

  fsm.reset();
  assert.equal(fsm.currentState, InteractionState.IDLE);
});

test('InteractionFSM: lifecycle hooks onEnter and onExit execute in exact sequence', () => {
  const fsm = new InteractionFSM();
  const history = [];

  fsm.onEnter(InteractionState.DRAWING, (ctx) => {
    history.push(`enter_drawing_${ctx.tool}`);
  });

  fsm.onExit(InteractionState.DRAWING, (ctx) => {
    history.push(`exit_drawing_${ctx.tool}`);
  });

  fsm.transition(InteractionState.DRAWING, { tool: 'bbox' });
  assert.deepEqual(history, ['enter_drawing_bbox']);

  fsm.reset();
  assert.deepEqual(history, ['enter_drawing_bbox', 'exit_drawing_bbox']);
});
