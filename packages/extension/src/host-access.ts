const DEFAULT_SITE_ALLOWLIST: string[] = [
  'localhost',
  '127.0.0.1',
  'btaitools.techinasia.com',
];

export function normalizeSiteAllowlist(hosts: unknown): string[] {
  const values = Array.isArray(hosts)
    ? hosts
        .map((value) => (typeof value === 'string' ? normalizeHostEntry(value) : ''))
        .filter(Boolean)
    : [];

  return values.length > 0 ? values : [...DEFAULT_SITE_ALLOWLIST];
}

export function parseSiteAllowlistInput(value: string): string[] {
  const entries = value
    .split(/[\n,]/)
    .map((entry) => normalizeHostEntry(entry))
    .filter(Boolean);

  return entries.length > 0 ? [...new Set(entries)] : [];
}

export function formatSiteAllowlist(hosts: unknown): string {
  return normalizeSiteAllowlist(hosts).join('\n');
}

export function isHostAllowed(hostname: string, hosts?: unknown): boolean {
  const normalizedHost = hostname.trim().toLowerCase();
  const allowlist = normalizeSiteAllowlist(hosts);

  if (allowlist.length === 0 || allowlist.includes('*')) {
    return true;
  }

  return allowlist.some((entry) => (
    normalizedHost === entry || normalizedHost.endsWith(`.${entry}`)
  ));
}

export function getDefaultSiteAllowlist(): string[] {
  return [...DEFAULT_SITE_ALLOWLIST];
}

function normalizeHostEntry(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return '';

  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withScheme);
    return url.hostname.trim().toLowerCase().replace(/^\*\./, '');
  } catch {
    return trimmed
      .replace(/^\*\./, '')
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
      .replace(/\/.*$/, '')
      .replace(/:\d+$/, '')
      .trim()
      .toLowerCase();
  }
}
