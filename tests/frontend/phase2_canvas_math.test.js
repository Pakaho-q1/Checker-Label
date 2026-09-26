'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ViewportEngine = require('../../core/web/static/js/canvas/viewport_engine');
const HitTestEngine = require('../../core/web/static/js/canvas/hit_test_engine');

// ==========================================
// 1. ViewportEngine Unit Tests
// ==========================================
test('ViewportEngine: imgToCanvas and canvasToImg roundtrip precision', () => {
  const engine = new ViewportEngine();
  const panX = 150.5;
  const panY = -80.25;
  const scale = 2.45;

  const originalImgX = 320;
  const originalImgY = 240;

  const canvasPos = engine.imgToCanvas(originalImgX, originalImgY, panX, panY, scale);
  const roundtripImgPos = engine.canvasToImg(canvasPos.x, canvasPos.y, panX, panY, scale);

  assert.ok(Math.abs(roundtripImgPos.x - originalImgX) < 1e-9);
  assert.ok(Math.abs(roundtripImgPos.y - originalImgY) < 1e-9);
});

test('ViewportEngine: calculateFit correctly calculates aspect ratio and centering', () => {
  const engine = new ViewportEngine();

  // Case 1: 1920x1080 image in 800x600 viewport with 0 padding
  const fit1 = engine.calculateFit(1920, 1080, 800, 600, 0);
  assert.ok(fit1.scale > 0);
  // Width-limited fit
  assert.equal(Math.round(1920 * fit1.scale), 800);
  assert.ok(1080 * fit1.scale <= 600);
  // Perfectly centered Y
  assert.ok(Math.abs(fit1.panY - (600 - 1080 * fit1.scale) / 2) < 1e-6);

  // Case 2: Zero or negative dimensions returns safe default
  const fitZero = engine.calculateFit(0, 0, 800, 600);
  assert.equal(fitZero.scale, 1);
  assert.equal(fitZero.panX, 0);
});

test('ViewportEngine: calculateZoomAtPoint anchors zoom at cursor position', () => {
  const engine = new ViewportEngine();

  const anchorX = 400;
  const anchorY = 300;
  const currentPanX = 50;
  const currentPanY = 30;
  const currentScale = 1.0;

  // Zoom in by factor 1.5
  const zoomed = engine.calculateZoomAtPoint(1.5, anchorX, anchorY, currentPanX, currentPanY, currentScale);
  assert.equal(zoomed.scale, 1.5);

  // The point in image space under anchor before zoom
  const imgPosBefore = engine.canvasToImg(anchorX, anchorY, currentPanX, currentPanY, currentScale);

  // The same point projected to canvas after zoom MUST match anchorX, anchorY
  const canvasPosAfter = engine.imgToCanvas(imgPosBefore.x, imgPosBefore.y, zoomed.panX, zoomed.panY, zoomed.scale);
  assert.ok(Math.abs(canvasPosAfter.x - anchorX) < 1e-9);
  assert.ok(Math.abs(canvasPosAfter.y - anchorY) < 1e-9);
});

test('ViewportEngine: scale clamping enforces minScale and maxScale boundaries', () => {
  const engine = new ViewportEngine({ minScale: 0.05, maxScale: 30.0 });

  // Exceed maxScale
  const zoomMax = engine.calculateZoomAtPoint(100, 0, 0, 0, 0, 1.0);
  assert.equal(zoomMax.scale, 30.0);

  // Below minScale
  const zoomMin = engine.calculateZoomAtPoint(0.001, 0, 0, 0, 0, 1.0);
  assert.equal(zoomMin.scale, 0.05);
});

// ==========================================
// 2. HitTestEngine Unit Tests
// ==========================================
test('HitTestEngine: isPointInBox detects containment accurately', () => {
  assert.equal(HitTestEngine.isPointInBox(50, 50, 10, 10, 100, 100), true);
  assert.equal(HitTestEngine.isPointInBox(10, 10, 10, 10, 100, 100), true);
  assert.equal(HitTestEngine.isPointInBox(100, 100, 10, 10, 100, 100), true);

  assert.equal(HitTestEngine.isPointInBox(9, 50, 10, 10, 100, 100), false);
  assert.equal(HitTestEngine.isPointInBox(101, 50, 10, 10, 100, 100), false);
  assert.equal(HitTestEngine.isPointInBox(50, 9, 10, 10, 100, 100), false);
  assert.equal(HitTestEngine.isPointInBox(50, 101, 10, 10, 100, 100), false);
});

