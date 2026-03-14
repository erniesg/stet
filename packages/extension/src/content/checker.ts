/**
 * Core checker logic — shared between public stet extension and private builds.
 * Discovers editables, runs check(), annotates with LanguageTool-style UI.
 *
 * Usage:
 *   import { initChecker } from './checker.js';
 *   // register your packs first, then:
 *   initChecker();
 */

import { check, checkDocument, toCheckOptions, listPacks } from 'stet';
import type { ResolvedStetConfig, Issue, DocumentIssue } from 'stet';
import { extractText } from './text-extractor.js';
import { AnnotationManager } from './annotation-manager.js';
import { loadDictionary, loadCustomTerms } from './dictionary-loader.js';
import {
  discoverAnnotatableEditables,
  findAnnotatableEditable,
} from './editable-target.js';

const managers = new Map<HTMLElement, AnnotationManager>();
let config: ResolvedStetConfig | null = null;
const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
let selfMutating = false;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const FALLBACK_CONFIG: ResolvedStetConfig = {
  packs: ['common'], language: 'en-GB', role: 'journalist',
  packConfig: { freThreshold: 30, paragraphCharLimit: 320 },
  rules: { enable: [], disable: [] }, dictionaries: [], prompts: {},
  workflows: {}, feedback: { endpoint: null, batchSize: 20, includeContext: false },
  enabled: true, siteAllowlist: [], debounceMs: 400,
};

async function loadConfig(): Promise<ResolvedStetConfig> {
  try {
    return await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (resp) => {
        if (chrome.runtime.lastError) { reject(chrome.runtime.lastError); return; }
        resolve(resp?.config || FALLBACK_CONFIG);
      });
    });
  } catch { return FALLBACK_CONFIG; }
}

// ---------------------------------------------------------------------------
// Check + annotate
// ---------------------------------------------------------------------------

/**
 * Extract structured paragraphs from a contenteditable element.
 * Splits on block elements (p, div, br+br) and newlines.
 * First paragraph treated as headline if short (<100 chars).
 */
function extractParagraphs(element: HTMLElement): { headline?: string; body: string[] } {
  const text = extractText(element);
  // Split on double newlines (common in contenteditable output)
  const parts = text.split(/\n\n+/).map(s => s.trim()).filter(Boolean);

  if (parts.length === 0) return { body: [] };

  // Heuristic: first part is headline if it's short and has no period
  const first = parts[0];
  if (parts.length > 1 && first.length < 120 && !first.includes('.')) {
    return { headline: first, body: parts.slice(1) };
  }

  return { body: parts };
}

function getIssues(element: HTMLElement): Issue[] {
  if (!config || !config.enabled) return [];
  const text = extractText(element);
  if (!text.trim()) return [];

  const { headline, body } = extractParagraphs(element);
  const opts = toCheckOptions(config);

  // Use checkDocument for structured checking — per-paragraph limits
  const issues = checkDocument(
    { headline, body },
    { ...opts, onDiagnostic: (d) => console.warn('[stet] Rule error:', d.ruleId, d.error) },
  );

  // Convert DocumentIssue offsets to flat innerText offsets for annotation.
  // Use indexOf on the original innerText to find each section's true start
  // position, avoiding drift from trimmed whitespace or variable separators.
  const fullText = text; // innerText from extractText() above
  const flatIssues: Issue[] = [];

  // Build a map of section → start position in fullText
  const sectionStarts = new Map<string, number>();
  let searchFrom = 0;

  if (headline) {
    const hlStart = fullText.indexOf(headline, searchFrom);
    if (hlStart >= 0) {
      sectionStarts.set('headline', hlStart);
      searchFrom = hlStart + headline.length;
    }
  }

  for (let i = 0; i < body.length; i++) {
    const paraStart = fullText.indexOf(body[i], searchFrom);
    if (paraStart >= 0) {
      sectionStarts.set(`body:${i}`, paraStart);
      searchFrom = paraStart + body[i].length;
    }
  }

  for (const issue of issues) {
    const di = issue as DocumentIssue;
    let globalOffset: number;

    if (di.section === 'headline') {
      globalOffset = (sectionStarts.get('headline') ?? 0) + issue.offset;
    } else if (di.section === 'body' && di.paragraphIndex !== undefined) {
      globalOffset = (sectionStarts.get(`body:${di.paragraphIndex}`) ?? 0) + issue.offset;
    } else {
      globalOffset = issue.offset;
    }

    flatIssues.push({ ...issue, offset: globalOffset });
  }

  return flatIssues;
}

