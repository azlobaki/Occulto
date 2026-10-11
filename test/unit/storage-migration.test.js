const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./helpers');

function fakeArea(initial = {}) {
  const data = { ...initial };
  return {
    data,
    async get(keys) {
      if (keys == null) return { ...data };
      const list = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of list) if (k in data) out[k] = data[k];
      return out;
    },
    async set(obj) { Object.assign(data, obj); },
    async remove(keys) { for (const k of [].concat(keys)) delete data[k]; },
  };
}
const DEFAULT_CONFIG = { version: '1', selectors: [], regex: [] };
function setup(local = {}, sync = {}) {
  const chrome = {
    storage: { local: fakeArea(local), sync: fakeArea(sync) },
    runtime: { getURL: (p) => `chrome-extension://x/${p}` },
  };
  const fetch = async () => ({ json: async () => DEFAULT_CONFIG });
  const run = loadScripts(['storage.js'], { chrome, fetch });
  return { chrome, run };
}

const OLD_IPV6 = "\\b(?:(?:[A-Fa-f0-9]{1,4}:){7}[A-Fa-f0-9]{1,4}|(?:[A-Fa-f0-9]{1,4}:){1,7}:|(?:[A-Fa-f0-9]{1,4}:){1,6}:[A-Fa-f0-9]{1,4}|(?:[A-Fa-f0-9]{1,4}:){1,5}(?::[A-Fa-f0-9]{1,4}){1,2}|(?:[A-Fa-f0-9]{1,4}:){1,4}(?::[A-Fa-f0-9]{1,4}){1,3}|(?:[A-Fa-f0-9]{1,4}:){1,3}(?::[A-Fa-f0-9]{1,4}){1,4}|(?:[A-Fa-f0-9]{1,4}:){1,2}(?::[A-Fa-f0-9]{1,4}){1,5}|[A-Fa-f0-9]{1,4}:(?:(?::[A-Fa-f0-9]{1,4}){1,6})|:(?:(?::[A-Fa-f0-9]{1,4}){1,7}|:)|(?:[A-Fa-f0-9]{1,4}:){6}(?:25[0-5]|2[0-4]\\d|1?\\d{1,2})(?:\\.(?:25[0-5]|2[0-4]\\d|1?\\d{1,2})){3})\\b";

test('loadAll migrates the old default IPv6 pattern in stored config', async () => {
  const stored = {
    version: '1',
    selectors: [],
    regex: [{ pattern: 'keep', flags: 'g' }, { pattern: OLD_IPV6, flags: 'gi' }],
  };
  const { chrome, run } = setup({ config: stored, migratedFromSync: true });
  const data = await run('OccultoStorage.loadAll()');
  const fixed = JSON.parse(JSON.stringify(data.config));
  assert.equal(fixed.regex[0].pattern, 'keep');
  assert.notEqual(fixed.regex[1].pattern, OLD_IPV6);
  assert.equal(fixed.regex[1].flags, 'gi');
  const shipped = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'config.json'), 'utf8'));
  assert.ok(shipped.regex.some((r) => r.pattern === fixed.regex[1].pattern), 'matches shipped config.json');
  assert.equal('fe80::1'.match(new RegExp(fixed.regex[1].pattern, 'gi'))[0], 'fe80::1');
  assert.equal(chrome.storage.local.data.config.regex[1].pattern, fixed.regex[1].pattern);
});

test('failed sync migration does not persist the default config', async () => {
  const { chrome, run } = setup();
  chrome.storage.sync.get = async () => { throw new Error('sync down'); };
  const origError = console.error;
  console.error = () => {};
  let data;
  try {
    data = await run('OccultoStorage.loadAll()');
  } finally {
    console.error = origError;
  }
  assert.deepEqual(JSON.parse(JSON.stringify(data.config)), DEFAULT_CONFIG);
  assert.equal('config' in chrome.storage.local.data, false);
  assert.equal('migratedFromSync' in chrome.storage.local.data, false);
});
