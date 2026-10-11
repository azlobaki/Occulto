const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./helpers');
const run = loadScripts(['validators.js', 'crypto.js', 'scrambler.js', 'replacer.js', 'fragments.js', 'pipeline.js']);

test('zero-length matches with the u flag terminate on astral characters', () => {
  const ranges = run(
    `OccultoPipeline.findCensorRanges('a😀b', OccultoPipeline.compileRegexList([{ pattern: 'x*', flags: 'gu' }]))`
  );
  assert.deepEqual(JSON.parse(JSON.stringify(ranges)), []);
});
