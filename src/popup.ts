// Types are declared in types.ts (shared global scope, module: None)

interface OccultoPageStats {
  active: boolean;
  host: string;
  blurred: number;
  scrambled: number;
  replaced: number;
}

class OccultoPopup {
  private data: StorageData | null = null;
  private changedBeforeLoad = false;
  private tabId: number | undefined;
  private host: string | null = null;
  private quickCase = false;
  private quickWord = false;
  private statsTimer = 0;
  private auditOn = false;
  private panicOn = false;

  constructor() {
    void this.init();
  }

  private el<T extends HTMLElement>(id: string): T {
    return document.getElementById(id) as T;
  }

  private async init(): Promise<void> {
    OccultoI18n.apply();
    OccultoIcons.hydrate();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (!this.data) this.changedBeforeLoad = true;
      else this.onStorageChanged(changes);
    });
    const [data, tabs] = await Promise.all([
      OccultoStorage.loadAll(),
      chrome.tabs.query({ active: true, currentWindow: true }),
    ]);
    this.data = this.changedBeforeLoad ? await OccultoStorage.loadAll() : data;
    this.tabId = tabs[0]?.id;
    this.host = OccultoStorage.siteKey(tabs[0]?.url);
    this.bindEvents();
    this.render();
    void this.refreshStats();
    void this.renderShortcut();
  }

  private onStorageChanged(changes: { [key: string]: chrome.storage.StorageChange }): void {
    const data = this.data;
    if (!data) return;
    if (changes.enabled) data.enabled = changes.enabled.newValue !== false;
    if (changes.mode) data.mode = changes.mode.newValue === 'scramble' ? 'scramble' : 'blur';
    if (changes.scrambleSettings) {
      data.scrambleSettings = OccultoStorage.normalizeScrambleSettings(changes.scrambleSettings.newValue);
    }
    if (changes.pausedSites) data.pausedSites = OccultoStorage.normalizePausedSites(changes.pausedSites.newValue);
    if (changes.config && changes.config.newValue) data.config = changes.config.newValue as Config;
    if (changes.profiles || changes.activeProfileId) {
      Object.assign(
        data,
        OccultoStorage.normalizeProfiles(
          changes.profiles ? changes.profiles.newValue : data.profiles,
          changes.activeProfileId ? changes.activeProfileId.newValue : data.activeProfileId
        )
      );
    }
    if (changes.replaceRules) {
      const raw: unknown = changes.replaceRules.newValue;
      data.replaceRules = Array.isArray(raw)
        ? raw.map((r: unknown) => OccultoStorage.normalizeReplaceRule(r)).filter((r): r is ReplaceRule => r !== null)
        : [];
    }
    this.render();
    this.scheduleStats();
  }

  private save(partial: Partial<StorageData>): void {
    OccultoStorage.save(partial).catch((error: Error) => console.error('[Occulto] Failed to save settings', error));
  }

  // ---- events ------------------------------------------------------------

  private bindEvents(): void {
    this.el<HTMLInputElement>('masterSwitch').addEventListener('change', (e) => {
      if (!this.data) return;
      this.data.enabled = (e.target as HTMLInputElement).checked;
      this.save({ enabled: this.data.enabled });
      this.render();
    });
    this.el('pauseSiteBtn').addEventListener('click', () => this.togglePause());
    document.querySelectorAll<HTMLButtonElement>('.segmented button').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.data) return;
        this.data.mode = btn.dataset.mode === 'scramble' ? 'scramble' : 'blur';
        this.save({ mode: this.data.mode });
        this.render();
      });
    });
    this.bindIpToggle('ipv4Toggle', 'alwaysScrambleIPv4');
    this.bindIpToggle('ipv6Toggle', 'alwaysScrambleIPv6');

    const quickCase = this.el<HTMLButtonElement>('quickCase');
    const quickWord = this.el<HTMLButtonElement>('quickWord');
    quickCase.addEventListener('click', () => {
      this.quickCase = !this.quickCase;
      quickCase.setAttribute('aria-pressed', String(this.quickCase));
    });
    quickWord.addEventListener('click', () => {
      this.quickWord = !this.quickWord;
      quickWord.setAttribute('aria-pressed', String(this.quickWord));
    });
    this.el<HTMLFormElement>('quickAddForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.quickAdd();
    });
    this.el<HTMLSelectElement>('profileSelect').addEventListener('change', (e) => {
      const id = (e.target as HTMLSelectElement).value;
      if (id) OccultoStorage.switchProfile(id).catch((error: Error) => console.error('[Occulto] Profile switch failed', error));
    });
    this.el('auditBtn').addEventListener('click', () => void this.runAudit(!this.auditOn));
    this.el('panicBtn').addEventListener('click', () => void this.togglePanic());
    this.el('openOptionsBtn').addEventListener('click', () => {
      void chrome.runtime.openOptionsPage();
      window.close();
    });
  }

  private bindIpToggle(id: string, key: 'alwaysScrambleIPv4' | 'alwaysScrambleIPv6'): void {
    this.el<HTMLInputElement>(id).addEventListener('change', (e) => {
      if (!this.data) return;
      this.data.scrambleSettings = { ...this.data.scrambleSettings, [key]: (e.target as HTMLInputElement).checked };
      this.save({ scrambleSettings: this.data.scrambleSettings });
    });
  }

  private togglePause(): void {
    if (!this.data || !this.host) return;
    const host = this.host;
    const paused = this.data.pausedSites.includes(host);
    this.data.pausedSites = paused ? this.data.pausedSites.filter((h) => h !== host) : [...this.data.pausedSites, host];
    this.save({ pausedSites: this.data.pausedSites });
    this.render();
  }

  private quickAdd(): void {
    if (!this.data) return;
    const findInput = this.el<HTMLInputElement>('quickFind');
    const replaceInput = this.el<HTMLInputElement>('quickReplace');
    if (findInput.value === '') {
      findInput.focus();
      return;
    }
    this.data.replaceRules = [
      ...this.data.replaceRules,
      OccultoStorage.createReplaceRule({
        find: findInput.value,
        replace: replaceInput.value,
        caseSensitive: this.quickCase,
        wholeWord: this.quickWord,
      }),
    ];
    this.save({ replaceRules: this.data.replaceRules });
    findInput.value = '';
    replaceInput.value = '';
    findInput.focus();
    this.renderRules();
  }

  private updateRule(id: string, patch: Partial<ReplaceRule>): void {
    if (!this.data) return;
    this.data.replaceRules = this.data.replaceRules.map((r) => (r.id === id ? { ...r, ...patch } : r));
    this.save({ replaceRules: this.data.replaceRules });
    this.renderRules();
  }

  private deleteRule(id: string): void {
    if (!this.data) return;
    this.data.replaceRules = this.data.replaceRules.filter((r) => r.id !== id);
    this.save({ replaceRules: this.data.replaceRules });
    this.renderRules();
  }

  // ---- rendering ---------------------------------------------------------

  private render(): void {
    const data = this.data;
    if (!data) return;
    const paused = this.host !== null && data.pausedSites.includes(this.host);
    document.body.classList.toggle('is-off', !data.enabled);
    document.body.classList.toggle('is-paused', data.enabled && paused);
    this.el<HTMLInputElement>('masterSwitch').checked = data.enabled;
    this.el('stateText').textContent = !data.enabled
      ? OccultoI18n.t('Off on every site')
      : paused
        ? OccultoI18n.t('Paused on this site')
        : OccultoI18n.t('Protecting this page');

    this.el('siteHost').textContent = this.host ?? OccultoI18n.t('This page');
    const pauseBtn = this.el<HTMLButtonElement>('pauseSiteBtn');
    pauseBtn.disabled = this.host === null || !data.enabled;
    pauseBtn.replaceChildren(
      OccultoIcons.create(paused ? 'play' : 'pause'),
      document.createTextNode(paused ? OccultoI18n.t('Resume here') : OccultoI18n.t('Pause here'))
    );
    pauseBtn.title = paused ? OccultoI18n.t('Resume Occulto on this site') : OccultoI18n.t('Pause Occulto on this site only');

    document.querySelectorAll<HTMLButtonElement>('.segmented button').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.mode === data.mode));
    });
    this.renderProfiles();
    const reachable = this.tabId !== undefined && this.host !== null;
    this.el<HTMLButtonElement>('auditBtn').disabled = !reachable;
    this.el<HTMLButtonElement>('panicBtn').disabled = !reachable;
    this.el<HTMLInputElement>('ipv4Toggle').checked = data.scrambleSettings.alwaysScrambleIPv4;
    this.el<HTMLInputElement>('ipv6Toggle').checked = data.scrambleSettings.alwaysScrambleIPv6;
    this.renderRules();
  }

  private renderProfiles(): void {
    if (!this.data) return;
    const { profiles, activeProfileId } = this.data;
    this.el('profileRow').hidden = profiles.length === 0;
    const select = this.el<HTMLSelectElement>('profileSelect');
    const options = profiles.map((p) => {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = p.name;
      return option;
    });
    if (activeProfileId === null) {
      const none = document.createElement('option');
      none.value = '';
      none.textContent = OccultoI18n.t('Choose a profile…');
      options.unshift(none);
    }
    select.replaceChildren(...options);
    select.value = activeProfileId ?? '';
  }

  private async runAudit(on: boolean): Promise<void> {
    if (this.tabId === undefined || !this.data) return;
    const box = this.el('auditResult');
    let result: { total: number; leaks: Array<{ id: string; name: string; count: number }> } | undefined;
    try {
      result = await chrome.tabs.sendMessage(this.tabId, { type: 'occulto:audit', on }, { frameId: 0 });
    } catch {
      result = undefined;
    }
    this.auditOn = on && result !== undefined;
    const btn = this.el('auditBtn');
    btn.replaceChildren(OccultoIcons.create('scan'), document.createTextNode(this.auditOn ? OccultoI18n.t('Stop audit') : OccultoI18n.t('Audit page')));
    if (!this.auditOn || !result) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    if (result.total === 0) {
      const ok = document.createElement('p');
      ok.className = 'ok';
      ok.textContent = OccultoI18n.t('✓ No obvious leaks. Hidden items are outlined on the page.');
      box.replaceChildren(ok);
      return;
    }
    const head = document.createElement('p');
    head.className = 'warn';
    head.textContent = result.total > 1 ? OccultoI18n.t('{0} possible leaks highlighted in red on the page:', result.total) : OccultoI18n.t('1 possible leak highlighted in red on the page:');
    const list = document.createElement('ul');
    for (const leak of result.leaks) {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = `${leak.name} ×${leak.count}`;
      const enable = document.createElement('button');
      enable.type = 'button';
      enable.className = 'btn btn-primary btn-sm';
      enable.textContent = OccultoI18n.t('Hide these');
      enable.addEventListener('click', () => this.enablePreset(leak.id));
      li.append(label, enable);
      list.appendChild(li);
    }
    box.replaceChildren(head, list);
  }

  private enablePreset(id: string): void {
    const preset = OCCULTO_PRESETS.find((p) => p.id === id);
    if (!this.data || !preset) return;
    this.data.config = OccultoLibrary.enable(this.data.config, preset);
    this.save({ config: this.data.config });
    // Re-scan once the page has applied the new pattern.
    window.setTimeout(() => void this.runAudit(true), 400);
  }

  private async togglePanic(): Promise<void> {
    if (this.tabId === undefined) return;
    try {
      const result = (await chrome.tabs.sendMessage(this.tabId, { type: 'occulto:panic' }, { frameId: 0 })) as
        | { panic: boolean }
        | undefined;
      this.panicOn = result?.panic === true;
    } catch {
      this.panicOn = false;
    }
    this.el('panicBtn').replaceChildren(
      OccultoIcons.create(this.panicOn ? 'play' : 'eyeOff'),
      document.createTextNode(this.panicOn ? OccultoI18n.t('Uncover') : OccultoI18n.t('Cover screen'))
    );
  }

  private renderRules(): void {
    if (!this.data) return;
    const list = this.el('ruleList');
    const rules = this.data.replaceRules;
    this.el('ruleCount').textContent = rules.length ? String(rules.length) : '';
    if (rules.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'rule-empty';
      empty.textContent = OccultoI18n.t('No rules yet — add one below.');
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(...rules.map((rule) => this.buildRuleItem(rule)));
  }

  private buildRuleItem(rule: ReplaceRule): HTMLLIElement {
    const li = document.createElement('li');
    li.className = rule.enabled ? 'rule-item' : 'rule-item disabled';

    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = rule.enabled;
    enabled.setAttribute('aria-label', OccultoI18n.t('Enable rule {0}', rule.find));
    enabled.addEventListener('change', () => this.updateRule(rule.id, { enabled: enabled.checked }));

    const text = document.createElement('span');
    text.className = 'rule-text';
    text.title = `${rule.find} → ${rule.replace}`;
    const from = document.createElement('span');
    from.textContent = rule.find || OccultoI18n.t('(empty)');
    const arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.textContent = '→';
    const to = document.createElement('span');
    to.className = 'to';
    to.textContent = rule.replace || '∅';
    text.append(from, arrow, to);

    const chip = (label: string, title: string, pressed: boolean, onToggle?: () => void): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = onToggle ? 'chip' : 'chip static';
      btn.textContent = label;
      btn.title = title;
      btn.setAttribute('aria-pressed', String(pressed));
      btn.setAttribute('aria-label', title);
      if (onToggle) btn.addEventListener('click', onToggle);
      else btn.disabled = true;
      return btn;
    };

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn-ghost btn-icon';
    del.setAttribute('aria-label', OccultoI18n.t('Delete rule {0}', rule.find));
    del.appendChild(OccultoIcons.create('trash'));
    del.addEventListener('click', () => this.deleteRule(rule.id));

    li.append(
      enabled,
      text,
      chip('Aa', OccultoI18n.t('Case sensitive'), rule.caseSensitive, () =>
        this.updateRule(rule.id, { caseSensitive: !rule.caseSensitive })
      ),
      chip('W', OccultoI18n.t('Whole word'), rule.wholeWord, () => this.updateRule(rule.id, { wholeWord: !rule.wholeWord }))
    );
    if (rule.isRegex) li.appendChild(chip('.*', OccultoI18n.t('Regular expression (edit in full settings)'), true));
    li.appendChild(del);
    return li;
  }

  private scheduleStats(): void {
    window.clearTimeout(this.statsTimer);
    // The content script reprocesses synchronously on the same change event.
    this.statsTimer = window.setTimeout(() => void this.refreshStats(), 250);
  }

  private async refreshStats(): Promise<void> {
    const box = this.el('stats');
    const note = (icon: string, message: string): void => {
      const span = document.createElement('span');
      span.className = 'note';
      span.append(OccultoIcons.create(icon), document.createTextNode(message));
      box.replaceChildren(span);
    };
    if (this.tabId === undefined || this.host === null) {
      note('info', OccultoI18n.t('Not available on this page'));
      return;
    }
    let stats: OccultoPageStats | undefined;
    try {
      stats = (await chrome.tabs.sendMessage(this.tabId, { type: 'occulto:stats' }, { frameId: 0 })) as OccultoPageStats | undefined;
    } catch {
      stats = undefined;
    }
    if (!stats) {
      note('alert', OccultoI18n.t('Reload this page to apply Occulto'));
      return;
    }
    if (!stats.active) {
      note('pause', OccultoI18n.t('Nothing hidden — Occulto is not running here'));
      return;
    }
    const pill = (cls: string, icon: string, n: number, label: string): HTMLSpanElement => {
      const span = document.createElement('span');
      span.className = `stat ${cls}`;
      span.append(OccultoIcons.create(icon), document.createTextNode(`${n} ${label}`));
      return span;
    };
    box.replaceChildren(
      pill('stat-blur', 'eyeOff', stats.blurred, OccultoI18n.t('blurred')),
      pill('stat-scramble', 'shuffle', stats.scrambled, OccultoI18n.t('scrambled')),
      pill('stat-replace', 'replace', stats.replaced, OccultoI18n.t('replaced'))
    );
  }

  private async renderShortcut(): Promise<void> {
    try {
      const commands = await chrome.commands.getAll();
      const shortcut = commands.find((c) => c.name === 'toggle-occulto')?.shortcut;
      this.el('shortcutKey').textContent = shortcut || OccultoI18n.t('not set');
      this.el('panicKey').textContent = commands.find((c) => c.name === 'panic-cover')?.shortcut || OccultoI18n.t('not set');
    } catch {
      this.el('shortcutKey').textContent = OccultoI18n.t('not set');
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new OccultoPopup();
});
