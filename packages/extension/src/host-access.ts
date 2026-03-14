const DEFAULT_SITE_ALLOWLIST: string[] = [];

export function normalizeSiteAllowlist(hosts: unknown): string[] {
  const values = Array.isArray(hosts)
    ? hosts
        .map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
        .filter(Boolean)
    : [];

  return values.length > 0 ? values : [...DEFAULT_SITE_ALLOWLIST];
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
