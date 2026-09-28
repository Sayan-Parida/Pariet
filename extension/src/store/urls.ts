/**
 * URL rules for what counts as research.
 *
 * Browser-internal pages are never recorded. Pariet's own surfaces are also
 * excluded, so opening the dashboard mid-session cannot add nodes to the graph
 * being recorded.
 */

/** True when a URL is a real web page worth keeping. */
export function isResearchUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (
    lower.startsWith('chrome://') ||
    lower.startsWith('chrome-extension://') ||
    lower.startsWith('about:') ||
    lower.startsWith('edge://') ||
    lower.startsWith('devtools://') ||
    lower.startsWith('view-source:') ||
    lower.startsWith('file:') ||
    lower.startsWith('data:') ||
    lower.startsWith('javascript:')
  ) {
    return false;
  }
  if (!lower.startsWith('http://') && !lower.startsWith('https://')) return false;
  return !isOwnAppUrl(url);
}

/** Pariet's own frontend/backend on loopback. */
export function isOwnAppUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (!loopback) return false;
    return parsed.port === '' || parsed.port === '5173' || parsed.port === '8080';
  } catch {
    return false;
  }
}
