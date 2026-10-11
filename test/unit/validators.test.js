const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./helpers');
const run = loadScripts(['validators.js']);
const v = (name, s) => run(`OccultoValidators.check(${JSON.stringify(name)}, ${JSON.stringify(s)})`);

test('luhn', () => {
  assert.equal(v('luhn', '4111 1111 1111 1111'), true);
  assert.equal(v('luhn', '4111-1111-1111-1112'), false);
  assert.equal(v('luhn', '732 829 320'), true); // SIREN
  assert.equal(v('luhn', '73282932000074'), true); // SIRET
  assert.equal(v('luhn', '12'), false);
});

test('iban mod 97', () => {
  assert.equal(v('iban', 'FR76 3000 6000 0112 3456 7890 189'), true);
  assert.equal(v('iban', 'DE89370400440532013000'), true);
  assert.equal(v('iban', 'FR76 3000 6000 0112 3456 7890 188'), false);
  assert.equal(v('iban', 'XX00'), false);
});

test('nir key (incl. Corsica 2A/2B)', () => {
  assert.equal(v('nir', '2 69 05 49 588 157 80'), true);
  assert.equal(v('nir', '2 69 05 49 588 157 81'), false);
  assert.equal(v('nir', '1690549588157'), true); // no key: format only
  const key = (13 - 0); void key;
  assert.equal(v('nir', '1 80 12 2A 123 456 ' + String(97 - (Number('1801219123456') % 97)).padStart(2, '0')), true);
});

test('unknown validator accepts', () => {
  assert.equal(v('nope', 'x'), true);
});

test('pipeline drops matches that fail their validator', () => {
  const p = loadScripts(['validators.js', 'crypto.js', 'scrambler.js', 'replacer.js', 'fragments.js', 'pipeline.js']);
  const ranges = JSON.parse(
    p(`JSON.stringify(OccultoPipeline.findCensorRanges('4111 1111 1111 1111 and 4111 1111 1111 1112',
      OccultoPipeline.compileRegexList([{ pattern: '\\\\b(?:\\\\d{4}[ -]?){3}\\\\d{1,4}\\\\b', flags: 'g', validator: 'luhn' }])))`)
  );
  assert.deepEqual(ranges.map((r) => [r.start, r.end]), [[0, 19]]);
});
