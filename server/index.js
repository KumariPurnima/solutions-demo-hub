const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { getCatalog, SHEET_ID } = require('./lib/catalog');

const app = express();
const PORT = Number(process.env.PORT || 8080);
const publicDir = path.join(__dirname, '..', 'public');
const SYNC_SECRET = process.env.SYNC_SECRET || '';
const SYNC_WEBHOOK_URL = process.env.SYNC_WEBHOOK_URL || '';
const SITE_USERNAME = process.env.SITE_USERNAME || 'solutions';
const SITE_PASSWORD = process.env.SITE_PASSWORD || '';
const SESSION_COOKIE = 'sdh_session';
const SESSION_DAYS = 7;
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  (SITE_PASSWORD
    ? crypto.createHash('sha256').update(`sdh:${SITE_PASSWORD}`).digest('hex')
    : '');

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  const len = Math.max(aa.length, bb.length, 1);
  const pa = Buffer.alloc(len);
  const pb = Buffer.alloc(len);
  aa.copy(pa);
  bb.copy(pb);
  return aa.length === bb.length && crypto.timingSafeEqual(pa, pb);
}

function parseCookies(req) {
  const raw = String(req.get('cookie') || '');
  const out = {};
  raw.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function signSession(username) {
  const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ u: username, exp }), 'utf8').toString(
    'base64url'
  );
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

function verifySession(token) {
  if (!token || !SESSION_SECRET) return null;
  const parts = String(token).split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data || typeof data.u !== 'string' || !data.exp) return null;
    if (Date.now() > Number(data.exp)) return null;
    return data;
  } catch {
    return null;
  }
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 24 * 60 * 60}${secure}`
  );
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
  );
}

function wantsHtml(req) {
  const accept = String(req.get('accept') || '');
  return accept.includes('text/html');
}

function isPublicPath(reqPath) {
  return (
    reqPath === '/api/health' ||
    reqPath === '/api/login' ||
    reqPath === '/api/logout' ||
    reqPath === '/login.html' ||
    reqPath === '/login'
  );
}

/** Cookie session gate when SITE_PASSWORD is set. Health + login stay open. */
function requireSiteAuth(req, res, next) {
  if (!SITE_PASSWORD) return next();
  if (isPublicPath(req.path)) return next();

  const cookies = parseCookies(req);
  const session = verifySession(cookies[SESSION_COOKIE]);
  if (session) {
    req.siteUser = session.u;
    return next();
  }

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ ok: false, error: 'Authentication required' });
  }

  if (wantsHtml(req) || req.method === 'GET') {
    const nextUrl = encodeURIComponent(req.originalUrl || '/');
    return res.redirect(302, `/login.html?next=${nextUrl}`);
  }

  return res.status(401).json({ ok: false, error: 'Authentication required' });
}

app.use(requireSiteAuth);

app.post('/api/login', (req, res) => {
  if (!SITE_PASSWORD) {
    return res.json({ ok: true, auth: 'disabled' });
  }
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!safeEqual(username, SITE_USERNAME) || !safeEqual(password, SITE_PASSWORD)) {
    return res.status(401).json({ ok: false, error: 'Invalid username or password' });
  }
  const token = signSession(username);
  setSessionCookie(res, token);
  return res.json({ ok: true });
});

app.post('/api/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/login', (_req, res) => {
  res.redirect(302, '/login.html');
});

function syncAuthorized(req) {
  if (!SYNC_SECRET) return false;
  const header = String(req.get('authorization') || '');
  const bearer = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const fromBody = req.body?.secret;
  const fromQuery = req.query?.secret;
  return [bearer, fromBody, fromQuery].includes(SYNC_SECRET);
}

app.get('/api/health', async (_req, res) => {
  try {
    const catalog = await getCatalog();
    res.json({
      ok: true,
      source: catalog.source,
      demos: catalog.demos.length,
      content: catalog.content.length,
      profiles: Object.keys(catalog.profiles).length,
      sheetId: SHEET_ID,
      fetchedAt: catalog.fetchedAt,
      cached: catalog.cached,
      syncConfigured: Boolean(SYNC_SECRET && SYNC_WEBHOOK_URL),
      authEnabled: Boolean(SITE_PASSWORD),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/catalog', async (_req, res) => {
  try {
    const catalog = await getCatalog();
    res.set('Cache-Control', 'private, max-age=30');
    res.json({
      demos: catalog.demos,
      profiles: catalog.profiles,
      content: catalog.content,
      sheetUrl: catalog.sheetUrl,
      source: catalog.source,
      fetchedAt: catalog.fetchedAt,
      syncConfigured: Boolean(SYNC_SECRET && SYNC_WEBHOOK_URL),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load catalog' });
  }
});

app.get('/api/catalog/refresh', async (req, res) => {
  if (SYNC_SECRET && !syncAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  try {
    const catalog = await getCatalog({ force: true });
    res.json({
      ok: true,
      source: catalog.source,
      demos: catalog.demos.length,
      fetchedAt: catalog.fetchedAt,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** Trigger Drive→git→redeploy sync via Cursor Automation webhook (or force in-memory refresh). */
app.post('/api/sync', async (req, res) => {
  if (!SYNC_SECRET) {
    return res.status(503).json({
      ok: false,
      error: 'SYNC_SECRET is not configured on App Platform',
    });
  }
  if (!syncAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const result = {
    ok: true,
    webhookTriggered: false,
    catalog: null,
  };

  if (SYNC_WEBHOOK_URL) {
    try {
      const wh = await fetch(SYNC_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SYNC_SECRET}`,
        },
        body: JSON.stringify({
          source: 'solutions-demo-hub',
          action: 'sync-sheet',
          sheetId: SHEET_ID,
          requestedAt: new Date().toISOString(),
        }),
      });
      result.webhookTriggered = wh.ok;
      result.webhookStatus = wh.status;
      if (!wh.ok) {
        const text = await wh.text().catch(() => '');
        result.webhookError = text.slice(0, 300) || `HTTP ${wh.status}`;
      }
    } catch (err) {
      result.webhookTriggered = false;
      result.webhookError = err.message;
    }
  }

  try {
    const catalog = await getCatalog({ force: true });
    result.catalog = {
      source: catalog.source,
      demos: catalog.demos.length,
      profiles: Object.keys(catalog.profiles).length,
      content: catalog.content.length,
      fetchedAt: catalog.fetchedAt,
    };
  } catch (err) {
    result.catalogError = err.message;
  }

  if (!result.webhookTriggered && !SYNC_WEBHOOK_URL) {
    result.message =
      'Cache refreshed only. Set SYNC_WEBHOOK_URL to queue a full Drive→GitHub→redeploy sync.';
  } else if (result.webhookTriggered) {
    result.message =
      'Sync queued. Catalog updates after the automation pushes JSON and App Platform redeploys (usually a few minutes).';
  } else {
    result.ok = false;
    result.message = 'Webhook trigger failed; see webhookError.';
  }

  res.status(result.ok ? 200 : 502).json(result);
});

app.use(express.static(publicDir, { extensions: ['html'] }));

app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, () => {
  const auth = SITE_PASSWORD
    ? `cookie-auth user=${SITE_USERNAME}`
    : 'open (no SITE_PASSWORD)';
  console.log(`Solutions Demo Hub listening on :${PORT} (${auth})`);
});
