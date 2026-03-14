# Stet Extension Handoff

Last updated: March 15, 2026
Repo: `stet`
Branch: `main`
Committed HEAD: `6e03396`
Working tree: dirty

## Plain-English Summary

The product goal is simple:

- every editable area should have its own version history
- the visible history chip should sit next to the editable area the user is working in
- if there are multiple editables, each should save independently
- the popup should show the same per-field history state
- we should not inject UI into the editor text itself
- we should not rely on a bottom-right page widget

The main issue was not chip placement.

The main confirmed extension bug was that the checker was mutating the live DOM of a host-owned rich `contenteditable` editor. On the CPI page that editor is `BTEditor`, which already injects its own figure spans and explicitly warns not to rebuild editor HTML during input because that interferes with extensions and cursor state.

That is a known class of problem for rich editors in general. It is not unique to CPI. CPI was just the first concrete page where it showed up clearly.

## What We Are Trying To Build

### Version History

Desired behavior:

- detect the active editable surface
- assign it a stable field identity
- autosave and manual-save snapshots per field
- show one history chip near the active editable
- let the popup inspect and restore the same record
- work even when editors blur, remount, or get replaced

### Checker

Desired behavior:

- detect issues in the active editable
- show feedback without destabilizing typing, caret, selection, or composition
- avoid rewriting host editor DOM unless the editor is known-safe

These are related UX-wise, but they are different risk profiles.

## What Went Wrong

### 1. The private BT extension build was not using the shared runtime

The BT build in `hammurabi` was directly calling checker/history init instead of booting through the same shared content runtime as `stet`.

That meant BT was bypassing:

- `?stetDebug=none|checker|history|all`
- shared host checks
- shared boot/init/skip tracing
- shared page-debug bridge injection

So earlier BT isolation results were not trustworthy.

This was fixed.

### 2. The checker was mutating live rich-editor DOM

The checker was wrapping issue ranges with `stet-mark` inside live `contenteditable` DOM.

That is risky on any host-owned rich editor.

On CPI this was especially bad because the page’s own editor already injects `.fig-ref` spans and preserves its own DOM model. The CPI editor code explicitly says not to rebuild `innerHTML` during input because it destroys cursor position and interferes with Chrome extensions.

This was the strongest confirmed extension-side root cause.

### 3. The test harness had a race that looked like a product bug

The CPI page can auto-generate an article on load.

The Playwright harness was also clicking `Generate Article` immediately.

That created overlapping `/api/cpi/generate-article` requests. When that happened, `#cpiArticleOutput` could remain hidden even though the editor already had text. Those later `checker` and `history` failures were false negatives caused by the harness, not by a renderer crash.

This was fixed.

### 4. `page` mode was left in the codebase long after the goal changed

The user wanted field-anchored chip UI.

The codebase still carried legacy `page` terminology and normalization paths in:

- settings types
- override parsing
- tests
- logs
- manager state labels

Runtime behavior now normalizes `page` to `field`, but the leftover naming still causes confusion and should be cleaned up.

Important: this was confusing and wrong, but it was not the root cause of the CPI editor instability.

## Root Cause Analysis

### Strongest confirmed root cause

Confirmed:

- the extension checker was mutating live host-owned rich-editor DOM on CPI
- CPI’s editor is sensitive to external DOM rewriting
- the checker now skips inline annotation on complex `contenteditable` editors
- after that change, BT isolation runs pass and traces show no inline annotation markup being injected

Evidence:

- `packages/extension/src/content/checker.ts`
- `packages/extension/src/content/editable-target.ts`
- `bt-ai-tools/static/js/bt_editor.js`
- `.stet-debug/traces-checker.ndjson`
- `.stet-debug/traces-all.ndjson`

### Confirmed but secondary issues

Also confirmed:

- BT private build bootstrap mismatch
- Playwright article-generation race

These were real, but they were not the underlying editor-compatibility issue.

### Not confirmed

Not proven:

- `bt-pack` by itself causes the crash
- CPI page by itself is unstable without the extension
- the current patched BT build still hard-crashes the renderer

After the fixes below, I could not reproduce the hard lockup anymore.

## What “Background Checking” Vs “Fix-Apply/Restore” Means

