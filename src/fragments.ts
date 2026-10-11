// Merges detection (censor) ranges with replace matches into ordered fragments.

function buildFragments(
  text: string,
  censorRanges: TextRange[],
  replaceMatches: ReplaceMatch[]
): TextFragment[] {
  type Merged = { start: number; end: number; sources: number[] };
  const sorted = censorRanges.map((r) => ({ ...r })).sort((a, b) => a.start - b.start);
  const merged: Merged[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
      if (range.source !== undefined && !last.sources.includes(range.source)) last.sources.push(range.source);
    } else {
      merged.push({ start: range.start, end: range.end, sources: range.source === undefined ? [] : [range.source] });
    }
  }

  const kept = replaceMatches.filter((m) => !merged.some((c) => m.start < c.end && c.start < m.end));

  type Piece = { start: number; end: number; kind: FragmentKind; replacement?: string; ruleId?: string; sources?: number[] };
  const pieces: Piece[] = [
    ...merged.map((c): Piece => ({ start: c.start, end: c.end, kind: 'censored', sources: c.sources })),
    ...kept.map(
      (m): Piece => ({ start: m.start, end: m.end, kind: 'replaced', replacement: m.replacement, ruleId: m.ruleId })
    ),
  ].sort((a, b) => a.start - b.start);

  const fragments: TextFragment[] = [];
  let pos = 0;
  for (const piece of pieces) {
    if (piece.start > pos) {
      fragments.push({ text: text.slice(pos, piece.start), kind: 'plain' });
    }
    const fragment: TextFragment = { text: text.slice(piece.start, piece.end), kind: piece.kind };
    if (piece.kind === 'replaced') {
      fragment.replacement = piece.replacement;
      fragment.ruleId = piece.ruleId;
    } else if (piece.sources && piece.sources.length > 0) {
      fragment.sources = [...piece.sources].sort((a, b) => a - b);
    }
    fragments.push(fragment);
    pos = Math.max(pos, piece.end);
  }
  if (pos < text.length || fragments.length === 0) {
    fragments.push({ text: text.slice(pos), kind: 'plain' });
  }
  return fragments;
}
