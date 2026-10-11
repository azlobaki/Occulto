// Options page shell: loads state, routes storage changes to sections, and
// owns the header, navigation, General and Scramble sections.

class OccultoOptionsPage {
  private data: StorageData | null = null;
  private changedBeforeLoad = false;
  private sections: OptionsSection[] = [];
  private readonly bus = new OptionsBus();
  private readonly dirty = new Set<string>();
  private saving = 0;

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    OccultoI18n.apply();
    OccultoIcons.hydrate();
    // Listen before loading so no early change is lost.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (!this.data) this.changedBeforeLoad = true;
      else this.onStorageChanged(changes);
    });
    let data = await OccultoStorage.loadAll();
    if (this.changedBeforeLoad) data = await OccultoStorage.loadAll();
    this.data = data;

    const ctx: OptionsContext = {
      data,
      bus: this.bus,
      save: (partial, what) => this.save(partial, what),
      toast: (message, options) => OptionsToast.show(message, options),
    };
    this.bus.on('dirty', ({ source, dirty }) => {
      if (dirty) this.dirty.add(source);
      else this.dirty.delete(source);
      this.renderSaveState();
    });
    this.bindHeader();
    this.bindGeneral();
    this.bindScramble();
    this.bindNav();
    this.sections = [new OptionsRulesSection(ctx), new OptionsDetectionSection(ctx)];
    new OptionsSandboxSection(ctx); // driven by bus events only
    const flush = (): void => this.sections.forEach((s) => s.flush?.());
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    this.renderAll();
    void this.renderShortcut();
    document.body.classList.add('ready');
  }

  private async save(partial: Partial<StorageData>, what: string): Promise<boolean> {
    this.saving++;
    this.renderSaveState();
    try {
      await OccultoStorage.save(partial);
      return true;
    } catch (error) {
      console.error(`[Occulto] Failed to ${what}`, error);
      OptionsToast.show(OccultoI18n.t("Couldn't {0}: {1}", what, (error as Error).message), { kind: 'error' });
      return false;
    } finally {
      this.saving--;
      this.renderSaveState();
    }
  }

  private onStorageChanged(changes: { [key: string]: chrome.storage.StorageChange }): void {
    const data = this.data;
    if (!data) return;
    if (changes.enabled) data.enabled = changes.enabled.newValue !== false;
    if (changes.mode) data.mode = changes.mode.newValue === 'scramble' ? 'scramble' : 'blur';
    if (changes.scrambleKey && typeof changes.scrambleKey.newValue === 'string') {
      data.scrambleKey = changes.scrambleKey.newValue;
    }
    if (changes.scrambleSettings) {
      data.scrambleSettings = OccultoStorage.normalizeScrambleSettings(changes.scrambleSettings.newValue);
    }
    if (changes.pausedSites) data.pausedSites = OccultoStorage.normalizePausedSites(changes.pausedSites.newValue);
    if (changes.hideStyle) data.hideStyle = OccultoStorage.normalizeHideStyle(changes.hideStyle.newValue);
    if (changes.profiles || changes.activeProfileId) {
      Object.assign(
        data,
        OccultoStorage.normalizeProfiles(
          changes.profiles ? changes.profiles.newValue : data.profiles,
          changes.activeProfileId ? changes.activeProfileId.newValue : data.activeProfileId
        )
      );
    }
    this.sections.forEach((s) => s.onExternalChange?.(changes));
    this.renderAll();
    if (changes.mode || changes.scrambleKey || changes.scrambleSettings || changes.config || changes.hideStyle) {
      this.bus.emit('settings', null);
    }
  }

  private renderAll(): void {
    this.renderHeader();
    this.renderGeneral();
    this.renderScramble();
  }

  private renderSaveState(): void {
    const node = OptionsUI.el('saveState');
    const state = this.saving > 0 ? 'saving' : this.dirty.size > 0 ? 'dirty' : 'saved';
    node.dataset.state = state;
    node.textContent =
      state === 'saving' ? OccultoI18n.t('Saving…') : state === 'dirty' ? OccultoI18n.t('Unsaved edit — leave the field to save') : OccultoI18n.t('All changes saved');
  }

  // ---- header & navigation -----------------------------------------------

  private bindHeader(): void {
    OptionsUI.el<HTMLInputElement>('masterSwitch').addEventListener('change', (e) => {
      if (!this.data) return;
      this.data.enabled = (e.target as HTMLInputElement).checked;
      void this.save({ enabled: this.data.enabled }, OccultoI18n.t('save enabled state'));
      this.renderHeader();
    });
  }

  private renderHeader(): void {
    if (!this.data) return;
    OptionsUI.el<HTMLInputElement>('masterSwitch').checked = this.data.enabled;
    OptionsUI.el('stateText').textContent = this.data.enabled ? OccultoI18n.t('Active on every page') : OccultoI18n.t('Off on every page');
    document.body.classList.toggle('is-off', !this.data.enabled);
  }

  private bindNav(): void {
    const links = [...document.querySelectorAll<HTMLAnchorElement>('.sidenav a')];
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          for (const link of links) {
            if (link.hash === `#${entry.target.id}`) link.setAttribute('aria-current', 'true');
            else link.removeAttribute('aria-current');
          }
        }
      },
      { rootMargin: '-30% 0px -60% 0px' }
    );
    document.querySelectorAll('main > section[id]').forEach((s) => observer.observe(s));
  }

  // ---- general -----------------------------------------------------------

  private bindGeneral(): void {
    document.querySelectorAll<HTMLButtonElement>('#modeSegmented button').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.data) return;
        this.data.mode = btn.dataset.mode === 'scramble' ? 'scramble' : 'blur';
        void this.save({ mode: this.data.mode }, OccultoI18n.t('save mode'));
        this.renderGeneral();
        this.bus.emit('settings', null);
      });
    });
    document.querySelectorAll<HTMLButtonElement>('#hideStyleSegmented button').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.data) return;
        this.data.hideStyle = btn.dataset.style === 'bar' ? 'bar' : 'blur';
        void this.save({ hideStyle: this.data.hideStyle }, OccultoI18n.t('save hiding style'));
        this.renderGeneral();
        this.bus.emit('settings', null);
      });
    });
    OptionsUI.el<HTMLFormElement>('profileAddForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = OptionsUI.el<HTMLInputElement>('profileNameInput');
      const name = input.value.trim();
      if (!name) {
        input.focus();
        return;
      }
      this.sections.forEach((s) => s.flush?.());
      OccultoStorage.saveCurrentAsProfile(name)
        .then(() => {
          input.value = '';
          OptionsToast.show(OccultoI18n.t('Profile “{0}” saved and active', name));
        })
        .catch((error: Error) => OptionsToast.show(OccultoI18n.t("Couldn't save the profile: {0}", error.message), { kind: 'error' }));
    });
    OptionsUI.el<HTMLFormElement>('pausedAddForm').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!this.data) return;
      const input = OptionsUI.el<HTMLInputElement>('pausedAddInput');
      const raw = input.value.trim();
      const host = OccultoStorage.siteKey(raw.includes('://') ? raw : `https://${raw}`);
      if (!host) {
        OptionsToast.show(OccultoI18n.t('Enter a domain such as mail.example.com'), { kind: 'error' });
        return;
      }
      this.setPausedSites(OccultoStorage.normalizePausedSites([...this.data.pausedSites, host]));
      input.value = '';
    });
  }

  private setPausedSites(next: string[], message?: string): void {
    if (!this.data) return;
    const previous = this.data.pausedSites;
    this.data.pausedSites = next;
    void this.save({ pausedSites: next }, OccultoI18n.t('save paused sites'));
    this.renderGeneral();
    if (message) OptionsToast.show(message, { undo: () => this.setPausedSites(previous) });
  }

  private renderGeneral(): void {
    const data = this.data;
    if (!data) return;
    document.querySelectorAll<HTMLButtonElement>('#modeSegmented button').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.mode === data.mode));
    });
    document.querySelectorAll<HTMLButtonElement>('#hideStyleSegmented button').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.style === data.hideStyle));
    });
    this.renderProfiles();
    const list = OptionsUI.el('pausedList');
    if (data.pausedSites.length === 0) {
      list.replaceChildren(OptionsUI.text('li', OccultoI18n.t('No paused sites. Use “Pause here” in the popup.'), 'empty-state'));
      return;
    }
    list.replaceChildren(
      ...data.pausedSites.map((host) => {
        const li = document.createElement('li');
        li.className = 'paused-item';
        li.append(
          OccultoIcons.create('pause'),
          OptionsUI.text('span', host, 'grow'),
          OptionsUI.iconButton('x', OccultoI18n.t('Resume on {0}', host), () =>
            this.setPausedSites(
              data.pausedSites.filter((h) => h !== host),
              OccultoI18n.t('Resumed on {0}', host)
            )
          )
        );
        return li;
      })
    );
  }

  private renderProfiles(): void {
    const data = this.data;
    if (!data) return;
    const list = OptionsUI.el('profileList');
    if (list.contains(document.activeElement)) return; // don't rebuild under the cursor
    if (data.profiles.length === 0) {
      list.replaceChildren(OptionsUI.text('li', OccultoI18n.t('No profiles yet.'), 'empty-state'));
      return;
    }
    list.replaceChildren(
      ...data.profiles.map((profile) => {
        const active = profile.id === data.activeProfileId;
        const li = document.createElement('li');
        li.className = active ? 'paused-item profile-item active' : 'paused-item profile-item';
        const name = OptionsUI.textInput({
          value: profile.name,
          placeholder: OccultoI18n.t('Profile name'),
          label: OccultoI18n.t('Rename profile {0}', profile.name),
          onCommit: () => {
            const next = data.profiles.map((p) => (p.id === profile.id ? { ...p, name: name.value.trim() || p.name } : p));
            data.profiles = next;
            void this.save({ profiles: next }, OccultoI18n.t('rename the profile'));
          },
        });
        li.appendChild(name);
        li.appendChild(OptionsUI.text('span', '', 'grow'));
        if (active) {
          li.appendChild(OptionsUI.text('span', OccultoI18n.t('Active'), 'tag tag-active'));
        } else {
          li.appendChild(
            OptionsUI.button(OccultoI18n.t('Switch'), {
              icon: 'replace',
              variant: 'btn-secondary btn-sm',
              onClick: () => {
                this.sections.forEach((s) => s.flush?.());
                OccultoStorage.switchProfile(profile.id)
                  .then(() => OptionsToast.show(OccultoI18n.t('Switched to “{0}”', profile.name)))
                  .catch((error: Error) => OptionsToast.show(OccultoI18n.t("Couldn't switch: {0}", error.message), { kind: 'error' }));
              },
            })
          );
        }
        li.appendChild(
          OptionsUI.iconButton('trash', OccultoI18n.t('Delete profile {0}', profile.name), () => {
            const previous = { profiles: data.profiles, activeProfileId: data.activeProfileId };
            const next = {
              profiles: data.profiles.filter((p) => p.id !== profile.id),
              activeProfileId: active ? null : data.activeProfileId,
            };
            Object.assign(data, next);
            void this.save(next, OccultoI18n.t('delete the profile'));
            this.renderGeneral();
            OptionsToast.show(OccultoI18n.t('Profile “{0}” deleted (current settings kept)', profile.name), {
              undo: () => {
                Object.assign(data, previous);
                void this.save(previous, OccultoI18n.t('restore the profile'));
                this.renderGeneral();
              },
            });
          })
        );
        return li;
      })
    );
  }

  private async renderShortcut(): Promise<void> {
    try {
      const commands = await chrome.commands.getAll();
      OptionsUI.el('shortcutKey').textContent =
        commands.find((c) => c.name === 'toggle-occulto')?.shortcut || OccultoI18n.t('not set');
    } catch {
      OptionsUI.el('shortcutKey').textContent = OccultoI18n.t('not set');
    }
  }

  // ---- scramble ----------------------------------------------------------

  private bindScramble(): void {
    OptionsUI.el('resetKeyBtn').addEventListener('click', () => {
      if (!confirm(OccultoI18n.t('Reset the scramble key? Text scrambled with the current key will no longer match.'))) return;
      OccultoStorage.resetScrambleKey()
        .then(() => OptionsToast.show(OccultoI18n.t('New scramble key generated')))
        .catch((error: Error) => OptionsToast.show(OccultoI18n.t("Couldn't reset the key: {0}", error.message), { kind: 'error' }));
    });
    for (const key of ['rotateKeyOnStartup', 'alwaysScrambleIPv4', 'alwaysScrambleIPv6'] as const) {
      OptionsUI.el<HTMLInputElement>(key).addEventListener('change', (e) => {
        if (!this.data) return;
        this.data.scrambleSettings = { ...this.data.scrambleSettings, [key]: (e.target as HTMLInputElement).checked };
        void this.save({ scrambleSettings: this.data.scrambleSettings }, OccultoI18n.t('save scramble settings'));
        this.bus.emit('settings', null);
      });
    }
  }

  private renderScramble(): void {
    if (!this.data) return;
    OptionsUI.el('keyFingerprint').textContent = OccultoCrypto.fingerprint(this.data.scrambleKey);
    const s = this.data.scrambleSettings;
    OptionsUI.el<HTMLInputElement>('rotateKeyOnStartup').checked = s.rotateKeyOnStartup;
    OptionsUI.el<HTMLInputElement>('alwaysScrambleIPv4').checked = s.alwaysScrambleIPv4;
    OptionsUI.el<HTMLInputElement>('alwaysScrambleIPv6').checked = s.alwaysScrambleIPv6;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new OccultoOptionsPage();
});
