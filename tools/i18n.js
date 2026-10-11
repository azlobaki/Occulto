// Builds _locales/<lang>/messages.json from the English strings used in the
// UI (OccultoI18n.t('…') calls, data-i18n markup, pattern library) and the
// translations in i18n/<lang>.json ({ "English": "Traduction" }).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// FNV-1a 32-bit; keep in sync with src/i18n.ts
function key(english) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < english.length; i++) {
    hash ^= english.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `m${hash.toString(16).padStart(8, '0')}`;
}

// Fixed keys used by manifest.json (__MSG_name__).
const MANIFEST_STRINGS = {
  extName: 'Occulto - Sensitive Data Hider',
  extDescription: 'Hide sensitive data in your browser during screen shares.',
  cmdToggle: 'Toggle Occulto on/off',
  cmdPanic: 'Cover the whole page instantly (press again to uncover)',
};

function unescapeJs(s) {
  return s.replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n');
}

function extract(root, distDir) {
  const strings = new Set(['en']);
  for (const file of fs.readdirSync(path.join(root, 'src')).filter((f) => f.endsWith('.ts'))) {
    const src = fs.readFileSync(path.join(root, 'src', file), 'utf8');
    for (const m of src.matchAll(/OccultoI18n\.t\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) strings.add(unescapeJs(m[2]));
  }
  for (const file of ['popup.html', 'options.html']) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    for (const m of html.matchAll(/<[a-z0-9]+\b[^>]*\bdata-i18n(?:=""|\b(?!-))[^>]*>([^<]*)</g)) strings.add(m[1].trim());
    for (const m of html.matchAll(/<[a-z0-9]+\b[^>]*\bdata-i18n-attr="([^"]+)"[^>]*>/g)) {
      for (const attr of m[1].split(/\s+/)) {
        const value = new RegExp(`\\b${attr}="([^"]*)"`).exec(m[0]);
        if (value && value[1]) strings.add(value[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"'));
      }
    }
  }
  // Pattern library: names, descriptions, categories (read from the compiled script).
  const ctx = vm.createContext({});
  for (const f of ['types.js', 'storage.js', 'library.js']) vm.runInContext(fs.readFileSync(path.join(distDir, f), 'utf8'), ctx);
  for (const p of vm.runInContext('OCCULTO_PRESETS', ctx)) {
    strings.add(p.name);
    strings.add(p.description);
  }
  for (const c of vm.runInContext('OccultoLibrary.categories', ctx)) strings.add(c);
  strings.delete('');
  return [...strings].sort();
}

// chrome.i18n treats "$" specially: escape it.
const message = (text) => ({ message: text.replace(/\$/g, '$$$$') });

function build(root, distDir, outDirs) {
  const strings = extract(root, distDir);
  const missing = {};
  const langs = fs.readdirSync(path.join(root, 'i18n')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  const locales = { en: {} };
  for (const [k, v] of Object.entries(MANIFEST_STRINGS)) locales.en[k] = message(v);
  for (const s of strings) locales.en[key(s)] = message(s);
  for (const lang of langs) {
    const translations = JSON.parse(fs.readFileSync(path.join(root, 'i18n', `${lang}.json`), 'utf8'));
    locales[lang] = {};
    missing[lang] = [];
    for (const [k, v] of Object.entries(MANIFEST_STRINGS)) locales[lang][k] = message(translations[v] ?? v);
    for (const s of strings) {
      if (translations[s] === undefined) missing[lang].push(s);
      locales[lang][key(s)] = message(translations[s] ?? s);
    }
  }
  for (const out of outDirs) {
    for (const [lang, messages] of Object.entries(locales)) {
      const dir = path.join(out, '_locales', lang);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'messages.json'), JSON.stringify(messages, null, 1) + '\n');
    }
  }
  return { strings, missing };
}

module.exports = { key, extract, build, MANIFEST_STRINGS };
