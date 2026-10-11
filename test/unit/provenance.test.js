const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./helpers');
const run = loadScripts(['validators.js', 'crypto.js', 'scrambler.js', 'replacer.js', 'fragments.js', 'pipeline.js']);
const KEY = 'cd'.repeat(32);

test('buildFragments keeps censor sources and rule ids', () => {
  const out = JSON.parse(
    run(`JSON.stringify(buildFragments('ab Acme cd', [{ start: 0, end: 2, source: 1 }, { start: 1, end: 2, source: 0 }],
      [{ start: 3, end: 7, replacement: 'X', ruleId: 'r1' }]))`)
  );
  assert.deepEqual(out[0], { text: 'ab', kind: 'censored', sources: [0, 1] });
  assert.equal(out[2].ruleId, 'r1');
});

test('compileRegexEntries maps compiled regexes to config indexes, skipping invalid ones', () => {
  const r = run(`JSON.stringify(OccultoPipeline.compileRegexEntries([{ pattern: '(' }, { pattern: 'a', flags: 'i' }]).map(e => [e.index, e.regex.flags]))`);
  assert.deepEqual(JSON.parse(r), [[1, 'gi']]);
});

test('processText reports patterns, rule ids and forced IP scrambles', () => {
  const frags = JSON.parse(
    run(`(() => {
      const replacer = new Replacer();
      replacer.setRules([{ id: 'r1', find: 'Acme', replace: 'Contoso', caseSensitive: false, wholeWord: false, isRegex: false, enabled: true }]);
      const ctx = {
        censorRegexes: OccultoPipeline.compileRegexList([{ pattern: '[a-z]+@[a-z]+\\\\.io' }, { pattern: '\\\\d+\\\\.\\\\d+\\\\.\\\\d+\\\\.\\\\d+' }]),
        ignoreRegexes: [],
        mode: 'blur',
        scrambleSettings: { rotateKeyOnStartup: false, alwaysScrambleIPv4: true, alwaysScrambleIPv6: false },
        replacer,
        scrambler: new Scrambler('${KEY}'),
      };
      return JSON.stringify(OccultoPipeline.processText('Acme a@b.io 10.0.0.1', ctx));
    })()`)
  );
  const byKind = Object.fromEntries(frags.filter((f) => f.kind !== 'plain').map((f) => [f.kind, f]));
  assert.equal(byKind.replaced.ruleId, 'r1');
  assert.deepEqual(byKind.blurred.patterns, [0]);
  assert.deepEqual(byKind.scrambled.patterns, [1]);
  assert.equal(byKind.scrambled.forced, true);
});

test('default config names its patterns', () => {
  const cfg = require('../../config.json');
  assert.deepEqual(cfg.regex.map((r) => r.name), ['Email', 'IPv4', 'IPv6']);
});
