'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Enums = require('../../core/web/static/js/constants/enums');
const Store = require('../../core/web/static/js/core/store');
const ApiClient = require('../../core/web/static/js/services/api_client');
const KeyboardShortcutManager = require('../../core/web/static/js/components/shortcuts');

// ==========================================
// 1. ApiClient Unit Tests
// ==========================================
test('ApiClient: getSummary sends GET with accept header', async () => {
  let capturedUrl = null;
  let capturedOptions = null;

  const mockFetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return {
      ok: true,
      status: 200,
      json: async () => ({ total: 100, confirmed: 45, classes: ['cat', 'dog'] })
    };
  };

  const client = new ApiClient({ fetchFn: mockFetch });
  const summary = await client.getSummary();

  assert.ok(capturedUrl.includes('/api/summary'));
  assert.equal(capturedOptions.headers.Accept, 'application/json');
  assert.equal(summary.total, 100);
});

test('ApiClient: saveItem sends JSON payload via POST', async () => {
  let capturedUrl = null;
  let capturedOptions = null;

  const mockFetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: 'saved', index: 5 })
    };
  };

  const client = new ApiClient({ fetchFn: mockFetch });
  const payload = {
    shapes: [{ label: 'person', points: [[0, 0], [10, 10]] }],
    confirmed: true,
    stem: 'test_img'
  };

  const res = await client.saveItem(5, payload);

  assert.ok(capturedUrl.includes('/api/save/5'));
  assert.equal(capturedOptions.method, 'POST');
  assert.equal(capturedOptions.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(capturedOptions.body), payload);
  assert.equal(res.status, 'saved');
});

test('ApiClient: error response throws descriptive Error', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 404,
    json: async () => ({ detail: 'Image not found' })
  });

  const client = new ApiClient({ fetchFn: mockFetch });

  await assert.rejects(
    async () => client.getItem(999),
    /Image not found/
  );
});

test('ApiClient: getFilterIndices passes confMin and confMax in URL query parameters', async () => {
  let capturedUrl = null;

  const mockFetch = async (url) => {
    capturedUrl = url;
    return {
      ok: true,
      status: 200,
      json: async () => [0, 4, 12]
    };
  };

  const client = new ApiClient({ fetchFn: mockFetch });
  const indices = await client.getFilterIndices({
    status: 'unverified',
    classes: ['hand'],
    confMin: 0.00,
    confMax: 0.60
  });

  assert.ok(capturedUrl.includes('status=unverified'));
  assert.ok(capturedUrl.includes('classes=hand'));
  assert.ok(capturedUrl.includes('conf_min=0'));
  assert.ok(capturedUrl.includes('conf_max=0.6'));
  assert.deepEqual(indices, [0, 4, 12]);
});

// ==========================================
// 2. KeyboardShortcutManager Unit Tests
// ==========================================
test('KeyboardShortcutManager: routes keyboard shortcuts to correct action callbacks', () => {
  const actionsTriggered = [];

  const manager = new KeyboardShortcutManager({
    onPrev: () => actionsTriggered.push('prev'),
    onNext: () => actionsTriggered.push('next'),
    onDelete: () => actionsTriggered.push('delete'),
    onUndo: () => actionsTriggered.push('undo'),
    onSetTool: (tool) => actionsTriggered.push(`tool_${tool}`)
  });

  // Emulate key events
  manager.handleKeyDown({ code: 'KeyA', preventDefault: () => {} });
  manager.handleKeyDown({ code: 'KeyD', preventDefault: () => {} });
  manager.handleKeyDown({ code: 'Delete', preventDefault: () => {} });
  manager.handleKeyDown({ ctrlKey: true, code: 'KeyZ', preventDefault: () => {} });
  manager.handleKeyDown({ code: 'Digit1' });
  manager.handleKeyDown({ code: 'Digit2' });
  manager.handleKeyDown({ code: 'Digit3' });

  assert.deepEqual(actionsTriggered, [
    'prev',
    'next',
    'delete',
    'undo',
    'tool_select',
    'tool_draw',
    'tool_pan'
  ]);
});

// ==========================================
// 3. TopbarComponent Unit Tests
// ==========================================
test('TopbarComponent: populateFilterOptions renders verified, unverified, and negative counts correctly', () => {
  const TopbarComponent = require('../../core/web/static/js/components/topbar');
  const store = new Store();

  let innerHTML = '';
  let selectedValue = '';
  const mockSelect = {
    set innerHTML(val) { innerHTML = val; },
    get innerHTML() { return innerHTML; },
    set value(v) { selectedValue = v; },
    get value() { return selectedValue; }
  };

  const topbar = new TopbarComponent(store);
  topbar.filterSelect = mockSelect;

  const mockSummary = {
    total: 15976,
    confirmed_count: 954,
    negative_count: 1973,
    low_conf_count: 50,
    classes: ['dog', 'cat'],
    class_counts: { dog: 100, cat: 200 }
  };

  topbar.populateFilterOptions(mockSummary, 'verified');

  assert.ok(innerHTML.includes('ภาพทั้งหมด (15976)'), 'Should contain total 15976');
  assert.ok(innerHTML.includes('ตรวจแล้ว (954)'), 'Should contain verified 954');
  assert.ok(innerHTML.includes('ไม่มีวัตถุ (1973)'), 'Should contain negative 1973');
  assert.ok(innerHTML.includes('ยังไม่ตรวจ (15022)'), 'Should contain unverified 15022');
  assert.ok(innerHTML.includes('มี Low-Conf (50)'), 'Should contain low_conf 50');
  assert.ok(innerHTML.includes('dog (100)'), 'Should contain class dog count 100');
  assert.ok(innerHTML.includes('cat (200)'), 'Should contain class cat count 200');
  assert.equal(selectedValue, 'verified');
});

