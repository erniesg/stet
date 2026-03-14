/**
 * Crash isolation test — one browser context, 4 modes.
 * Uses a single session so the CPI PDF data persists across mode switches.
 *
 * Run:  npm run test:crash
 */

import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

// ---------------------------------------------------------------------------
// .env
// ---------------------------------------------------------------------------
(function loadDotEnv() {
  try {
    const p = path.resolve('.env');
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 0) continue;
      if (!process.env[t.slice(0, eq).trim()]) process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
  } catch {}
})();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const APP = process.env.STET_CPI_ORIGIN || 'http://127.0.0.1:5002';
const CPI_USER = process.env.STET_CPI_USER || 'stet-test';
const CPI_PASS = process.env.STET_CPI_PASSWORD || 'stet-test-pw';
const TRACE_PORT = Number(process.env.STET_TRACE_PORT || 5123);
const ARTICLE_MS = Number(process.env.STET_ARTICLE_WAIT_MS || 120_000);
const EXT = path.resolve(process.env.STET_EXTENSION_PATH || 'packages/extension/dist');
const PDF = path.resolve(process.env.STET_CPI_PDF || '../bt-ai-tools/assets/cpi/Consumer Price Developments in January 2026.pdf');
const TRACE = `http://127.0.0.1:${TRACE_PORT}`;
const OBSERVE_MS = 25_000;
const EDITOR = '#bt-editor-content[contenteditable="true"]';
const INTERACTION_SETTLE_MS = 800;

// ---------------------------------------------------------------------------
// Trace collector
// ---------------------------------------------------------------------------
interface TraceEntry {
  seq?: number; source?: string; event: string;
  timestamp: string; href: string; data: Record<string, unknown>;
}

let coll: ChildProcess | null = null;

