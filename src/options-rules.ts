// Replace-rules editor: inline editing, drag & drop, filter, bulk actions,
// sandbox match badges, duplicate warnings, undo.

class OptionsRulesSection implements OptionsSection {
  private readonly list = OptionsUI.el('rulesList');
  private readonly filterInput = OptionsUI.el<HTMLInputElement>('rulesFilter');
  private readonly selectAll = OptionsUI.el<HTMLInputElement>('rulesSelectAll');
  private readonly selected = new Set<string>();
  private matches = new Map<string, number>();
  // Text edits persist on commit (blur/Enter) so half-typed rules never reach
  // open tabs; savePending marks an unsaved local edit.
  private savePending = false;
  private inFlight = 0;
  private pendingExternal: ReplaceRule[] | null = null;
  private dragId: string | null = null;

  constructor(private readonly ctx: OptionsContext) {
    OptionsUI.el('addRuleBtn').addEventListener('click', () => this.add());
    OptionsUI.el('exportRulesBtn').addEventListener('click', () =>
      OptionsUI.download('occulto-rules.json', { replaceRules: this.rules })
    );
    OptionsUI.el('importRulesBtn').addEventListener('click', () => void this.importRules());
    this.filterInput.addEventListener('input', () => this.render());
    this.selectAll.addEventListener('change', () => {
      for (const rule of this.visibleRules()) {
        if (this.selectAll.checked) this.selected.add(rule.id);
        else this.selected.delete(rule.id);
      }
      this.render();
    });
    OptionsUI.el('bulkEnableBtn').addEventListener('click', () => this.bulkSetEnabled(true));
    OptionsUI.el('bulkDisableBtn').addEventListener('click', () => this.bulkSetEnabled(false));
    OptionsUI.el('bulkDeleteBtn').addEventListener('click', () => this.bulkDelete());
    this.list.addEventListener('focusout', () => {
      window.setTimeout(() => {
        if (this.pendingExternal && !this.list.contains(document.activeElement)) {
          this.rules = this.pendingExternal;
          this.pendingExternal = null;
          this.render();
          this.publish();
        }
      }, 0);
    });
    ctx.bus.on('ruleMatches', (matches) => {
      this.matches = matches;
      this.updateBadges();
    });
    this.render();
    this.publish();
  }

  private get rules(): ReplaceRule[] {
    return this.ctx.data.replaceRules;
  }

  private set rules(value: ReplaceRule[]) {
    this.ctx.data.replaceRules = value;
  }

  onExternalChange(changes: { [key: string]: chrome.storage.StorageChange }): void {
    if (!changes.replaceRules) return;
    const raw: unknown = changes.replaceRules.newValue;
    const incoming = Array.isArray(raw)
      ? raw.map((r: unknown) => OccultoStorage.normalizeReplaceRule(r)).filter((r): r is ReplaceRule => r !== null)
      : [];
    // While this page has unsaved or in-flight edits its state wins (last writer).
    if (this.savePending || this.inFlight > 0) return;
    if (JSON.stringify(incoming) === JSON.stringify(this.rules)) return; // own echo
    if (this.list.contains(document.activeElement)) {
      this.pendingExternal = incoming; // never rebuild under the cursor
      return;
    }
    this.rules = incoming;
    this.render();
    this.publish();
  }

  flush(): void {
    if (this.savePending) this.saveNow();
  }

  // ---- state -------------------------------------------------------------

  private publish(): void {
    this.ctx.bus.emit('draftRules', this.rules);
  }

  private setPending(pending: boolean): void {
    this.savePending = pending;
    this.ctx.bus.emit('dirty', { source: 'rules', dirty: pending });
  }

  private saveNow(): void {
    this.setPending(false);
    this.pendingExternal = null;
    this.inFlight++;
    void this.ctx.save({ replaceRules: this.rules }, OccultoI18n.t('save rules')).finally(() => {
      this.inFlight--;
    });
  }

