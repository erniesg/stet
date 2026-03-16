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

import type { Language } from 'stet';

/** Default fallback dictionary URL — served via jsDelivr with CORS + gzip */
const DICTIONARY_VERSION = '20260317-zh-sg';
const DEFAULT_DICTIONARY_BASE_URL = 'https://cdn.jsdelivr.net/gh/erniesg/stet@main/data';
const DICTIONARY_FILES: Record<Language, string> = {
  'en-GB': 'wordlist-en.txt',
  'en-US': 'wordlist-en.txt',
  'zh-SG': 'wordlist-zh-sg.txt',
};

function getBundledDictionaryUrl(language: Language): string | null {
  try {
    return `${chrome.runtime.getURL(getDictionaryFile(language))}?v=${DICTIONARY_VERSION}`;
  } catch {
    return null;
  }
}

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
 * Returns an array of valid words for the configured language.
 */
export async function loadDictionary(
  language: Language = 'en-GB',
  url?: string,
): Promise<string[]> {
  const bundledUrl = getBundledDictionaryUrl(language);
  const resolvedUrl = url ?? bundledUrl ?? getDefaultDictionaryUrl(language);
  const useBundledAsset = bundledUrl !== null && isSameDictionaryUrl(resolvedUrl, bundledUrl);

  // Always prefer the packaged asset when it exists. It is local to the
  // extension build, so chrome.storage caching only makes it go stale.
  if (useBundledAsset) {
    try {
      const words = await fetchDictionaryWords(resolvedUrl);
      console.log(`[stet] Dictionary loaded from extension bundle (${words.length} words)`);
      return words;
    } catch (err) {
      console.warn('[stet] Bundled dictionary fetch failed, falling back to cached/CDN copy:', err);
    }
  }

  // 1. Try cache for remote dictionaries / fallback path
  const cached = await getCached();
  if (cached && cached.url === resolvedUrl && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
    console.log(`[stet] Dictionary loaded from cache (${cached.words.length} words)`);
    return cached.words;
  }

  // 2. Fetch remote fallback and cache it
  try {
    const words = await fetchDictionaryWords(resolvedUrl);
    console.log(`[stet] Dictionary fetched (${words.length} words)`);

    // 3. Cache
    await setCached({ words, fetchedAt: Date.now(), url: resolvedUrl });

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
        resolve(normalizeCustomTerms((result.stet_custom_terms as string[] | undefined) || []));
      });
    } catch {
      resolve([]);
    }
  });
}

async function fetchDictionaryWords(url: string): Promise<string[]> {
  console.log(`[stet] Fetching dictionary from ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const text = await response.text();
  return text.split('\n').map(w => w.trim()).filter(Boolean);
}

function isSameDictionaryUrl(left: string, right: string): boolean {
  return stripQuery(left) === stripQuery(right);
}

function stripQuery(url: string): string {
  const queryIndex = url.indexOf('?');
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
}

function getDefaultDictionaryUrl(language: Language): string {
  return `${DEFAULT_DICTIONARY_BASE_URL}/${getDictionaryFile(language)}?v=${DICTIONARY_VERSION}`;
}

function getDictionaryFile(language: Language): string {
  return DICTIONARY_FILES[language] ?? DICTIONARY_FILES['en-GB'];
}

/**
 * Save custom terms to chrome.storage.sync.
 */
export async function saveCustomTerms(terms: string[]): Promise<void> {
  return new Promise((resolve) => {
    try {
      chrome.storage.sync.set({ stet_custom_terms: normalizeCustomTerms(terms) }, resolve);
    } catch {
      resolve();
    }
  });
}

export function normalizeCustomTerms(terms: string[]): string[] {
  return [...new Set(terms.map(term => term.trim()).filter(Boolean))];
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
