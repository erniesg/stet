import { describe, expect, it } from 'vitest';

import {
  formatSiteAllowlist,
  normalizeSiteAllowlist,
  parseSiteAllowlistInput,
} from '../packages/extension/src/host-access.js';

describe('host access helpers', () => {
  it('normalizes host entries from plain hosts and urls', () => {
    expect(normalizeSiteAllowlist([
      'Mail.Google.com',
      'https://studio.workspace.google.com/mail/u/0/',
      '*.cms.example.com',
    ])).toEqual([
      'mail.google.com',
      'studio.workspace.google.com',
      'cms.example.com',
    ]);
  });

  it('parses allowlist input from textarea text', () => {
    expect(parseSiteAllowlistInput('mail.google.com\nhttps://cms.example.com/story\nmail.google.com')).toEqual([
      'mail.google.com',
      'cms.example.com',
    ]);
  });

  it('formats an allowlist as newline-separated hosts', () => {
    expect(formatSiteAllowlist(['mail.google.com', 'cms.example.com'])).toBe('mail.google.com\ncms.example.com');
  });
});
