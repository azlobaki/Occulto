const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadScripts } = require('./helpers');
const FILES = ['crypto.js', 'scrambler.js', 'replacer.js', 'fragments.js', 'pipeline.js'];
const run = loadScripts(FILES);
const KEY = 'cd'.repeat(32);
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config.json'), 'utf8'));

function processDefault(text, { mode = 'blur', settings = {} } = {}) {
  const ctx = `({
    censorRegexes: OccultoPipeline.compileRegexList(${JSON.stringify(config.regex)}),
    ignoreRegexes: [],
    mode: '${mode}',
    scrambleSettings: Object.assign({ rotateKeyOnStartup: false, alwaysScrambleIPv4: false, alwaysScrambleIPv6: false }, ${JSON.stringify(settings)}),
    replacer: new Replacer(),
    scrambler: new Scrambler('${KEY}'),
  })`;
  return JSON.parse(run(`JSON.stringify(OccultoPipeline.processText(${JSON.stringify(text)}, ${ctx}))`));
}

const IPV6 = ['fe80::1', '2001:db8::ff00:42:8329', '2001:0db8:85a3:0000:0000:8a2e:0370:7334', '::1'];

for (const addr of IPV6) {
  test(`default config censors ${addr} in full`, () => {
    const hits = processDefault(`addr ${addr} end`).filter((x) => x.kind !== 'plain');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].kind, 'blurred');
    assert.equal(hits[0].original, addr);
  });
  test(`alwaysScrambleIPv6 scrambles ${addr} keeping group structure`, () => {
    const f = processDefault(`addr ${addr} end`, { settings: { alwaysScrambleIPv6: true } });
    const hits = f.filter((x) => x.kind !== 'plain');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].kind, 'scrambled');
    assert.equal(hits[0].original, addr);
    const shape = (s) => s.split(':').map((g) => g.length).join(',');
    assert.equal(shape(hits[0].display), shape(addr));
  });
}

test('a time of day is not an IPv6 address', () => {
  assert.ok(processDefault('at 12:30:45 today').every((x) => x.kind === 'plain'));
});

for (const [text, addr] of [
  ['ip:fe80::1', 'fe80::1'],
  ['addr:2001:db8::1', '2001:db8::1'],
  ['Gateway fe80::1: unreachable', 'fe80::1'],
  ['from 2001:db8::5: refused', '2001:db8::5'],
]) {
  test(`default config censors ${addr} when adjacent to a colon in "${text}"`, () => {
    const hits = processDefault(text).filter((x) => x.kind !== 'plain');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].original, addr);
  });
}

for (const text of ['12:30:45', '00:1A:2B:3C:4D:5E']) {
  test(`default config does not treat "${text}" as an IPv6 address`, () => {
    const hits = processDefault(text).filter((x) => x.kind !== 'plain');
    assert.ok(hits.every((x) => !x.original.includes(':')));
  });
}

test('default config does not treat the port in "host 10.0.0.1:8080" as IPv6', () => {
  const hits = processDefault('host 10.0.0.1:8080').filter((x) => x.kind !== 'plain');
  assert.ok(hits.every((x) => !x.original.includes(':')));
  assert.ok(hits.some((x) => x.original === '10.0.0.1'));
});
