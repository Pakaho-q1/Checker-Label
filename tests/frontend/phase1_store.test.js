'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Enums = require('../../core/web/static/js/constants/enums');
const EventBus = require('../../core/web/static/js/core/event_bus');
const Store = require('../../core/web/static/js/core/store');

// ==========================================
// 1. Enums & Type Safety Tests
// ==========================================
test('Enums: all enums are frozen and immutable', () => {
  const { ToolType, InteractionState, InputMode, FilterType, SortOrder, AppEvent, ResizeHandle } = Enums;

  assert.ok(Object.isFrozen(ToolType));
  assert.ok(Object.isFrozen(InteractionState));
  assert.ok(Object.isFrozen(InputMode));
  assert.ok(Object.isFrozen(FilterType));
  assert.ok(Object.isFrozen(SortOrder));
  assert.ok(Object.isFrozen(AppEvent));
  assert.ok(Object.isFrozen(ResizeHandle));

  // Verify immutability: attempting to mutate throws or fails silently in non-strict
  assert.throws(() => {
    ToolType.CUSTOM = 'custom';
  }, TypeError);
});

test('Enums: validation helper functions correctly identify valid and invalid values', () => {
  const { isValidToolType, isValidInteractionState, isValidInputMode, isValidAppEvent, ToolType, InteractionState, InputMode, AppEvent } = Enums;

  assert.equal(isValidToolType(ToolType.SELECT), true);
  assert.equal(isValidToolType(ToolType.DRAW), true);
  assert.equal(isValidToolType('invalid_tool'), false);

  assert.equal(isValidInteractionState(InteractionState.IDLE), true);
  assert.equal(isValidInteractionState(InteractionState.PANNING), true);
  assert.equal(isValidInteractionState('RANDOM_STATE'), false);

  assert.equal(isValidInputMode(InputMode.MOUSE), true);
  assert.equal(isValidInputMode('gamepad'), false);

  assert.equal(isValidAppEvent(AppEvent.TOOL_CHANGED), true);
  assert.equal(isValidAppEvent('fake_event'), false);
});

// ==========================================
// 2. EventBus Unit Tests
// ==========================================
test('EventBus: subscribe, emit, and functional unsubscribe closure', () => {
  const bus = new EventBus();
  const received = [];

  const unsubscribe = bus.on('test_event', (payload) => {
    received.push(payload);
  });

  assert.equal(bus.listenerCount('test_event'), 1);

  bus.emit('test_event', { data: 123 });
  assert.equal(received.length, 1);
  assert.deepEqual(received[0], { data: 123 });

  // Unsubscribe using the returned closure
  unsubscribe();
  assert.equal(bus.listenerCount('test_event'), 0);

  bus.emit('test_event', { data: 456 });
  assert.equal(received.length, 1, 'Should not receive event after unsubscribe');
});

test('EventBus: once() executes handler exactly once', () => {
  const bus = new EventBus();
  let count = 0;

  bus.once('single_event', () => {
    count++;
  });

  bus.emit('single_event');
  bus.emit('single_event');
  bus.emit('single_event');

  assert.equal(count, 1);
  assert.equal(bus.listenerCount('single_event'), 0);
});

test('EventBus: error isolation guarantees one failing listener does not crash other listeners', () => {
  const bus = new EventBus();
  let secondRan = false;

  bus.on('error_test', () => {
    throw new Error('Explosion in listener 1');
  });

  bus.on('error_test', () => {
    secondRan = true;
  });

  // Emitting should not throw, second listener must execute
  assert.doesNotThrow(() => {
    bus.emit('error_test');
  });

  assert.equal(secondRan, true);
});

test('EventBus: strict mode validates AppEvent enum', () => {
  const bus = new EventBus({ strict: true });
  const { AppEvent } = Enums;

  assert.doesNotThrow(() => {
    bus.on(AppEvent.TOOL_CHANGED, () => {});
  });

  assert.throws(() => {
    bus.on('not_a_valid_app_event', () => {});
  }, /Invalid AppEvent/);
});

