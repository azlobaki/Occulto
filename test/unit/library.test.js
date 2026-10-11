const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./helpers');
const run = loadScripts(['validators.js', 'storage.js', 'library.js']);
const presets = JSON.parse(run('JSON.stringify(OCCULTO_PRESETS)'));
const config = require('../../config.json');

// First match in `text` that also passes the preset's validator.
function firstMatch(p, text) {
  const re = new RegExp(p.pattern, p.flags.includes('g') ? p.flags : p.flags + 'g');
  for (const m of text.matchAll(re)) {
    if (!p.validator || run(`OccultoValidators.check('${p.validator}', ${JSON.stringify(m[0])})`)) return m[0];
  }
  return null;
}

test('every preset matches its sample and rejects its negatives', () => {
  assert.ok(presets.length >= 25);
  for (const p of presets) {
    assert.equal(firstMatch(p, p.sample), p.expect ?? p.sample, `${p.id} sample`);
    for (const neg of p.negatives ?? []) assert.equal(firstMatch(p, neg), null, `${p.id} negative ${neg}`);
  }
});

test('preset ids are unique', () => {
  assert.equal(new Set(presets.map((p) => p.id)).size, presets.length);
});

test('default config entries are the email/ipv4/ipv6 presets', () => {
  for (const id of ['email', 'ipv4', 'ipv6']) {
    const preset = presets.find((p) => p.id === id);
    const entry = config.regex.find((r) => r.preset === id);
    assert.ok(entry, `config has preset ${id}`);
    assert.equal(entry.pattern, preset.pattern, id);
  }
});

test('enable / disable / isEnabled (also recognises untagged copies)', () => {
  const r = JSON.parse(
    run(`(() => {
      const card = OCCULTO_PRESETS.find((p) => p.id === 'card');
      const email = OCCULTO_PRESETS.find((p) => p.id === 'email');
      const base = { version: '1', selectors: [], regex: [{ pattern: email.pattern, flags: 'gi' }] };
      const on = OccultoLibrary.enable(base, card);
      const twice = OccultoLibrary.enable(on, card);
      return JSON.stringify({
        emailOn: OccultoLibrary.isEnabled(base, email),
        added: on.regex[1],
        twiceLen: twice.regex.length,
        offLen: OccultoLibrary.disable(on, card).regex.length,
        emailOffLen: OccultoLibrary.disable(on, email).regex.length,
      });
    })()`)
  );
  assert.equal(r.emailOn, true);
  assert.equal(r.added.preset, 'card');
  assert.equal(r.added.validator, 'luhn');
  assert.equal(r.twiceLen, 2);
  assert.equal(r.offLen, 1);
  assert.equal(r.emailOffLen, 1);
});

test('every preset belongs to a listed category', () => {
  const categories = JSON.parse(run('JSON.stringify(OccultoLibrary.categories)'));
  for (const p of presets) assert.ok(categories.includes(p.category), p.id);
});

test('findLeaks reports matches of presets that are not enabled (validated, not noisy)', () => {
  const leaks = JSON.parse(
    run(`(() => {
      const email = OCCULTO_PRESETS.find((p) => p.id === 'email');
      const config = { version: '1', selectors: [], regex: [OccultoLibrary.toPattern(email)] };
      const text = 'Mail a@b.io, call 06 12 34 56 78, card 4111 1111 1111 1112, host api.acme.com, iban FR76 3000 6000 0112 3456 7890 189';
      return JSON.stringify(OccultoLibrary.findLeaks(text, config).map((l) => [l.presetId, text.slice(l.start, l.end)]));
    })()`)
  );
  assert.deepEqual(leaks, [
    ['phone-fr', '06 12 34 56 78'],
    ['iban', 'FR76 3000 6000 0112 3456 7890 189'],
  ]);
});
