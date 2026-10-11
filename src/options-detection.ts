// Detection rules editor: four editable lists (selectors, patterns and their
// exceptions) plus the raw JSON editor for advanced use.

interface OptionsListField<T> {
  placeholder: string;
  label: string;
  className: string;
  get(item: T): string;
  set(item: T, value: string): T;
}

interface OptionsListToggle<T> {
  text: string;
  label: string; // tooltip + accessible name
  get(item: T): boolean;
  set(item: T, on: boolean): T;
}

interface OptionsListSpec<T> {
  title: string;
  description: string;
  read(): T[]; // current items (read at commit time, never a stale copy)
  blank: T;
  fields: OptionsListField<T>[];
  toggles?: OptionsListToggle<T>[];
  badge?(item: T): string | null; // read-only note shown next to the toggles
  isEmpty(item: T): boolean;
  validate(item: T): string | null;
  describe(item: T): string;
  save(next: T[], options?: { message?: string; rerender?: boolean }): void;
}

class OptionsDetectionSection implements OptionsSection {
  private readonly section = OptionsUI.el('detection');
  private readonly lists = OptionsUI.el('detectionLists');
  private readonly editor = OptionsUI.el<HTMLTextAreaElement>('configEditor');
  private pendingExternal: Config | null = null;
  private static readonly VALIDATOR_LABELS: Record<PatternValidator, string> = {
    luhn: 'Luhn',
    iban: OccultoI18n.t('IBAN mod-97'),
    nir: OccultoI18n.t('NIR key'),
  };

  constructor(private readonly ctx: OptionsContext) {
    OptionsUI.el('saveConfigBtn').addEventListener('click', () => this.saveJson());
    OptionsUI.el('resetConfigBtn').addEventListener('click', () => void this.resetDefaults());
    OptionsUI.el('importConfigBtn').addEventListener('click', () => void this.importJson());
    OptionsUI.el('exportConfigBtn').addEventListener('click', () =>
      OptionsUI.download('occulto-detection.json', this.config)
    );
    this.section.addEventListener('focusout', () => {
      window.setTimeout(() => {
        if (this.pendingExternal && !this.section.contains(document.activeElement)) {
          this.ctx.data.config = this.pendingExternal;
          this.pendingExternal = null;
          this.render();
        }
      }, 0);
    });
    this.render();
  }

  private get config(): Config {
    return this.ctx.data.config;
  }

  onExternalChange(changes: { [key: string]: chrome.storage.StorageChange }): void {
    const incoming = changes.config?.newValue as Config | undefined;
    if (!incoming || JSON.stringify(incoming) === JSON.stringify(this.config)) return;
    if (this.section.contains(document.activeElement)) {
      this.pendingExternal = incoming; // never rebuild under the cursor
      return;
    }
    this.ctx.data.config = incoming;
    this.render();
  }

  // rerender=false keeps focus when a row commits a value in place.
  private commit(next: Config, message?: string, rerender = true): void {
    const previous = this.config;
    this.ctx.data.config = next;
    this.pendingExternal = null;
    if (rerender) this.render();
    else this.editor.value = JSON.stringify(next, null, 2);
    this.ctx.bus.emit('settings', null);
    void this.ctx.save({ config: next }, OccultoI18n.t('save detection rules'));
    if (message) this.ctx.toast(message, { undo: () => this.commit(previous) });
  }

  // ---- validation --------------------------------------------------------

  private static validateSelector(selector: string): string | null {
    try {
      document.createDocumentFragment().querySelector(selector);
      return null;
    } catch {
      return OccultoI18n.t('Invalid CSS selector');
    }
  }

  private static validatePattern(item: RegexPattern): string | null {
    const flags = item.flags ?? '';
    if (!/^[dgimsuyv]*$/.test(flags) || new Set(flags).size !== flags.length) {
      return OccultoI18n.t('Flags may only use d g i m s u v y, once each');
    }
    try {
      new RegExp(item.pattern, flags);
      return null;
    } catch (error) {
      return (error as Error).message;
    }
  }

  private static validateConfig(value: unknown): Config {
    const config = value as Partial<Config> | null;
    if (!config || !config.version || !Array.isArray(config.selectors) || !Array.isArray(config.regex)) {
      throw new Error(OccultoI18n.t('a config needs version, selectors[] and regex[]'));
    }
    return config as Config;
  }

