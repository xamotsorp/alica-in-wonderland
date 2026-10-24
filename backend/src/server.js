'use strict';

const fs = require('node:fs/promises');
const express = require('express');
const config = require('./config');
const db = require('./db');
const auth = require('./auth');
const content = require('./content');
const media = require('./media');
const { renderPage } = require('./render');

const app = express();
app.disable('x-powered-by');
app.disable('etag');
app.set('trust proxy', false); // реальный IP берём только из X-Real-IP, который ставит наш nginx

// ---------- Публичная страница (кэш в памяти, сбрасывается при сохранении в админке) ----------

let pageCache = null;
content.onContentChange(() => {
  pageCache = null;
});

async function buildPage() {
  const [{ data }, list] = await Promise.all([content.getContent(), media.listMedia()]);
  return renderPage(data, new Map(list.map((m) => [m.id, m])));
}

app.get('/', async (req, res, next) => {
  try {
    if (!pageCache) pageCache = await buildPage();
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'no-cache');
    res.send(pageCache);
  } catch (err) {
    next(err);
  }
});

app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));

// ---------- API админки ----------

const api = express.Router();
api.use(auth.ipAllowlist);
api.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
});
api.use(express.json({ limit: '300kb', strict: true, type: 'application/json' }));
// Изменяющие запросы с телом принимаем только как JSON (кроме загрузки файлов)
api.use((req, res, next) => {
  const hasBody = Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding'];
  if (['PUT', 'PATCH'].includes(req.method) && hasBody && !req.is('application/json')) {
    return res.status(415).json({ error: 'Неверный формат запроса' });
  }
  return next();
});
api.use(auth.router);
api.use(content.router);
api.use(media.router);
api.use((req, res) => res.status(404).json({ error: 'Не найдено' }));
app.use('/api/admin', api);

// ---------- Ошибки: наружу без подробностей ----------

app.use((req, res) => res.status(404).type('text/plain').send('Не найдено'));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Слишком большой запрос' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Неверный формат запроса' });
  console.error('[error]', req.method, req.path, err.stack || err.message);
  return res.status(500).json({ error: 'Внутренняя ошибка. Попробуйте ещё раз' });
});

// ---------- Запуск ----------

async function start() {
  await fs.mkdir(config.uploadsDir, { recursive: true });
  await db.waitForDatabase();
  await db.migrate();
  if (await content.ensureSeed()) {
    const { data } = await content.getContent();
    await content.setSeedPhotos(await media.importSeedPhotos(
      data.projects.items.map((p) => p.title),
      data.certificates.items.map((c) => c.title),
    ));
    console.log('[api] создано стартовое содержимое из резюме');
  }
  // Уборка раз в час: просроченные сессии и записи журнала старше 180 дней
  const cleanup = () => Promise.all([
    db.query('DELETE FROM sessions WHERE expires_at < now()'),
    db.query("DELETE FROM audit_log WHERE created_at < now() - interval '180 days'"),
  ]).catch((err) => console.error('[cleanup]', err.message));
  cleanup();
  setInterval(cleanup, 3600_000).unref();
  const server = app.listen(config.port, () => console.log(`[api] слушаю порт ${config.port}`));
  server.headersTimeout = 15_000;
  server.requestTimeout = 60_000;
  const stop = () => server.close(() => db.pool.end().finally(() => process.exit(0)));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (require.main === module) {
  start().catch((err) => {
    console.error('[api] не удалось запуститься:', err.message);
    process.exit(1);
  });
}

module.exports = { app };
