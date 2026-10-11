interface PipelineContext {
  censorRegexes: RegExp[];
  ignoreRegexes: RegExp[];
  mode: OccultoMode;
  scrambleSettings: ScrambleSettings;
  replacer: Replacer;
  scrambler: Scrambler;
}

class OccultoPipeline {
  // Checksum validators attached to compiled detection regexes.
  private static readonly validators = new WeakMap<RegExp, PatternValidator>();

  static compileRegexList(list: RegexPattern[] | undefined): RegExp[] {
    return OccultoPipeline.compileRegexEntries(list).map((entry) => entry.regex);
  }

  // Like compileRegexList, but keeps each regex's index in the source list
  // (invalid patterns are skipped, so compiled and config indexes can differ).
  static compileRegexEntries(list: RegexPattern[] | undefined): Array<{ regex: RegExp; index: number }> {
    const compiled: Array<{ regex: RegExp; index: number }> = [];
    (list ?? []).forEach((pattern, index) => {
      try {
        let flags = pattern.flags ?? 'g';
        // A non-global regex in an exec loop never terminates.
        if (!flags.includes('g')) flags += 'g';
        const regex = new RegExp(pattern.pattern, flags);
        if (pattern.validator) OccultoPipeline.validators.set(regex, pattern.validator);
        compiled.push({ regex, index });
      } catch (error) {
        console.error('[Occulto] Invalid regex pattern:', pattern, error);
      }
    });
    return compiled;
  }

  static isIgnored(text: string, ignoreRegexes: RegExp[]): boolean {
    return ignoreRegexes.some((regex) => {
      regex.lastIndex = 0;
      return regex.test(text);
    });
  }

  static findCensorRanges(text: string, regexes: RegExp[]): TextRange[] {
    const ranges: TextRange[] = [];
    regexes.forEach((regex, source) => {
      const validator = OccultoPipeline.validators.get(regex);
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        if (match[0].length === 0) {
          // With the u flag, stepping into the middle of a surrogate pair
          // would match again at the same position forever.
          regex.lastIndex += regex.unicode ? Replacer.codePointLength(text, regex.lastIndex) : 1;
          continue;
        }
        if (validator && !OccultoValidators.check(validator, match[0])) continue;
        ranges.push({ start: match.index, end: match.index + match[0].length, source });
      }
    });
    return ranges;
  }

  // Detection ranges minus those overlapping an ignore match: an exception
  // only exempts its own text, never the rest of the node.
  static findVisibleCensorRanges(text: string, censorRegexes: RegExp[], ignoreRegexes: RegExp[]): TextRange[] {
    const censor = OccultoPipeline.findCensorRanges(text, censorRegexes);
    if (censor.length === 0 || ignoreRegexes.length === 0) return censor;
    const ignored = OccultoPipeline.findCensorRanges(text, ignoreRegexes);
    return censor.filter((c) => !ignored.some((i) => c.start < i.end && i.start < c.end));
  }

  // Detection over adjacent text segments (e.g. "john@<b>acme</b>.com"):
  // returns only matches spanning 2+ segments, each split into per-segment pieces.
  static crossSegmentMatches(
    segments: string[],
    ctx: Pick<PipelineContext, 'censorRegexes' | 'ignoreRegexes'>
  ): Array<Array<{ segment: number; start: number; end: number }>> {
    const offsets: number[] = [];
    let total = 0;
    for (const segment of segments) {
      offsets.push(total);
      total += segment.length;
    }
    const ranges = OccultoPipeline.findVisibleCensorRanges(segments.join(''), ctx.censorRegexes, ctx.ignoreRegexes)
      .sort((a, b) => a.start - b.start)
      .reduce<TextRange[]>((merged, range) => {
        const last = merged[merged.length - 1];
        if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
        else merged.push({ start: range.start, end: range.end });
        return merged;
      }, []);
    const matches: Array<Array<{ segment: number; start: number; end: number }>> = [];
    for (const range of ranges) {
      const pieces = segments
        .map((segment, i) => ({
          segment: i,
          start: Math.max(range.start, offsets[i]) - offsets[i],
          end: Math.min(range.end, offsets[i] + segment.length) - offsets[i],
        }))
        .filter((piece) => piece.end > piece.start);
      if (pieces.length > 1) matches.push(pieces);
    }
    return matches;
  }

  static hasCensoredText(text: string, ctx: PipelineContext): boolean {
    return OccultoPipeline.findVisibleCensorRanges(text, ctx.censorRegexes, ctx.ignoreRegexes).length > 0;
  }

  // True when ignore matches cover every non-whitespace character.
  static isFullyIgnored(text: string, ignoreRegexes: RegExp[]): boolean {
    if (!text.trim()) return false;
    const covered = new Array<boolean>(text.length).fill(false);
    for (const range of OccultoPipeline.findCensorRanges(text, ignoreRegexes)) {
      covered.fill(true, range.start, range.end);
    }
    for (let i = 0; i < text.length; i++) {
      if (!covered[i] && text[i].trim() !== '') return false;
    }
    return true;
  }

  // Flattens fragments to a string for places that can't render spans
  // (tab title, tooltips, clipboard): blurred text becomes █.
  static toPlainText(fragments: RenderedFragment[]): string {
    return fragments.map((f) => (f.kind === 'blurred' ? '█'.repeat(f.original.length) : f.display)).join('');
  }

  static shouldScramble(text: string, mode: OccultoMode, settings: ScrambleSettings): boolean {
    if (mode === 'scramble') return true;
    const type = Scrambler.detectType(text.trim());
    return (type === 'ipv4' && settings.alwaysScrambleIPv4) || (type === 'ipv6' && settings.alwaysScrambleIPv6);
  }

  static processText(text: string, ctx: PipelineContext): RenderedFragment[] {
    const censor = OccultoPipeline.findVisibleCensorRanges(text, ctx.censorRegexes, ctx.ignoreRegexes);
    const replacements = ctx.replacer.findMatches(text);
    return buildFragments(text, censor, replacements).map((fragment): RenderedFragment => {
      const original = fragment.text;
      if (fragment.kind === 'replaced') {
        return { kind: 'replaced', original, display: fragment.replacement ?? original, ruleId: fragment.ruleId };
      }
      if (fragment.kind === 'censored') {
        const patterns = fragment.sources ?? [];
        if (!OccultoPipeline.shouldScramble(original, ctx.mode, ctx.scrambleSettings)) {
          return { kind: 'blurred', original, display: original, patterns };
        }
        const rendered: RenderedFragment = { kind: 'scrambled', original, display: ctx.scrambler.scramble(original), patterns };
        if (ctx.mode !== 'scramble') rendered.forced = true;
        return rendered;
      }
      return { kind: 'plain', original, display: original };
    });
  }
}
