/** Extracts plain text from editable elements */

import {
  extractGoogleDocsRenderedText,
  isGoogleDocsSurfaceRoot,
} from './google-docs-surface.js';

export function extractText(element: HTMLElement): string {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return element.value;
  }

  if (isGoogleDocsSurfaceRoot(element)) {
    return extractGoogleDocsRenderedText(element);
  }

  return element.innerText || element.textContent || '';
}
