import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const traceDir = path.join(repoRoot, '.stet-debug');
const traceFile = process.env.STET_TRACE_FILE || path.join(traceDir, 'trace.ndjson');
const port = Number(process.env.STET_TRACE_PORT || 5123);

fs.mkdirSync(traceDir, { recursive: true });
fs.writeFileSync(traceFile, '', 'utf8');

let lineCount = 0;

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
}

const server = http.createServer((req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { ...corsHeaders(), 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, traceFile, lineCount }));
    return;
  }

  // Read all collected traces
  if (req.method === 'GET' && req.url === '/traces') {
    try {
      const content = fs.readFileSync(traceFile, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      const entries = lines.map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);
      res.writeHead(200, { ...corsHeaders(), 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, count: entries.length, entries }));
    } catch (error) {
      res.writeHead(500, { ...corsHeaders(), 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, message: error.message }));
    }
    return;
  }

  // Clear traces
  if (req.method === 'POST' && req.url === '/clear') {
    fs.writeFileSync(traceFile, '', 'utf8');
    lineCount = 0;
    res.writeHead(200, { ...corsHeaders(), 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method !== 'POST' || req.url !== '/trace') {
    res.writeHead(404, { ...corsHeaders(), 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false }));
    return;
  }

  const chunks = [];
  req.on('data', (chunk) => {
    chunks.push(chunk);
  });

  req.on('end', () => {
    try {
      const raw = Buffer.concat(chunks).toString('utf8');
      // sendBeacon sends text/plain — still valid JSON inside
      const payload = JSON.parse(raw);
      const line = JSON.stringify(payload);
      fs.appendFileSync(traceFile, `${line}\n`, 'utf8');
      lineCount++;

      // Also print to stdout for live tailing
      const ts = payload.timestamp || new Date().toISOString();
      const evt = payload.event || '?';
      const src = payload.source || '?';
      const seq = typeof payload.seq === 'number' ? `#${payload.seq}` : '';
      process.stdout.write(`[${ts}] ${src}${seq} ${evt}\n`);

      res.writeHead(200, { ...corsHeaders(), 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (error) {
      res.writeHead(400, { ...corsHeaders(), 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      }));
    }
  });
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`stet trace collector listening on http://127.0.0.1:${port}\n`);
  process.stdout.write(`writing trace to ${traceFile}\n`);
  process.stdout.write(`GET /traces — read all, POST /clear — reset, GET /health — status\n`);
});
