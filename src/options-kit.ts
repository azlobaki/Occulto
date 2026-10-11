// Shared plumbing for the options page sections: event bus, toasts, DOM helpers.

type OptionsEventMap = {
  draftRules: ReplaceRule[]; // local (possibly unsaved) rules, for the sandbox
  settings: null; // mode / scramble settings / key / config changed
  ruleMatches: Map<string, number>; // replaced fragments per rule id in the sandbox
  dirty: { source: string; dirty: boolean };
};

class OptionsBus {
  private readonly handlers = new Map<keyof OptionsEventMap, Array<(payload: never) => void>>();

  on<K extends keyof OptionsEventMap>(event: K, handler: (payload: OptionsEventMap[K]) => void): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler as (payload: never) => void);
    this.handlers.set(event, list);
  }

  emit<K extends keyof OptionsEventMap>(event: K, payload: OptionsEventMap[K]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      (handler as (p: OptionsEventMap[K]) => void)(payload);
    }
  }
}

interface OptionsToastOptions {
  kind?: 'info' | 'error';
  undo?: () => void;
  timeout?: number;
}

interface OptionsContext {
  data: StorageData;
  bus: OptionsBus;
  // Persists and reports failures as an error toast; resolves to success.
  save(partial: Partial<StorageData>, what: string): Promise<boolean>;
  toast(message: string, options?: OptionsToastOptions): void;
}

// Contract between the page shell and each section.
interface OptionsSection {
  onExternalChange?(changes: { [key: string]: chrome.storage.StorageChange }): void;
  flush?(): void;
}

class OptionsToast {
  static show(message: string, options: OptionsToastOptions = {}): void {
    const region = document.getElementById('toastRegion');
    if (!region) return;
    const toast = document.createElement('div');
    toast.className = options.kind === 'error' ? 'toast error' : 'toast';
    toast.setAttribute('role', options.kind === 'error' ? 'alert' : 'status');
    const msg = document.createElement('span');
    msg.className = 'toast-msg';
    msg.textContent = message;
    toast.append(OccultoIcons.create(options.kind === 'error' ? 'alert' : 'check'), msg);
    const close = (): void => toast.remove();
    if (options.undo) {
      const undo = options.undo;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = OccultoI18n.t('Undo');
      btn.addEventListener('click', () => {
        undo();
        close();
      });
      toast.appendChild(btn);
    }
    region.appendChild(toast);
    window.setTimeout(close, options.timeout ?? (options.undo ? 7000 : 3500));
  }
}

class OptionsUI {
  static el<T extends HTMLElement>(id: string): T {
    const node = document.getElementById(id);
    if (!node) throw new Error(`[Occulto] Missing element #${id}`);
    return node as T;
  }

  static button(
    label: string,
    opts: { icon?: string; variant?: string; title?: string; onClick: () => void }
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn ${opts.variant ?? 'btn-secondary'}`;
    if (opts.icon) btn.appendChild(OccultoIcons.create(opts.icon));
    if (label) btn.appendChild(document.createTextNode(label));
    if (opts.title) btn.title = opts.title;
    btn.addEventListener('click', opts.onClick);
    return btn;
  }

  static iconButton(icon: string, label: string, onClick: () => void, disabled = false): HTMLButtonElement {
    const btn = OptionsUI.button('', { icon, variant: 'btn-ghost btn-icon', title: label, onClick });
    btn.setAttribute('aria-label', label);
    btn.disabled = disabled;
    return btn;
  }

  static chip(text: string, label: string, pressed: boolean, onToggle: (value: boolean) => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.textContent = text;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-pressed', String(pressed));
    btn.addEventListener('click', () => {
      const next = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', String(next));
      onToggle(next);
    });
    return btn;
  }

  static textInput(opts: {
    value: string;
    placeholder: string;
    label: string;
    mono?: boolean;
    onInput?: (value: string) => void;
    onCommit?: () => void; // change event: blur or Enter
  }): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = opts.mono ? 'input mono' : 'input';
    input.value = opts.value;
    input.placeholder = opts.placeholder;
    input.spellcheck = false;
    input.setAttribute('aria-label', opts.label);
    if (opts.onInput) input.addEventListener('input', () => opts.onInput?.(input.value));
    if (opts.onCommit) input.addEventListener('change', () => opts.onCommit?.());
    return input;
  }

  static text(tag: string, text: string, className?: string): HTMLElement {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  static download(filename: string, json: unknown): void {
    const url = URL.createObjectURL(new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  // Opens a file picker and resolves with the chosen file's parsed JSON.
  static pickJson(): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) return;
        file
          .text()
          .then((text) => resolve(JSON.parse(text)))
          .catch(reject);
      });
      input.click();
    });
  }
}