// ==========================================
// 3. Store Unit Tests (SSOT & Actions)
// ==========================================
test('Store: initial state and tool selection via ToolType Enum', () => {
  const store = new Store();
  const { ToolType } = Enums;

  assert.equal(store.activeTool, ToolType.SELECT);

  let emittedTool = null;
  store.eventBus.on(Enums.AppEvent.TOOL_CHANGED, (tool) => {
    emittedTool = tool;
  });

  store.setTool(ToolType.DRAW);
  assert.equal(store.activeTool, ToolType.DRAW);
  assert.equal(emittedTool, ToolType.DRAW);

  // Reject invalid tool gracefully
  store.setTool('invalid_tool');
  assert.equal(store.activeTool, ToolType.SELECT);
});

test('Store: confidence threshold clamping and event emission', () => {
  const store = new Store();

  let emittedConf = null;
  store.eventBus.on(Enums.AppEvent.CONF_THRESHOLD_CHANGED, (val) => {
    emittedConf = val;
  });

  store.setConfThreshold(0.75);
  assert.equal(store.confThreshold, 0.75);
  assert.equal(emittedConf, 0.75);

  // Clamp over 1.0 -> 1.0
  store.setConfThreshold(1.5);
  assert.equal(store.confThreshold, 1.0);

  // Clamp below 0.05 -> 0.05
  store.setConfThreshold(0.01);
  assert.equal(store.confThreshold, 0.05);
});

test('Store: data loading, dirty tracking, and snapshot comparison', () => {
  const store = new Store();

  const mockData = {
    index: 0,
    filename: 'test_img.jpg',
    width: 640,
    height: 480,
    shapes: [
      { label: 'person', points: [[10, 10], [50, 50]] }
    ],
    confirmed: false
  };

  store.setLoadedData(mockData);
  assert.equal(store.isDirty, false);
  assert.equal(store.hasChanged(), false);
  assert.equal(store.currentData.shapes.length, 1);

  // Modifying shapes triggers dirty change
  let dirtyReported = null;
  store.eventBus.on(Enums.AppEvent.DIRTY_CHANGED, (isDirty) => {
    dirtyReported = isDirty;
  });

  const modifiedShapes = [
    { label: 'person', points: [[10, 10], [100, 100]] }
  ];
  store.updateShapes(modifiedShapes);

  assert.equal(store.isDirty, true);
  assert.equal(store.hasChanged(), true);
  assert.equal(dirtyReported, true);

  // markClean resets dirty tracking
  store.markClean(true);
  assert.equal(store.isDirty, false);
  assert.equal(store.hasChanged(), false);
  assert.equal(store.currentData.confirmed, true);
});

test('Store: undo history stack management and depth limit', () => {
  const store = new Store({ maxHistory: 3 });

  store.setLoadedData({ shapes: [] });

  store.updateShapes([{ label: 'box1', points: [[0, 0], [10, 10]] }]);
  store.updateShapes([{ label: 'box2', points: [[0, 0], [20, 20]] }]);
  store.updateShapes([{ label: 'box3', points: [[0, 0], [30, 30]] }]);
  store.updateShapes([{ label: 'box4', points: [[0, 0], [40, 40]] }]);

  // History stack should be capped at maxHistory = 3
  assert.equal(store.history.length, 3);

  // Undo restores previous
  const undoResult = store.undo();
  assert.equal(undoResult, true);
  assert.equal(store.currentData.shapes[0].label, 'box3');

  store.undo();
  assert.equal(store.currentData.shapes[0].label, 'box2');

  store.undo();
  assert.equal(store.currentData.shapes[0].label, 'box1');

  // No more history
  assert.equal(store.history.length, 0);
  assert.equal(store.undo(), false);
});

