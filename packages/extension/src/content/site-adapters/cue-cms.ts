/** Adapter for CUE CMS (stub — needs VPN access to inspect DOM) */

// TODO: Phase 6 implementation
export class CueCmsAdapter {
  matches(url: string): boolean {
    return url.includes('cue.') || url.includes('escenic.');
  }
}
