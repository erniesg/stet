/**
 * Textarea-to-contenteditable mirror.
 *
 * When the checker discovers a <textarea>, this module creates a contenteditable
 * div that visually replaces the textarea. The mirror:
 *
 *   1. Matches the textarea's computed style exactly (font, padding, border, etc.)
 *   2. Lets the user type in the contenteditable
 *   3. Syncs content back to the hidden textarea on every input (for form submission)
 *   4. Supports inline <stet-mark> annotations (because it's a contenteditable)
 *   5. Hides the original textarea but keeps it in the DOM
 *   6. Supports resize when the textarea had resize enabled
 *
 * This is the same technique Grammarly and LanguageTool use for textarea support.
 */

const mirrorMap = new WeakMap<HTMLTextAreaElement, HTMLDivElement>();
const mirrorToTextarea = new WeakMap<HTMLDivElement, HTMLTextAreaElement>();
const cleanupMap = new WeakMap<HTMLTextAreaElement, () => void>();

/** Style properties copied from the textarea to the mirror div. */
const COPIED_STYLES = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'fontVariant',
  'fontStretch',
  'lineHeight',
  'letterSpacing',
  'wordSpacing',
  'textAlign',
  'textIndent',
  'textTransform',
  'textDecoration',
  'color',
  'backgroundColor',
  'caretColor',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderTopStyle',
  'borderRightStyle',
  'borderBottomStyle',
  'borderLeftStyle',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomLeftRadius',
  'borderBottomRightRadius',
  'boxShadow',
  'outline',
  'outlineOffset',
  'direction',
  'tabSize',
] as const;

/**
 * Creates a contenteditable mirror for a textarea element.
 *
 * The mirror replaces the textarea visually but keeps it in the DOM
 * for form submission. Content is synced bidirectionally.
 *
 * Returns the mirror div, or null if the textarea is already mirrored or
 * cannot be mirrored.
 */
export function createTextareaMirror(textarea: HTMLTextAreaElement): HTMLDivElement | null {
  if (!(textarea instanceof HTMLTextAreaElement)) return null;
  if (mirrorMap.has(textarea)) return mirrorMap.get(textarea)!;
  if (!textarea.isConnected) return null;

  // Build the mirror div
  const mirror = document.createElement('div');
  mirror.setAttribute('contenteditable', 'plaintext-only');
  mirror.setAttribute('role', 'textbox');
  mirror.setAttribute('aria-multiline', 'true');
  mirror.dataset.stetTextareaMirror = 'true';

  // Copy identifying attributes for debugging
  if (textarea.id) {
    mirror.dataset.stetOriginalTextarea = textarea.id;
  } else if (textarea.name) {
    mirror.dataset.stetOriginalTextarea = textarea.name;
  }

  // Copy aria-label / placeholder for accessibility
  const ariaLabel = textarea.getAttribute('aria-label');
  if (ariaLabel) mirror.setAttribute('aria-label', ariaLabel);
  const placeholder = textarea.getAttribute('placeholder');
  if (placeholder) mirror.dataset.placeholder = placeholder;

  // Disable browser's native spellcheck — stet handles it
  mirror.spellcheck = false;

  // Copy computed styles from the textarea
  copyTextareaStyles(textarea, mirror);

  // Essential layout styles for contenteditable to behave like a textarea
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.wordWrap = 'break-word';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.overflowY = 'auto';
  mirror.style.overflowX = 'hidden';
  mirror.style.display = 'block';
  mirror.style.boxSizing = 'border-box';

  // Initialize content
  mirror.textContent = textarea.value;

  // Insert mirror after textarea, then hide the textarea
  textarea.parentNode!.insertBefore(mirror, textarea.nextSibling);
  textarea.style.display = 'none';

  // Store mappings
  mirrorMap.set(textarea, mirror);
  mirrorToTextarea.set(mirror, textarea);

  // --- Sync: mirror → textarea ---
  const onMirrorInput = () => {
    const text = mirror.textContent || '';
    setTextareaValueNative(textarea, text);
    dispatchNativeEvents(textarea);
  };
  mirror.addEventListener('input', onMirrorInput);

  // --- Sync: textarea → mirror (programmatic .value changes) ---
  // Intercept .value setter on this specific textarea instance
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  );
  let interceptorInstalled = false;
  if (originalDescriptor?.set && originalDescriptor?.get) {
    const nativeGet = originalDescriptor.get;
    const nativeSet = originalDescriptor.set;
    try {
      Object.defineProperty(textarea, 'value', {
        configurable: true,
        enumerable: true,
        get() {
          return nativeGet.call(textarea);
        },
        set(newValue: string) {
          nativeSet.call(textarea, newValue);
          // Sync to mirror only if the text actually differs
          if (mirror.textContent !== newValue) {
            mirror.textContent = newValue;
          }
        },
      });
      interceptorInstalled = true;
    } catch {
      // Some environments may not allow redefining the property
    }
  }

  // Fallback: poll for programmatic changes if interceptor failed
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  if (!interceptorInstalled) {
    let lastKnownValue = textarea.value;
    pollTimer = setInterval(() => {
      if (!textarea.isConnected || !mirror.isConnected) {
        if (pollTimer) clearInterval(pollTimer);
        return;
      }
      const current = textarea.value;
      if (current !== lastKnownValue) {
        lastKnownValue = current;
        if (mirror.textContent !== current) {
          mirror.textContent = current;
        }
      }
    }, 500);
  }

  // --- Handle resize ---
  const computedResize = window.getComputedStyle(textarea).resize;
  if (computedResize === 'both' || computedResize === 'vertical' || computedResize === 'horizontal') {
    mirror.style.resize = computedResize;
  }

  // Sync mirror size back to textarea (for form-related JS that reads dimensions)
  let resizeObserver: ResizeObserver | null = null;
  try {
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === mirror) {
          textarea.style.width = `${entry.contentRect.width}px`;
          textarea.style.height = `${entry.contentRect.height}px`;
        }
      }
    });
    resizeObserver.observe(mirror);
  } catch {
    // ResizeObserver may not be available in very old browsers
  }

  // --- Focus forwarding ---
  // If something tries to focus the textarea, redirect to mirror
  const onTextareaFocus = () => {
    mirror.focus();
  };
  textarea.addEventListener('focus', onTextareaFocus);

  // --- Cleanup registration ---
  cleanupMap.set(textarea, () => {
    mirror.removeEventListener('input', onMirrorInput);
    textarea.removeEventListener('focus', onTextareaFocus);

    if (pollTimer) clearInterval(pollTimer);
    if (resizeObserver) resizeObserver.disconnect();

    // Restore the native value descriptor
    if (interceptorInstalled) {
      try {
        delete (textarea as unknown as Record<string, unknown>).value;
      } catch {
        // If we can't delete the override, restore the original descriptor
        if (originalDescriptor) {
          try {
            Object.defineProperty(textarea, 'value', originalDescriptor);
          } catch { /* best effort */ }
        }
      }
    }

    // Show the textarea again
    textarea.style.display = '';

    // Remove the mirror
    if (mirror.isConnected) mirror.remove();

    // Clean up maps
    mirrorMap.delete(textarea);
    mirrorToTextarea.delete(mirror);
    cleanupMap.delete(textarea);
  });

  console.log(
    `[stet] Created textarea mirror for ${textarea.id || textarea.name || 'unnamed textarea'}`,
  );

  return mirror;
}