test('Store: promote low confidence candidate shapes', () => {
  const store = new Store();
  store.setLoadedData({
    shapes: [],
    raw_shapes: [
      { label: 'car', score: 0.35, points: [[5, 5], [25, 25]] }
    ]
  });

  assert.equal(store.currentData.shapes.length, 0);

  const rawCandidate = store.currentData.raw_shapes[0];
  store.promoteLowConfShape(rawCandidate);

  assert.equal(store.currentData.shapes.length, 1);
  assert.equal(store.currentData.shapes[0].label, 'car');
  assert.equal(store.selectedShapeIdx, 0);
  assert.equal(store.isDirty, true);

  // Undo promotion
  store.undo();
  assert.equal(store.currentData.shapes.length, 0);
});

test('Store: delete selected shape', () => {
  const store = new Store();
  store.setLoadedData({
    shapes: [
      { label: 'dog', points: [[0, 0], [10, 10]] },
      { label: 'cat', points: [[20, 20], [30, 30]] }
    ]
  });

  store.selectShape(0);
  assert.equal(store.selectedShapeIdx, 0);

  const deleted = store.deleteSelectedShape();
  assert.equal(deleted, true);
  assert.equal(store.currentData.shapes.length, 1);
  assert.equal(store.currentData.shapes[0].label, 'cat');
  assert.equal(store.selectedShapeIdx, -1);
  assert.equal(store.isDirty, true);
});

test('Store: getShapeBounds accurate 2-point and 4-point calculation', () => {
  const store = new Store();

  // 2-point bbox: [[x1, y1], [x2, y2]]
  const b2 = store.getShapeBounds({ points: [[10, 20], [50, 80]] });
  assert.equal(b2.minX, 10);
  assert.equal(b2.minY, 20);
  assert.equal(b2.maxX, 50);
  assert.equal(b2.maxY, 80);
  assert.equal(b2.w, 40);
  assert.equal(b2.h, 60);

  // 4-point polygon (arbitrary order)
  const b4 = store.getShapeBounds({ points: [[50, 80], [10, 80], [10, 20], [50, 20]] });
  assert.equal(b4.minX, 10);
  assert.equal(b4.minY, 20);
  assert.equal(b4.maxX, 50);
  assert.equal(b4.maxY, 80);
  assert.equal(b4.w, 40);
  assert.equal(b4.h, 60);

  // Empty shape safety
  const empty = store.getShapeBounds(null);
  assert.equal(empty.w, 0);
});

test('Store: setCombinedFilter supports confidence range and formats getFilterLabel', () => {
  const store = new Store();

  // 1. Single class with confidence range
  store.setCombinedFilter('all', ['hand'], [1, 3, 5], 0.00, 0.60);
  assert.equal(store.activeFilter, 'class:hand@0.00-0.60');
  assert.equal(store.filterConfMin, 0.00);
  assert.equal(store.filterConfMax, 0.60);
  assert.equal(store.getFilterLabel(), 'hand (0.00 - 0.60)');
  assert.deepEqual(store.filteredIndices, [1, 3, 5]);

  // 2. Status unverified + class hand + confidence range
  store.setCombinedFilter('unverified', ['hand'], [3], 0.05, 0.50);
  assert.equal(store.activeFilter, 'unverified:hand@0.05-0.50');
  assert.equal(store.getFilterLabel(), 'ยังไม่ตรวจ [hand] (0.05 - 0.50)');

  // 3. Multiple classes + confidence range
  store.setCombinedFilter('all', ['hand', 'face'], [1, 2], 0.10, 0.80);
  assert.equal(store.activeFilter, 'all:hand,face@0.10-0.80');
  assert.equal(store.getFilterLabel(), 'hand +1 (0.10 - 0.80)');

  // 4. Single class with confidence range and includeLowConf=false (passed only)
  store.setCombinedFilter('all', ['hand'], [1], 0.10, 0.80, false);
  assert.equal(store.activeFilter, 'class:hand@0.10-0.80:passed');
  assert.equal(store.getFilterLabel(), 'hand (0.10 - 0.80 ผ่าน)');
});

