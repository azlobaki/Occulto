// UI translation. Source strings are the English text itself; their message
// key is a hash of it (see tools/i18n.js, which builds _locales/*/messages.json).
// Placeholders are written {0}, {1}…

class OccultoI18n {
  static key(english: string): string {
    // FNV-1a 32-bit; keep in sync with tools/i18n.js
    let hash = 0x811c9dc5;
    for (let i = 0; i < english.length; i++) {
      hash ^= english.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `m${hash.toString(16).padStart(8, '0')}`;
  }

  static t(english: string, ...subs: Array<string | number>): string {
    let message = english;
    try {
      message = chrome.i18n.getMessage(OccultoI18n.key(english)) || english;
    } catch {
      // no i18n API (unit tests): fall back to English
    }
    return message.replace(/\{(\d)\}/g, (_, i: string) => String(subs[Number(i)] ?? ''));
  }

  // Translates elements marked with data-i18n (their own text) and the
  // attributes listed in data-i18n-attr (e.g. "placeholder title").
  static apply(root: ParentNode = document): void {
    root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
      const source = el.dataset.i18nSource ?? el.textContent?.trim() ?? '';
      el.dataset.i18nSource = source;
      el.textContent = OccultoI18n.t(source);
    });
    root.querySelectorAll<HTMLElement>('[data-i18n-attr]').forEach((el) => {
      for (const attr of (el.dataset.i18nAttr ?? '').split(/\s+/).filter(Boolean)) {
        const value = el.getAttribute(attr);
        if (value) el.setAttribute(attr, OccultoI18n.t(value));
      }
    });
    document.documentElement.lang = OccultoI18n.t('en');
  }
}
