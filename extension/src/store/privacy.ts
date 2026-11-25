// Keep ordinary research queries, but never persist common URL credentials.
// This is deliberately not a claim that arbitrary page text/paths are secret-free.
function isSensitiveParameter(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return /^(code|state|nonce|auth|authorization|key|apikey|accesskeyid|awsaccesskeyid|sig|signature|credential|credentials|password|passwd|pwd|secret|session|sessionid|sid|jwt|ticket|assertion|samlrequest|samlresponse|samlart|otc|otp)$/.test(normalized)
    || /(token|secret|password|signature|credential)s?$/.test(normalized)
    || /^(xamz|xgoog|oauth)/.test(normalized);
}

/** Null means the URL cannot safely be used as a research URL. */
export function redactUrl(value: string | null | undefined, depth = 0): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.username = '';
    url.password = '';
    // Fragments may contain OAuth tokens or opaque secrets without a key name.
    url.hash = '';
    const entries = [...url.searchParams.entries()];
    const keys = new Set(entries.map(([key]) => key));
    for (const key of keys) {
      if (isSensitiveParameter(key)) {
        url.searchParams.delete(key);
      } else {
        // Redirect/return URLs can hide credentials inside a second URL.
        const values = url.searchParams.getAll(key);
        const cleaned = values.map(item => {
          if (!/^https?:\/\//i.test(item)) return item;
          return depth < 2 ? redactUrl(item, depth + 1) : null;
        });
        if (cleaned.some((item, index) => item !== values[index])) {
          url.searchParams.delete(key);
          for (const item of cleaned) if (item !== null) url.searchParams.append(key, item);
        }
      }
    }
    return url.href;
  } catch {
    return null;
  }
}

/** Page titles sometimes echo the full URL, including the removed credential. */
export function redactUrlInTitle(title: string | null, original: string | null, clean: string | null): string | null {
  if (!title || !original || original === clean) return title;
  return title.split(original).join(clean ?? '[link removed]');
}