async function ensureColl() {
  try { const r = await fetch(`${TRACE}/health`); if (r.ok) return; } catch {}
  coll = spawn('node', [path.resolve('scripts/trace-collector.mjs')], {
    env: { ...process.env, STET_TRACE_PORT: String(TRACE_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'], detached: false,
  });
  await new Promise<void>((ok, fail) => {
    const t = setTimeout(() => fail(new Error('timeout')), 5000);
    coll!.stdout?.on('data', (c: Buffer) => { if (c.toString().includes('listening')) { clearTimeout(t); ok(); } });
    coll!.on('error', e => { clearTimeout(t); fail(e); });
  });
}
async function clearTraces() { try { await fetch(`${TRACE}/clear`, { method: 'POST' }); } catch {} }
async function getTraces(): Promise<TraceEntry[]> {
  try { const r = await fetch(`${TRACE}/traces`); return ((await r.json()) as any).entries ?? []; } catch { return []; }
}

async function waitForPreviewReady(page: Page) {
  await page.waitForFunction(async () => {
    const response = await fetch('/cpi-preview-status', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
    if (!response.ok) return false;
    const status = await response.json();
    if (status?.status === 'error') {
      throw new Error(`Preview build failed: ${status.error || status.message || 'unknown error'}`);
    }
    return status?.status === 'ready';
  }, undefined, { timeout: 240_000 });

  await page.goto(`${APP}/cpi`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('#cpiPreviewContainer', { timeout: 30_000 });
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------
interface Res {
  mode: string; crashed: boolean; crashedAt: string | null;
  pageErrors: string[]; consoleErrors: string[]; stetLogs: string[];
  traces: TraceEntry[]; lastTrace: string | null;
  editorChars: number; durationMs: number;
}

interface ArticleUiState {
  outputVisible: boolean;
  statusVisible: boolean;
  errorVisible: boolean;
  buttonDisabled: boolean;
  editorChars: number;
  errorText: string;
}

interface ArticleReadyState extends ArticleUiState {
  state: 'ready' | 'error' | 'hidden-ready';
}

function fmt(r: Res) {
  const s = r.crashed ? '💥 CRASHED' : '✅ STABLE';
  const lines = [`  ${s} [${r.mode}] ${r.durationMs}ms | ${r.traces.length} traces | ${r.editorChars} chars`];
  if (r.crashedAt) lines.push(`    crashed at: ${r.crashedAt}`);
  if (r.lastTrace) lines.push(`    last trace: ${r.lastTrace}`);
  if (r.pageErrors.length) lines.push(`    page errors: ${r.pageErrors.slice(0, 3).join('; ')}`);
  if (r.consoleErrors.length) lines.push(`    console: ${r.consoleErrors.slice(0, 3).join('; ')}`);
  return lines.join('\n');
}

function dumpTraces(r: Res) {
  if (!r.traces.length) { console.log('    (no traces)'); return; }
  console.log(`    Last ${Math.min(20, r.traces.length)} traces:`);
  for (const t of r.traces.slice(-20)) {
    const d = Object.keys(t.data).length ? ` ${JSON.stringify(t.data)}` : '';
    console.log(`      [${t.timestamp}] ${t.event}${d}`);
  }
}

function isCrash(e: unknown) { const s = String(e); return s.includes('crash') || s.includes('Target closed') || s.includes('detached'); }

async function getArticleUiState(page: Page): Promise<ArticleUiState> {
  return page.evaluate((editorSelector) => {
    const isVisible = (element: Element | null): boolean => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      return !element.classList.contains('hidden')
        && style.display !== 'none'
        && style.visibility !== 'hidden';
    };

    const output = document.getElementById('cpiArticleOutput');
    const status = document.getElementById('cpiArticleStatus');
    const error = document.getElementById('cpiArticleError');
    const button = document.getElementById('cpiGenerateArticleBtn');
    const editor = document.querySelector(editorSelector);

    return {
      outputVisible: isVisible(output),
      statusVisible: isVisible(status),
      errorVisible: isVisible(error),
      buttonDisabled: button instanceof HTMLButtonElement ? button.disabled : false,
      editorChars: editor instanceof HTMLElement ? editor.innerText.trim().length : 0,
      errorText: error instanceof HTMLElement ? error.innerText.trim() : '',
    };
  }, EDITOR);
}

async function waitForArticleReady(page: Page): Promise<ArticleReadyState> {
  const handle = await page.waitForFunction((editorSelector) => {
    const isVisible = (element: Element | null): boolean => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      return !element.classList.contains('hidden')
        && style.display !== 'none'
        && style.visibility !== 'hidden';
    };

    const output = document.getElementById('cpiArticleOutput');
    const status = document.getElementById('cpiArticleStatus');
    const error = document.getElementById('cpiArticleError');
    const button = document.getElementById('cpiGenerateArticleBtn');
    const editor = document.querySelector(editorSelector);

    const state = {
      outputVisible: isVisible(output),
      statusVisible: isVisible(status),
      errorVisible: isVisible(error),
      buttonDisabled: button instanceof HTMLButtonElement ? button.disabled : false,
      editorChars: editor instanceof HTMLElement ? editor.innerText.trim().length : 0,
      errorText: error instanceof HTMLElement ? error.innerText.trim() : '',
    };

    if (state.errorVisible) return { state: 'error', ...state };
    if (state.outputVisible && state.editorChars > 100) return { state: 'ready', ...state };
    if (state.editorChars > 100 && !state.statusVisible && !state.buttonDisabled) {
      return { state: 'hidden-ready', ...state };
    }

    return null;
  }, EDITOR, { timeout: ARTICLE_MS });

  return handle.jsonValue() as Promise<ArticleReadyState>;
}

async function exerciseEditorInteractions(page: Page, mode: 'all' | 'checker' | 'history' | 'none') {
  await page.locator('#cpiArticleOutput').waitFor({ state: 'visible', timeout: 15_000 });
  const editor = page.locator(EDITOR);
  await editor.waitFor({ state: 'visible', timeout: 15_000 });
  await editor.click({ position: { x: 24, y: 24 } });

  // Put the caret at the end of the draft so edits happen inside the real editor flow.
  await page.evaluate((selector) => {
    const element = document.querySelector(selector);
    if (!(element instanceof HTMLElement)) return;

    element.focus();
    const selection = window.getSelection();
    if (!selection) return;

    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }, EDITOR);

  await page.keyboard.type(' Test');
  await page.waitForTimeout(INTERACTION_SETTLE_MS);

  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(INTERACTION_SETTLE_MS);

  await page.keyboard.press('Enter');
  await page.keyboard.type('Line');
  await page.waitForTimeout(INTERACTION_SETTLE_MS);

  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press('Shift+ArrowLeft');
  }
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(INTERACTION_SETTLE_MS);

  if (mode === 'history' || mode === 'all') {
    const historyButton = page.locator('.stet-history-button').first();
    if (await historyButton.count()) {
      await historyButton.click();
      await page.waitForTimeout(INTERACTION_SETTLE_MS);
      const closeButton = page.locator('.stet-history-close').first();
      if (await closeButton.count()) {
        await closeButton.click();
        await page.waitForTimeout(INTERACTION_SETTLE_MS);
      }
    }
  }

  if (mode === 'checker' || mode === 'all') {
    const mark = page.locator('stet-mark').first();
    if (await mark.count()) {
      await mark.click();
      await page.waitForTimeout(INTERACTION_SETTLE_MS);
      const chip = page.locator('.stet-suggestion-chip').first();
      if (await chip.count()) {
        await chip.click();
        await page.waitForTimeout(INTERACTION_SETTLE_MS);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------
test.describe('CPI crash isolation', () => {
  let ctx: BrowserContext;
  let dataReady = false;

  test.beforeAll(async () => {
    await ensureColl();
    if (!fs.existsSync(path.join(EXT, 'manifest.json')))
      throw new Error(`Extension not built at ${EXT}`);
    ctx = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
        '--no-first-run', '--disable-default-apps', '--disable-popup-blocking',
      ],
    });

    // Login once
    const page = await ctx.newPage();
    await page.goto(`${APP}/login`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.fill('#username', CPI_USER);
    await page.fill('#password', CPI_PASS);
    await page.click('button[type="submit"]');
    await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 10_000 });

    // Upload PDF once (session will remember it)
    await page.goto(`${APP}/cpi`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (!(await page.$('#cpiPreviewContainer'))) {
      if (!fs.existsSync(PDF)) throw new Error(`PDF missing: ${PDF}`);
      console.log(`  Uploading ${path.basename(PDF)}...`);
      const fi = await page.$('#cpiFile');
      await fi!.setInputFiles(PDF);
      const btn = await page.$('#cpiUploadSubmitBtn');
      if (btn) await btn.click();
      await waitForPreviewReady(page);
    }
    dataReady = true;
    console.log('  CPI data preview ready — session cached');
    await page.close();
  });

  test.afterAll(async () => {
    await ctx?.close().catch(() => {});
    if (coll) { coll.kill('SIGTERM'); coll = null; }
  });

  async function runMode(mode: 'all' | 'checker' | 'history' | 'none'): Promise<Res> {
    const t0 = Date.now();
    await clearTraces();
    const pErr: string[] = [], cErr: string[] = [], sLogs: string[] = [];
    let crashed = false, crashedAt: string | null = null, editorChars = 0;

    const page = await ctx.newPage();
    page.on('pageerror', e => pErr.push(`${e.name}: ${e.message}`));
    page.on('console', m => {
      if (m.type() === 'error') cErr.push(m.text());
      if (m.text().includes('[stet]')) sLogs.push(m.text());
    });
    page.on('crash', () => { crashed = true; crashedAt = new Date().toISOString(); });

    try {
      // Navigate with isolation param — session already has uploaded data
      const url = `${APP}/cpi?stetDebug=${mode}`;
      console.log(`    → ${url}`);
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      } catch (e) { if (isCrash(e)) { crashed = true; crashedAt = new Date().toISOString(); } else throw e; }
      if (crashed) return await fin();

      // Data preview should already be there from session
      const hasPreview = await page.$('#cpiPreviewContainer');
      if (!hasPreview) {
        console.log('      ⚠ No data preview (session lost?)');
      }

      // Generate article, but avoid racing the page's own auto-generate flow.
      const initialArticleState = await getArticleUiState(page);
      const existingGeneration =
        initialArticleState.outputVisible
        || initialArticleState.statusVisible
        || initialArticleState.buttonDisabled
        || initialArticleState.editorChars > 100;

      let articleState: ArticleReadyState | null = null;
      if (existingGeneration) {
        console.log('      Waiting for existing article generation...');
        try {
          articleState = await waitForArticleReady(page);
        } catch {
          console.log('      ⚠ Existing article generation did not settle');
        }
      } else {
        const genBtn = await page.$('#cpiGenerateArticleBtn');
        if (genBtn) {
          console.log('      Generating...');
          await genBtn.click();
          try {
            articleState = await waitForArticleReady(page);
          } catch {
            console.log('      ⚠ Article generation timeout');
          }
        }
      }

      if (articleState?.state === 'error') {
        console.log(`      ⚠ Article generation error: ${articleState.errorText || 'unknown error'}`);
      } else if (articleState?.state === 'hidden-ready') {
        console.log('      ⚠ Article editor populated while output remained hidden');
      }

      editorChars = articleState?.editorChars
        ?? await page.evaluate((s) =>
          (document.querySelector(s) as HTMLElement)?.innerText?.trim().length ?? 0, EDITOR).catch(() => 0);
      console.log(`      Editor: ${editorChars} chars`);

      if (crashed) return await fin();

      if (editorChars > 0) {
        console.log('      Exercising editor interactions...');
        try {
          await exerciseEditorInteractions(page, mode);
          editorChars = await page.evaluate((s) =>
            (document.querySelector(s) as HTMLElement)?.innerText?.trim().length ?? 0, EDITOR).catch(() => editorChars);
          console.log(`      Editor after interactions: ${editorChars} chars`);
        } catch (e) {
          if (isCrash(e)) {
            crashed = true;
            crashedAt = new Date().toISOString();
          } else {
            throw e;
          }
        }
      }

      // Observe
      console.log(`      Observing ${OBSERVE_MS / 1000}s...`);
      const deadline = Date.now() + OBSERVE_MS;
      while (Date.now() < deadline && !crashed) {
        await page.waitForTimeout(2000);
        try { await page.evaluate(() => document.readyState); }
        catch (e) { if (isCrash(e)) { crashed = true; crashedAt = new Date().toISOString(); } }
      }
    } finally {
      await page.close().catch(() => {});
    }

    async function fin(): Promise<Res> {
      await new Promise(r => setTimeout(r, 1000));
      const traces = await getTraces();
      return { mode, crashed, crashedAt, pageErrors: pErr, consoleErrors: cErr, stetLogs: sLogs,
        traces, lastTrace: traces.at(-1)?.event ?? null, editorChars, durationMs: Date.now() - t0 };
    }
    return fin();
  }

  for (const mode of ['none', 'checker', 'history', 'all'] as const) {
    test(`mode: ${mode}`, async () => {
      expect(dataReady, 'CPI data must be loaded').toBe(true);
      console.log(`\n── ${mode.toUpperCase()} ${'─'.repeat(55)}`);
      const r = await runMode(mode);
      console.log(fmt(r));
      if (r.crashed) dumpTraces(r);

      // Write per-mode traces
      const dir = path.resolve('.stet-debug');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `traces-${mode}.ndjson`),
        r.traces.map(t => JSON.stringify(t)).join('\n') + '\n');
      fs.writeFileSync(path.join(dir, `result-${mode}.json`), JSON.stringify(r, null, 2));

      if (r.crashed) {
        console.log(`\n  💥 [${mode}] CRASHED — check .stet-debug/traces-${mode}.ndjson`);
      }
      expect(r.crashed, `Renderer crashed in ${mode} mode`).toBe(false);
    });
  }
});