This is the distinction that matters now.

### Background checking

Passive behavior:

- discover editables
- extract text
- run rules
- compute issue lists
- show field/popup UI

Background checking used to be dangerous because it also injected inline annotation markup into the editor. That specific risk was fixed for complex rich editors by skipping inline annotation markup entirely.

### Fix-apply

Active write behavior:

- user clicks a suggestion chip or “apply”
- extension writes replacement text into the editor

That code path still exists in `packages/extension/src/content/checker.ts` and uses:

- `replaceEditableRange(...)`
- `replaceEditableText(...)`

This is more dangerous than passive checking because it actively changes the editor content.

### Restore

Active write behavior:

- user restores an old version-history snapshot
- extension writes the full snapshot text back into the editor

That path also writes directly to the editor content and then verifies whether the host accepted the exact restored text.

Current meaning:

- passive background checking now looks safe enough on CPI
- active write paths still need dedicated validation on rich editors

So when I said “the next risky path is fix-apply/restore, not background checking,” I meant:

- the passive checker no longer rewrites CPI’s DOM inline
- the remaining risky operations are the ones that still write text back into the editor

## What Was Changed

### Shared content runtime

Added:

- `packages/extension/src/content/runtime.ts`

Updated:

- `packages/extension/src/content/index.ts`
- `hammurabi/packages/extension/src/content.ts`
- `hammurabi/packages/extension/vite.config.ts`

Effect:

- public and BT builds now use the same content bootstrap
- BT build now honors `?stetDebug=none|checker|history|all`
- BT build now copies `page-debug-bridge.js` correctly

### Complex rich-editor safety gate

Updated:

- `packages/extension/src/content/editable-target.ts`
- `packages/extension/src/content/checker.ts`

Effect:

- checker still computes issues
- checker no longer injects inline `stet-mark` wrappers into complex host-owned `contenteditable` editors
- CPI traces now show `checker:inline-annotations-skip`
- CPI traces show `afterMarks: 0`

### Crash/isolation harness

Updated:

- `tests/crash-isolation.spec.ts`

Added/expanded:

- real CPI editor interactions
- article auto-generate detection
- wait-for-existing-generation logic
- hidden-ready/error detection

Effect:

- removed a harness race
- made BT isolation runs meaningful again

### Unit coverage

Added:

- `tests/editable-annotation-support.test.ts`

Effect:

- verifies that plain text editors are considered safe for inline annotation
- verifies that host-owned rich-editor DOM with extra spans is considered unsafe

## Current Status

### What is fixed

Fixed:

- BT private build now uses the shared content runtime
- BT isolation modes are now trustworthy
- checker no longer injects inline annotation wrappers into CPI’s complex editor
- Playwright harness no longer double-triggers article generation

### What is currently passing

Verified:

- full BT sweep: `none`, `checker`, `history`, `all`
- repeated BT `all` runs: 3/3 passed

Current artifacts:

- `.stet-debug/result-none.json`
- `.stet-debug/result-checker.json`
- `.stet-debug/result-history.json`
- `.stet-debug/result-all.json`
- `.stet-debug/traces-none.ndjson`
- `.stet-debug/traces-checker.ndjson`
- `.stet-debug/traces-history.ndjson`
- `.stet-debug/traces-all.ndjson`

### What is not yet proven

Still not proven:

- active checker apply is safe on CPI and other rich editors
- version-history restore is safe on CPI and other rich editors
- Quill pages have been manually stress-tested with the patched BT build

## Is This CPI-Only

No.

This is a rich-editor compatibility problem, not a CPI-only problem.

Current editor landscape in `bt-ai-tools`:

- CPI uses custom `BTEditor` on a live `contenteditable`
- other pages use Quill

That means the risk class applies to:

- CPI `BTEditor`
- Quill pages
- any Gmail/ProseMirror/DraftJS/Slate-style host editor

The fix should therefore be policy-based:

- do not inline-mutate complex host-owned rich editors unless there is an editor-specific adapter

## Should We Change The CPI Editor

Not as the first move.

The better fix is in the extension:

- history stays field-anchored
- checker avoids inline DOM mutation on complex rich editors
- active write paths get explicit safety policy

