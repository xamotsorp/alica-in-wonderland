'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const config = require('./config');
const db = require('./db');
const { requireAuth, audit } = require('./auth');
const { schema, collectImageIds, UUID_RE } = require('./schema');
const content = require('./content');

// Ограничиваем память и параллелизм обработки изображений
sharp.cache(false);
sharp.concurrency(1);

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif', 'gif', 'heif']);
const MAX_PIXELS = 50_000_000; // защита от «бомб» — картинок с огромным разрешением

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1, fields: 2, parts: 3, fieldNameSize: 50 },
  fileFilter(req, file, cb) {
    // MIME от браузера не доверяем, это лишь первый фильтр; настоящую проверку делает sharp.
    cb(null, /^image\//.test(file.mimetype));
  },
});

function mediaRow(r) {
  return {
    id: r.id,
    url: `/media/${r.file_name}`,
    thumb: `/media/${r.thumb_name}`,
    width: r.width,
    height: r.height,
    bytes: r.bytes,
    alt: r.alt,
    createdAt: r.created_at,
  };
}

async function listMedia() {
  const { rows } = await db.query('SELECT * FROM media ORDER BY created_at DESC');
  return rows.map(mediaRow);
}

// Перекодирование в WebP: убирает EXIF (геопозицию, модель телефона) и любой «полезный груз» в файле.
async function processImage(buffer) {
  const input = sharp(buffer, { limitInputPixels: MAX_PIXELS, failOn: 'error', animated: false });
  const meta = await input.metadata();
  if (!ALLOWED_FORMATS.has(meta.format)) throw new Error('unsupported');
  const base = sharp(buffer, { limitInputPixels: MAX_PIXELS, failOn: 'error', animated: false }).rotate();
  const full = await base.clone()
    .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toBuffer({ resolveWithObject: true });
  const thumb = await base.clone()
    .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78, effort: 4 })
    .toBuffer();
  return { full: full.data, width: full.info.width, height: full.info.height, thumb };
}

async function saveImage(buffer, alt = '') {
  const img = await processImage(buffer);
  const id = crypto.randomUUID();
  const fileName = `${id}.webp`;
  const thumbName = `${id}-thumb.webp`;
  await fs.writeFile(path.join(config.uploadsDir, fileName), img.full, { flag: 'wx', mode: 0o644 });
  await fs.writeFile(path.join(config.uploadsDir, thumbName), img.thumb, { flag: 'wx', mode: 0o644 });
  const { rows } = await db.query(
    `INSERT INTO media (id, file_name, thumb_name, width, height, bytes, alt)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [id, fileName, thumbName, img.width, img.height, img.full.length, String(alt).slice(0, 200)],
  );
  return mediaRow(rows[0]);
}

// Стартовые фото из backend/seed/photos — только при самом первом запуске
const SEED_PHOTOS = {
  hero: { file: 'photos/hero.jpg', alt: 'Алиса, SMM-специалист' },
  about: { file: 'photos/about.jpg', alt: 'Алиса на фотосъёмке' },
  hobby: { file: 'photos/hobby.jpg', alt: 'Алиса — портрет' },
  contact: { file: 'photos/contact.jpg', alt: 'Алиса' },
};
// Фото проектов: seed/projects/01-a.jpg, 01-b.jpg … — номер совпадает с порядком проектов
const SEED_PROJECTS = 12;

async function importSeedFile(file, alt) {
  try {
    const buffer = await fs.readFile(path.join(__dirname, '..', 'seed', file));
    return (await saveImage(buffer, alt)).id;
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[seed] фото', file, err.message);
    return '';
  }
}

async function importSeedPhotos(projectTitles = [], certificateTitles = []) {
  const ids = { projects: [], certificates: [] };
  // Сканы сертификатов: seed/certificates/01.jpg, 02.jpg …
  for (let i = 0; i < certificateTitles.length; i += 1) {
    ids.certificates.push(await importSeedFile(`certificates/${String(i + 1).padStart(2, '0')}.jpg`, `Сертификат: ${certificateTitles[i]}`));
  }
  for (const [key, { file, alt }] of Object.entries(SEED_PHOTOS)) ids[key] = await importSeedFile(file, alt);
  for (let i = 0; i < Math.min(projectTitles.length, SEED_PROJECTS); i += 1) {
    const n = String(i + 1).padStart(2, '0');
    ids.projects.push({
      photo1: await importSeedFile(`projects/${n}-a.jpg`, projectTitles[i]),
      photo2: await importSeedFile(`projects/${n}-b.jpg`, projectTitles[i]),
    });
  }
  return ids;
}

const router = express.Router();

router.get('/media', requireAuth, async (req, res, next) => {
  try {
    res.json(await listMedia());
  } catch (err) {
    next(err);
  }
});

router.post('/media', requireAuth, (req, res, next) => {
  upload.single('file')(req, res, async (uploadErr) => {
    if (uploadErr) {
      const tooBig = uploadErr.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({
        error: tooBig ? `Файл больше ${config.maxUploadMb} МБ` : 'Не удалось принять файл',
      });
    }
    if (!req.file) return res.status(400).json({ error: 'Нужен файл изображения: JPG, PNG, WebP или AVIF' });
    try {
      const alt = typeof req.body?.alt === 'string' ? req.body.alt.replace(/[\u0000-\u001F\u007F]/g, '').trim() : '';
      let saved;
      try {
        saved = await saveImage(req.file.buffer, alt);
      } catch (err) {
        if (err.code) throw err; // ошибка диска или базы, а не плохой файл
        return res.status(400).json({ error: 'Файл не похож на изображение или повреждён' });
      }
      await audit(req.adminId, 'media_uploaded', req, { id: saved.id });
      return res.status(201).json(saved);
    } catch (err) {
      return next(err);
    }
  });
});

router.patch('/media/:id', requireAuth, async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Не найдено' });
    const alt = typeof req.body?.alt === 'string' ? req.body.alt.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 200) : '';
    const { rows } = await db.query('UPDATE media SET alt = $2 WHERE id = $1 RETURNING *', [req.params.id, alt]);
    if (!rows[0]) return res.status(404).json({ error: 'Не найдено' });
    content.notifyChange();
    return res.json(mediaRow(rows[0]));
  } catch (err) {
    return next(err);
  }
});

router.delete('/media/:id', requireAuth, async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Не найдено' });
    const { data } = await content.getContent();
    if (collectImageIds(schema, data).has(req.params.id)) {
      return res.status(409).json({ error: 'Фото используется на сайте. Сначала уберите его из раздела и сохраните' });
    }
    const { rows } = await db.query('DELETE FROM media WHERE id = $1 RETURNING *', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Не найдено' });
    await Promise.all(
      [rows[0].file_name, rows[0].thumb_name].map((f) => fs.unlink(path.join(config.uploadsDir, f)).catch(() => {})),
    );
    await audit(req.adminId, 'media_deleted', req, { id: req.params.id });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = { router, listMedia, importSeedPhotos, importSeedFile };
