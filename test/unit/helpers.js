// Loads compiled extension scripts (dist/*.js, classic scripts sharing one
// global scope) into an isolated node:vm context so they can be unit tested.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DIST = path.join(__dirname, '..', '..', 'dist');

function loadScripts(files, extraGlobals = {}) {
  const context = vm.createContext({
    console,
    TextEncoder,
    TextDecoder,
    URL,
    crypto: globalThis.crypto,
    ...extraGlobals,
  });
  for (const file of files) {
    const filename = path.join(DIST, file);
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  }
  // Top-level class/const declarations live in the context's global lexical
  // scope, so they are reached by evaluating an expression, not as properties.
  return (expr) => vm.runInContext(expr, context);
}

module.exports = { loadScripts };
