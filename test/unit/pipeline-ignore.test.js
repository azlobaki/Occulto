const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./helpers');
const run = loadScripts(['validators.js', 'crypto.js', 'scrambler.js', 'replacer.js', 'fragments.js', 'pipeline.js']);
const EMAIL = { pattern: '[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}', flags: 'gi' };
const IGNORE = { pattern: 'support@mycompany\\.com', flags: 'i' };
const ctx = `({
  censorRegexes: OccultoPipeline.compileRegexList(${JSON.stringify([EMAIL])}),
  ignoreRegexes: OccultoPipeline.compileRegexList(${JSON.stringify([IGNORE])}),
  mode: 'blur',
  scrambleSettings: { rotateKeyOnStartup: false, alwaysScrambleIPv4: false, alwaysScrambleIPv6: false },
  replacer: new Replacer(),
  scrambler: new Scrambler('${'ef'.repeat(32)}'),
})`;
const process = (text) => JSON.parse(run(`JSON.stringify(OccultoPipeline.processText(${JSON.stringify(text)}, ${ctx}))`));

test('an ignore match only exempts its own range, not the whole text node', () => {
  const f = process('Mail support@mycompany.com or bob@client.com');
  assert.deepEqual(f.filter((x) => x.kind === 'blurred').map((x) => x.original), ['bob@client.com']);
});

test('isFullyIgnored is true only when ignore matches cover all visible text', () => {
  const full = (t) => run(`OccultoPipeline.isFullyIgnored(${JSON.stringify(t)}, OccultoPipeline.compileRegexList(${JSON.stringify([IGNORE])}))`);
  assert.equal(full('support@mycompany.com'), true);
  assert.equal(full('  support@mycompany.com \n'), true);
  assert.equal(full('support@mycompany.com and bob'), false);
  assert.equal(full('   '), false);
});

test('hasCensoredText ignores exempted ranges', () => {
  const has = (t) => run(`OccultoPipeline.hasCensoredText(${JSON.stringify(t)}, ${ctx})`);
  assert.equal(has('support@mycompany.com'), false);
  assert.equal(has('support@mycompany.com, x@y.io'), true);
});

test('toPlainText masks blurred fragments and keeps substitutes', () => {
  const out = run(`OccultoPipeline.toPlainText([
    { kind: 'plain', original: 'a ', display: 'a ' },
    { kind: 'blurred', original: 'secret', display: 'secret' },
    { kind: 'replaced', original: 'Acme', display: 'Contoso' },
  ])`);
  assert.equal(out, 'a ██████Contoso');
});
