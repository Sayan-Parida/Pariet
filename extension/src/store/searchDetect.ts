/**
 * Search-engine URL detection.
 *
 * Ported from the backend's SearchDetector so search queries are recognised
 * identically now that detection happens in the browser rather than on a
 * server. The engine table and path rules must stay in step with what the
 * original used, or queries would silently stop being detected.
 */

interface EngineRule {
  /** Hosts this rule applies to. */
  hosts: string[];
  /** Path fragment required, or null for "any path". */
  path: string | null;
  /** Query parameter holding the search text. */
  param: string;
  engine: string;
}

const RULES: EngineRule[] = [
  { hosts: ['google.com', 'www.google.com'], path: '/search', param: 'q', engine: 'google' },
  { hosts: ['bing.com', 'www.bing.com'], path: '/search', param: 'q', engine: 'bing' },
  { hosts: ['duckduckgo.com', 'www.duckduckgo.com'], path: null, param: 'q', engine: 'duckduckgo' },
  { hosts: ['search.brave.com'], path: null, param: 'q', engine: 'brave' },
  { hosts: ['youtube.com', 'www.youtube.com'], path: '/results', param: 'search_query', engine: 'youtube' },
  { hosts: ['github.com', 'www.github.com'], path: '/search', param: 'q', engine: 'github' },
  { hosts: ['stackoverflow.com', 'www.stackoverflow.com'], path: '/search', param: 'q', engine: 'stackoverflow' }
];

export interface DetectedSearch {
  queryText: string;
  engine: string;
}

function hostMatches(host: string, candidate: string): boolean {
  return host === candidate || host.endsWith(`.${candidate}`);
}

/** Returns the search text and engine, or null if this is not a search URL. */
export function detectSearch(url: string): DetectedSearch | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();

  for (const rule of RULES) {
    if (!rule.hosts.some((candidate) => hostMatches(host, candidate))) continue;
    if (rule.path && !path.includes(rule.path)) continue;

    const value = parsed.searchParams.get(rule.param);
    if (!value || !value.trim()) continue;
    return { queryText: value.trim(), engine: rule.engine };
  }
  return null;
}

/** Hosts whose result pages are hidden from the visible research map. */
const SEARCH_ENGINE_DOMAINS = [
  'google.com',
  'www.google.com',
  'bing.com',
  'www.bing.com',
  'duckduckgo.com',
  'www.duckduckgo.com',
  'youtube.com',
  'www.youtube.com',
  'search.yahoo.com',
  'www.search.yahoo.com'
];

export function isSearchEngineUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (!SEARCH_ENGINE_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) {
      return false;
    }
    const path = parsed.pathname.toLowerCase();
    return (
      path.includes('/search') ||
      path.includes('/results') ||
      parsed.searchParams.has('q') ||
      parsed.searchParams.has('search_query') ||
      parsed.searchParams.has('p')
    );
  } catch {
    return false;
  }
}
