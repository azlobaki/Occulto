const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { toFirefoxManifest } = require('../../tools/manifest');
const { createZip } = require('../../tools/zip');
const chromeManifest = require('../../manifest.json');

test('toFirefoxManifest swaps the service worker for background scripts and adds gecko settings', () => {
  const ff = toFirefoxManifest(chromeManifest);
  assert.deepEqual(ff.background, { scripts: ['types.js', 'storage.js', 'background.js'] });
  assert.equal(ff.browser_specific_settings.gecko.id, 'occulto@azlobaki');
  assert.deepEqual(ff.browser_specific_settings.gecko.data_collection_permissions, { required: ['none'] });
  assert.ok(ff.options_ui && !ff.options_page);
  assert.ok(chromeManifest.background.service_worker, 'input manifest is not mutated');
});

test('createZip produces a readable archive', () => {
  const zip = createZip([
    { name: 'manifest.json', data: Buffer.from('{"a":1}') },
    { name: 'icons/x.txt', data: Buffer.from('hello hello hello') },
  ]);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  const eocd = zip.length - 22;
  assert.equal(zip.readUInt32LE(eocd), 0x06054b50);
  assert.equal(zip.readUInt16LE(eocd + 10), 2);
  // first entry: decompress and compare
  const nameLen = zip.readUInt16LE(26);
  const extraLen = zip.readUInt16LE(28);
  const size = zip.readUInt32LE(18);
  const start = 30 + nameLen + extraLen;
  assert.equal(zip.toString('utf8', 30, 30 + nameLen), 'manifest.json');
  assert.equal(zlib.inflateRawSync(zip.subarray(start, start + size)).toString(), '{"a":1}');
  assert.equal(zip.readUInt32LE(14), zlib.crc32(Buffer.from('{"a":1}')));
});