test('HitTestEngine: calculateHandlePositions generates exact 8 handles', () => {
  const handles = HitTestEngine.calculateHandlePositions(0, 0, 100, 200);

  assert.equal(handles.length, 8);
  assert.deepEqual(handles[0], { handleIdx: 0, x: 0, y: 0, cursor: 'nwse-resize' });
  assert.deepEqual(handles[1], { handleIdx: 1, x: 50, y: 0, cursor: 'ns-resize' });
  assert.deepEqual(handles[2], { handleIdx: 2, x: 100, y: 0, cursor: 'nesw-resize' });
  assert.deepEqual(handles[3], { handleIdx: 3, x: 100, y: 100, cursor: 'ew-resize' });
  assert.deepEqual(handles[4], { handleIdx: 4, x: 100, y: 200, cursor: 'nwse-resize' });
  assert.deepEqual(handles[5], { handleIdx: 5, x: 50, y: 200, cursor: 'ns-resize' });
  assert.deepEqual(handles[6], { handleIdx: 6, x: 0, y: 200, cursor: 'nesw-resize' });
  assert.deepEqual(handles[7], { handleIdx: 7, x: 0, y: 100, cursor: 'ew-resize' });
});

test('HitTestEngine: getHandleAt finds handles within radius', () => {
  const handles = HitTestEngine.calculateHandlePositions(100, 100, 300, 300);

  // Exact hit on TOP_LEFT (100, 100)
  const hitExact = HitTestEngine.getHandleAt(100, 100, handles, 8);
  assert.ok(hitExact);
  assert.equal(hitExact.handleIdx, 0);

  // Near hit (104, 104) dist ~ 5.65 <= 8
  const hitNear = HitTestEngine.getHandleAt(104, 104, handles, 8);
  assert.ok(hitNear);
  assert.equal(hitNear.handleIdx, 0);

  // Miss (115, 115) dist > 8
  const hitMiss = HitTestEngine.getHandleAt(115, 115, handles, 8);
  assert.equal(hitMiss, null);
});

test('HitTestEngine: findHitShape returns topmost intersecting shape', () => {
  const shapes = [
    { label: 'bottom_box', minX: 0, minY: 0, maxX: 100, maxY: 100 },
    { label: 'top_box', minX: 20, minY: 20, maxX: 80, maxY: 80 }
  ];

  // Point (50, 50) is inside both shapes -> should return top_box (index 1)
  const hitTop = HitTestEngine.findHitShape(50, 50, shapes, s => s);
  assert.ok(hitTop);
  assert.equal(hitTop.shape.label, 'top_box');
  assert.equal(hitTop.index, 1);

  // Point (10, 10) is only inside bottom_box -> should return bottom_box (index 0)
  const hitBottom = HitTestEngine.findHitShape(10, 10, shapes, s => s);
  assert.ok(hitBottom);
  assert.equal(hitBottom.shape.label, 'bottom_box');
  assert.equal(hitBottom.index, 0);

  // Point (150, 150) is outside both -> null
  const hitOutside = HitTestEngine.findHitShape(150, 150, shapes, s => s);
  assert.equal(hitOutside, null);
});

test('HitTestEngine: findHitLowConf respects confThreshold and ignores already promoted shapes', () => {
  const rawShapes = [
    { label: 'candidate_1', score: 0.35, points: [[0, 0], [50, 50]], minX: 0, minY: 0, maxX: 50, maxY: 50 },
    { label: 'candidate_2', score: 0.85, points: [[10, 10], [60, 60]], minX: 10, minY: 10, maxX: 60, maxY: 60 },
    { label: 'already_promoted', score: 0.25, points: [[20, 20], [70, 70]], minX: 20, minY: 20, maxX: 70, maxY: 70 }
  ];

  const primaryShapes = [
    { label: 'promoted', points: [[20, 20], [70, 70]] }
  ];

  // Threshold 0.50:
  // - candidate_2 (score 0.85) is excluded (> 0.50)
  // - already_promoted is excluded (in primaryShapes)
  // - candidate_1 (score 0.35) should be hit
  const hit = HitTestEngine.findHitLowConf(25, 25, rawShapes, primaryShapes, 0.50, s => s);
  assert.ok(hit);
  assert.equal(hit.shape.label, 'candidate_1');
  assert.equal(hit.index, 0);

  // Filter allowedClasses: only allow 'hand' -> candidate_1 is 'candidate_1' so it should be ignored
  const hitWrongClass = HitTestEngine.findHitLowConf(25, 25, rawShapes, primaryShapes, 0.50, s => s, 0.0, true, ['hand']);
  assert.equal(hitWrongClass, null);

  // Filter allowedClasses: allow 'candidate_1' -> should be hit
  const hitCorrectClass = HitTestEngine.findHitLowConf(25, 25, rawShapes, primaryShapes, 0.50, s => s, 0.0, true, ['candidate_1']);
  assert.ok(hitCorrectClass);
  assert.equal(hitCorrectClass.shape.label, 'candidate_1');

  // Filter confMin: min 0.40 -> candidate_1 (0.35) is below min, should be ignored
  const hitBelowMin = HitTestEngine.findHitLowConf(25, 25, rawShapes, primaryShapes, 0.50, s => s, 0.40, true);
  assert.equal(hitBelowMin, null);
});
