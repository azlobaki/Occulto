const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./helpers');
const run = loadScripts(['validators.js', 'crypto.js', 'scrambler.js']);
const K1 = '11'.repeat(32);
const scr = (key, input) => run(`new Scrambler('${key}').scramble(${JSON.stringify(input)})`);

test('generic scramble: ASCII output is unchanged for a fixed key', () => {
  assert.equal(
    scr(K1, "Confidential Project Falcon, Room 42-B! Mr. O'Neil"),
    "Biblljsjbxbp Gvqayzs Qbjphv, Ssck 71-N! Gu. S'Ewza"
  );
});

test('generic scramble: non-ASCII letters and digits do not survive', () => {
  const input = 'Zoë Иван 山田 ٣';
  const a = Array.from(input);
  const b = Array.from(scr(K1, input));
  assert.equal(b.length, a.length);
  a.forEach((ch, i) => {
    if (/[\p{L}\p{N}]/u.test(ch)) {
      assert.notEqual(b[i], ch);
      if (/\p{Lu}/u.test(ch)) assert.match(b[i], /^[A-Z]$/);
      else if (/\p{L}/u.test(ch)) assert.match(b[i], /^[a-z]$/);
      else assert.match(b[i], /^[0-9]$/);
    } else {
      assert.equal(b[i], ch);
    }
  });
});