function runCheckAndAnnotate(element: HTMLElement) {
  if (selfMutating) return;
  if (!element.isContentEditable) return;

  const text = extractText(element);
  console.log(`[stet] Checking <${element.tagName.toLowerCase()}> (${text.length} chars)`);

  const issues = getIssues(element);

  if (issues.length > 0) {
    console.log(`[stet] ${issues.length} issue(s):`);
    for (const iss of issues.slice(0, 5)) {
      console.log(`  [${iss.rule}] "${iss.originalText}" → ${iss.suggestion ?? '(no fix)'}`);
    }
    if (issues.length > 5) console.log(`  ... and ${issues.length - 5} more`);
  } else {
    console.log('[stet] No issues found');
  }

  let mgr = managers.get(element);
  if (!mgr) {
    mgr = new AnnotationManager(element);
    managers.set(element, mgr);
  }

  selfMutating = true;
  try {
    mgr.annotate(issues);
  } finally {
    requestAnimationFrame(() => { selfMutating = false; });
  }

  updateBadge(issues.length);
}

function scheduleCheck(element: HTMLElement) {
  if (selfMutating) return;
  const existing = timers.get(element);
  if (existing) clearTimeout(existing);
  const delay = config?.debounceMs ?? 800;
  timers.set(element, setTimeout(() => runCheckAndAnnotate(element), delay));
}

function updateBadge(count: number) {
  try { chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', count }); } catch {}
}

// ---------------------------------------------------------------------------
// Element discovery
// ---------------------------------------------------------------------------

function attachListener(el: HTMLElement) {
  if (managers.has(el)) return;
  managers.set(el, new AnnotationManager(el));

  el.addEventListener('input', () => {
    if (selfMutating) return;
    scheduleCheck(el);
  });

  setTimeout(() => runCheckAndAnnotate(el), 300);
}

function discoverEditables() {
  discoverAnnotatableEditables().forEach(attachListener);
}

function observeDOM() {
  const observer = new MutationObserver((mutations) => {
    if (selfMutating) return;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement) {
          const editable = findAnnotatableEditable(node);
          if (editable) attachListener(editable);
          discoverAnnotatableEditables(node).forEach(attachListener);
        }
      }
    }
  });
  observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load the spell-check dictionary from CDN and cache locally.
 * Runs in the background — doesn't block checker startup.
 * Returns the word list (or empty array on failure).
 */
async function loadSpellCheckDictionary(): Promise<string[]> {
  try {
    const [words, customTerms] = await Promise.all([
      loadDictionary(),
      loadCustomTerms(),
    ]);
    return [...words, ...customTerms];
  } catch (err) {
    console.warn('[stet] Dictionary load failed:', err);
    return [];
  }
}

/** Callback type for dictionary loading hook */
export type OnDictionaryLoaded = (words: string[]) => void;

/**
 * Initialize the checker. Call this AFTER registering all packs.
 *
 * @param onDictionaryLoaded — optional callback invoked when the spell-check
 *   dictionary is ready. Packs use this to feed words into their spell-check
 *   rules (e.g., `loadWordList(words)` in bt-pack).
 */
export async function initChecker(onDictionaryLoaded?: OnDictionaryLoaded) {
  config = await loadConfig();

  // Override config packs with whatever is actually registered
  const registered = listPacks().map(p => p.id);
  config = { ...config, packs: registered };

  // Sync actual packs back to storage so popup reflects reality
  try {
    chrome.runtime.sendMessage({
      type: 'SET_RESOLVED_CONFIG',
      config,
    });
  } catch {}

  if (!config.enabled) { console.log('[stet] Disabled'); return; }

  if (config.siteAllowlist.length > 0) {
    const host = window.location.hostname;
    if (!config.siteAllowlist.some(s => host.includes(s))) return;
  }

  console.log('[stet] Active — packs:', registered.map(id => {
    const p = listPacks().find(p => p.id === id);
    return `${id} (${p?.rules.length ?? 0} rules)`;
  }).join(', '));

  discoverEditables();
  observeDOM();

  // Load dictionary in the background — doesn't block initial check
  loadSpellCheckDictionary().then((words) => {
    if (words.length > 0 && onDictionaryLoaded) {
      onDictionaryLoaded(words);
      console.log(`[stet] Dictionary ready (${words.length} words)`);
    }
  });
}
