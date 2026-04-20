const express = require('express');
const Database = require('better-sqlite3');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR   = process.env.DATA_DIR   || path.join(__dirname, '../data');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../uploads');

[DATA_DIR, UPLOADS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ── Database ───────────────────────────────────────────────
const db = new Database(path.join(DATA_DIR, 'dashboard.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS workspaces (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT 'Workspace',
    pos  INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tiles (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER NOT NULL DEFAULT 1,
    url          TEXT NOT NULL,
    label        TEXT,
    tile_type    TEXT NOT NULL DEFAULT 'iframe',
    proxy_mode   INTEGER NOT NULL DEFAULT 0,
    col          INTEGER NOT NULL DEFAULT 0,
    row          INTEGER NOT NULL DEFAULT 0,
    col_span     INTEGER NOT NULL DEFAULT 4,
    row_span     INTEGER NOT NULL DEFAULT 3,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// ── Migrations for existing databases ─────────────────────
const migrations = [
  `ALTER TABLE tiles ADD COLUMN tile_type TEXT NOT NULL DEFAULT 'iframe'`,
  `ALTER TABLE tiles ADD COLUMN workspace_id INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE tiles ADD COLUMN proxy_mode INTEGER NOT NULL DEFAULT 0`,
];
migrations.forEach(sql => { try { db.exec(sql); } catch (_) {} });

// Seed default workspace if none exist
const wsCount = db.prepare('SELECT COUNT(*) as n FROM workspaces').get();
if (wsCount.n === 0) {
  db.prepare("INSERT INTO workspaces (id, name, pos) VALUES (1, 'Default', 0)").run();
}

// ── Middleware ─────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.use('/uploads', (req, res) => {
  const safe     = path.normalize(req.path).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(UPLOADS_DIR, safe);
  if (!filePath.startsWith(path.resolve(UPLOADS_DIR))) return res.status(403).send('Forbidden');
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  if (filePath.endsWith('.pdf')) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.removeHeader('Content-Security-Policy');
  }
  res.sendFile(filePath);
});

// ── Multer ─────────────────────────────────────────────────
const imgStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename:    (req, file, cb) => cb(null, `background${path.extname(file.originalname)}`)
});
const upload = multer({
  storage: imgStorage,
  fileFilter: (req, file, cb) => file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Images only')),
  limits: { fileSize: 20 * 1024 * 1024 }
});

const pdfStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename:    (req, file, cb) => cb(null, `pdf-${Date.now()}-${Math.round(Math.random()*1e6)}.pdf`)
});
const pdfUpload = multer({
  storage: pdfStorage,
  fileFilter: (req, file, cb) => file.mimetype === 'application/pdf' ? cb(null, true) : cb(new Error('PDFs only')),
  limits: { fileSize: 100 * 1024 * 1024 }
});

// ── Workspaces API ─────────────────────────────────────────

// GET all workspaces
app.get('/api/workspaces', (req, res) => {
  res.json(db.prepare('SELECT * FROM workspaces ORDER BY pos, id').all());
});

// POST create workspace
app.post('/api/workspaces', (req, res) => {
  const { name = 'Workspace' } = req.body;
  const maxPos = db.prepare('SELECT MAX(pos) as m FROM workspaces').get().m ?? -1;
  const result = db.prepare('INSERT INTO workspaces (name, pos) VALUES (?, ?)').run(name.trim() || 'Workspace', maxPos + 1);
  res.json(db.prepare('SELECT * FROM workspaces WHERE id = ?').get(result.lastInsertRowid));
});

// PUT rename workspace
app.put('/api/workspaces/:id', (req, res) => {
  const { name } = req.body;
  db.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run((name || '').trim() || 'Workspace', req.params.id);
  res.json(db.prepare('SELECT * FROM workspaces WHERE id = ?').get(req.params.id));
});

// PUT reorder workspaces — body: { order: [id, id, ...] }
app.put('/api/workspaces/reorder', (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be array' });
  const update = db.prepare('UPDATE workspaces SET pos = ? WHERE id = ?');
  const tx = db.transaction(() => order.forEach((id, i) => update.run(i, id)));
  tx();
  res.json({ success: true });
});

