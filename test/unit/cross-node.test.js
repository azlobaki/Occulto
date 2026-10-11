const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./helpers');
const run = loadScripts(['validators.js', 'crypto.js', 'scrambler.js', 'replacer.js', 'fragments.js', 'pipeline.js']);
const EMAIL = { pattern: '[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}', flags: 'gi' };
const PHONE = { pattern: '(?<![\\d+])0[1-9](?:[\\s.-]?\\d{2}){4}(?!\\d)', flags: 'g' };
const cross = (segments) =>
  JSON.parse(
    run(`JSON.stringify(OccultoPipeline.crossSegmentMatches(${JSON.stringify(segments)}, {
      censorRegexes: OccultoPipeline.compileRegexList(${JSON.stringify([EMAIL, PHONE])}),
      ignoreRegexes: [],
    }))`)
  );

test('a value split across inline elements is mapped onto each segment', () => {
  assert.deepEqual(cross(['Mail john@', 'acme', '.com now']), [
    [
      { segment: 0, start: 5, end: 10 },
      { segment: 1, start: 0, end: 4 },
      { segment: 2, start: 0, end: 4 },
    ],
  ]);
  assert.deepEqual(cross(['Call 06 12 ', '34 56', ' 78.']).length, 1);
});

test('values fully inside one segment are left to the per-node pass', () => {
  assert.deepEqual(cross(['a@b.io', ' and ', 'text']), []);
});