  // Replaces the whole list, re-renders and saves; optional undo toast.
  private commit(next: ReplaceRule[], message?: string): void {
    const previous = this.rules;
    this.rules = next;
    for (const id of [...this.selected]) if (!next.some((r) => r.id === id)) this.selected.delete(id);
    this.render();
    this.publish();
    this.saveNow();
    if (message) this.ctx.toast(message, { undo: () => this.commit(previous) });
  }

  private edited(persistNow: boolean): void {
    this.pendingExternal = null; // the user's newer state wins
    this.publish();
    this.refreshRowStates();
    this.setPending(true);
    if (persistNow) this.saveNow();
  }

  // ---- actions -----------------------------------------------------------

  private add(): void {
    const rule = OccultoStorage.createReplaceRule();
    this.filterInput.value = '';
    this.commit([...this.rules, rule]);
    this.list.querySelector<HTMLInputElement>(`[data-rule-id="${rule.id}"] input[data-field="find"]`)?.focus();
  }

  private move(id: string, delta: number): void {
    const index = this.rules.findIndex((r) => r.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= this.rules.length) return;
    const next = [...this.rules];
    [next[index], next[target]] = [next[target], next[index]];
    this.commit(next);
    this.list.querySelector<HTMLButtonElement>(`[data-rule-id="${id}"] [data-move="${delta}"]`)?.focus();
  }

  private moveTo(id: string, targetId: string, after: boolean): void {
    const moving = this.rules.find((r) => r.id === id);
    if (!moving || id === targetId) return;
    const next = this.rules.filter((r) => r.id !== id);
    const targetIndex = next.findIndex((r) => r.id === targetId);
    next.splice(after ? targetIndex + 1 : targetIndex, 0, moving);
    this.commit(next);
  }

  private remove(id: string): void {
    const rule = this.rules.find((r) => r.id === id);
    this.commit(
      this.rules.filter((r) => r.id !== id),
      OccultoI18n.t('Rule “{0}” deleted', rule?.find || OccultoI18n.t('empty'))
    );
  }

  private bulkSetEnabled(enabled: boolean): void {
    this.commit(this.rules.map((r) => (this.selected.has(r.id) ? { ...r, enabled } : r)));
  }

  private bulkDelete(): void {
    const count = this.selected.size;
    this.commit(
      this.rules.filter((r) => !this.selected.has(r.id)),
      count > 1 ? OccultoI18n.t('{0} rules deleted', count) : OccultoI18n.t('1 rule deleted')
    );
  }

  private async importRules(): Promise<void> {
    try {
      const parsed = await OptionsUI.pickJson();
      const list: unknown = Array.isArray(parsed) ? parsed : (parsed as { replaceRules?: unknown } | null)?.replaceRules;
      if (!Array.isArray(list)) throw new Error(OccultoI18n.t('expected {"replaceRules": [...]} or an array of rules'));
      const imported = list
        .map((raw: unknown) => OccultoStorage.normalizeReplaceRule(raw))
        .filter((r): r is ReplaceRule => r !== null)
        // Fresh ids avoid collisions with existing rules.
        .map((r) => OccultoStorage.createReplaceRule({ ...r, id: undefined }));
      this.commit([...this.rules, ...imported], imported.length === 1 ? OccultoI18n.t('Imported 1 rule') : OccultoI18n.t('Imported {0} rules', imported.length));
    } catch (error) {
      this.ctx.toast(OccultoI18n.t('Import failed: {0}', (error as Error).message), { kind: 'error' });
    }
  }

  // ---- rendering ---------------------------------------------------------

  private filterText(): string {
    return this.filterInput.value.trim().toLowerCase();
  }

  private visibleRules(): ReplaceRule[] {
    const filter = this.filterText();
    if (!filter) return this.rules;
    return this.rules.filter(
      (r) => r.find.toLowerCase().includes(filter) || r.replace.toLowerCase().includes(filter)
    );
  }

