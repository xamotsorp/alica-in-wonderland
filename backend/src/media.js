'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
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
    kind: r.kind || 'image',
    duration: r.duration ?? null,
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


// ---------- Видео ----------
// Файл принимается во временную папку на томе с медиа, проверяется ffprobe и пересобирается ffmpeg
// в MP4: метаданные (геопозиция, модель телефона) удаляются, индекс переносится в начало файла,
// чтобы ролик начинал играть сразу. Если кодек не H.264 (например, HEVC с iPhone) или кадр больше
// 1920 px, ролик перекодируется — так он играет во всех браузерах.

const VIDEO_EXT = /\.(mp4|m4v|mov|webm)$/i;
const incomingDir = () => path.join(config.uploadsDir, '.incoming');

const videoUpload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      fs.mkdir(incomingDir(), { recursive: true, mode: 0o700 }).then(() => cb(null, incomingDir()), cb);
    },
    filename(req, file, cb) {
      cb(null, crypto.randomUUID());
    },
  }),
  limits: { fileSize: config.maxVideoMb * 1024 * 1024, files: 1, fields: 2, parts: 3, fieldNameSize: 50 },
  fileFilter(req, file, cb) {
    // Первый фильтр; настоящая проверка — ffprobe
    cb(null, /^video\//.test(file.mimetype) || (file.mimetype === 'application/octet-stream' && VIDEO_EXT.test(file.originalname)));
  },
});

function run(cmd, args, { timeout = 60_000, encoding = 'utf8', maxBuffer = 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, encoding, maxBuffer, killSignal: 'SIGKILL', windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const e = new Error(`${cmd}: ${String(stderr || err.message).slice(0, 300)}`);
        e.badMedia = true;
        return reject(e);
      }
      return resolve(stdout);
    });
  });
}

function bad(message) {
  const e = new Error(message);
  e.badMedia = true;
  e.userMessage = message;
  return e;
}

async function probe(file) {
  const out = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=format_name,duration:stream=codec_type,codec_name,width,height,pix_fmt',
    '-of', 'json', file,
  ], { timeout: 30_000 });
  let info;
  try {
    info = JSON.parse(out);
  } catch {
    throw bad('Файл не похож на видео или повреждён');
  }
  const streams = Array.isArray(info.streams) ? info.streams : [];
  return {
    v: streams.find((st) => st.codec_type === 'video'),
    a: streams.find((st) => st.codec_type === 'audio'),
    duration: Number(info.format?.duration),
    format: String(info.format?.format_name || ''),
  };
}

async function processVideo(input, output) {
  const { v, a, duration, format } = await probe(input);
  if (!/(^|,)(mov|mp4|m4a|3gp|matroska|webm)(,|$)/.test(format)) throw bad('Нужен ролик MP4, MOV или WebM');
  if (!v || !(v.width > 0) || !(v.height > 0) || v.width > 8192 || v.height > 8192) throw bad('В файле нет видео');
  if (!Number.isFinite(duration) || duration <= 0) throw bad('Не удалось определить длительность ролика');
  if (duration > config.maxVideoSeconds) {
    throw bad(`Ролик длиннее ${Math.round(config.maxVideoSeconds / 60)} мин. Длинные видео выложите в VK Видео и вставьте ссылкой`);
  }
  const common = ['-nostdin', '-hide_banner', '-v', 'error', '-y', '-i', input, '-map', '0:v:0', '-map', '0:a:0?',
    '-map_metadata', '-1', '-map_chapters', '-1', '-dn', '-sn'];
  const tail = ['-movflags', '+faststart', '-f', 'mp4', output];
  const playable = v.codec_name === 'h264' && ['yuv420p', 'yuvj420p'].includes(v.pix_fmt)
    && Math.max(v.width, v.height) <= 1920 && (!a || ['aac', 'mp3'].includes(a.codec_name)) && !/webm|matroska/.test(format);
  if (playable) {
    await run('ffmpeg', [...common, '-c', 'copy', ...tail], { timeout: 120_000 });
  } else {
    await run('ffmpeg', [...common,
      '-vf', 'scale=w=min(1920\\,iw):h=min(1920\\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
      '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-threads', '2', ...tail], { timeout: 15 * 60_000 });
  }
  // Обложка — кадр на первой трети ролика (не дальше 2-й секунды); ffmpeg сам учитывает поворот
  const at = Math.min(2, duration / 3).toFixed(2);
  const frame = await run('ffmpeg', ['-nostdin', '-v', 'error', '-ss', at, '-i', output, '-frames:v', '1',
    '-f', 'image2pipe', '-c:v', 'png', '-'], { timeout: 60_000, encoding: 'buffer', maxBuffer: 80 * 1024 * 1024 });
  const poster = sharp(frame, { limitInputPixels: MAX_PIXELS, failOn: 'error' });
  const meta = await poster.metadata();
  const thumb = await poster.resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78, effort: 4 }).toBuffer();
  return { width: meta.width, height: meta.height, duration, thumb };
}