Only change the editor if there is a clear product need that the extension cannot support safely otherwise.

## Why `page` Mode Is Still Mentioned

Because cleanup is incomplete.

Current reality:

- `history-settings.ts` still defines `HistoryUiMode = 'off' | 'page' | 'field'`
- stored/query/window `page` inputs normalize to `field`
- manager logs still emit `uiMode: this.isFieldMode ? 'field' : 'page'`
- `isFieldMode` is effectively `requestedUiMode !== 'off'`

Meaning:

- `page` is effectively dead as a real runtime UX mode
- `page` still survives as legacy type and logging terminology

This should be cleaned up so the code matches the product intent.

## How To Work On This Safely

### 1. Always test the correct extension path

Chrome must load:

- `/Users/erniesg/code/erniesg/hammurabi/packages/extension/dist`

Not:

- `/Users/erniesg/code/erniesg/hammurabi/packages/extension`

If Chrome loads the package root, it will say the manifest is missing or unreadable because `manifest.json` is inside `dist`.

### 2. Build the BT extension before testing

From:

- `/Users/erniesg/code/erniesg/hammurabi/packages/extension`

Run:

- `npm run build`

### 3. Run CPI isolation against the BT build explicitly

From:

- `/Users/erniesg/code/erniesg/stet`

Run:

- `STET_EXTENSION_PATH=/Users/erniesg/code/erniesg/hammurabi/packages/extension/dist npm run test:crash`

### 4. Keep the mental split between passive and active behaviors

When debugging, separate:

- passive checking
- active issue apply
- active snapshot restore

Do not treat “checker” as one undifferentiated thing.

### 5. Treat complex rich editors as no-inline-mutation zones

Safe default:

- compute state
- show anchored UI
- do not wrap text inline

Only add richer behavior through explicit adapters or proven-safe paths.

## Suggested Next Steps

### Immediate next step

Decide policy for active write paths on complex rich editors.

Recommended default:

- keep passive background checking enabled
- keep field-anchored version-history chip enabled
- disable checker apply on complex rich editors unless proven safe
- disable snapshot restore on complex rich editors unless proven safe

That is the conservative path.

### Follow-up cleanup

Clean up legacy `page` terminology:

- remove `page` from `HistoryUiMode`
- remove `page` normalization branches once migration is handled
- update logs/tests/labels to speak only in terms of `field` or `off`

This is mostly cleanup and clarity, not crash prevention.

### Expand verification

Add targeted tests for:

- checker apply on CPI
- snapshot restore on CPI
- checker apply on Quill
- snapshot restore on Quill

If these fail, fall back to disabling those actions on complex rich editors.

### Optional future direction

If richer support is needed later, add editor-specific adapters:

- BTEditor adapter
- Quill adapter

Do not attempt one generic “works on all rich editors” write strategy unless it is proven in practice.

## Recommended Product/Engineering Position

This is the clean position to take:

- history UI is field-anchored and per-editable
- no page widget
- no inline history UI inside editor text
- passive checker support is okay on complex editors if it does not mutate editor DOM
- active write operations on complex editors must be explicitly earned, not assumed

## File Map

Primary files:

- `packages/extension/src/content/runtime.ts`
- `packages/extension/src/content/checker.ts`
- `packages/extension/src/content/editable-target.ts`
- `packages/extension/src/content/version-history-manager.ts`
- `packages/extension/src/history-settings.ts`
- `tests/crash-isolation.spec.ts`
- `tests/editable-annotation-support.test.ts`
- `hammurabi/packages/extension/src/content.ts`
- `hammurabi/packages/extension/vite.config.ts`
- `bt-ai-tools/static/js/bt_editor.js`
- `bt-ai-tools/templates/cpi_upload.html`

## Bottom Line

What is most likely true now:

- the extension-side DOM mutation conflict was real
- that conflict is fixed for passive checking on CPI
- the latest BT build no longer reproduces the lockup in the current isolation/stress runs

What still needs deliberate work:

- active apply
- active restore
- cleanup of dead `page` terminology

Do not restart this from “move the chip around.”

The chip placement goal is already understood.

The remaining work is editor-write safety and cleanup.