  // ---- rendering ---------------------------------------------------------

  private render(): void {
    const selectorFields: OptionsListField<string>[] = [
      {
        placeholder: '.secret, [data-private]',
        label: OccultoI18n.t('CSS selector'),
        className: 'grow mono',
        get: (s) => s,
        set: (_s, v) => v,
      },
    ];
    const patternFields: OptionsListField<RegexPattern>[] = [
      {
        placeholder: OccultoI18n.t('Name'),
        label: OccultoI18n.t('Pattern name'),
        className: 'name',
        get: (p) => p.name ?? '',
        set: (p, v) => ({ ...p, name: v || undefined }),
      },
      {
        placeholder: OccultoI18n.t('Regular expression'),
        label: OccultoI18n.t('Pattern'),
        className: 'grow mono',
        get: (p) => p.pattern,
        set: (p, v) => ({ ...p, pattern: v }),
      },
    ];
    // Regex flags as plain-language toggles. "g" is always added by the
    // engine, so it is not shown; rare flags (d, y, v) are kept untouched.
    const flagToggle = (flag: string, text: string, label: string, invert = false): OptionsListToggle<RegexPattern> => ({
      text,
      label,
      get: (p) => (p.flags ?? '').includes(flag) !== invert,
      set: (p, on) => {
        const flags = (p.flags ?? '').replace(flag, '') + (on !== invert ? flag : '');
        return { ...p, flags: flags || undefined };
      },
    });
    const patternToggles: OptionsListToggle<RegexPattern>[] = [
      flagToggle('i', OccultoI18n.t('Match case'), OccultoI18n.t('Match case: “Acme” does not match “acme” (off = ignore case, flag i)'), true),
      flagToggle('m', OccultoI18n.t('Multiline'), OccultoI18n.t('Multiline: ^ and $ match at the start/end of every line (flag m)')),
      flagToggle('s', OccultoI18n.t('Dot = newline'), OccultoI18n.t('Dot matches newline: “.” also matches line breaks (flag s)')),
      flagToggle('u', OccultoI18n.t('Unicode'), 'Unicode: needed for \\p{…} classes and emoji (flag u)'),
    ];
    const selectorSpec = (
      title: string,
      description: string,
      read: () => string[],
      write: (next: string[]) => Config
    ): OptionsListSpec<string> => ({
      title,
      description,
      read,
      blank: '',
      fields: selectorFields,
      isEmpty: (s) => s.trim() === '',
      validate: (s) => OptionsDetectionSection.validateSelector(s),
      describe: (s) => s,
      save: (next, o) => this.commit(write(next), o?.message, o?.rerender ?? true),
    });
    const patternSpec = (
      title: string,
      description: string,
      read: () => RegexPattern[],
      write: (next: RegexPattern[]) => Config
    ): OptionsListSpec<RegexPattern> => ({
      title,
      description,
      read,
      blank: { pattern: '', flags: 'gi' },
      fields: patternFields,
      toggles: patternToggles,
      badge: (p) => (p.validator ? OccultoI18n.t('Checksum: {0}', OptionsDetectionSection.VALIDATOR_LABELS[p.validator]) : null),
      isEmpty: (p) => p.pattern === '',
      validate: (p) => OptionsDetectionSection.validatePattern(p),
      describe: (p) => p.name || p.pattern,
      save: (next, o) => this.commit(write(next), o?.message, o?.rerender ?? true),
    });

    this.renderLibrary();
    this.lists.replaceChildren(
      this.buildList(
        patternSpec(
          OccultoI18n.t('Text patterns'),
          OccultoI18n.t('Matches inside page text are blurred or scrambled.'),
          () => this.config.regex,
          (regex) => ({ ...this.config, regex })
        )
      ),
      this.buildList(
        selectorSpec(
          OccultoI18n.t('Sensitive elements'),
          OccultoI18n.t('Whole elements matching these CSS selectors are hidden.'),
          () => this.config.selectors,
          (selectors) => ({ ...this.config, selectors })
        )
      ),
      this.buildList(
        patternSpec(
          OccultoI18n.t('Never hide text matching'),
          OccultoI18n.t('A text node matching one of these is left alone (replace rules still apply).'),
          () => this.config.ignore?.regex ?? [],
          (regex) => ({ ...this.config, ignore: { ...this.config.ignore, regex } })
        )
      ),
      this.buildList(
        selectorSpec(
          OccultoI18n.t('Never hide inside'),
          OccultoI18n.t('Nothing inside elements matching these selectors is hidden.'),
          () => this.config.ignore?.selectors ?? [],
          (selectors) => ({ ...this.config, ignore: { ...this.config.ignore, selectors } })
        )
      )
    );
    this.editor.value = JSON.stringify(this.config, null, 2);
  }