/**
 * Returns true if the given textarea already has a mirror attached.
 */
export function isMirroredTextarea(textarea: HTMLTextAreaElement): boolean {
  return mirrorMap.has(textarea);
}

/**
 * Returns the mirror div for a textarea, or null if none exists.
 */
export function getMirrorForTextarea(textarea: HTMLTextAreaElement): HTMLDivElement | null {
  return mirrorMap.get(textarea) ?? null;
}

/**
 * Returns the original textarea for a mirror div, or null if the element
 * is not a mirror.
 */
export function getTextareaForMirror(mirror: HTMLElement): HTMLTextAreaElement | null {
  if (!(mirror instanceof HTMLDivElement)) return null;
  return mirrorToTextarea.get(mirror) ?? null;
}

/**
 * Returns true if the given element is a textarea mirror.
 */
export function isTextareaMirror(element: HTMLElement): boolean {
  return element.dataset.stetTextareaMirror === 'true';
}

/**
 * Destroys the mirror for a textarea, restoring the original textarea.
 */
export function destroyTextareaMirror(textarea: HTMLTextAreaElement): void {
  const cleanup = cleanupMap.get(textarea);
  if (cleanup) cleanup();
}

/**
 * Destroys all active textarea mirrors.
 */
export function destroyAllTextareaMirrors(): void {
  // We can't iterate a WeakMap, so we rely on the DOM to find mirrors
  const mirrors = document.querySelectorAll<HTMLDivElement>('[data-stet-textarea-mirror="true"]');
  for (const mirror of mirrors) {
    const textarea = mirrorToTextarea.get(mirror);
    if (textarea) {
      destroyTextareaMirror(textarea);
    } else {
      // Orphaned mirror — just remove it
      mirror.remove();
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function copyTextareaStyles(textarea: HTMLTextAreaElement, mirror: HTMLDivElement): void {
  const computed = window.getComputedStyle(textarea);

  for (const prop of COPIED_STYLES) {
    try {
      (mirror.style as unknown as Record<string, string>)[prop] = computed[prop];
    } catch {
      // Ignore read-only or unsupported properties
    }
  }

  // Copy size explicitly — use the textarea's rendered dimensions
  const rect = textarea.getBoundingClientRect();
  mirror.style.width = `${rect.width}px`;
  mirror.style.minHeight = `${rect.height}px`;

  // Copy min/max dimensions if set
  const minWidth = computed.minWidth;
  const maxWidth = computed.maxWidth;
  const minHeight = computed.minHeight;
  const maxHeight = computed.maxHeight;

  if (minWidth && minWidth !== 'none' && minWidth !== '0px') mirror.style.minWidth = minWidth;
  if (maxWidth && maxWidth !== 'none') mirror.style.maxWidth = maxWidth;
  if (minHeight && minHeight !== 'none' && minHeight !== '0px') mirror.style.minHeight = minHeight;
  if (maxHeight && maxHeight !== 'none') mirror.style.maxHeight = maxHeight;
}

function setTextareaValueNative(textarea: HTMLTextAreaElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  );
  if (descriptor?.set) {
    descriptor.set.call(textarea, value);
  } else {
    textarea.value = value;
  }
}

function dispatchNativeEvents(textarea: HTMLTextAreaElement): void {
  try {
    textarea.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: false,
      inputType: 'insertReplacementText',
      data: null,
    }));
  } catch {
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
}
