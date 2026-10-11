const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./helpers');
const run = loadScripts(['replacer.js']);
const rule = (o) => JSON.stringify({ id: o.id || 'r', find: '', replace: '', caseSensitive: false, wholeWord: false, isRegex: false, enabled: true, ...o });
const apply = (rules, text) => run(`(() => { const r = new Replacer(); r.setRules([${rules.map(rule).join(',')}]); return r.apply(${JSON.stringify(text)}); })()`);

test('literal, case-insensitive by default', () => {
  assert.equal(apply([{ find: 'Acme', replace: 'Contoso' }], 'ACME acme Acme'), 'Contoso Contoso Contoso');
});
test('case sensitive', () => {
  assert.equal(apply([{ find: 'Acme', replace: 'X', caseSensitive: true }], 'ACME Acme'), 'ACME X');
});
test('whole word, Unicode aware', () => {
  assert.equal(apply([{ find: 'Acme', replace: 'X', wholeWord: true }], 'Acme Acmeville'), 'X Acmeville');
  assert.equal(apply([{ find: 'café', replace: 'X', wholeWord: true }], 'café cafés'), 'X cafés');
  assert.equal(apply([{ find: 'été', replace: 'X', wholeWord: true }], 'étés été'), 'étés X');
  assert.equal(apply([{ find: 'société', replace: 'X', wholeWord: true }], 'SOCIÉTÉ'), 'X');
});
test('literal special characters are escaped', () => {
  assert.equal(apply([{ find: 'a.b', replace: 'X' }], 'axb a.b'), 'axb X');
  assert.equal(apply([{ find: '$5 (USD)', replace: '€' }], 'cost $5 (USD)'), 'cost €');
  assert.equal(apply([{ find: 'x', replace: '$&$1' }], 'x'), '$&$1');
});
test('regex with groups', () => {
  assert.equal(apply([{ find: '(\\w+)@corp\\.com', replace: '$1@example.com', isRegex: true }], 'mail bob@corp.com'), 'mail bob@example.com');
  assert.equal(apply([{ find: '(?<u>\\w+)!', replace: '<$<u>> $& $$ $9', isRegex: true }], 'hi!'), '<hi> hi! $ $9');
});
test('unknown named group stays literal', () => {
  assert.equal(apply([{ find: 'a', replace: '$<nope>', isRegex: true }], 'a'), '$<nope>');
});
test('rule order: earlier rule wins on overlap', () => {
  assert.equal(apply([{ id: 'a', find: 'New York', replace: 'Paris' }, { id: 'b', find: 'York', replace: 'Lyon' }], 'New York and York'), 'Paris and Lyon');
});
test('disabled, empty, invalid and zero-length rules are ignored', () => {
  assert.equal(apply([{ find: 'a', replace: 'X', enabled: false }, { find: '', replace: 'Y' }, { find: '(', replace: 'Z', isRegex: true }, { find: '^', replace: 'W', isRegex: true }], 'abc'), 'abc');
  assert.equal(run(`Replacer.validate(${rule({ find: '(', isRegex: true })})`) !== null, true);
  assert.equal(run(`Replacer.validate(${rule({ find: '(', isRegex: false })})`), null);
});
test('replacement containing the search term does not loop', () => {
  assert.equal(apply([{ find: 'foo', replace: 'foobar' }], 'foo foo'), 'foobar foobar');
});
test('findMatches returns positions', () => {
  const m = run(`(() => { const r = new Replacer(); r.setRules([${rule({ id: 'q', find: 'cat', replace: 'dog' })}]); return JSON.stringify(r.findMatches('a cat')); })()`);
  assert.deepEqual(JSON.parse(m), [{ start: 2, end: 5, replacement: 'dog', ruleId: 'q' }]);
  assert.equal(run(`(() => { const r = new Replacer(); r.setRules([]); return r.hasActiveRules(); })()`), false);
});
