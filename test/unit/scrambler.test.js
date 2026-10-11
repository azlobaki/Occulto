const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./helpers');
const run = loadScripts(['validators.js', 'crypto.js', 'scrambler.js']);
const K1 = '11'.repeat(32);
const K2 = '22'.repeat(32);
const scr = (key, input) => run(`new Scrambler('${key}').scramble(${JSON.stringify(input)})`);

test('same key => same output; different key => different output', () => {
  for (const input of ['john.doe@company.com', '192.168.1.42', 'Confidential Project Falcon']) {
    assert.equal(scr(K1, input), scr(K1, input));
    assert.notEqual(scr(K1, input), scr(K2, input));
  }
});

test('no key => ephemeral random key (two instances differ)', () => {
  const a = run(`new Scrambler().scramble('Confidential Project Falcon 2024')`);
  const b = run(`new Scrambler().scramble('Confidential Project Falcon 2024')`);
  assert.notEqual(a, b);
});

test('setKey clears cache and changes output', () => {
  const [a, b] = run(`(() => { const s = new Scrambler('${K1}'); const a = s.scramble('secret text'); s.setKey('${K2}'); return [a, s.scramble('secret text')]; })()`);
  assert.notEqual(a, b);
});

test('formats are preserved', () => {
  assert.match(scr(K1, 'john.doe@company.com'), /^[a-z]+[._]?[a-z]+@[a-z.]+\.[a-z]{2,}$/);
  for (const seed of ['10.0.0.1', '192.168.1.42', '8.8.8.8']) {
    const ip = scr(K1, seed);
    const octets = ip.split('.');
    assert.equal(octets.length, 4);
    for (const o of octets) {
      assert.match(o, /^(0|[1-9]\d{0,2})$/);
      assert.ok(Number(o) <= 255);
    }
  }
  const v6in = '2001:db8::ff00:42:8329';
  const v6out = scr(K1, v6in);
  assert.deepEqual(v6out.split(':').map((g) => g.length), v6in.split(':').map((g) => g.length));
  assert.match(v6out, /^[0-9a-f:]+$/);
  assert.match(scr(K1, '123e4567-e89b-12d3-a456-426614174000'), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  const text = 'Hello World 42!';
  const out = scr(K1, text);
  assert.equal(out.length, text.length);
  for (let i = 0; i < text.length; i++) {
    const cls = (c) => (/[A-Z]/.test(c) ? 'U' : /[a-z]/.test(c) ? 'l' : /\d/.test(c) ? 'd' : c);
    assert.equal(cls(out[i]), cls(text[i]));
  }
});

test('detectType', () => {
  assert.equal(run(`Scrambler.detectType('a@b.co')`), 'email');
  assert.equal(run(`Scrambler.detectType('10.1.2.3')`), 'ipv4');
  assert.equal(run(`Scrambler.detectType('fe80::1:2')`), 'ipv6');
  assert.equal(run(`Scrambler.detectType('123e4567-e89b-12d3-a456-426614174000')`), 'uuid');
  assert.equal(run(`Scrambler.detectType('hello')`), 'text');
});

test('keys must be exactly 32 bytes (64 hex chars)', () => {
  assert.throws(() => run(`new Scrambler('')`));
  assert.throws(() => run(`new Scrambler('abcd')`));
  assert.throws(() => run(`new Scrambler('${K1}').setKey('')`));
  assert.throws(() => run(`new Scrambler('${K1}').setKey('abcd')`));
  assert.equal(typeof scr(K1, 'ok'), 'string');
});

test('detectType handles IPv6 edge cases', () => {
  assert.equal(run(`Scrambler.detectType('::1')`), 'ipv6');
  assert.equal(run(`Scrambler.detectType('2001:db8::ff00:42:8329')`), 'ipv6');
  assert.equal(run(`Scrambler.detectType('1:2:3:4:5:6:7:8')`), 'ipv6');
  assert.equal(run(`Scrambler.detectType('1:2:3:4:5:6:7')`), 'text');
  assert.equal(run(`Scrambler.detectType('1::2::3')`), 'text');
  assert.equal(run(`Scrambler.detectType('12345::1')`), 'text');
  assert.equal(run(`Scrambler.detectType('1:2')`), 'text');
});
