// User-defined find -> replace rule engine.

interface CompiledReplaceRule {
  rule: ReplaceRule;
  regex: RegExp;
}

class Replacer {
  private compiled: CompiledReplaceRule[] = [];

  setRules(rules: ReplaceRule[]): void {
    this.compiled = [];
    for (const rule of rules) {
      const regex = Replacer.compile(rule);
      if (regex) {
        this.compiled.push({ rule, regex });
      }
    }
  }

  hasActiveRules(): boolean {
    return this.compiled.length > 0;
  }

  findMatches(text: string): ReplaceMatch[] {
    const accepted: ReplaceMatch[] = [];
    for (const { rule, regex } of this.compiled) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        if (match[0].length === 0) {
          regex.lastIndex += Replacer.codePointLength(text, regex.lastIndex);
          continue;
        }
        const start = match.index;
        const end = start + match[0].length;
        if (accepted.some((m) => start < m.end && m.start < end)) {
          continue;
        }
        accepted.push({
          start,
          end,
          replacement: rule.isRegex ? Replacer.expandTemplate(rule.replace, match) : rule.replace,
          ruleId: rule.id,
        });
      }
      regex.lastIndex = 0;
    }
    return accepted.sort((a, b) => a.start - b.start);
  }

  apply(text: string): string {
    let result = '';
    let pos = 0;
    for (const m of this.findMatches(text)) {
      result += text.slice(pos, m.start) + m.replacement;
      pos = m.end;
    }
    return result + text.slice(pos);
  }

  static compile(rule: ReplaceRule): RegExp | null {
    if (!rule.enabled || rule.find === '') {
      return null;
    }
    let source = rule.isRegex ? rule.find : Replacer.escapeRegExp(rule.find);
    if (rule.wholeWord) {
      source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
    }
    try {
      return new RegExp(source, 'gu' + (rule.caseSensitive ? '' : 'i'));
    } catch {
      return null;
    }
  }

  static validate(rule: ReplaceRule): string | null {
    if (!rule.isRegex) {
      return null;
    }
    let source = rule.find;
    if (rule.wholeWord) {
      source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
    }
    try {
      new RegExp(source, 'gu' + (rule.caseSensitive ? '' : 'i'));
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

  static expandTemplate(template: string, match: RegExpExecArray): string {
    let out = '';
    let i = 0;
    while (i < template.length) {
      const ch = template[i];
      if (ch !== '$' || i + 1 >= template.length) {
        out += ch;
        i++;
        continue;
      }
      const next = template[i + 1];
      if (next === '$') {
        out += '$';
        i += 2;
      } else if (next === '&') {
        out += match[0];
        i += 2;
      } else if (next === '<') {
        const close = template.indexOf('>', i + 2);
        const name = close === -1 ? '' : template.slice(i + 2, close);
        if (close !== -1 && match.groups && name in match.groups) {
          out += match.groups[name] ?? '';
          i = close + 1;
        } else {
          out += '$<';
          i += 2;
        }
      } else if (next >= '0' && next <= '9') {
        const two = template.slice(i + 1, i + 3);
        const groupCount = match.length - 1;
        if (/^\d\d$/.test(two) && Number(two) >= 1 && Number(two) <= groupCount) {
          out += match[Number(two)] ?? '';
          i += 3;
        } else if (Number(next) >= 1 && Number(next) <= groupCount) {
          out += match[Number(next)] ?? '';
          i += 2;
        } else {
          out += '$';
          i++;
        }
      } else {
        out += '$';
        i++;
      }
    }
    return out;
  }

  static codePointLength(text: string, index: number): number {
    const cp = text.codePointAt(index);
    return cp !== undefined && cp > 0xffff ? 2 : 1;
  }

  private static escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  }
}

const occultoReplacer = new Replacer();
