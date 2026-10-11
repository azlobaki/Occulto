const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./helpers');
const run = loadScripts(['validators.js', 'crypto.js', 'scrambler.js']);
const K = '42'.repeat(32);
const scr = (s) => run(`new Scrambler('${K}').scramble(${JSON.stringify(s)})`);
const type = (s) => run(`Scrambler.detectType(${JSON.stringify(s)})`);
const valid = (name, s) => run(`OccultoValidators.check('${name}', ${JSON.stringify(s)})`);
const shape = (s) => s.replace(/[0-9]/g, '9').replace(/[A-Z]/g, 'A').replace(/[a-z]/g, 'a');

test('detectType recognises the new types', () => {
  assert.equal(type('00:1A:2B:3C:4D:5E'), 'mac');
  assert.equal(type('001a.2b3c.4d5e'), 'mac');
  assert.equal(type('4111 1111 1111 1111'), 'card');
  assert.equal(type('FR76 3000 6000 0112 3456 7890 189'), 'iban');
  assert.equal(type('+33 6 12 34 56 78'), 'phone');
  assert.equal(type('06.12.34.56.78'), 'phone');
  assert.equal(type('https://intranet.acme.com/clients/42'), 'url');
  assert.equal(type('db01.prod.acme.com'), 'domain');
  assert.equal(type('732 829 320'), 'text');
});

test('MAC keeps separators and stays hexadecimal', () => {
  const out = scr('00:1A:2B:3C:4D:5E');
  assert.match(out, /^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/);
  assert.notEqual(out, '00:1A:2B:3C:4D:5E');
});

test('card keeps format and first digit and stays Luhn-valid', () => {
  const out = scr('4111 1111 1111 1111');
  assert.equal(shape(out), shape('4111 1111 1111 1111'));
  assert.equal(out[0], '4');
  assert.equal(valid('luhn', out), true);
  assert.notEqual(out, '4111 1111 1111 1111');
});

test('IBAN keeps country and spacing and stays valid', () => {
  const src = 'FR76 3000 6000 0112 3456 7890 189';
  const out = scr(src);
  assert.equal(out.slice(0, 2), 'FR');
  assert.equal(out.length, src.length);
  assert.deepEqual([...out].map((c) => c === ' '), [...src].map((c) => c === ' '));
  assert.equal(valid('iban', out), true);
  assert.notEqual(out, src);
});

test('phone keeps its prefix and separators', () => {
  const out = scr('+33 6 12 34 56 78');
  assert.ok(out.startsWith('+33 '), out);
  assert.equal(shape(out), shape('+33 6 12 34 56 78'));
  const fr = scr('06.12.34.56.78');
  assert.ok(fr.startsWith('06.'), fr);
  assert.notEqual(fr, '06.12.34.56.78');
});

test('domain and URL keep TLD and scheme', () => {
  const d = scr('db01.prod.acme.com');
  assert.match(d, /\.com$/);
  assert.equal(d.split('.').length, 4);
  assert.notEqual(d, 'db01.prod.acme.com');
  const u = scr('https://intranet.acme.com:8443/clients/42?id=7');
  assert.match(u, /^https:\/\/[a-z0-9]+\.[a-z0-9]+\.com:8443\/[a-z0-9]+\/[0-9]+\?[a-z0-9]+=[0-9]$/);
  assert.ok(!u.includes('acme'));
});
