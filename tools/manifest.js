// Derives the Firefox manifest from the Chrome (MV3) one.
const GECKO_SETTINGS = {
  id: 'occulto@azlobaki',
  strict_min_version: '128.0',
  data_collection_permissions: { required: ['none'] },
};

function toFirefoxManifest(chromeManifest) {
  const manifest = JSON.parse(JSON.stringify(chromeManifest));
  // Firefox has no extension service workers: run the same code as a
  // background script, loading its dependencies first.
  manifest.background = { scripts: ['types.js', 'storage.js', manifest.background.service_worker] };
  manifest.browser_specific_settings = { gecko: GECKO_SETTINGS };
  return manifest;
}

module.exports = { toFirefoxManifest };