test('TopbarComponent: unified filter summary label and dual slider highlight', () => {
  const TopbarComponent = require('../../core/web/static/js/components/topbar');
  const store = new Store();

  let filterChangePayload = null;
  const topbar = new TopbarComponent(store, {
    onFilterChange: (data) => { filterChangePayload = data; }
  });

  const mockLabel = { textContent: '' };
  const mockHighlight = { style: {} };
  const mockVal = { textContent: '' };

  topbar.filterSummaryLabel = mockLabel;
  topbar.confSliderHighlight = mockHighlight;
  topbar.confVal = mockVal;

  // 1. Initial status label
  topbar.activeStatus = 'all';
  topbar.updateFilterSummaryLabel();
  assert.equal(mockLabel.textContent, 'Filter');

  // 2. Select 1 class
  topbar.selectedClasses.add('HAND');
  topbar.updateFilterSummaryLabel();
  assert.equal(mockLabel.textContent, 'Filter: HAND');

  // 3. Select 2 classes
  topbar.selectedClasses.add('FACE');
  topbar.updateFilterSummaryLabel();
  assert.equal(mockLabel.textContent, 'Filter (2)');

  // 4. Combined with unverified status
  topbar.activeStatus = 'unverified';
  topbar.updateFilterSummaryLabel();
  assert.equal(mockLabel.textContent, 'Filter (3)');

  // 5. Trigger filter change
  topbar.triggerFilterChange();
  assert.deepEqual(filterChangePayload, {
    status: 'unverified',
    classes: ['HAND', 'FACE']
  });

  // 6. Dual slider highlight display
  topbar.updateConfRangeDisplay(0.10, 0.60);
  assert.equal(mockVal.textContent, '0.10 - 0.60');
  assert.equal(mockHighlight.style.left, '10%');
  assert.equal(mockHighlight.style.width, '50%');
});

test('TopbarComponent: multi-status checkboxes and mutual exclusivity logic', () => {
  const TopbarComponent = require('../../core/web/static/js/components/topbar');
  const store = new Store();

  let filterPayload = null;
  const topbar = new TopbarComponent(store, {
    onFilterChange: (data) => { filterPayload = data; }
  });

  const mockLabel = { textContent: '' };
  topbar.filterSummaryLabel = mockLabel;

  // Mock DOM elements
  const mockChkAll = { checked: true };
  const mockItemUnverified = { value: 'unverified', checked: false };
  const mockItemNegative = { value: 'negative', checked: false };
  const mockItemVerified = { value: 'verified', checked: false };
  const items = [mockItemUnverified, mockItemNegative, mockItemVerified];

  topbar.chkStatusAll = mockChkAll;
  global.document = {
    getElementById: (id) => {
      if (id === 'chk-status-all') return mockChkAll;
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel === '.chk-status-item') return items;
      return [];
    }
  };

  // 1. Initial sync as 'all'
  topbar.syncStatusCheckboxes('all');
  assert.equal(mockChkAll.checked, true);
  assert.equal(mockItemUnverified.checked, false);
  assert.equal(mockItemNegative.checked, false);
  assert.equal(topbar.selectedStatuses.size, 0);
  topbar.updateFilterSummaryLabel();
  assert.equal(mockLabel.textContent, 'Filter');

  // 2. Select unverified + negative
  topbar.syncStatusCheckboxes(['unverified', 'negative']);
  assert.equal(mockChkAll.checked, false);
  assert.equal(mockItemUnverified.checked, true);
  assert.equal(mockItemNegative.checked, true);
  assert.equal(mockItemVerified.checked, false);
  assert.equal(topbar.selectedStatuses.size, 2);
  assert.ok(topbar.selectedStatuses.has('unverified'));
  assert.ok(topbar.selectedStatuses.has('negative'));

  // 3. Label updates to Filter (2)
  topbar.updateFilterSummaryLabel();
  assert.equal(mockLabel.textContent, 'Filter (2)');

  // 4. Trigger filter change passes both statuses
  topbar.triggerFilterChange();
  assert.deepEqual(filterPayload.status.sort(), ['negative', 'unverified'].sort());
  assert.deepEqual(filterPayload.classes, []);

  // 5. Checking All clears specific statuses and resets label to Filter
  topbar.syncStatusCheckboxes('all');
  assert.equal(mockChkAll.checked, true);
  assert.equal(mockItemUnverified.checked, false);
  assert.equal(mockItemNegative.checked, false);
  assert.equal(topbar.selectedStatuses.size, 0);
  topbar.updateFilterSummaryLabel();
  assert.equal(mockLabel.textContent, 'Filter');

  // Cleanup mock
  delete global.document;
});

