const path = require('path');
const express = require('express');
const { getCatalog, SHEET_ID } = require('./lib/catalog');

const app = express();
const PORT = Number(process.env.PORT || 8080);
const publicDir = path.join(__dirname, '..', 'public');

app.disable('x-powered-by');

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
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load catalog' });
  }
});

app.get('/api/catalog/refresh', async (_req, res) => {
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

app.use(express.static(publicDir, { extensions: ['html'] }));

app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Solutions Demo Hub listening on :${PORT}`);
});
