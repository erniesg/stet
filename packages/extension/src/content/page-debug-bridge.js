(function () {
  if (window.__stetPageDebugBridgeInstalled) return;
  window.__stetPageDebugBridgeInstalled = true;

  function post(type, payload) {
    try {
      window.postMessage({
        source: 'stet-page-debug',
        type,
        href: window.location.href,
        timestamp: new Date().toISOString(),
        payload,
      }, '*');
    } catch {}
  }

  function toPayload(args) {
    return {
      args: args.map((value) => {
        if (value instanceof Error) {
          return {
            name: value.name,
            message: value.message,
            stack: value.stack || null,
          };
        }

        if (typeof value === 'string') return value;

        try {
          return JSON.parse(JSON.stringify(value));
        } catch {
          return String(value);
        }
      }),
    };
  }

  var originalWarn = console.warn;
  console.warn = function () {
    var args = Array.prototype.slice.call(arguments);
    var first = args[0];
    if (typeof first === 'string' && /tt:|trusted|trustedtypes/i.test(first)) {
      post('console-warn', toPayload(args));
    }
    return originalWarn.apply(console, args);
  };

  var originalError = console.error;
  console.error = function () {
    var args = Array.prototype.slice.call(arguments);
    post('console-error', toPayload(args));
    return originalError.apply(console, args);
  };

  window.addEventListener('error', function (event) {
    post('window-error', {
      message: event.message,
      filename: event.filename || null,
      lineno: event.lineno || null,
      colno: event.colno || null,
      stack: event.error && event.error.stack ? event.error.stack : null,
    });
  });

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    post('unhandledrejection', reason instanceof Error ? {
      name: reason.name,
      message: reason.message,
      stack: reason.stack || null,
    } : {
      message: typeof reason === 'string' ? reason : String(reason),
    });
  });
})();
