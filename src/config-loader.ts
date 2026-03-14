/**
 * YAML config file loader — Node/CLI only.
 *
 * Reads stet.config.yaml from disk, parses it, and calls resolveConfig()
 * to produce a ResolvedStetConfig. Not used in the browser extension.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { parse as parseYaml } from 'yaml';
import type { StetConfig, ResolvedStetConfig, DictionaryEntry } from './types.js';
import { resolveConfig } from './config.js';

const DEFAULT_CONFIG_NAMES = ['stet.config.yaml', 'stet.config.yml'];

/**
 * Find the config file by walking up from startDir.
 * Returns the absolute path or null if not found.
 */
function findConfigFile(startDir: string): string | null {
  let dir = resolve(startDir);
  const root = resolve('/');

  while (dir !== root) {
    for (const name of DEFAULT_CONFIG_NAMES) {
      const candidate = resolve(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    dir = dirname(dir);
  }
  return null;
}

/**
 * Load a YAML dictionary file and return DictionaryEntry[].
 * Expected format: array of { correct, wrong, caseSensitive?, exceptions? }
 */
function loadDictionaryFile(filePath: string, configDir: string): DictionaryEntry[] {
  const absPath = resolve(configDir, filePath);
  if (!existsSync(absPath)) return [];

  const raw = readFileSync(absPath, 'utf-8');
  const parsed = parseYaml(raw);
  if (!Array.isArray(parsed)) return [];

  return parsed.map((entry: Record<string, unknown>) => ({
    correct: String(entry.correct || ''),
    wrong: Array.isArray(entry.wrong) ? entry.wrong.map(String) : [],
    caseSensitive: entry.caseSensitive === true,
    exceptions: Array.isArray(entry.exceptions) ? entry.exceptions.map(String) : undefined,
  }));
}

/**
 * Load a prompt file and return its contents as a string.
 */
function loadPromptFile(filePath: string, configDir: string): string {
  const absPath = resolve(configDir, filePath);
  if (!existsSync(absPath)) return '';
  return readFileSync(absPath, 'utf-8');
}

/**
 * Load and resolve a stet config from a YAML file.
 *
 * @param configPath - Path to stet.config.yaml. If omitted, searches upward from cwd.
 * @returns The resolved config, or the default config if no file found.
 */
export function loadConfig(configPath?: string): ResolvedStetConfig {
  const filePath = configPath
    ? resolve(configPath)
    : findConfigFile(process.cwd());

  if (!filePath || !existsSync(filePath)) {
    return resolveConfig({ packs: ['common'] });
  }

  const raw = readFileSync(filePath, 'utf-8');
  const parsed = parseYaml(raw) as StetConfig;
  const configDir = dirname(filePath);

  // Load dictionaries from file paths
  const dictionaries: DictionaryEntry[] = [];
  if (parsed.dictionaries) {
    for (const dictPath of parsed.dictionaries) {
      dictionaries.push(...loadDictionaryFile(dictPath, configDir));
    }
  }

  // Load prompts from file paths
  const prompts: Record<string, string> = {};
  if (parsed.prompts) {
    for (const [key, value] of Object.entries(parsed.prompts)) {
      // If it looks like a file path, load it; otherwise treat as inline
      if (value.startsWith('./') || value.startsWith('/') || value.endsWith('.md') || value.endsWith('.txt')) {
        prompts[key] = loadPromptFile(value, configDir);
      } else {
        prompts[key] = value;
      }
    }
  }

  return resolveConfig(parsed, { dictionaries, prompts });
}
