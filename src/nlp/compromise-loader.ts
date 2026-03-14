/**
 * Lazy-loads compromise.js for POS tagging.
 * compromise is an optional peer dependency (~200KB).
 */
let nlpInstance: any = null;

export async function loadCompromise(): Promise<any> {
  if (nlpInstance) return nlpInstance;
  try {
    const mod = await import('compromise');
    nlpInstance = mod.default || mod;
    return nlpInstance;
  } catch {
    return null;
  }
}

export function getCompromise(): any {
  return nlpInstance;
}