  private render(): void {
    const visible = this.visibleRules();
    const filtered = this.filterText() !== '';
    OptionsUI.el('rulesCount').textContent = filtered
      ? OccultoI18n.t('{0} of {1}', visible.length, this.rules.length)
      : String(this.rules.length);
    if (visible.length === 0) {
      const empty = OptionsUI.text(
        'p',
        filtered ? OccultoI18n.t('No rule matches this filter.') : OccultoI18n.t('No replace rules yet. Add one to swap names, clients or projects on every page.'),
        'empty-state'
      );
      this.list.replaceChildren(empty);
    } else {
      this.list.replaceChildren(...visible.map((rule) => this.buildRow(rule, filtered)));
    }
    this.updateBulk(visible);
    this.refreshRowStates();
    this.updateBadges();
  }

  private buildRow(rule: ReplaceRule, filtered: boolean): HTMLElement {
    const index = this.rules.indexOf(rule);
    const n = index + 1;
    const row = document.createElement('div');
    row.className = 'rule-row';
    row.dataset.ruleId = rule.id;

    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.title = filtered ? OccultoI18n.t('Clear the filter to reorder') : OccultoI18n.t('Drag to reorder');
    handle.appendChild(OccultoIcons.create('grip'));
    handle.addEventListener('mousedown', () => {
      row.draggable = !filtered;
    });
    // A press on the handle without dragging must not leave the row draggable
    // (it would hijack text selection in its inputs).
    handle.addEventListener('mouseup', () => {
      row.draggable = false;
    });
    this.bindDrag(row, rule.id);

    const select = document.createElement('input');
    select.type = 'checkbox';
    select.className = 'row-select';
    select.checked = this.selected.has(rule.id);
    select.setAttribute('aria-label', OccultoI18n.t('Select rule {0}', n));
    select.addEventListener('change', () => {
      if (select.checked) this.selected.add(rule.id);
      else this.selected.delete(rule.id);
      this.updateBulk(this.visibleRules());
    });

    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.className = 'switch';
    enabled.setAttribute('role', 'switch');
    enabled.checked = rule.enabled;
    enabled.setAttribute('aria-label', OccultoI18n.t('Rule {0} enabled', n));
    enabled.addEventListener('change', () => {
      rule.enabled = enabled.checked;
      this.edited(true);
    });

    const commitText = (): void => {
      if (this.savePending) this.saveNow();
    };
    const find = OptionsUI.textInput({
      value: rule.find,
      placeholder: OccultoI18n.t('Find…'),
      label: OccultoI18n.t('Rule {0} find', n),
      mono: true,
      onInput: (v) => {
        rule.find = v;
        this.edited(false);
      },
      onCommit: commitText,
    });
    find.dataset.field = 'find';
    const replace = OptionsUI.textInput({
      value: rule.replace,
      placeholder: OccultoI18n.t('Replace with…'),
      label: OccultoI18n.t('Rule {0} replacement', n),
      mono: true,
      onInput: (v) => {
        rule.replace = v;
        this.edited(false);
      },
      onCommit: commitText,
    });

    const chips = document.createElement('div');
    chips.className = 'rule-chips';
    chips.append(
      OptionsUI.chip('Aa', OccultoI18n.t('Case sensitive'), rule.caseSensitive, (v) => {
        rule.caseSensitive = v;
        this.edited(true);
      }),
      OptionsUI.chip('W', OccultoI18n.t('Whole word'), rule.wholeWord, (v) => {
        rule.wholeWord = v;
        this.edited(true);
      }),
      OptionsUI.chip('.*', OccultoI18n.t('Regular expression ($1, $& and $<name> in the replacement)'), rule.isRegex, (v) => {
        rule.isRegex = v;
        this.edited(true);
      })
    );

    const badge = OptionsUI.text('span', '', 'match-badge');
    badge.title = OccultoI18n.t('Matches in the text sandbox');

    const up = OptionsUI.iconButton('up', OccultoI18n.t('Move rule {0} up', n), () => this.move(rule.id, -1), filtered || index === 0);
    up.dataset.move = '-1';
    const down = OptionsUI.iconButton(
      'down',
      OccultoI18n.t('Move rule {0} down', n),
      () => this.move(rule.id, 1),
      filtered || index === this.rules.length - 1
    );
    down.dataset.move = '1';

    const main = document.createElement('div');
    main.className = 'rule-main';
    main.append(
      handle,
      select,
      enabled,
      OptionsUI.text('span', `#${n}`, 'rule-index'),
      find,
      OptionsUI.text('span', '→', 'rule-arrow'),
      replace,
      chips,
      badge,
      up,
      down,
      OptionsUI.iconButton('trash', OccultoI18n.t('Delete rule {0}', n), () => this.remove(rule.id))
    );
    const msg = document.createElement('div');
    msg.className = 'rule-msg';
    row.append(main, msg);
    return row;
  }