  private buildList<T>(spec: OptionsListSpec<T>): HTMLElement {
    const block = document.createElement('div');
    block.className = 'det-block';
    const head = document.createElement('div');
    head.className = 'det-head';
    const titles = document.createElement('div');
    titles.append(OptionsUI.text('h3', spec.title), OptionsUI.text('p', spec.description, 'muted small'));
    const rows = document.createElement('div');
    rows.className = 'det-rows';
    const addBtn = OptionsUI.button(OccultoI18n.t('Add'), {
      icon: 'plus',
      variant: 'btn-secondary btn-sm',
      onClick: () => {
        const row = this.buildRow(spec, spec.blank, null);
        rows.querySelector('.empty-state')?.remove();
        rows.appendChild(row);
        row.querySelector<HTMLInputElement>('input.grow')?.focus();
      },
    });
    head.append(titles, addBtn);
    const items = spec.read();
    if (items.length === 0) rows.appendChild(OptionsUI.text('p', OccultoI18n.t('Nothing here yet.'), 'empty-state'));
    items.forEach((item, index) => rows.appendChild(this.buildRow(spec, item, index)));
    block.append(head, rows);
    return block;
  }

  // index === null marks a draft row that is not saved until filled in.
  private buildRow<T>(spec: OptionsListSpec<T>, item: T, rowIndex: number | null): HTMLElement {
    let index = rowIndex;
    const row = document.createElement('div');
    row.className = 'det-row';
    const msg = document.createElement('div');
    msg.className = 'rule-msg error';
    msg.setAttribute('role', 'alert');
    let current = item;
    const inputs: HTMLInputElement[] = [];
    const showValidity = (): void => {
      const error = spec.isEmpty(current) ? null : spec.validate(current);
      msg.textContent = error ?? '';
      for (const input of inputs) input.setAttribute('aria-invalid', String(error !== null));
    };
    const commit = (): void => {
      const next = [...spec.read()];
      if (spec.isEmpty(current)) {
        if (index === null) return; // empty draft: nothing to save
        next.splice(index, 1);
        spec.save(next); // indexes shift: rebuild
        return;
      }
      if (index === null) {
        next.push(current);
        index = next.length - 1;
      } else {
        next[index] = current;
      }
      spec.save(next, { rerender: false });
    };
    const fields = document.createElement('div');
    fields.className = 'det-fields';
    for (const field of spec.fields) {
      const input = OptionsUI.textInput({
        value: field.get(item),
        placeholder: field.placeholder,
        label: field.label,
        onInput: (v) => {
          current = field.set(current, v);
          showValidity();
        },
        onCommit: commit,
      });
      input.className = `input ${field.className}`;
      inputs.push(input);
      fields.appendChild(input);
    }
    fields.appendChild(
      OptionsUI.iconButton('trash', OccultoI18n.t('Delete {0}', spec.describe(current) || OccultoI18n.t('entry')), () => {
        if (index === null) {
          row.remove();
          return;
        }
        const removed = index;
        spec.save(
          spec.read().filter((_, i) => i !== removed),
          { message: OccultoI18n.t('Removed “{0}”', spec.describe(current)) }
        );
      })
    );
    row.append(fields);
    const badge = spec.badge?.(item) ?? null;
    if (spec.toggles || badge) {
      const toggles = document.createElement('div');
      toggles.className = 'det-flags';
      for (const toggle of spec.toggles ?? []) {
        toggles.appendChild(
          OptionsUI.chip(toggle.text, toggle.label, toggle.get(item), (on) => {
            current = toggle.set(current, on);
            showValidity();
            commit();
          })
        );
      }
      if (badge) toggles.appendChild(OptionsUI.text('span', badge, 'chip static check-badge'));
      row.appendChild(toggles);
    }
    row.appendChild(msg);
    showValidity();
    return row;
  }

