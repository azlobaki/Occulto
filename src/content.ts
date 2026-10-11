// Types are declared in types.ts (shared global scope, module: None)

// Attributes shown as tooltips / labels on screen.
const OCCULTO_ATTRS = ['title', 'alt', 'placeholder', 'aria-label'];
const OCCULTO_ATTR_SELECTOR = OCCULTO_ATTRS.map((a) => `[${a}]`).join(',');
const OCCULTO_TEXT_INPUTS =
  'textarea, input:not([type]), input[type="text"], input[type="email"], input[type="search"], input[type="tel"], input[type="url"], input[type="number"]';
// Never touch text inside these (not rendered, or would change form values).
const OCCULTO_SKIP_TAGS = new Set(['script', 'style', 'noscript', 'title', 'textarea', 'template']);
// Inline formatting elements: a sensitive value may be split across them.
const OCCULTO_INLINE_TAGS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'dfn', 'em', 'font', 'i', 'kbd', 'label',
  'mark', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var',
]);

class OccultoContentScript {
  private config: Config | null = null;
  private enabled = true;
  private mode: OccultoMode = 'blur';
  private observer: MutationObserver | null = null;
  private processedNodes = new WeakSet<Node>();
  private compiledRegex: RegExp[] = [];
  private compiledIgnoreRegex: RegExp[] = [];
  // All valid sensitive selectors joined into one query (one DOM pass instead of one per selector).
  private selectorQuery = '';
  private scrambleSettings: ScrambleSettings = DEFAULT_SCRAMBLE_SETTINGS;
  private shadowRoots = new WeakSet<ShadowRoot>();
  private shadowObservers: MutationObserver[] = [];
  // Plain text nodes this script created while splitting a node; they are
  // already processed, so the observers must not feed them back in.
  private ownTextNodes = new WeakSet<Node>();
  private loaded = false;
  private changedBeforeLoad = false;
  // `enabled` is the effective state: the global switch minus per-site pause.
  private userEnabled = true;
  private pausedSites: string[] = [];
  // This frame's host first, then its ancestors' (pausing a site covers its iframes).
  private readonly hosts = OccultoContentScript.frameHosts();
  private hideStyle: HideStyle = 'blur';
  private preloadStyle: HTMLStyleElement | null = null;
  private originalTitle: string | null = null;
  private renderedTitle: string | null = null;
  // Editable host → fixed layer of boxes drawn over its sensitive text.
  private readonly overlays = new Map<HTMLElement, HTMLElement>();
  private overlayFrame = 0;
  private badgeTimer = 0;
  private lastContextTarget: Element | null = null;
  private panicCover: HTMLElement | null = null;

  constructor() {
    this.init();
  }

