const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./helpers');
const run = loadScripts(['fragments.js']);
const frags = (text, censor, repl) => JSON.parse(run(`JSON.stringify(buildFragments(${JSON.stringify(text)}, ${JSON.stringify(censor)}, ${JSON.stringify(repl)}))`));
const R = (start, end, replacement) => ({ start, end, replacement, ruleId: 'r' });

test('nothing to do', () => {
  assert.deepEqual(frags('hello', [], []), [{ text: 'hello', kind: 'plain' }]);
  assert.deepEqual(frags('', [], []), [{ text: '', kind: 'plain' }]);
});
test('censor ranges merge when overlapping or touching', () => {
  assert.deepEqual(frags('abcdefgh', [{ start: 1, end: 3 }, { start: 2, end: 4 }, { start: 4, end: 5 }], []), [
    { text: 'a', kind: 'plain' }, { text: 'bcde', kind: 'censored' }, { text: 'fgh', kind: 'plain' },
  ]);
});
test('replace matches interleave with censored', () => {
  assert.deepEqual(frags('Acme mail x@y.io', [{ start: 10, end: 16 }], [R(0, 4, 'Contoso')]), [
    { text: 'Acme', kind: 'replaced', replacement: 'Contoso', ruleId: 'r' }, { text: ' mail ', kind: 'plain' }, { text: 'x@y.io', kind: 'censored' },
  ]);
});
test('censor wins over an intersecting replace match', () => {
  assert.deepEqual(frags('john@acme.com', [{ start: 0, end: 13 }], [R(5, 9, 'Contoso')]), [{ text: 'john@acme.com', kind: 'censored' }]);
});
