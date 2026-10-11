const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadScripts } = require('./helpers');
const tools = require('../../tools/i18n');
const fr = require('../../i18n/fr.json');
const ROOT = path.join(__dirname, '..', '..');
const run = loadScripts(['i18n.js']);

test('runtime and build compute the same message keys', () => {
  for (const s of ['Undo', 'Rule “{0}” deleted', 'Unicode: needed for \\p{…} classes and emoji (flag u)', '']) {
    assert.equal(run(`OccultoI18n.key(${JSON.stringify(s)})`), tools.key(s));
  }
});

test('every UI string has a French translation with the same placeholders', () => {
  const strings = tools.extract(ROOT, path.join(ROOT, 'dist'));
  assert.ok(strings.length > 200);
  const placeholders = (s) => (s.match(/\{\d\}/g) ?? []).sort().join();
  for (const s of strings) {
    assert.ok(s in fr, `missing FR: ${s}`);
    assert.equal(placeholders(fr[s]), placeholders(s), `placeholders differ: ${s}`);
  }
  for (const v of Object.values(tools.MANIFEST_STRINGS)) assert.ok(v in fr, `missing FR manifest string: ${v}`);
});

test('t() substitutes placeholders and falls back to English without the API', () => {
  assert.equal(run(`OccultoI18n.t('{0} of {1}', 3, 9)`), '3 of 9');
});