  private async init() {
    // Runs at document_start: keep the page invisible until the first pass so
    // sensitive data never paints before the settings are loaded.
    this.hideUntilReady();
    // Register before loading so changes during the initial load (e.g. the
    // very first key creation) are not lost. All state lives in
    // chrome.storage.local.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (!this.loaded) {
        this.changedBeforeLoad = true;
        return;
      }
      this.onStorageChanged(changes);
    });
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message) return;
      if (message.type === 'occulto:stats') sendResponse(this.collectStats());
      else if (message.type === 'occulto:audit') sendResponse(this.setAudit(message.on === true));
      else if (message.type === 'occulto:panic') sendResponse({ panic: this.togglePanic() });
      else if (message.type === 'occulto:context-selector') {
        sendResponse(this.lastContextTarget ? OccultoContentScript.cssPath(this.lastContextTarget) : null);
      }
    });
    // Remember what was right-clicked for "Hide this element".
    document.addEventListener(
      'contextmenu',
      (e) => {
        const target = e.target instanceof Element ? e.target : null;
        this.lastContextTarget = target?.closest('[data-censor]')?.parentElement ?? target;
      },
      true
    );
    await this.loadConfig();
    if (this.changedBeforeLoad) await this.loadConfig();
    this.loaded = true;
    this.compileRegexPatterns();
    this.startObserving();
    this.processInitialPage();
    document.addEventListener(
      'input',
      (e) => {
        const target = e.target as Element | null;
        if (this.enabled && target instanceof HTMLElement && target.matches(OCCULTO_TEXT_INPUTS)) {
          this.processInput(target as HTMLInputElement | HTMLTextAreaElement);
        }
      },
      true
    );
    const refresh = () => this.scheduleOverlayRefresh();
    window.addEventListener('scroll', refresh, true);
    window.addEventListener('resize', refresh);
    this.reveal();
    this.scheduleBadge();
  }

  // Top frame reports its state to the background, which paints the toolbar badge.
  private scheduleBadge() {
    if (window !== window.top) return;
    window.clearTimeout(this.badgeTimer);
    this.badgeTimer = window.setTimeout(() => {
      const stats = this.collectStats();
      const state = !this.userEnabled ? 'off' : !this.enabled ? 'paused' : 'active';
      chrome.runtime
        .sendMessage({ type: 'occulto:badge', state, count: stats.blurred + stats.scrambled + stats.replaced })
        .catch(() => undefined);
    }, 400);
  }

  // Audit: outlines everything hidden (CSS, see content.css) and highlights
  // text that a not-enabled library pattern would catch, using the CSS Custom
  // Highlight API so the page DOM is not modified.
  private setAudit(on: boolean): { total: number; leaks: Array<{ id: string; name: string; count: number }> } {
    document.documentElement.classList.toggle('occulto-audit', on);
    const registry = (CSS as unknown as { highlights?: { set(n: string, h: unknown): void; delete(n: string): void } })
      .highlights;
    const HighlightCtor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    registry?.delete('occulto-leak');
    if (!on || !this.config) return { total: 0, leaks: [] };
    const ranges: Range[] = [];
    const counts = new Map<string, number>();
    const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent || OCCULTO_SKIP_TAGS.has(parent.tagName.toLowerCase()) || parent.closest('[data-censor]')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.textContent ?? '';
      for (const leak of OccultoLibrary.findLeaks(text, this.config)) {
        const range = document.createRange();
        range.setStart(node, leak.start);
        range.setEnd(node, leak.end);
        ranges.push(range);
        counts.set(leak.presetId, (counts.get(leak.presetId) ?? 0) + 1);
      }
    }
    if (registry && HighlightCtor && ranges.length > 0) registry.set('occulto-leak', new HighlightCtor(...ranges));
    const leaks = [...counts].map(([id, count]) => ({
      id,
      name: OCCULTO_PRESETS.find((p) => p.id === id)?.name ?? id,
      count,
    }));
    return { total: ranges.length, leaks };
  }

  // Panic: instantly covers the whole page (top frame); toggled by Alt+Shift+P.
  private togglePanic(): boolean {
    if (window !== window.top) return false;
    if (this.panicCover) {
      this.panicCover.remove();
      this.panicCover = null;
      return false;
    }
    const cover = document.createElement('div');
    cover.setAttribute('data-occulto-panic', '1');
    cover.textContent = OccultoI18n.t('Content hidden');
    cover.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;' +
      'background:rgba(18,19,26,0.72);backdrop-filter:blur(30px);-webkit-backdrop-filter:blur(30px);' +
      'color:#e7e9f2;font:600 18px system-ui,sans-serif;letter-spacing:.02em;';
    (document.body ?? document.documentElement).appendChild(cover);
    this.panicCover = cover;
    return true;
  }

  // Short CSS selector for "Hide this element" (id, else up to 4 ancestors).
  private static cssPath(el: Element): string {
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node !== document.documentElement && parts.length < 4) {
      if (node.id) {
        parts.unshift(`#${CSS.escape(node.id)}`);
        break;
      }
      let part = node.tagName.toLowerCase();
      const classes = [...node.classList]
        .filter((c) => !['blurred', 'scrambled', 'occulto-replaced', 'occulto-audit'].includes(c))
        .slice(0, 2);
      part += classes.map((c) => `.${CSS.escape(c)}`).join('');
      const current: Element = node;
      const siblings = current.parentElement
        ? [...current.parentElement.children].filter((c) => c.tagName === current.tagName)
        : [];
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  private processTextWithContainer(node: Text) {
    const container = node.parentElement ? this.inlineContainer(node.parentElement) : null;
    this.processTextNode(node);
    if (container) this.processCrossNode(container);
  }

  private hideUntilReady() {
    const style = document.createElement('style');
    style.textContent = 'html { visibility: hidden !important; }';
    document.documentElement.appendChild(style);
    this.preloadStyle = style;
    window.setTimeout(() => this.reveal(), 1500); // failsafe
  }

  private reveal() {
    this.preloadStyle?.remove();
    this.preloadStyle = null;
  }

  private static frameHosts(): string[] {
    const hosts = [location.hostname.toLowerCase()];
    const add = (url: string) => {
      try {
        hosts.push(new URL(url).hostname.toLowerCase());
      } catch {
        // ignore unparsable origins
      }
    };
    const ancestors = (location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
    if (ancestors) for (let i = 0; i < ancestors.length; i++) add(ancestors[i]);
    if (window !== window.top && document.referrer) add(document.referrer);
    return hosts;
  }

  // Keys that change what a page shows; anything else (profiles list, flags…) is ignored.
  private static readonly RELEVANT_KEYS = [
    'config',
    'enabled',
    'mode',
    'replaceRules',
    'scrambleKey',
    'scrambleSettings',
    'pausedSites',
    'hideStyle',
  ];

  private onStorageChanged(changes: { [key: string]: chrome.storage.StorageChange }) {
    if (!OccultoContentScript.RELEVANT_KEYS.some((key) => key in changes)) return;
    const wasEnabled = this.enabled;
    const onlyPauseList = Object.keys(changes).every((key) => key === 'pausedSites' || !OccultoContentScript.RELEVANT_KEYS.includes(key));
    let disabled = false;
    if (changes.config) {
      this.config = changes.config.newValue;
      this.compileRegexPatterns();
    }
    if (changes.enabled !== undefined || changes.pausedSites !== undefined) {
      if (changes.enabled !== undefined) this.userEnabled = changes.enabled.newValue !== false;
      if (changes.pausedSites !== undefined) {
        this.pausedSites = OccultoStorage.normalizePausedSites(changes.pausedSites.newValue);
      }
      this.refreshEnabled();
      if (!this.enabled) disabled = true;
    }
    if (changes.hideStyle !== undefined) {
      this.hideStyle = OccultoStorage.normalizeHideStyle(changes.hideStyle.newValue);
    }
    if (changes.mode !== undefined) {
      this.mode = changes.mode.newValue || 'blur';
    }
    if (changes.replaceRules !== undefined) {
      const rules = Array.isArray(changes.replaceRules.newValue) ? changes.replaceRules.newValue : [];
      occultoReplacer.setRules(
        rules
          .map((r: unknown) => OccultoStorage.normalizeReplaceRule(r))
          .filter((r: ReplaceRule | null): r is ReplaceRule => r !== null)
      );
    }
    if (changes.scrambleKey !== undefined) {
      this.applyScrambleKey(changes.scrambleKey.newValue);
    }
    if (changes.scrambleSettings !== undefined) {
      this.scrambleSettings = OccultoStorage.normalizeScrambleSettings(changes.scrambleSettings.newValue);
    }

    if (onlyPauseList && this.enabled === wasEnabled) return; // another site was (un)paused
    if (disabled) {
      this.removeAllBlurs();
    } else if (this.enabled) {
      this.reprocessPage();
    }
    this.scheduleBadge();
  }

  private refreshEnabled() {
    this.enabled = this.userEnabled && !this.hosts.some((h) => this.pausedSites.includes(h));
  }

  // Answers the popup's stats request (counts include open shadow roots).
  private collectStats() {
    const stats = { active: this.enabled, host: this.hosts[0], blurred: 0, scrambled: 0, replaced: 0 };
    const count = (root: ParentNode) => {
      stats.blurred += root.querySelectorAll('.blurred').length;
      stats.scrambled += root.querySelectorAll('[data-censor="1"].scrambled').length;
      stats.replaced += root.querySelectorAll('.occulto-replaced').length;
    };
    count(document);
    this.forEachShadowRoot(count);
    stats.blurred += document.querySelectorAll('[data-occulto-overlay] > div').length;
    return stats;
  }

  // setKey throws on malformed keys; never let a bad storage value kill the content script
  private applyScrambleKey(key: unknown) {
    if (typeof key === 'string' && /^[0-9a-f]{64}$/.test(key)) {
      occultoScrambler.setKey(key);
    } else {
      console.error('[Occulto] Ignoring invalid scramble key');
    }
  }

  private async loadConfig() {
    try {
      const data = await OccultoStorage.loadAll();
      this.config = data.config;
      this.userEnabled = data.enabled;
      this.pausedSites = data.pausedSites;
      this.hideStyle = data.hideStyle;
      this.refreshEnabled();
      this.mode = data.mode;
      this.scrambleSettings = OccultoStorage.normalizeScrambleSettings(data.scrambleSettings);
      this.applyScrambleKey(data.scrambleKey);
      occultoReplacer.setRules(data.replaceRules);
    } catch (error) {
      console.error('[Occulto] Failed to load config:', error);
    }
  }

  private compileRegexPatterns() {
    if (!this.config) return;
    this.compiledRegex = OccultoPipeline.compileRegexList(this.config.regex);
    this.compiledIgnoreRegex = OccultoPipeline.compileRegexList(this.config.ignore?.regex);
    const probe = document.createDocumentFragment();
    this.selectorQuery = this.config.selectors
      .filter((selector) => {
        try {
          probe.querySelector(selector);
          return true;
        } catch (error) {
          console.error('[Occulto] Invalid selector:', selector, error);
          return false;
        }
      })
      .join(',');
  }

  // Hides every not-yet-processed element matching a sensitive selector under root.
  private censorMatchingIn(root: ParentNode) {
    if (!this.selectorQuery) return;
    root.querySelectorAll(this.selectorQuery).forEach((el) => {
      if (this.processedNodes.has(el) || this.shouldIgnoreElement(el)) return;
      if (this.shouldIgnoreText(el.textContent || '')) return;
      this.processedNodes.add(el);
      this.applyCensoring(el);
    });
  }

  private startObserving() {
    this.observer = new MutationObserver((mutations) => {
      if (!this.enabled) return;

      // Elements added in this batch whose ancestor was also added are covered
      // by processing that ancestor once (SPAs insert whole subtrees).
      const added = new Set<Element>();
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) added.add(node as Element);
        });
      }
      const coveredByAncestor = (el: Element): boolean => {
        for (let p = el.parentElement; p; p = p.parentElement) if (added.has(p)) return true;
        return false;
      };

      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (coveredByAncestor(node as Element)) return;
              this.processElement(node as Element);
              this.discoverAndHandleShadowRoots(node as Element);
            } else if (node.nodeType === Node.TEXT_NODE && !this.ownTextNodes.has(node)) {
              this.processTextWithContainer(node as Text);
            }
          });
          if (mutation.target instanceof HTMLTitleElement) this.processTitle();
        } else if (mutation.type === 'characterData') {
          this.processTextWithContainer(mutation.target as Text);
        } else if (mutation.type === 'attributes') {
          this.processAttributes(mutation.target as Element);
        }
      }
      this.scheduleBadge();
    });

    // Observe the whole document: at document_start <body> may not exist yet.
    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: OCCULTO_ATTRS,
    });

    // Handle any existing open shadow roots on the page at startup
    this.discoverAndHandleShadowRoots(document.documentElement);
  }

  private processInitialPage() {
    if (!this.enabled || !this.config) return;
    this.processElement(document.documentElement);
    this.processTitle();
    // Also process any discovered shadow roots initially
    this.discoverAndHandleShadowRoots(document.documentElement);
  }

  private reprocessPage() {
    this.removeAllBlurs();
    this.processedNodes = new WeakSet<Node>();
    occultoScrambler.clearCache();
    this.processInitialPage();
  }

  private removeAllBlurs() {
    const removeInRoot = (root: ParentNode & DocumentOrShadowRoot) => {
      // Remove hide styling (restores each element's original inline style)
      root.querySelectorAll('.blurred').forEach((el) => this.restoreHideStyle(el as HTMLElement));
      root.querySelectorAll('[data-occulto-selector]').forEach((el) => el.removeAttribute('data-occulto-selector'));
      this.restoreAttributes(root);

      // Remove scrambled class and restore original text
      root.querySelectorAll('.scrambled').forEach((el) => {
        const element = el as HTMLElement;
        element.classList.remove('scrambled');
      });

      root.querySelectorAll('.occulto-replaced').forEach((el) => {
        el.classList.remove('occulto-replaced');
      });

      // Remove censored/scrambled spans and restore original text
      root.querySelectorAll('[data-censor="1"]').forEach((span) => {
        const parent = span.parentNode;
        if (parent) {
          // If scrambled, restore the original text
          const originalText = span.getAttribute('data-occulto-original');
          const textContent = originalText || span.textContent || '';
          parent.replaceChild(document.createTextNode(textContent), span);
          (parent as ParentNode).normalize();
        }
      });

      // Remove scrambled marker from selector-matched elements (text is restored via data-censor spans above)
      root.querySelectorAll('[data-occulto-scrambled="1"]').forEach((el) => {
        const element = el as HTMLElement;
        element.removeAttribute('data-occulto-scrambled');
        element.classList.remove('scrambled');
      });
    };

    removeInRoot(document);
    this.restoreTitle();
    for (const host of [...this.overlays.keys()]) this.removeOverlay(host);

    // Ensure we are aware of all current shadow roots before cleanup within them
    this.discoverAndHandleShadowRoots(document.documentElement);

    // Clean within known shadow roots
    this.forEachShadowRoot((sr) => removeInRoot(sr));
  }

  private processElement(element: Element) {
    if (!this.config || this.processedNodes.has(element)) return;
    this.processedNodes.add(element);

    // Check if element should be ignored
    if (this.shouldIgnoreElement(element)) return;

    // Check if element matches any selector
    if (this.matchesSelectors(element)) {
      if (!this.shouldIgnoreText(element.textContent || '')) {
        this.applyCensoring(element);
      }
    }

    // Process all child elements that match selectors
    this.censorMatchingIn(element);

    // Process input/textarea elements for regex matching on their values
    this.processInputElements(element);

    // If this element hosts a shadow root, handle it
    if ((element as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot) {
      this.observeAndProcessShadowRoot((element as Element & { shadowRoot: ShadowRoot }).shadowRoot);
    }

    // Process text nodes for regex matching
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          // Skip if parent is already blurred or is a script/style tag
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          
          if (OCCULTO_SKIP_TAGS.has(parent.tagName.toLowerCase())) {
            return NodeFilter.FILTER_REJECT;
          }

          if (parent.classList.contains('blurred') || parent.classList.contains('scrambled') || parent.hasAttribute('data-censor')) {
            return NodeFilter.FILTER_REJECT;
          }

          if (this.shouldIgnoreElement(parent)) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    const textNodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      textNodes.push(node as Text);
    }

    const containers = new Set<Element>();
    for (const textNode of textNodes) {
      if (textNode.parentElement) containers.add(this.inlineContainer(textNode.parentElement));
    }
    textNodes.forEach((textNode) => this.processTextNode(textNode));
    containers.forEach((container) => this.processCrossNode(container));

    this.processAttributes(element);
    element.querySelectorAll(OCCULTO_ATTR_SELECTOR).forEach((el) => this.processAttributes(el));
  }

  private shouldIgnoreElement(element: Element): boolean {
    if (!this.config?.ignore?.selectors) return false;

    for (const selector of this.config.ignore.selectors) {
      try {
        if (element.matches(selector)) return true;
        // Check if element is within an ignored parent
        if (element.closest(selector)) return true;
      } catch (error) {
        console.error('[Occulto] Invalid ignore selector:', selector, error);
      }
    }

    return false;
  }

  private matchesSelectors(element: Element): boolean {
    return this.selectorQuery !== '' && element.matches(this.selectorQuery);
  }

  private pipelineContext(): PipelineContext {
    return {
      censorRegexes: this.compiledRegex,
      ignoreRegexes: this.compiledIgnoreRegex,
      mode: this.mode,
      scrambleSettings: this.scrambleSettings,
      replacer: occultoReplacer,
      scrambler: occultoScrambler,
    };
  }

  private processTextNode(textNode: Text) {
    if (!this.config) return;

    const parent = textNode.parentElement;
    if (!parent || parent.hasAttribute('data-censor')) return;
    if (OCCULTO_SKIP_TAGS.has(parent.tagName.toLowerCase())) return;
    if (this.isEditable(parent)) {
      this.processEditable(parent);
      return;
    }

    const text = textNode.textContent || '';
    if (!text.trim()) return;

    // Ignore regexes only suppress censoring; replace rules still apply (handled in the pipeline)
    const fragments = OccultoPipeline.processText(text, this.pipelineContext());
    if (fragments.every((f) => f.kind === 'plain')) return;

    const parentNode = textNode.parentNode;
    if (!parentNode) return;

    const docFragment = document.createDocumentFragment();
    fragments.forEach((fragment) => {
      if (fragment.kind === 'plain') {
        const plain = document.createTextNode(fragment.display);
        this.ownTextNodes.add(plain);
        docFragment.appendChild(plain);
        return;
      }

      const span = document.createElement('span');
      span.setAttribute('data-censor', '1');
      if (fragment.kind === 'blurred') {
        span.textContent = fragment.display;
        span.className = 'blurred';
        this.applyHideStyle(span);
      } else {
        // scrambled / replaced: show the substitute, keep the original for restoring
        span.setAttribute('data-occulto-original', fragment.original);
        span.textContent = fragment.display;
        span.className = fragment.kind === 'scrambled' ? 'scrambled' : 'occulto-replaced';
      }
      docFragment.appendChild(span);
    });

    parentNode.replaceChild(docFragment, textNode);
  }

  private processInputElements(element: Element) {
    if (!this.config) return;
    element.querySelectorAll(OCCULTO_TEXT_INPUTS).forEach((input) => {
      this.processInput(input as HTMLInputElement | HTMLTextAreaElement);
    });
  }

  // Form values are never rewritten (that would change what gets submitted):
  // a field holding detected data or a replace-rule term is hidden instead.
  // Re-run on every `input` event so typed values are covered too.
  private processInput(input: HTMLInputElement | HTMLTextAreaElement) {
    if (!this.config || this.shouldIgnoreElement(input) || input.hasAttribute('data-occulto-selector')) return;
    const value = input.value;
    if (value.trim() && this.containsSomethingToHide(value)) {
      this.applyHideStyle(input);
    } else if (input.hasAttribute('data-occulto-inline')) {
      this.restoreHideStyle(input);
    }
  }

  private containsSomethingToHide(text: string): boolean {
    return OccultoPipeline.hasCensoredText(text, this.pipelineContext()) || occultoReplacer.findMatches(text).length > 0;
  }

  private isEditable(el: HTMLElement): boolean {
    return el.isContentEditable || document.designMode === 'on';
  }

  // Editable regions (Gmail compose, Notion, chat boxes…) are never rewritten:
  // their content would be saved or sent. Sensitive text there is covered by
  // boxes drawn in a separate fixed layer (overlay mode), so the editor's DOM
  // and styles stay untouched.
  private processEditable(from: HTMLElement) {
    let host = from;
    if (document.designMode === 'on') {
      host = document.body ?? document.documentElement;
    } else {
      while (host.parentElement && host.parentElement.isContentEditable) host = host.parentElement;
    }
    this.drawOverlay(host);
  }

  private drawOverlay(host: HTMLElement) {
    const ranges = this.sensitiveRanges(host);
    if (ranges.length === 0 || !host.isConnected) {
      this.removeOverlay(host);
      return;
    }
    let layer = this.overlays.get(host);
    if (!layer) {
      layer = document.createElement('div');
      layer.setAttribute('data-occulto-overlay', '1');
      layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;';
      document.documentElement.appendChild(layer);
      this.overlays.set(host, layer);
    }
    const clip = host.getBoundingClientRect();
    const boxStyle =
      this.hideStyle === 'bar'
        ? 'background:#000;'
        : 'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);background:rgba(128,128,128,0.18);';
    const boxes: HTMLElement[] = [];
    for (const range of ranges) {
      for (const rect of range.getClientRects()) {
        const left = Math.max(rect.left, clip.left);
        const top = Math.max(rect.top, clip.top);
        const right = Math.min(rect.right, clip.right);
        const bottom = Math.min(rect.bottom, clip.bottom);
        if (right <= left || bottom <= top) continue;
        const box = document.createElement('div');
        box.style.cssText = `position:fixed;left:${left - 1}px;top:${top}px;width:${right - left + 2}px;height:${bottom - top}px;border-radius:2px;${boxStyle}`;
        boxes.push(box);
      }
    }
    layer.replaceChildren(...boxes);
  }

  // Ranges of everything Occulto would hide or replace inside root's text.
  private sensitiveRanges(root: HTMLElement): Range[] {
    const ranges: Range[] = [];
    const ctx = this.pipelineContext();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = (node as Text).data;
      if (!text.trim()) continue;
      let offset = 0;
      for (const fragment of OccultoPipeline.processText(text, ctx)) {
        if (fragment.kind !== 'plain') {
          const range = document.createRange();
          range.setStart(node, offset);
          range.setEnd(node, offset + fragment.original.length);
          ranges.push(range);
        }
        offset += fragment.original.length;
      }
    }
    return ranges;
  }

  private removeOverlay(host: HTMLElement) {
    this.overlays.get(host)?.remove();
    this.overlays.delete(host);
  }

  // Overlay boxes use viewport coordinates: redraw on scroll/resize.
  private scheduleOverlayRefresh() {
    if (this.overlays.size === 0 || this.overlayFrame) return;
    this.overlayFrame = requestAnimationFrame(() => {
      this.overlayFrame = 0;
      for (const host of [...this.overlays.keys()]) this.drawOverlay(host);
    });
  }

  // Nearest ancestor that is not an inline formatting element.
  private inlineContainer(el: Element): Element {
    let node = el;
    while (node.parentElement && OCCULTO_INLINE_TAGS.has(node.tagName.toLowerCase())) node = node.parentElement;
    return node;
  }

  // Second pass for values split across inline formatting, e.g.
  // "john@<b>acme</b>.com": each piece is wrapped and hidden (in Scramble mode
  // the first piece shows the whole fake value, the others are emptied).
  private processCrossNode(container: Element) {
    if (!this.config || !this.enabled || !container.isConnected) return;
    if (container instanceof HTMLElement && this.isEditable(container)) return;
    if (OCCULTO_SKIP_TAGS.has(container.tagName.toLowerCase())) return;
    if (container.closest('[data-censor],[data-occulto-selector]') || this.shouldIgnoreElement(container)) return;
    const groups: Text[][] = [[]];
    const walk = (node: Node) => {
      for (const child of [...node.childNodes]) {
        if (child.nodeType === Node.TEXT_NODE) {
          groups[groups.length - 1].push(child as Text);
        } else if (child instanceof Element) {
          const inline =
            OCCULTO_INLINE_TAGS.has(child.tagName.toLowerCase()) &&
            !child.hasAttribute('data-censor') &&
            !child.hasAttribute('data-occulto-selector');
          if (inline) walk(child);
          else groups.push([]); // block, <br>, already-hidden span…: hard boundary
        }
      }
    };
    walk(container);
    const ctx = this.pipelineContext();
    for (const group of groups) {
      if (group.length < 2) continue;
      const matches = OccultoPipeline.crossSegmentMatches(
        group.map((t) => t.data),
        ctx
      );
      // Last match first: earlier offsets stay valid when a node is split.
      for (const pieces of matches.reverse()) this.wrapCrossMatch(group, pieces);
    }
  }

  private wrapCrossMatch(group: Text[], pieces: Array<{ segment: number; start: number; end: number }>) {
    const full = pieces.map((p) => group[p.segment].data.slice(p.start, p.end)).join('');
    const scramble = OccultoPipeline.shouldScramble(full, this.mode, this.scrambleSettings);
    const display = scramble ? occultoScrambler.scramble(full) : '';
    pieces.forEach((piece, i) => {
      const middle = group[piece.segment].splitText(piece.start);
      this.ownTextNodes.add(middle.splitText(piece.end - piece.start));
      const span = document.createElement('span');
      span.setAttribute('data-censor', '1');
      span.setAttribute('data-occulto-original', middle.data);
      if (scramble) {
        span.className = 'scrambled';
        span.textContent = i === 0 ? display : '';
      } else {
        span.className = 'blurred';
        span.textContent = middle.data;
        this.applyHideStyle(span);
      }
      middle.replaceWith(span);
    });
  }

  // Tab titles are visible while screen sharing; they can't hold spans, so
  // blurred parts become █ (see OccultoPipeline.toPlainText). Top frame only.
  private processTitle() {
    if (window !== window.top || !this.config) return;
    const current = document.title;
    if (current === this.renderedTitle) return; // our own write
    if (!this.enabled) return;
    const rendered = OccultoPipeline.toPlainText(OccultoPipeline.processText(current, this.pipelineContext()));
    this.originalTitle = current;
    this.renderedTitle = rendered === current ? null : rendered;
    if (rendered !== current) document.title = rendered;
  }

  private restoreTitle() {
    const original = this.originalTitle;
    const rendered = this.renderedTitle;
    this.originalTitle = null;
    this.renderedTitle = null;
    if (original !== null && rendered !== null && document.title === rendered) document.title = original;
  }

  // Tooltip / label attributes, rewritten like the title. Originals and our
  // rendered values are kept in data-occulto-attrs for restoring and to
  // recognise our own writes.
  private processAttributes(el: Element) {
    if (!this.enabled || !this.config || this.shouldIgnoreElement(el)) return;
    if (el instanceof HTMLElement && this.isEditable(el)) return;
    const stored = OccultoContentScript.readStoredAttrs(el);
    let changed = false;
    for (const name of OCCULTO_ATTRS) {
      const value = el.getAttribute(name);
      if (value === null || !value.trim() || stored[name]?.r === value) continue;
      const rendered = OccultoPipeline.toPlainText(OccultoPipeline.processText(value, this.pipelineContext()));
      if (rendered === value) {
        if (stored[name]) {
          delete stored[name];
          changed = true;
        }
        continue;
      }
      stored[name] = { o: value, r: rendered };
      changed = true;
      el.setAttribute(name, rendered);
    }
    if (!changed) return;
    if (Object.keys(stored).length > 0) el.setAttribute('data-occulto-attrs', JSON.stringify(stored));
    else el.removeAttribute('data-occulto-attrs');
  }

  private restoreAttributes(root: ParentNode) {
    root.querySelectorAll('[data-occulto-attrs]').forEach((el) => {
      const stored = OccultoContentScript.readStoredAttrs(el);
      el.removeAttribute('data-occulto-attrs');
      for (const [name, { o, r }] of Object.entries(stored)) {
        if (el.getAttribute(name) === r) el.setAttribute(name, o);
      }
    });
  }

  private static readStoredAttrs(el: Element): Record<string, { o: string; r: string }> {
    try {
      return JSON.parse(el.getAttribute('data-occulto-attrs') || '{}');
    } catch {
      return {};
    }
  }

  // For selector-matched elements: skip only when exceptions cover all of their text.
  private shouldIgnoreText(text: string): boolean {
    return OccultoPipeline.isFullyIgnored(text, this.compiledIgnoreRegex);
  }

  // Decide whether to blur or scramble a selector-matched element
  private applyCensoring(element: Element) {
    element.setAttribute('data-occulto-selector', '1');
    // Editable content is never rewritten (see processEditable).
    const editable = element instanceof HTMLElement && this.isEditable(element);
    if (this.mode === 'scramble' && !editable) {
      this.applySelectorScramble(element);
    } else {
      this.applyHideStyle(element);
    }
  }

  // Scramble the visible text content of a selector-matched element
  private applySelectorScramble(element: Element) {
    const htmlEl = element as HTMLElement;
    htmlEl.setAttribute('data-occulto-scrambled', '1');
    htmlEl.classList.add('scrambled');

    // Collect leaf text nodes first, then wrap each in a censor span
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tagName = parent.tagName.toLowerCase();
          if (tagName === 'script' || tagName === 'style' || tagName === 'noscript') {
            return NodeFilter.FILTER_REJECT;
          }
          if (parent.hasAttribute('data-censor')) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );
    const textNodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      textNodes.push(node as Text);
    }

    for (const textNode of textNodes) {
      const text = textNode.textContent || '';
      if (!text.trim()) continue;
      const span = document.createElement('span');
      span.setAttribute('data-censor', '1');
      span.setAttribute('data-occulto-original', text);
      span.textContent = occultoScrambler.scramble(text);
      span.className = 'scrambled';
      textNode.parentNode?.replaceChild(span, textNode);
    }
  }

  // Inline !important styling also works across shadow DOM boundaries. The
  // element's original style attribute is saved in data-occulto-inline.
  // Blur scales with the font size; "bar" paints a solid block (safer: short
  // blurred strings can sometimes be reconstructed).
  private applyHideStyle(element: Element) {
    const el = element as HTMLElement;
    if (!el.style) return;
    el.classList.add('blurred');
    if (!el.hasAttribute('data-occulto-inline')) {
      el.setAttribute('data-occulto-inline', el.getAttribute('style') ?? '');
    }
    if (this.hideStyle === 'bar') {
      el.style.setProperty('filter', 'brightness(0)', 'important');
      el.style.setProperty('background-color', '#000', 'important');
    } else {
      el.style.setProperty('filter', 'blur(0.45em)', 'important');
    }
  }

  private restoreHideStyle(el: HTMLElement) {
    el.classList.remove('blurred');
    const original = el.getAttribute('data-occulto-inline');
    if (original === null) return;
    el.removeAttribute('data-occulto-inline');
    if (original === '') el.removeAttribute('style');
    else el.setAttribute('style', original);
  }

  // Discover and handle open shadow roots under a given root
  private discoverAndHandleShadowRoots(root: Element | Document) {
    const scope = root instanceof Document ? root.documentElement : (root as Element);
    if (!scope) return;
    const all = scope.querySelectorAll('*');
    (all as NodeListOf<Element>).forEach((el) => {
      const sr = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
      if (sr) {
        this.observeAndProcessShadowRoot(sr);
      }
    });
  }

  private observeAndProcessShadowRoot(sr: ShadowRoot) {
    if (this.shadowRoots.has(sr)) return;
    this.shadowRoots.add(sr);
    this.injectStylesIntoShadowRoot(sr);

    // Observe mutations inside the shadow root
    const shadowObserver = new MutationObserver((mutations) => {
      if (!this.enabled) return;
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Process within the shadow root context
              this.processShadowRoot(sr);
              // And discover nested shadow roots
              this.discoverAndHandleShadowRoots(node as Element);
            } else if (node.nodeType === Node.TEXT_NODE && !this.ownTextNodes.has(node)) {
              this.processTextNode(node as Text);
            }
          });
        } else if (mutation.type === 'characterData') {
          this.processTextNode(mutation.target as Text);
        }
      }
    });

    shadowObserver.observe(sr, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    this.shadowObservers.push(shadowObserver);

    // Initial processing inside the shadow root
    this.processShadowRoot(sr);
  }

  private processShadowRoot(sr: ShadowRoot) {
    if (!this.config) return;

    // Process elements by selectors
    this.censorMatchingIn(sr);

    // Process inputs
    const container = sr as unknown as Element;
    this.processInputElements(container);

    // Process text nodes
    const walker = sr.ownerDocument.createTreeWalker(
      sr,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          
          if (OCCULTO_SKIP_TAGS.has(parent.tagName.toLowerCase())) {
            return NodeFilter.FILTER_REJECT;
          }

          if (parent.classList.contains('blurred') || parent.classList.contains('scrambled') || parent.hasAttribute('data-censor')) {
            return NodeFilter.FILTER_REJECT;
          }

          if (this.shouldIgnoreElement(parent)) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    const textNodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      textNodes.push(node as Text);
    }

    textNodes.forEach((textNode) => this.processTextNode(textNode));
  }

  private injectStylesIntoShadowRoot(sr: ShadowRoot) {
    // Avoid duplicate injections
    if (sr.querySelector('style[data-occulto-style="1"]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-occulto-style', '1');
    style.textContent = `
      .blurred { filter: blur(6px) !important; }
      [data-censor="1"]:not(.scrambled):not(.occulto-replaced) { filter: blur(6px) !important; }
      .scrambled, .occulto-replaced { user-select: none; }
    `;
    sr.appendChild(style);
  }

  private forEachShadowRoot(cb: (sr: ShadowRoot) => void) {
    // WeakSet is not iterable; rely on discovery to call cb
    this.discoverAndHandleShadowRoots(document.documentElement);
    // After discovery, we can try common portals (still call discovery).
    // We cannot iterate WeakSet; discovery ensures observeAndProcessShadowRoot is called then cb via next call below.
    // So we traverse again and run cb on each found shadow root.
    const invokeCb = (root: Element | Document) => {
      const scope = root instanceof Document ? root.documentElement : (root as Element);
      if (!scope) return;
      const all = scope.querySelectorAll('*');
      (all as NodeListOf<Element>).forEach((el) => {
        const sr = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
        if (sr) cb(sr);
      });
    };
    invokeCb(document);
  }
}

// Initialize the content script
new OccultoContentScript();
