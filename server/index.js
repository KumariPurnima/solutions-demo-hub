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

/** Browser Basic Auth when SITE_PASSWORD is set. Health checks stay open. */
function requireSiteAuth(req, res, next) {
  if (!SITE_PASSWORD) return next();
  if (req.path === '/api/health') return next();

  const header = String(req.get('authorization') || '');
  const match = header.match(/^Basic\s+(.+)$/i);
  if (match) {
    try {
      const decoded = Buffer.from(match[1], 'base64').toString('utf8');
      const colon = decoded.indexOf(':');
      const user = colon >= 0 ? decoded.slice(0, colon) : decoded;
      const pass = colon >= 0 ? decoded.slice(colon + 1) : '';
      if (safeEqual(user, SITE_USERNAME) && safeEqual(pass, SITE_PASSWORD)) {
        return next();
      }
    } catch {
      /* fall through to 401 */
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="Solutions Demo Hub", charset="UTF-8"');
  return res.status(401).send('Authentication required');
}

app.use(requireSiteAuth);

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
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/catalog', async (_req, res) => {
  try {
    const catalog = await getCatalog();
    res.set('Cache-Control', 'public, max-age=30');
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
  const auth = SITE_PASSWORD ? `basic-auth user=${SITE_USERNAME}` : 'open (no SITE_PASSWORD)';
  console.log(`Solutions Demo Hub listening on :${PORT} (${auth})`);
});
