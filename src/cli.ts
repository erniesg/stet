#!/usr/bin/env node

/**
 * stet CLI — check files against loaded config.
 *
 * Usage:
 *   npx stet check <file>           Check a file
 *   npx stet check <file> --json    Output as JSON
 *   npx stet check <file> -c path   Use specific config file
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { loadConfig } from './config-loader.js';
import { check, toCheckOptions } from './index.js';
import type { Issue } from './types.js';

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === '--help' || command === '-h') {
  console.log(`stet — pluggable prose linter

Usage:
  stet check <file>              Check a file for style issues
  stet check <file> --json       Output issues as JSON
  stet check <file> -c <config>  Use a specific config file

Options:
  --json       Output as JSON instead of human-readable
  -c, --config Path to stet.config.yaml
  -h, --help   Show this help`);
  process.exit(0);
}

if (command === 'check') {
  const filePath = args[1];
  if (!filePath) {
    console.error('Error: no file specified. Usage: stet check <file>');
    process.exit(1);
  }

  // Parse flags
  let configPath: string | undefined;
  let jsonOutput = false;
  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--json') jsonOutput = true;
    if ((args[i] === '-c' || args[i] === '--config') && args[i + 1]) {
      configPath = args[++i];
    }
  }

  // Load config
  const config = loadConfig(configPath);
  const checkOpts = toCheckOptions(config);

  // Read and check file
  const absPath = resolve(filePath);
  let text: string;
  try {
    text = readFileSync(absPath, 'utf-8');
  } catch {
    console.error(`Error: cannot read file: ${absPath}`);
    process.exit(1);
  }

  const issues = check(text, checkOpts);

  if (jsonOutput) {
    console.log(JSON.stringify(issues, null, 2));
  } else {
    if (issues.length === 0) {
      console.log('No issues found.');
    } else {
      console.log(`Found ${issues.length} issue${issues.length === 1 ? '' : 's'}:\n`);
      for (const issue of issues) {
        printIssue(issue, text);
      }
    }
  }

  process.exit(issues.length > 0 ? 1 : 0);
} else {
  console.error(`Unknown command: ${command}. Try: stet check <file>`);
  process.exit(1);
}

function printIssue(issue: Issue, fullText: string) {
  const line = fullText.substring(0, issue.offset).split('\n').length;
  const severity = issue.severity.toUpperCase().padEnd(7);
  const fix = issue.suggestion ? ` → "${issue.suggestion}"` : '';
  console.log(`  ${severity} [${issue.rule}] L${line}: "${issue.originalText}"${fix}`);
  console.log(`           ${issue.description}\n`);
}