  // ---- pattern library ---------------------------------------------------

  private renderLibrary(): void {
    const box = OptionsUI.el('patternLibrary');
    const enabled = OCCULTO_PRESETS.filter((p) => OccultoLibrary.isEnabled(this.config, p)).length;
    const summary = document.createElement('summary');
    summary.append(
      OccultoIcons.create('sparkles'),
      OptionsUI.text('span', OccultoI18n.t('Pattern library'), 'lib-title'),
      OptionsUI.text('span', OccultoI18n.t('{0} of {1} enabled', enabled, OCCULTO_PRESETS.length), 'count')
    );
    const intro = OptionsUI.text(
      'p',
      OccultoI18n.t('Ready-made patterns you can switch on. “May over-match” ones can also hide harmless text; checksum ones only hide values that pass a validity check.'),
      'muted small'
    );
    const groups = OccultoLibrary.categories.map((category) => {
      const group = document.createElement('div');
      group.className = 'lib-group';
      const grid = document.createElement('div');
      grid.className = 'lib-grid';
      for (const preset of OCCULTO_PRESETS.filter((p) => p.category === category)) {
        grid.appendChild(this.buildPreset(preset));
      }
      group.append(OptionsUI.text('h4', OccultoI18n.t(category)), grid);
      return group;
    });
    box.replaceChildren(summary, intro, ...groups);
  }

  private buildPreset(preset: OccultoPreset): HTMLElement {
    const on = OccultoLibrary.isEnabled(this.config, preset);
    const item = document.createElement('label');
    item.className = on ? 'lib-item on' : 'lib-item';
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.className = 'switch';
    toggle.setAttribute('role', 'switch');
    toggle.checked = on;
    toggle.dataset.preset = preset.id;
    toggle.addEventListener('change', () => {
      const next = toggle.checked
        ? OccultoLibrary.enable(this.config, preset)
        : OccultoLibrary.disable(this.config, preset);
      this.commit(next, toggle.checked ? OccultoI18n.t('{0} detection enabled', OccultoI18n.t(preset.name)) : OccultoI18n.t('{0} detection disabled', OccultoI18n.t(preset.name)));
      OptionsUI.el('patternLibrary').querySelector<HTMLInputElement>(`[data-preset="${preset.id}"]`)?.focus();
    });
    const body = document.createElement('div');
    body.className = 'lib-body';
    const title = document.createElement('div');
    title.className = 'lib-name';
    title.appendChild(OptionsUI.text('strong', OccultoI18n.t(preset.name)));
    if (preset.validator) title.appendChild(OptionsUI.text('span', OccultoI18n.t('checksum'), 'tag tag-ok'));
    if (preset.noisy) title.appendChild(OptionsUI.text('span', OccultoI18n.t('may over-match'), 'tag tag-warn'));
    body.append(
      title,
      OptionsUI.text('span', OccultoI18n.t(preset.description), 'muted small'),
      OptionsUI.text('code', preset.expect ?? preset.sample, 'lib-sample')
    );
    item.append(toggle, body);
    return item;
  }

  // ---- advanced JSON -----------------------------------------------------

  private saveJson(): void {
    try {
      this.commit(OptionsDetectionSection.validateConfig(JSON.parse(this.editor.value)));
      this.ctx.toast(OccultoI18n.t('Detection rules saved'));
    } catch (error) {
      this.ctx.toast(OccultoI18n.t('Invalid JSON: {0}', (error as Error).message), { kind: 'error' });
    }
  }

  private async resetDefaults(): Promise<void> {
    if (!confirm(OccultoI18n.t('Replace all detection rules with the defaults?'))) return;
    try {
      this.commit(await OccultoStorage.loadDefaultConfig(), OccultoI18n.t('Detection rules reset to defaults'));
    } catch (error) {
      this.ctx.toast(OccultoI18n.t('Reset failed: {0}', (error as Error).message), { kind: 'error' });
    }
  }

  private async importJson(): Promise<void> {
    try {
      this.commit(OptionsDetectionSection.validateConfig(await OptionsUI.pickJson()), OccultoI18n.t('Detection rules imported'));
    } catch (error) {
      this.ctx.toast(OccultoI18n.t('Import failed: {0}', (error as Error).message), { kind: 'error' });
    }
  }
}
