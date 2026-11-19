const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./helpers');

const run = loadScripts(['types.js', 'storage.js', 'rotation.js']);
const call = (expr, arg) => JSON.parse(run(`JSON.stringify(${expr}(${JSON.stringify(arg)}))`));
const tab = (id, index, active = false) => ({ id, index, active });

test('nextTabId moves to the following tab and wraps around', () => {
  assert.equal(call('OccultoRotation.nextTabId', [tab(10, 0, true), tab(11, 1), tab(12, 2)]), 11);
  assert.equal(call('OccultoRotation.nextTabId', [tab(10, 0), tab(11, 1), tab(12, 2, true)]), 10);
});

test('nextTabId follows tab order, not array order', () => {
  assert.equal(call('OccultoRotation.nextTabId', [tab(12, 2), tab(10, 0, true), tab(11, 1)]), 11);
});

test('nextTabId has nothing to do with fewer than two tabs', () => {
  assert.equal(call('OccultoRotation.nextTabId', []), null);
  assert.equal(call('OccultoRotation.nextTabId', [tab(10, 0, true)]), null);
});

test('nextTabId starts at the first tab when none is active', () => {
  assert.equal(call('OccultoRotation.nextTabId', [tab(10, 0), tab(11, 1)]), 10);
});

test('formatInterval is compact', () => {
  assert.equal(call('OccultoRotation.formatInterval', 45), '45 s');
  assert.equal(call('OccultoRotation.formatInterval', 60), '1 min');
  assert.equal(call('OccultoRotation.formatInterval', 90), '1 min 30 s');
  assert.equal(call('OccultoRotation.formatInterval', 7200), '2 h');
});

test('normalizeTabRotation defaults to off, one minute', () => {
  assert.deepEqual(call('OccultoStorage.normalizeTabRotation', null), { enabled: false, intervalSeconds: 60, windowId: null });
});

test('normalizeTabRotation clamps the interval and needs a window to be on', () => {
  assert.deepEqual(call('OccultoStorage.normalizeTabRotation', { enabled: true, intervalSeconds: 1 }), {
    enabled: false,
    intervalSeconds: 5,
    windowId: null,
  });
  assert.deepEqual(call('OccultoStorage.normalizeTabRotation', { enabled: true, intervalSeconds: 1e9, windowId: 7 }), {
    enabled: true,
    intervalSeconds: 86400,
    windowId: 7,
  });
  assert.equal(call('OccultoStorage.normalizeTabRotation', { intervalSeconds: 'abc' }).intervalSeconds, 60);
});
