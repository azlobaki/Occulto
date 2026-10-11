const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./helpers');
const run = loadScripts(['crypto.js']);
const hex = (expr) => run(`OccultoCrypto.bytesToHex(${expr})`);

test('sha256 FIPS vectors', () => {
  assert.equal(hex(`OccultoCrypto.sha256(OccultoCrypto.utf8(''))`), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(hex(`OccultoCrypto.sha256(OccultoCrypto.utf8('abc'))`), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(hex(`OccultoCrypto.sha256(OccultoCrypto.utf8('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))`), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  assert.equal(hex(`OccultoCrypto.sha256(OccultoCrypto.utf8('a'.repeat(1000000)))`), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
});

test('hmac-sha256 RFC 4231 vectors', () => {
  assert.equal(hex(`OccultoCrypto.hmacSha256(new Uint8Array(20).fill(0x0b), OccultoCrypto.utf8('Hi There'))`), 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
  assert.equal(hex(`OccultoCrypto.hmacSha256(OccultoCrypto.utf8('Jefe'), OccultoCrypto.utf8('what do ya want for nothing?'))`), '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
  assert.equal(hex(`OccultoCrypto.hmacSha256(new Uint8Array(131).fill(0xaa), OccultoCrypto.utf8('Test Using Larger Than Block-Size Key - Hash Key First'))`), '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54');
});

test('hex round trip and validation', () => {
  assert.equal(hex(`OccultoCrypto.hexToBytes('00ff10ab')`), '00ff10ab');
  assert.throws(() => run(`OccultoCrypto.hexToBytes('abc')`));
  assert.throws(() => run(`OccultoCrypto.hexToBytes('zz')`));
});

test('fingerprint is 8 hex chars and key-dependent', () => {
  const a = run(`OccultoCrypto.fingerprint('${'11'.repeat(32)}')`);
  const b = run(`OccultoCrypto.fingerprint('${'22'.repeat(32)}')`);
  assert.match(a, /^[0-9a-f]{8}$/);
  assert.notEqual(a, b);
});

test('KeyedRng is deterministic per key+label and bounded', () => {
  const seq = (k, l) => run(`(() => { const r = new KeyedRng(new Uint8Array(32).fill(${k}), '${l}'); return Array.from({length: 50}, () => r.int(10)).join(','); })()`);
  assert.equal(seq(1, 'x'), seq(1, 'x'));
  assert.notEqual(seq(1, 'x'), seq(2, 'x'));
  assert.notEqual(seq(1, 'x'), seq(1, 'y'));
  const values = seq(3, 'z').split(',').map(Number);
  assert.ok(values.every((v) => v >= 0 && v < 10));
  assert.equal(run(`new KeyedRng(new Uint8Array(32), 'a').int(1)`), 0);
});
