// Text sandbox: renders pasted text exactly as a page would (per line ≈ per
// text node), with stats, per-fragment explanations and copy.

const OPTIONS_SANDBOX_SAMPLE = [
  'Hi team, here is the Acme Corp incident summary.',
  'Contact: jane.doe@acme.com (on-call: john.smith@example.org)',
  'Affected hosts: 192.168.10.42, 10.0.0.7 and fe80::1',
  'Ticket 123e4567-e89b-12d3-a456-426614174000 was opened by Société Générale.',
  'Call 06 12 34 56 78 · router MAC 00:1A:2B:3C:4D:5E · db01.prod.internal',
  'Refund to FR76 3000 6000 0112 3456 7890 189, card 4111 1111 1111 1111.',
].join('\n');

class OptionsSandboxSection {
  private readonly input = OptionsUI.el<HTMLTextAreaElement>('sandboxInput');
  private readonly output = OptionsUI.el('sandboxOutput');
  private readonly details = OptionsUI.el('sandboxDetails');
  private readonly replacer = new Replacer();
  private readonly scrambler = new Scrambler();
  private rules: ReplaceRule[] = [];
  private entries: Array<{ regex: RegExp; index: number }> = [];
  private fragments: RenderedFragment[] = [];
  private queued = false;

  constructor(private readonly ctx: OptionsContext) {
    this.rules = ctx.data.replaceRules;
    this.replacer.setRules(this.rules);
    ctx.bus.on('draftRules', (rules) => {
      this.rules = rules;
      this.replacer.setRules(rules);
      this.schedule();
    });
    ctx.bus.on('settings', () => {
      this.syncKey();
      this.schedule();
    });
    this.input.addEventListener('input', () => this.schedule());
    OptionsUI.el('sampleTextBtn').addEventListener('click', () => {
      this.input.value = OPTIONS_SANDBOX_SAMPLE;
      this.schedule();
    });
    OptionsUI.el<HTMLInputElement>('showHighlights').addEventListener('change', (e) => {
      this.output.classList.toggle('sbx-highlights', (e.target as HTMLInputElement).checked);
    });
    OptionsUI.el('copyResultBtn').addEventListener('click', () => void this.copy());
    this.output.addEventListener('click', (e) => this.onFragmentActivated(e.target));
    this.output.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.onFragmentActivated(e.target);
      }
    });
    this.syncKey();
    this.schedule();
  }

  private syncKey(): void {
    // setKey throws on malformed keys; the shell only stores valid ones.
    if (/^[0-9a-f]{64}$/.test(this.ctx.data.scrambleKey)) this.scrambler.setKey(this.ctx.data.scrambleKey);
  }

  private schedule(): void {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.render();
    });
  }

  private compute(): RenderedFragment[] {
    const { config, mode, scrambleSettings } = this.ctx.data;
    this.entries = OccultoPipeline.compileRegexEntries(config.regex);
    const ctx: PipelineContext = {
      censorRegexes: this.entries.map((e) => e.regex),
      ignoreRegexes: OccultoPipeline.compileRegexList(config.ignore?.regex),
      mode,
      scrambleSettings,
      replacer: this.replacer,
      scrambler: this.scrambler,
    };
    const fragments: RenderedFragment[] = [];
    for (const piece of this.input.value.split(/(\n)/)) {
      if (piece === '') continue;
      if (piece === '\n') fragments.push({ kind: 'plain', original: piece, display: piece });
      else fragments.push(...OccultoPipeline.processText(piece, ctx));
    }
    return fragments;
  }

  private render(): void {
    this.output.classList.toggle('hide-bar', this.ctx.data.hideStyle === 'bar');
    this.fragments = this.compute();
    const counts = { blurred: 0, scrambled: 0, replaced: 0 };
    const ruleMatches = new Map<string, number>();
    const nodes = this.fragments.map((fragment, i): Node => {
      if (fragment.kind === 'plain') return document.createTextNode(fragment.display);
      counts[fragment.kind]++;
      if (fragment.ruleId) ruleMatches.set(fragment.ruleId, (ruleMatches.get(fragment.ruleId) ?? 0) + 1);
      const span = document.createElement('span');
      span.className = `sbx-${fragment.kind}`;
      span.textContent = fragment.display;
      span.dataset.i = String(i);
      span.tabIndex = 0;
      span.setAttribute('role', 'button');
      span.setAttribute('aria-label', OccultoI18n.t('Show details'));
      return span;
    });
    this.output.replaceChildren(...nodes);
    if (this.fragments.length === 0) {
      this.output.appendChild(OptionsUI.text('span', OccultoI18n.t('The result appears here.'), 'muted'));
    }
    this.details.hidden = true;
    this.renderStats(counts);
    this.ctx.bus.emit('ruleMatches', ruleMatches);
  }

  private renderStats(counts: { blurred: number; scrambled: number; replaced: number }): void {
    const pill = (cls: string, icon: string, n: number, label: string): HTMLElement => {
      const span = document.createElement('span');
      span.className = `stat ${cls}`;
      span.append(OccultoIcons.create(icon), document.createTextNode(`${n} ${label}`));
      return span;
    };
    OptionsUI.el('sandboxStats').replaceChildren(
      pill('stat-blur', 'eyeOff', counts.blurred, OccultoI18n.t('blurred')),
      pill('stat-scramble', 'shuffle', counts.scrambled, OccultoI18n.t('scrambled')),
      pill('stat-replace', 'replace', counts.replaced, OccultoI18n.t('replaced'))
    );
  }

  private onFragmentActivated(target: EventTarget | null): void {
    const span = (target as HTMLElement | null)?.closest<HTMLElement>('[data-i]');
    const fragment = span ? this.fragments[Number(span.dataset.i)] : undefined;
    if (!fragment) return;
    this.details.replaceChildren(...this.describe(fragment));
    this.details.hidden = false;
  }

  private describe(fragment: RenderedFragment): Node[] {
    const line = (label: string, value: string, mono = false): HTMLElement => {
      const p = document.createElement('p');
      p.append(OptionsUI.text('strong', `${label} `), OptionsUI.text('span', value, mono ? 'mono' : ''));
      return p;
    };
    const out: Node[] = [line(OccultoI18n.t('Original:'), fragment.original, true)];
    if (fragment.kind === 'replaced') {
      const index = this.rules.findIndex((r) => r.id === fragment.ruleId);
      const rule = this.rules[index];
      const flags = rule
        ? [rule.caseSensitive && OccultoI18n.t('case sensitive'), rule.wholeWord && OccultoI18n.t('whole word'), rule.isRegex && OccultoI18n.t('regex')].filter(Boolean)
        : [];
      out.push(
        line(
          OccultoI18n.t('Replaced by:'),
          rule
            ? OccultoI18n.t('rule #{0} “{1}” → “{2}”', index + 1, rule.find, rule.replace) +
                (flags.length ? ` (${flags.join(', ')})` : '')
            : OccultoI18n.t('a replace rule')
        )
      );
      return out;
    }
    const names = (fragment.patterns ?? []).map((compiledIndex) => {
      const configIndex = this.entries[compiledIndex]?.index ?? compiledIndex;
      return (this.ctx.data.config.regex[configIndex]?.name && OccultoI18n.t(this.ctx.data.config.regex[configIndex]?.name ?? '')) || OccultoI18n.t('pattern #{0}', configIndex + 1);
    });
    out.push(line(OccultoI18n.t('Detected by:'), names.length ? names.join(', ') : OccultoI18n.t('a detection pattern')));
    const type = Scrambler.detectType(fragment.original.trim()) === 'ipv6' ? 'IPv6' : 'IPv4';
    out.push(
      line(
        OccultoI18n.t('Action:'),
        fragment.kind === 'blurred'
          ? this.ctx.data.hideStyle === 'bar'
            ? OccultoI18n.t('hidden behind a black bar (Blur mode)')
            : OccultoI18n.t('blurred (Blur mode)')
          : fragment.forced
            ? OccultoI18n.t('scrambled because “Always scramble {0}” is on', type)
            : OccultoI18n.t('scrambled with your secret key (Scramble mode)')
      )
    );
    return out;
  }

  private async copy(): Promise<void> {
    const text = OccultoPipeline.toPlainText(this.compute());
    try {
      await navigator.clipboard.writeText(text);
      this.ctx.toast(OccultoI18n.t('Result copied — blurred parts became █'));
    } catch (error) {
      this.ctx.toast(OccultoI18n.t('Copy failed: {0}', (error as Error).message), { kind: 'error' });
    }
  }
}
