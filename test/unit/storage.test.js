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

test('loadAll applies defaults and creates a key', async () => {
  const { chrome, run } = setup();
  const data = await run('OccultoStorage.loadAll()');
  assert.equal(data.enabled, true);
  assert.equal(data.mode, 'blur');
  assert.deepEqual(JSON.parse(JSON.stringify(data.replaceRules)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(data.config)), DEFAULT_CONFIG);
  assert.match(data.scrambleKey, /^[0-9a-f]{64}$/);
  assert.equal(chrome.storage.local.data.scrambleKey, data.scrambleKey);
  assert.deepEqual(JSON.parse(JSON.stringify(data.scrambleSettings)), { rotateKeyOnStartup: false, alwaysScrambleIPv4: false, alwaysScrambleIPv6: false });
});

test('key persists across loads; reset changes it', async () => {
  const { run } = setup();
  const a = (await run('OccultoStorage.loadAll()')).scrambleKey;
  const b = (await run('OccultoStorage.loadAll()')).scrambleKey;
  assert.equal(a, b);
  const c = await run('OccultoStorage.resetScrambleKey()');
  assert.notEqual(a, c);
});

test('migrates sync -> local once and clears sync', async () => {
  const { chrome, run } = setup({ mode: 'scramble' }, { enabled: false, mode: 'blur', config: { version: '9', selectors: [], regex: [] } });
  await run('OccultoStorage.migrateFromSync()');
  assert.equal(chrome.storage.local.data.enabled, false);
  assert.equal(chrome.storage.local.data.mode, 'scramble'); // local value wins
  assert.equal(chrome.storage.local.data.config.version, '9');
  assert.equal(chrome.storage.local.data.migratedFromSync, true);
  assert.deepEqual(Object.keys(chrome.storage.sync.data), []);
});

test('normalizers', () => {
  const { run } = setup();
  assert.equal(run('OccultoStorage.normalizeReplaceRule(42)'), null);
  assert.equal(run('OccultoStorage.normalizeReplaceRule({ replace: "x" })'), null);
  const r = run('OccultoStorage.normalizeReplaceRule({ find: "a", wholeWord: true, enabled: "yes" })');
  assert.equal(r.find, 'a');
  assert.equal(r.replace, '');
  assert.equal(r.wholeWord, true);
  assert.equal(r.enabled, true);
  assert.equal(typeof r.id, 'string');
  const s = run('OccultoStorage.normalizeScrambleSettings({ alwaysScrambleIPv4: true, rotateKeyOnStartup: "no" })');
  assert.equal(s.alwaysScrambleIPv4, true);
  assert.equal(s.rotateKeyOnStartup, false);
});

test('pausedSites: normalized, defaults to [] and survives loadAll', async () => {
  const { run } = setup({ pausedSites: ['Example.COM', 'example.com', 42, ' news.site '] });
  const data = await run('OccultoStorage.loadAll()');
  assert.deepEqual(JSON.parse(JSON.stringify(data.pausedSites)), ['example.com', 'news.site']);
  const empty = await setup().run('OccultoStorage.loadAll()');
  assert.deepEqual(JSON.parse(JSON.stringify(empty.pausedSites)), []);
});

test('siteKey extracts hostnames from http(s) URLs only', () => {
  const { run } = setup();
  assert.equal(run('OccultoStorage.siteKey("https://Mail.Example.com:8443/inbox?x=1")'), 'mail.example.com');
  assert.equal(run('OccultoStorage.siteKey("http://localhost:3000/")'), 'localhost');
  assert.equal(run('OccultoStorage.siteKey("chrome://extensions")'), null);
  assert.equal(run('OccultoStorage.siteKey("about:blank")'), null);
  assert.equal(run('OccultoStorage.siteKey("not a url")'), null);
});

test('hideStyle defaults to blur and only accepts blur|bar', async () => {
  assert.equal((await setup().run('OccultoStorage.loadAll()')).hideStyle, 'blur');
  assert.equal((await setup({ hideStyle: 'bar' }).run('OccultoStorage.loadAll()')).hideStyle, 'bar');
  assert.equal((await setup({ hideStyle: 'pixel' }).run('OccultoStorage.loadAll()')).hideStyle, 'blur');
});

test('profiles: save current, switch (auto-saves the active one), normalize', async () => {
  const { chrome, run } = setup({
    replaceRules: [{ id: 'a', find: 'Acme', replace: 'Contoso', caseSensitive: false, wholeWord: true, isRegex: false, enabled: true }],
    mode: 'scramble',
  });
  await run('OccultoStorage.loadAll()');
  const p1 = await run('OccultoStorage.saveCurrentAsProfile("Client A")');
  assert.equal(chrome.storage.local.data.activeProfileId, p1);
  // Edit live settings, then create a second profile from them.
  await chrome.storage.local.set({ mode: 'blur', replaceRules: [] });
  const p2 = await run('OccultoStorage.saveCurrentAsProfile("Client B")');
  await chrome.storage.local.set({ hideStyle: 'bar' }); // unsaved edit while B is active
  await run(`OccultoStorage.switchProfile(${JSON.stringify(p1)})`);
  const d = chrome.storage.local.data;
  assert.equal(d.activeProfileId, p1);
  assert.equal(d.mode, 'scramble');
  assert.equal(d.replaceRules[0].find, 'Acme');
  // B kept the edit made while it was active.
  assert.equal(d.profiles.find((p) => p.id === p2).data.hideStyle, 'bar');
  // Snapshots are complete even for settings never written (defaults).
  assert.equal(d.profiles.find((p) => p.id === p2).data.mode, 'blur');
  assert.equal(d.profiles.find((p) => p.id === p1).data.hideStyle, 'blur');
  const loaded = await run('OccultoStorage.loadAll()');
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.profiles.map((p) => p.name))), ['Client A', 'Client B']);
  assert.equal(loaded.activeProfileId, p1);
});

test('profiles normalize drops malformed entries', async () => {
  const { run } = setup({ profiles: [{ id: 'x', name: 'Ok', data: {} }, { name: 'no id' }, 7], activeProfileId: 'gone' });
  const d = await run('OccultoStorage.loadAll()');
  assert.equal(d.profiles.length, 1);
  assert.equal(d.activeProfileId, null);
});