// DELETE workspace (cascade deletes tiles)
app.delete('/api/workspaces/:id', (req, res) => {
  const remaining = db.prepare('SELECT COUNT(*) as n FROM workspaces').get().n;
  if (remaining <= 1) return res.status(400).json({ error: 'Cannot delete last workspace' });
  db.prepare('DELETE FROM tiles WHERE workspace_id = ?').run(req.params.id);
  db.prepare('DELETE FROM workspaces WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── Tiles API (workspace-scoped) ───────────────────────────

app.get('/api/workspaces/:wsId/tiles', (req, res) => {
  res.json(db.prepare('SELECT * FROM tiles WHERE workspace_id = ? ORDER BY row, col').all(req.params.wsId));
});

app.post('/api/workspaces/:wsId/tiles', (req, res) => {
  const wsId = parseInt(req.params.wsId);
  const { url, label, tile_type = 'iframe', proxy_mode = 0, col = 0, row, col_span = 4, row_span = 3 } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });
  let targetRow = row;
  if (targetRow === undefined) {
    const last = db.prepare('SELECT MAX(row + row_span) as n FROM tiles WHERE workspace_id = ?').get(wsId);
    targetRow = last.n || 0;
  }
  const r = db.prepare(
    'INSERT INTO tiles (workspace_id, url, label, tile_type, proxy_mode, col, row, col_span, row_span) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(wsId, url, label || extractLabel(url), tile_type, proxy_mode ? 1 : 0, col, targetRow, col_span, row_span);
  res.json(db.prepare('SELECT * FROM tiles WHERE id = ?').get(r.lastInsertRowid));
});

app.put('/api/tiles/:id', (req, res) => {
  const { url, label, col, row, col_span, row_span, proxy_mode } = req.body;
  const tile = db.prepare('SELECT * FROM tiles WHERE id = ?').get(req.params.id);
  if (!tile) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE tiles SET
    url=COALESCE(?,url), label=COALESCE(?,label),
    col=COALESCE(?,col), row=COALESCE(?,row),
    col_span=COALESCE(?,col_span), row_span=COALESCE(?,row_span),
    proxy_mode=COALESCE(?,proxy_mode)
    WHERE id=?`
  ).run(url, label, col, row, col_span, row_span, proxy_mode !== undefined ? (proxy_mode ? 1 : 0) : null, req.params.id);
  res.json(db.prepare('SELECT * FROM tiles WHERE id = ?').get(req.params.id));
});

app.delete('/api/tiles/:id', (req, res) => {
  db.prepare('DELETE FROM tiles WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── Settings API ───────────────────────────────────────────
app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

app.post('/api/settings', (req, res) => {
  const { key, value } = req.body;
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  res.json({ success: true });
});

// ── Background ─────────────────────────────────────────────
app.post('/api/background', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image' });
  const url = `/uploads/${req.file.filename}`;
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('background', url);
  res.json({ url });
});

app.delete('/api/background', (req, res) => {
  db.prepare("DELETE FROM settings WHERE key='background'").run();
  try {
    fs.readdirSync(UPLOADS_DIR).filter(f => f.startsWith('background'))
      .forEach(f => fs.unlinkSync(path.join(UPLOADS_DIR, f)));
  } catch (_) {}
  res.json({ success: true });
});

// ── PDF Upload ─────────────────────────────────────────────
app.post('/api/pdf', pdfUpload.single('pdf'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No PDF' });
  const wsId  = parseInt(req.body.workspace_id) || 1;
  const url   = `/uploads/${req.file.filename}`;
  const label = req.body.label || req.file.originalname.replace(/\.pdf$/i, '');
  const last  = db.prepare('SELECT MAX(row + row_span) as n FROM tiles WHERE workspace_id = ?').get(wsId);
  const r = db.prepare(
    'INSERT INTO tiles (workspace_id, url, label, tile_type, col, row, col_span, row_span) VALUES (?,?,?,?,?,?,?,?)'
  ).run(wsId, url, label, 'pdf', 0, last.n || 0, 6, 8);
  res.json(db.prepare('SELECT * FROM tiles WHERE id = ?').get(r.lastInsertRowid));
});

// ── PDF listing ────────────────────────────────────────────
app.get('/api/pdfs', (req, res) => {
  try {
    const files = fs.readdirSync(UPLOADS_DIR)
      .filter(f => f.endsWith('.pdf'))
      .map(f => {
        const stat = fs.statSync(path.join(UPLOADS_DIR, f));
        return { filename: f, url: `/uploads/${f}`, size: stat.size, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    res.json(files);
  } catch (_) { res.json([]); }
});

app.delete('/api/pdfs/:filename', (req, res) => {
  const safe = path.basename(req.params.filename);
  if (!safe.endsWith('.pdf')) return res.status(400).json({ error: 'Not a PDF' });
  const fp = path.join(UPLOADS_DIR, safe);
  if (!fp.startsWith(path.resolve(UPLOADS_DIR))) return res.status(403).json({ error: 'Forbidden' });
  try { if (fs.existsSync(fp)) fs.unlinkSync(fp); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});


// ── Reverse proxy ──────────────────────────────────────────
// Routes: /proxy/<encodedBase>/rest/of/path
//
// The key challenge: the proxied app (e.g. Trilium) loads HTML, then its JS
// makes further requests to /api/..., /assets/... etc. Those must also flow
// through this proxy or the browser can't reach the internal host.
//
// Fix: for HTML responses we rewrite all absolute and root-relative URLs
// (in src=, href=, action=, fetch(), XHR, WebSocket) to go through /proxy/.
// For non-HTML we pipe the bytes straight through (no rewriting needed
// because the browser will resolve relative URLs against the proxy path).

const http    = require('http');
const https   = require('https');
const { URL: NodeURL } = require('url');

app.use('/proxy', (req, res) => {
  // Decode the encoded base from the first path segment.
  // e.g. /proxy/http%3A%2F%2Fhost.docker.internal%3A8088/some/path?q=1
  const raw        = req.url.slice(1);                 // strip leading /
  const slashIdx   = raw.indexOf('/');
  const encodedBase = slashIdx === -1 ? raw : raw.slice(0, slashIdx);
  const restPath    = slashIdx === -1 ? '/' : raw.slice(slashIdx);

  let targetBase, targetUrl;
  try {
    targetBase = decodeURIComponent(encodedBase);
    const baseUrl  = new NodeURL(targetBase);
    // restPath already includes query string
    targetUrl = new NodeURL(restPath, baseUrl);
  } catch (e) {
    return res.status(400).send('Bad proxy URL: ' + e.message);
  }

  const proxyBase = '/proxy/' + encodedBase; // used for URL rewriting

  const lib = targetUrl.protocol === 'https:' ? https : http;
  const options = {
    hostname: targetUrl.hostname,
    port:     targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
    path:     targetUrl.pathname + targetUrl.search,
    method:   req.method,
    headers:  { ...req.headers, host: targetUrl.host },
  };
  // Clean up headers that can cause upstream issues
  delete options.headers['if-none-match'];
  delete options.headers['if-modified-since'];
  delete options.headers['accept-encoding']; // we need to read/rewrite body

  const proxyReq = lib.request(options, proxyRes => {
    const ct = (proxyRes.headers['content-type'] || '').toLowerCase();
    const isHtml = ct.includes('text/html');
    const isJs   = ct.includes('javascript');
    const isCss  = ct.includes('text/css');
    const needsRewrite = isHtml || isJs || isCss;

    const respHeaders = { ...proxyRes.headers };
    // Strip framing-blocking headers
    delete respHeaders['x-frame-options'];
    delete respHeaders['content-security-policy'];
    delete respHeaders['content-security-policy-report-only'];
    // We'll set content-length ourselves after rewriting
    if (needsRewrite) delete respHeaders['content-length'];

    // Rewrite Location header on redirects
    if (respHeaders['location']) {
      try {
        const loc = new NodeURL(respHeaders['location'], targetUrl);
        if (loc.origin === new NodeURL(targetBase).origin) {
          respHeaders['location'] = proxyBase + loc.pathname + loc.search;
        }
      } catch (_) {}
    }

    if (!needsRewrite) {
      res.writeHead(proxyRes.statusCode, respHeaders);
      proxyRes.pipe(res, { end: true });
      return;
    }

    // Collect body for rewriting
    const chunks = [];
    proxyRes.on('data', c => chunks.push(c));
    proxyRes.on('end', () => {
      let body = Buffer.concat(chunks).toString('utf8');
      const origin = new NodeURL(targetBase).origin;

      // Helper: rewrite a URL string to go through proxy
      function rewrite(url) {
        if (!url) return url;
        // Already proxied
        if (url.startsWith('/proxy/')) return url;
        // Absolute URL pointing to the target origin
        if (url.startsWith(origin)) {
          const u = new NodeURL(url);
          return proxyBase + u.pathname + u.search;
        }
        // Root-relative URL (e.g. /api/notes)
        if (url.startsWith('/') && !url.startsWith('//')) {
          return proxyBase + url;
        }
        // Protocol-relative
        if (url.startsWith('//')) {
          return proxyBase + new NodeURL('https:' + url).pathname;
        }
        return url;
      }

      if (isHtml) {
        // Rewrite src=, href=, action=, data-src= attributes
        body = body.replace(/(src|href|action|data-src)=(['"])(.*?)/gi, (m, attr, q, val) => {
          return attr + '=' + q + rewrite(val) + q;
        });
        // Rewrite url() in inline styles
        body = body.replace(/url\((['"]?)(.*?)\)/gi, (m, q, val) => {
          return 'url(' + q + rewrite(val) + q + ')';
        });
        // Inject a base-rewrite script so dynamic JS fetches also go through proxy
        const script = `<script>
(function() {
  var _proxyBase = ${JSON.stringify(proxyBase)};
  var _origin    = ${JSON.stringify(origin)};
  function rw(u) {
    if (!u || u.startsWith('/proxy/') || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('#')) return u;
    if (u.startsWith(_origin)) return _proxyBase + new URL(u).pathname + new URL(u).search;
    if (u.startsWith('/') && !u.startsWith('//')) return _proxyBase + u;
    return u;
  }
  // Patch fetch
  var _fetch = window.fetch;
  window.fetch = function(input, init) {
    if (typeof input === 'string') input = rw(input);
    else if (input instanceof Request) input = new Request(rw(input.url), input);
    return _fetch.call(this, input, init);
  };
  // Patch XMLHttpRequest
  var _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    arguments[1] = rw(url);
    return _open.apply(this, arguments);
  };
  // Patch WebSocket
  if (window.WebSocket) {
    var _WS = window.WebSocket;
    window.WebSocket = function(url, protocols) {
      // Convert ws:// to a proxied path is complex; just block to avoid errors
      try { return new _WS(url, protocols); } catch(e) { return { send:function(){}, close:function(){}, addEventListener:function(){} }; }
    };
    window.WebSocket.prototype = _WS.prototype;
  }
})();
</script>`;
        // Insert before </head> or at top of body
        if (body.includes('</head>')) {
          body = body.replace('</head>', script + '</head>');
        } else {
          body = script + body;
        }
      } else if (isJs) {
        // Rewrite string literals that look like root-relative paths in JS
        // This catches patterns like fetch('/api/...') and xhr.open('GET', '/notes/...')
        body = body.replace(/(["'\`])(\/[a-zA-Z][^"'\`\s]*?)(["'\`])/g, (m, q1, path, q2) => {
          if (path.startsWith('/proxy/')) return m;
          return q1 + proxyBase + path + q2;
        });
      }

      res.writeHead(proxyRes.statusCode, respHeaders);
      res.end(body);
    });
  });

  proxyReq.on('error', err => {
    if (!res.headersSent) res.status(502).send('Proxy error: ' + err.message);
  });

  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    req.pipe(proxyReq, { end: true });
  } else {
    proxyReq.end();
  }
});

// ── Helpers ────────────────────────────────────────────────
function extractLabel(url) {
  try { return new URL(url.startsWith('http') ? url : `http://${url}`).hostname.replace('www.', ''); }
  catch { return url; }
}

app.listen(PORT, () => {
  console.log(`GridDock running at http://localhost:${PORT}`);
  console.log(`  Data    : ${DATA_DIR}`);
  console.log(`  Uploads : ${UPLOADS_DIR}`);
});