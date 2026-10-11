declare function importScripts(...urls: string[]): void;
// Chrome runs this as a service worker; Firefox loads it as a background
// script listed after types.js and storage.js, where importScripts is absent.
if (typeof importScripts === 'function') {
  importScripts('types.js', 'storage.js');
}

const OCCULTO_BADGE_COLORS = { active: '#5b6cf0', off: '#8a8fa3', paused: '#d08a1e' };

function occultoCreateMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'occulto-hide-text', title: 'Occulto: always hide “%s”', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'occulto-replace-text', title: 'Occulto: replace “%s”…', contexts: ['selection'] });
    chrome.contextMenus.create({
      id: 'occulto-hide-element',
      title: 'Occulto: hide this element',
      contexts: ['page', 'link', 'image', 'editable'],
    });
  });
}

function occultoLiteralPattern(text: string): string {
  return text
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');
}

chrome.runtime.onInstalled.addListener(() => {
  occultoCreateMenus();
  void (async () => {
    await OccultoStorage.migrateFromSync();
    await OccultoStorage.ensureScrambleKey();
  })();
});

chrome.runtime.onStartup.addListener(() => {
  occultoCreateMenus();
  void (async () => {
    const data = await OccultoStorage.loadAll();
    if (data.scrambleSettings.rotateKeyOnStartup) {
      await OccultoStorage.resetScrambleKey();
    }
  })();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void (async () => {
    const data = await OccultoStorage.loadAll();
    const selection = (info.selectionText ?? '').trim().slice(0, 200);
    if (info.menuItemId === 'occulto-hide-text' && selection) {
      const label = selection.length > 24 ? `${selection.slice(0, 24)}…` : selection;
      await OccultoStorage.save({
        config: {
          ...data.config,
          regex: [...data.config.regex, { name: `Selected: ${label}`, pattern: occultoLiteralPattern(selection), flags: 'gi' }],
        },
      });
    } else if (info.menuItemId === 'occulto-replace-text' && selection) {
      await OccultoStorage.save({
        replaceRules: [...data.replaceRules, OccultoStorage.createReplaceRule({ find: selection, replace: 'Redacted' })],
      });
      await chrome.tabs.create({ url: chrome.runtime.getURL('options.html#rules') });
    } else if (info.menuItemId === 'occulto-hide-element' && tab?.id !== undefined) {
      const selector: unknown = await chrome.tabs
        .sendMessage(tab.id, { type: 'occulto:context-selector' }, { frameId: info.frameId ?? 0 })
        .catch(() => null);
      if (typeof selector === 'string' && selector && !data.config.selectors.includes(selector)) {
        await OccultoStorage.save({ config: { ...data.config, selectors: [...data.config.selectors, selector] } });
      }
    }
  })();
});

chrome.commands.onCommand.addListener((command) => {
  void (async () => {
    if (command === 'toggle-occulto') {
      const { enabled } = await chrome.storage.local.get('enabled');
      await OccultoStorage.save({ enabled: enabled === false });
    } else if (command === 'panic-cover') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id !== undefined) {
        await chrome.tabs.sendMessage(tab.id, { type: 'occulto:panic' }, { frameId: 0 }).catch(() => undefined);
      }
    }
  })();
});

// Toolbar badge: what Occulto is doing on each tab, readable at a glance.
chrome.runtime.onMessage.addListener((message, sender) => {
  const tabId = sender.tab?.id;
  if (!message || message.type !== 'occulto:badge' || tabId === undefined) return;
  const state = message.state as keyof typeof OCCULTO_BADGE_COLORS;
  const count = Number(message.count) || 0;
  const text = state === 'off' ? 'OFF' : state === 'paused' ? 'II' : count > 999 ? '999+' : count > 0 ? String(count) : '';
  void chrome.action.setBadgeText({ tabId, text });
  void chrome.action.setBadgeBackgroundColor({ tabId, color: OCCULTO_BADGE_COLORS[state] ?? OCCULTO_BADGE_COLORS.active });
});
