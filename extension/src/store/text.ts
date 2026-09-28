/** Text normalization shared by search detection and session-scoped search. */

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her',
  'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how',
  'its', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy', 'did',
  'she', 'use', 'with'
]);

/** Lowercase, trim, collapse whitespace. */
export function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Meaningful search terms, in first-seen order, excluding short/stop words. */
export function terms(value: string): string[] {
  const cleaned = value.replace(/[^\p{L}\p{Nd}_-]/gu, ' ').split(/\s+/);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of cleaned) {
    const t = token.trim().toLowerCase();
    if (t.length < 2) continue;
    if (STOP_WORDS.has(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}
