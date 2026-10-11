const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./helpers');
const FILES = ['crypto.js', 'scrambler.js', 'replacer.js', 'fragments.js', 'pipeline.js'];
const run = loadScripts(FILES);
const KEY = 'ab'.repeat(32);
const EMAIL = { pattern: '[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}', flags: 'gi' };
const IPV4 = { pattern: '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b', flags: 'i' }; // no 'g' on purpose
function processText(text, { mode = 'blur', settings = {}, rules = [], ignore = [] } = {}) {
  const ctx = `({
    censorRegexes: OccultoPipeline.compileRegexList(${JSON.stringify([EMAIL, IPV4])}),
    ignoreRegexes: OccultoPipeline.compileRegexList(${JSON.stringify(ignore)}),
    mode: '${mode}',
    scrambleSettings: Object.assign({ rotateKeyOnStartup: false, alwaysScrambleIPv4: false, alwaysScrambleIPv6: false }, ${JSON.stringify(settings)}),
    replacer: (() => { const r = new Replacer(); r.setRules(${JSON.stringify(rules)}); return r; })(),
    scrambler: new Scrambler('${KEY}'),
  })`;
  return JSON.parse(run(`JSON.stringify(OccultoPipeline.processText(${JSON.stringify(text)}, ${ctx}))`));
}
const kinds = (frags) => frags.map((f) => f.kind).join(',');

test('blur mode marks detections as blurred, display unchanged', () => {
  const f = processText('mail a@b.io from 10.0.0.1');
  assert.equal(kinds(f), 'plain,blurred,plain,blurred');
  assert.equal(f[1].display, 'a@b.io');
});
test('scramble mode scrambles detections with the key', () => {
  const f = processText('mail a@b.io', { mode: 'scramble' });
  assert.equal(kinds(f), 'plain,scrambled');
  assert.notEqual(f[1].display, 'a@b.io');
  assert.equal(f[1].original, 'a@b.io');
});
test('IPv4 override scrambles IPs in blur mode only for IPv4', () => {
  const f = processText('a@b.io 10.0.0.1', { settings: { alwaysScrambleIPv4: true } });
  assert.equal(kinds(f), 'blurred,plain,scrambled');
});
test('replace rules apply, and ignore only disables censoring', () => {
  const rules = [{ id: 'r', find: 'Acme', replace: 'Contoso', caseSensitive: false, wholeWord: true, isRegex: false, enabled: true }];
  const f = processText('Acme: a@b.io', { rules, ignore: [{ pattern: 'a@b\\.io', flags: 'i' }] });
  assert.equal(kinds(f), 'replaced,plain');
  assert.equal(f[0].display, 'Contoso');
});
test('compileRegexList forces global flag and skips invalid patterns', () => {
  const errors = [];
  const quiet = loadScripts(FILES, { console: { ...console, error: (...a) => errors.push(a) } });
  assert.equal(
    quiet(`OccultoPipeline.compileRegexList([{ pattern: 'a', flags: 'i' }, { pattern: '(' }]).map(r => r.flags).join('|')`),
    'gi'
  );
  assert.equal(errors.length, 1);
  assert.equal(errors[0][0], '[Occulto] Invalid regex pattern:');
});
test('findCensorRanges skips zero-length matches and terminates', () => {
  const r = JSON.parse(
    run(
      `JSON.stringify(OccultoPipeline.findCensorRanges('abab', OccultoPipeline.compileRegexList([{ pattern: 'x*' }, { pattern: 'ab' }])))`
    )
  );
  assert.deepEqual(r, [
    { start: 0, end: 2, source: 1 },
    { start: 2, end: 4, source: 1 },
  ]);
});
