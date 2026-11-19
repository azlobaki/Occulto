declare function importScripts(...urls: string[]): void;
// Chrome runs this as a service worker; Firefox loads it as a background
// script listed after its dependencies (see tools/manifest.js), where importScripts is absent.
if (typeof importScripts === 'function') {
  importScripts('types.js', 'storage.js', 'rotation.js', 'i18n.js');
}

const OCCULTO_BADGE_COLORS = { active: '#5b6cf0', off: '#8a8fa3', paused: '#d08a1e' };

function occultoCreateMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'occulto-hide-text',
      title: OccultoI18n.t('Occulto: always hide “%s”'),
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'occulto-replace-text',
      title: OccultoI18n.t('Occulto: replace “%s”…'),
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'occulto-hide-element',
      title: OccultoI18n.t('Occulto: hide this element'),
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

// ---- tab rotation ---------------------------------------------------------
// Each tick activates the next tab of the rotated window and schedules the
// following tick. The alarm survives the background being suspended; browsers
// may delay alarms to 30 s, so shorter intervals also run on a timer (each
// tick's API calls keep the background alive in between).

const OCCULTO_ALARM_MIN_MS = 30_000;
let occultoRotationDueAt = 0; // 0: nothing scheduled by this instance
let occultoRotationTimer: ReturnType<typeof setTimeout> | undefined;

async function occultoReadRotation(): Promise<TabRotationSettings> {
  const stored = await chrome.storage.local.get('tabRotation');
  return OccultoStorage.normalizeTabRotation(stored.tabRotation);
}

function occultoScheduleRotation(intervalSeconds: number): void {
  const delay = intervalSeconds * 1000;
  occultoRotationDueAt = Date.now() + delay;
  clearTimeout(occultoRotationTimer);
  void chrome.alarms.create(OccultoRotation.ALARM, { when: occultoRotationDueAt });
  if (delay < OCCULTO_ALARM_MIN_MS) {
    occultoRotationTimer = setTimeout(() => void occultoRotateTick(), delay);
  }
}

function occultoStopRotation(): void {
  occultoRotationDueAt = 0;
  clearTimeout(occultoRotationTimer);
  void chrome.alarms.clear(OccultoRotation.ALARM);
}

async function occultoRotateTick(): Promise<void> {
  // The timer and the alarm can both fire for one tick: the first one claims it.
  if (Date.now() < occultoRotationDueAt - 500) return;
  occultoRotationDueAt = Number.POSITIVE_INFINITY;
  try {
    const rotation = await occultoReadRotation();
    if (!rotation.enabled || rotation.windowId === null) return;
    const tabs = await chrome.tabs.query({ windowId: rotation.windowId }).catch(() => []);
    if (tabs.length === 0) {
      // The rotated window was closed.
      await OccultoStorage.save({ tabRotation: { ...rotation, enabled: false, windowId: null } });
      return;
    }
    occultoScheduleRotation(rotation.intervalSeconds);
    const next = OccultoRotation.nextTabId(tabs);
    if (next !== null) await chrome.tabs.update(next, { active: true }).catch(() => undefined);
  } finally {
    if (occultoRotationDueAt === Number.POSITIVE_INFINITY) occultoStopRotation();
  }
}

// Starts rotation in the given window, or stops it if it is running there.
async function occultoToggleRotation(windowId: number): Promise<void> {
  const rotation = await occultoReadRotation();
  const running = rotation.enabled && rotation.windowId === windowId;
  await OccultoStorage.save({
    tabRotation: { ...rotation, enabled: !running, windowId: running ? null : windowId },
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === OccultoRotation.ALARM) void occultoRotateTick();
});

// The popup, the options page and the shortcut only write the setting; the
// schedule follows it from here.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.tabRotation) return;
  const previous = OccultoStorage.normalizeTabRotation(changes.tabRotation.oldValue);
  const next = OccultoStorage.normalizeTabRotation(changes.tabRotation.newValue);
  if (!next.enabled) occultoStopRotation();
  else if (
    !previous.enabled ||
    previous.intervalSeconds !== next.intervalSeconds ||
    previous.windowId !== next.windowId
  ) {
    occultoScheduleRotation(next.intervalSeconds);
  }
});

chrome.runtime.onInstalled.addListener(() => {
  occultoCreateMenus();
  void (async () => {
    await OccultoStorage.migrateFromSync();
    await OccultoStorage.ensureScrambleKey();
    // Alarms are dropped when the extension is updated or reloaded.
    const rotation = await occultoReadRotation();
    if (rotation.enabled) occultoScheduleRotation(rotation.intervalSeconds);
  })();
});

chrome.runtime.onStartup.addListener(() => {
  occultoCreateMenus();
  void (async () => {
    const data = await OccultoStorage.loadAll();
    if (data.scrambleSettings.rotateKeyOnStartup) {
      await OccultoStorage.resetScrambleKey();
    }
    // Window ids do not survive a browser restart: rotation starts off.
    if (data.tabRotation.enabled || data.tabRotation.windowId !== null) {
      await OccultoStorage.save({
        tabRotation: { ...data.tabRotation, enabled: false, windowId: null },
      });
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
          regex: [
            ...data.config.regex,
            { name: `Selected: ${label}`, pattern: occultoLiteralPattern(selection), flags: 'gi' },
          ],
        },
      });
    } else if (info.menuItemId === 'occulto-replace-text' && selection) {
      await OccultoStorage.save({
        replaceRules: [
          ...data.replaceRules,
          OccultoStorage.createReplaceRule({ find: selection, replace: 'Redacted' }),
        ],
      });
      await chrome.tabs.create({ url: chrome.runtime.getURL('options.html#rules') });
    } else if (info.menuItemId === 'occulto-hide-element' && tab?.id !== undefined) {
      const selector: unknown = await chrome.tabs
        .sendMessage(tab.id, { type: 'occulto:context-selector' }, { frameId: info.frameId ?? 0 })
        .catch(() => null);
      if (typeof selector === 'string' && selector && !data.config.selectors.includes(selector)) {
        await OccultoStorage.save({
          config: { ...data.config, selectors: [...data.config.selectors, selector] },
        });
      }
    }
  })();
});

chrome.commands.onCommand.addListener((command) => {
  void (async () => {
    if (command === 'toggle-occulto') {
      const { enabled } = await chrome.storage.local.get('enabled');
      await OccultoStorage.save({ enabled: enabled === false });
    } else if (command === 'toggle-rotation') {
      const focused = await chrome.windows.getLastFocused();
      if (focused.id !== undefined) await occultoToggleRotation(focused.id);
    } else if (command === 'panic-cover') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id !== undefined) {
        await chrome.tabs
          .sendMessage(tab.id, { type: 'occulto:panic' }, { frameId: 0 })
          .catch(() => undefined);
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
  const text =
    state === 'off'
      ? 'OFF'
      : state === 'paused'
        ? 'II'
        : count > 999
          ? '999+'
          : count > 0
            ? String(count)
            : '';
  void chrome.action.setBadgeText({ tabId, text });
  void chrome.action.setBadgeBackgroundColor({
    tabId,
    color: OCCULTO_BADGE_COLORS[state] ?? OCCULTO_BADGE_COLORS.active,
  });
});