// Перекодирование тяжёлое: ролики обрабатываются строго по одному
let videoQueue = Promise.resolve();
function enqueue(job) {
  const next = videoQueue.then(job, job);
  videoQueue = next.catch(() => {});
  return next;
}

async function saveVideo(input, alt = '') {
  const id = crypto.randomUUID();
  const fileName = `${id}.mp4`;
  const thumbName = `${id}-thumb.webp`;
  const output = path.join(config.uploadsDir, fileName);
  try {
    const vid = await processVideo(input, output);
    await fs.chmod(output, 0o644);
    await fs.writeFile(path.join(config.uploadsDir, thumbName), vid.thumb, { flag: 'wx', mode: 0o644 });
    const { size } = await fs.stat(output);
    const { rows } = await db.query(
      `INSERT INTO media (id, file_name, thumb_name, width, height, bytes, alt, kind, duration)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'video', $8) RETURNING *`,
      [id, fileName, thumbName, vid.width, vid.height, size, String(alt).slice(0, 200), vid.duration],
    );
    return mediaRow(rows[0]);
  } catch (err) {
    await Promise.all([output, path.join(config.uploadsDir, thumbName)].map((f) => fs.unlink(f).catch(() => {})));
    throw err;
  }
}

// Для стартовых роликов: та же обработка и та же очередь, что у загрузки из админки
function saveVideoQueued(file, alt = '') {
  return enqueue(() => saveVideo(file, alt));
}

// Удаляет файл медиатеки вместе с файлами на диске (используется, если импорт не удался)
async function removeMedia(id) {
  const { rows } = await db.query('DELETE FROM media WHERE id = $1 RETURNING *', [id]);
  if (!rows[0]) return;
  await Promise.all([rows[0].file_name, rows[0].thumb_name].map((f) => fs.unlink(path.join(config.uploadsDir, f)).catch(() => {})));
}

// Остатки прерванных загрузок видео (например, после перезапуска во время обработки)
async function cleanIncoming() {
  const dir = incomingDir();
  const names = await fs.readdir(dir).catch(() => []);
  await Promise.all(names.map((n) => fs.unlink(path.join(dir, n)).catch(() => {})));
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

router.post('/media/video', requireAuth, (req, res, next) => {
  videoUpload.single('file')(req, res, async (uploadErr) => {
    const tmp = req.file?.path;
    const cleanup = () => (tmp ? fs.unlink(tmp).catch(() => {}) : undefined);
    if (uploadErr) {
      await cleanup();
      const tooBig = uploadErr.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({
        error: tooBig
          ? `Видео больше ${config.maxVideoMb} МБ. Сожмите его или выложите в VK Видео и вставьте ссылкой`
          : 'Не удалось принять файл',
      });
    }
    if (!req.file) return res.status(400).json({ error: 'Нужен видеофайл: MP4, MOV или WebM' });
    try {
      const alt = typeof req.body?.alt === 'string' ? req.body.alt.replace(/[\u0000-\u001F\u007F]/g, '').trim() : '';
      let saved;
      try {
        saved = await enqueue(() => saveVideo(tmp, alt));
      } catch (err) {
        if (!err.badMedia) throw err;
        console.error('[media] видео отклонено:', err.message);
        return res.status(400).json({ error: err.userMessage || 'Файл не похож на видео или повреждён' });
      }
      await audit(req.adminId, 'video_uploaded', req, { id: saved.id });
      return res.status(201).json(saved);
    } catch (err) {
      return next(err);
    } finally {
      await cleanup();
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
      return res.status(409).json({ error: 'Файл используется на сайте. Сначала уберите его из раздела и сохраните' });
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

module.exports = { router, listMedia, importSeedPhotos, importSeedFile, cleanIncoming, saveVideoQueued, removeMedia };
