'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Enums = require('../../core/web/static/js/constants/enums');
const EventBus = require('../../core/web/static/js/core/event_bus');
const Store = require('../../core/web/static/js/core/store');
const ViewportEngine = require('../../core/web/static/js/canvas/viewport_engine');
const HitTestEngine = require('../../core/web/static/js/canvas/hit_test_engine');
const InteractionFSM = require('../../core/web/static/js/canvas/interaction_fsm');
const ApiClient = require('../../core/web/static/js/services/api_client');

const { ToolType, InteractionState, FilterType, AppEvent } = Enums;

test('E2E Integration: Complete review, annotation, promote low-conf, and save lifecycle', async () => {
  // 1. Initialize decoupled systems
  const eventBus = new EventBus({ strict: true });
  const store = new Store({ eventBus });
  const viewport = new ViewportEngine();
  const fsm = new InteractionFSM({ strict: true });

  // Mock API client
  let lastSavedPayload = null;
  const apiClient = new ApiClient({
    fetchFn: async (url, options) => {
      if (url.includes('/api/summary')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            total: 50,
            confirmed_count: 10,
            classes: ['person', 'bicycle', 'car'],
            class_counts: { person: 30, bicycle: 15, car: 20 },
            filter_indices: {
              low_conf: [2, 5, 8],
              'class:car': [1, 2, 9]
            }
          })
        };
      }
      if (url.includes('/api/save/')) {
        lastSavedPayload = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: 'success', index: 2 })
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }
  });

  // 2. Fetch Summary & configure Store
  const summary = await apiClient.getSummary();
  store.total = summary.total;
  store.confirmedCount = summary.confirmed_count;
  store.classes = summary.classes;
  store.setFilterMap(summary.filter_indices, summary.class_counts);

  assert.equal(store.total, 50);
  assert.equal(store.classes.length, 3);

  // 3. Filter by low_conf
  store.applyActiveFilter('low_conf');
  assert.equal(store.activeFilter, 'low_conf');
  assert.deepEqual(store.filteredIndices, [2, 5, 8]);
  assert.equal(store.getFilterLabel(), 'มี Low-Conf');

  // 4. Load Item #2
  const itemData = {
    index: 2,
    stem: 'frame_0002',
    filename: 'frame_0002.jpg',
    width: 1280,
    height: 720,
    shapes: [
      { label: 'person', points: [[100, 100], [200, 300]] }
    ],
    raw_shapes: [
      { label: 'person', points: [[100, 100], [200, 300]], score: 0.85 },
      { label: 'car', points: [[400, 300], [700, 500]], score: 0.32 } // Candidate
    ],
    confirmed: false
  };

  store.setLoadedData(itemData);
  assert.equal(store.isDirty, false);
  assert.equal(store.currentData.shapes.length, 1);

  // 5. Hit test candidate and promote it
  const hitCandidate = HitTestEngine.findHitLowConf(
    450, 350,
    store.currentData.raw_shapes,
    store.currentData.shapes,
    store.confThreshold,
    sh => store.getShapeBounds(sh)
  );

  assert.ok(hitCandidate, 'Should find candidate car at (450, 350)');
  assert.equal(hitCandidate.shape.label, 'car');

  // Promote Candidate
  store.promoteLowConfShape(hitCandidate.shape);
  assert.equal(store.currentData.shapes.length, 2);
  assert.equal(store.isDirty, true);
  assert.equal(store.currentData.shapes[1].label, 'car');

  // 6. FSM Interaction: Select Tool -> Resize Shape
  store.setTool(ToolType.SELECT);
  assert.equal(fsm.currentState, InteractionState.IDLE);

  // Calculate 8 handles on promoted car shape
  const carShape = store.currentData.shapes[1];
  const b = store.getShapeBounds(carShape);
  const handles = HitTestEngine.calculateHandlePositions(b.minX, b.minY, b.maxX, b.maxY);
  assert.equal(handles.length, 8);

  // User grabs BOT_RIGHT handle (700, 500)
  const hitHandle = HitTestEngine.getHandleAt(700, 500, handles, 8);
  assert.ok(hitHandle);
  assert.equal(hitHandle.handleIdx, 4); // BOT_RIGHT

  // FSM transitions to RESIZING_SHAPE
  fsm.transition(InteractionState.RESIZING_SHAPE, {
    handleIdx: hitHandle.handleIdx,
    anchor: { x1: b.minX, y1: b.minY, x2: b.maxX, y2: b.maxY }
  });
  assert.equal(fsm.currentState, InteractionState.RESIZING_SHAPE);

  // Move handle to (750, 550)
  carShape.points = [[b.minX, b.minY], [750, 550]];

  // User releases pointer -> FSM reset to IDLE
  fsm.reset();
  assert.equal(fsm.currentState, InteractionState.IDLE);

  // 7. Save and Confirm
  const savePayload = {
    shapes: store.currentData.shapes,
    confirmed: true,
    stem: store.currentData.stem,
    filename: store.currentData.filename,
    raw_shapes: store.currentData.raw_shapes
  };

  const saveRes = await apiClient.saveItem(store.currentIndex, savePayload);
  assert.equal(saveRes.status, 'success');
  assert.equal(lastSavedPayload.confirmed, true);
  assert.equal(lastSavedPayload.shapes.length, 2);
  assert.deepEqual(lastSavedPayload.shapes[1].points, [[400, 300], [750, 550]]);

  // Mark clean in store
  store.markClean(true);
  assert.equal(store.isDirty, false);
  assert.equal(store.hasChanged(), false);
  assert.equal(store.currentData.confirmed, true);
});
