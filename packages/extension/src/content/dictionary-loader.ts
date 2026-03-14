/**
 * Dictionary loader — fetches a word list from CDN, caches in chrome.storage.local.
 *
 * Flow:
 *   1. Check chrome.storage.local for cached dictionary
 *   2. If cached and fresh (< 7 days old), use it
 *   3. Otherwise, fetch from CDN, parse, cache, and return
 *   4. Caller feeds the word list into the spell check rule
 *
 * The dictionary URL is configurable via extension settings.
 * Default points to the stet repo's data directory via jsDelivr CDN.
 */

/** Default dictionary URL — served via jsDelivr with CORS + gzip */
const DEFAULT_DICTIONARY_URL =
  'https://cdn.jsdelivr.net/gh/erniesg/stet@main/data/wordlist-en.txt';

/** Cache key in chrome.storage.local */
const CACHE_KEY = 'stet_dictionary';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CachedDictionary {
  words: string[];
  fetchedAt: number;
  url: string;
}

/**
 * Load the dictionary — from cache or CDN.
 * Returns an array of valid English words.
 */
export async function loadDictionary(
  url: string = DEFAULT_DICTIONARY_URL,
): Promise<string[]> {
  // 1. Try cache
  const cached = await getCached();
  if (cached && cached.url === url && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
    console.log(`[stet] Dictionary loaded from cache (${cached.words.length} words)`);
    return cached.words;
  }

  // 2. Fetch from CDN
  try {
    console.log(`[stet] Fetching dictionary from ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const text = await response.text();
    const words = text.split('\n').map(w => w.trim()).filter(Boolean);
    console.log(`[stet] Dictionary fetched (${words.length} words)`);

    // 3. Cache
    await setCached({ words, fetchedAt: Date.now(), url });

    return words;
  } catch (err) {
    console.warn('[stet] Dictionary fetch failed, using cache fallback:', err);
    // Fall back to stale cache if available
    if (cached) return cached.words;
    return [];
  }
}

/**
 * Load custom terms from chrome.storage.sync (user-added words).
 */
export async function loadCustomTerms(): Promise<string[]> {
  return new Promise((resolve) => {
    try {
      chrome.storage.sync.get({ stet_custom_terms: [] as string[] }, (result) => {
        resolve((result.stet_custom_terms as string[] | undefined) || []);
      });
    } catch {
      resolve([]);
    }
  });
}

/**
 * Save custom terms to chrome.storage.sync.
 */
export async function saveCustomTerms(terms: string[]): Promise<void> {
  return new Promise((resolve) => {
    try {
      chrome.storage.sync.set({ stet_custom_terms: terms }, resolve);
    } catch {
      resolve();
    }
  });
}

// ---------------------------------------------------------------------------
// chrome.storage helpers
// ---------------------------------------------------------------------------

function getCached(): Promise<CachedDictionary | null> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(CACHE_KEY, (result) => {
        resolve((result[CACHE_KEY] as CachedDictionary | undefined) || null);
      });
    } catch {
      resolve(null);
    }
  });
}

function setCached(data: CachedDictionary): Promise<void> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set({ [CACHE_KEY]: data }, resolve);
    } catch {
      resolve();
    }
  });
}
