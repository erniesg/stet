(() => {
  try {
    if (window.location.hostname !== 'docs.google.com') return;

    // Known whitelisted extension id that enables Google Docs' HTML fallback.
    // This matches the prototype the user provided and is required so Stet can
    // read rendered text geometry instead of an opaque canvas surface.
    window._docs_annotate_canvas_by_ext = 'ogmnaimimemjmbakcfefmnahgdfhfami';
  } catch {}
})();
