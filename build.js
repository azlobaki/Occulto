const fs = require('fs');
const path = require('path');
const { toFirefoxManifest } = require('./tools/manifest');
const { createZip } = require('./tools/zip');
const i18n = require('./tools/i18n');

const DIST = 'dist';
const FIREFOX_DIST = 'dist-firefox';
const FIREFOX_ZIP = 'occulto-firefox.zip';

// Static files copied next to the compiled scripts (tsc writes dist/*.js).
const STATIC_FILES = [
  'manifest.json',
  'config.json',
  'ui-tokens.css',
  'popup.html',
  'popup.css',
  'options.html',
  'options.css',
  'src/content.css',
];

fs.mkdirSync(DIST, { recursive: true });
for (const file of STATIC_FILES) {
  fs.copyFileSync(file, path.join(DIST, path.basename(file)));
}
fs.cpSync('icons', path.join(DIST, 'icons'), { recursive: true });
const { missing } = i18n.build('.', DIST, [DIST]);
for (const [lang, list] of Object.entries(missing)) {
  if (list.length) console.warn(`i18n: ${list.length} string(s) missing in i18n/${lang}.json (English used)`);
}
console.log(`Chrome build ready in ${DIST}/`);

// Firefox: same files, adapted manifest.
fs.rmSync(FIREFOX_DIST, { recursive: true, force: true });
fs.cpSync(DIST, FIREFOX_DIST, { recursive: true });
const chromeManifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
fs.writeFileSync(
  path.join(FIREFOX_DIST, 'manifest.json'),
  JSON.stringify(toFirefoxManifest(chromeManifest), null, 2) + '\n'
);

function listFiles(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix + entry.name;
    return entry.isDirectory() ? listFiles(path.join(dir, entry.name), rel + '/') : [rel];
  });
}
const entries = listFiles(FIREFOX_DIST)
  .sort()
  .map((name) => ({ name, data: fs.readFileSync(path.join(FIREFOX_DIST, name)) }));
fs.writeFileSync(FIREFOX_ZIP, createZip(entries));
console.log(`Firefox build ready in ${FIREFOX_DIST}/ and ${FIREFOX_ZIP}`);

console.log('\nChrome/Chromium: chrome://extensions → Developer mode → Load unpacked → dist/');
console.log('Firefox: about:debugging#/runtime/this-firefox → Load Temporary Add-on → dist-firefox/manifest.json');