  private bindDrag(row: HTMLElement, id: string): void {
    const clear = (): void => row.classList.remove('drop-before', 'drop-after');
    row.addEventListener('dragstart', (e) => {
      this.dragId = id;
      row.classList.add('dragging');
      e.dataTransfer?.setData('text/plain', id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', () => {
      this.dragId = null;
      row.draggable = false;
      row.classList.remove('dragging');
    });
    row.addEventListener('dragover', (e) => {
      if (!this.dragId || this.dragId === id) return;
      e.preventDefault();
      const rect = row.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      row.classList.toggle('drop-after', after);
      row.classList.toggle('drop-before', !after);
    });
    row.addEventListener('dragleave', clear);
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      const after = row.classList.contains('drop-after');
      clear();
      if (this.dragId) this.moveTo(this.dragId, id, after);
    });
  }

  private updateBulk(visible: ReplaceRule[]): void {
    const count = this.selected.size;
    OptionsUI.el('rulesBulk').hidden = count === 0;
    OptionsUI.el('rulesSelectedCount').textContent = OccultoI18n.t('{0} selected', count);
    const visibleSelected = visible.filter((r) => this.selected.has(r.id)).length;
    this.selectAll.checked = visible.length > 0 && visibleSelected === visible.length;
    this.selectAll.indeterminate = visibleSelected > 0 && visibleSelected < visible.length;
  }

  // Validation errors, duplicate warnings and disabled styling for every row.
  private refreshRowStates(): void {
    const firstSeen = new Map<string, number>();
    const duplicateOf = new Map<string, number>();
    this.rules.forEach((rule, index) => {
      if (!rule.enabled || rule.find === '') return;
      const key = JSON.stringify([rule.find, rule.caseSensitive, rule.wholeWord, rule.isRegex]);
      const first = firstSeen.get(key);
      if (first === undefined) firstSeen.set(key, index);
      else duplicateOf.set(rule.id, first + 1);
    });
    for (const row of this.list.querySelectorAll<HTMLElement>('.rule-row')) {
      const rule = this.rules.find((r) => r.id === row.dataset.ruleId);
      if (!rule) continue;
      const error = Replacer.validate(rule);
      const dup = duplicateOf.get(rule.id);
      row.classList.toggle('is-disabled', !rule.enabled);
      row.querySelector('input[data-field="find"]')?.setAttribute('aria-invalid', String(error !== null));
      const msg = row.querySelector<HTMLElement>('.rule-msg');
      if (!msg) continue;
      msg.className = error ? 'rule-msg error' : dup ? 'rule-msg warn' : 'rule-msg';
      msg.textContent = error ?? (dup ? OccultoI18n.t('Same search as rule #{0}, which runs first — this one never matches.', dup) : '');
      msg.setAttribute('role', error ? 'alert' : 'note');
    }
  }

  private updateBadges(): void {
    for (const row of this.list.querySelectorAll<HTMLElement>('.rule-row')) {
      const badge = row.querySelector<HTMLElement>('.match-badge');
      if (!badge) continue;
      const count = this.matches.get(row.dataset.ruleId ?? '') ?? 0;
      badge.textContent = count ? `${count}×` : '';
      badge.style.visibility = count === 0 ? 'hidden' : ''; // keeps its slot so rows stay aligned
    }
  }
}
