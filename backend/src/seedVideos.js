'use strict';

// Стартовые ролики из seed/videos. При запуске сервера каждый ролик импортируется ровно один раз:
// файл загружается в медиатеку, а в содержимое ДОБАВЛЯЕТСЯ карточка (в «Работы» или в ролики проекта).
// Карточки приходят СКРЫТЫМИ: Алиса смотрит их в админке и сама включает «Показывать на сайте».
// Существующие тексты, карточки и настройки не меняются. После импорта ключ записывается
// в seed_imports, поэтому удалённая в админке карточка после перезапуска не вернётся.

const fs = require('node:fs/promises');
const path = require('node:path');
const db = require('./db');
const content = require('./content');
const media = require('./media');
const { validateContent } = require('./schema');
const defaultContent = require('./defaultContent');

const DIR = path.join(__dirname, '..', 'seed', 'videos');
const MAX_WORKS = 40;
const MAX_CLIPS = 4;

const AUTO_TAG = 'Автосервис · детейлинг';

const SEED_VIDEOS = [
  {
    key: 'video:01-detailing-wash',
    file: '01-detailing-wash.mp4',
    alt: 'Reels для детейлинг-центра: мойка арок и подкапотного пространства',
    work: {
      title: 'Детейлинг: «опять на мойку отдал?»',
      tag: AUTO_TAG,
      caption: 'Reels для детейлинг-центра с крючком-диалогом в первые секунды: чем детейлинг отличается от «быстрой мойки» — пена на арках и подвеске, мойка подкапотного пространства и готовая машина в студии.',
    },
  },
  {
    key: 'video:02-autoservice-team',
    file: '02-autoservice-team.mp4',
    alt: 'Имиджевый ролик автосервиса: мастер за работой',
    work: {
      title: 'Автосервис: мастер за работой',
      tag: AUTO_TAG,
      caption: 'Имиджевый ролик для автосервиса: мастер в фирменной форме, подъёмники, двигатель и ходовая крупным планом. Показывает уровень сервиса и команду без лишних слов.',
    },
  },
  {
    key: 'video:03-autoservice-brakes',
    file: '03-autoservice-brakes.mp4',
    alt: 'Ролик автосервиса: ремонт ходовой и тормозов',
    work: {
      title: 'Ремонт ходовой и тормозов',
      tag: AUTO_TAG,
      caption: 'Ролик «как мы работаем»: машина на подъёмнике, снятое колесо, тормозной диск и подвеска. Короткие динамичные планы под вертикальный формат — процесс, которому хочется доверить машину.',
    },
  },
  {
    key: 'video:04-gisdays',
    file: '04-gisdays.mp4',
    alt: 'Ролик с GISDAYS 2026: шахматная сцена и живой концерт',
    // Ролик кладётся в проект GIS DAYS; если такого проекта нет или ролики в нём заполнены — в «Работы»
    project: /GIS\s*DAYS/i,
    clip: { title: 'Атмосфера GISDAYS 2026: шахматная сцена и живой концерт' },
    work: {
      title: 'GISDAYS 2026: атмосфера форума',
      tag: 'Конференция · ИБ',
      caption: 'Ролик с форума по информационной безопасности: шахматная айдентика сцены, полный зал и живой концерт на студенческом дне.',
    },
  },
];

// Добавляет ролик в содержимое (без побочных эффектов — удобно тестировать). Возвращает, куда добавлен.
function applySeedVideo(data, entry, mediaId) {
  const base = { visible: false, video: mediaId, videoUrl: '', shape: 'auto' };
  if (entry.project) {
    const project = (data.projects.items || []).find((p) => entry.project.test(p.title || ''));
    if (project) {
      project.videos = project.videos || [];
      if (project.videos.length < MAX_CLIPS) {
        project.videos.push({ ...base, ...entry.clip });
        return 'project';
      }
    }
  }
  data.works.items = data.works.items || [];
  if (data.works.items.length >= MAX_WORKS) return null;
  data.works.items.push({ ...base, photo: '', ...entry.work });
  return 'works';
}

async function alreadyImported(key) {
  const { rowCount } = await db.query('SELECT 1 FROM seed_imports WHERE key = $1', [key]);
  return rowCount > 0;
}

async function importOne(entry) {
  if (await alreadyImported(entry.key)) return;
  const file = path.join(DIR, entry.file);
  try {
    await fs.access(file);
  } catch {
    return;
  }
  const saved = await media.saveVideoQueued(file, entry.alt);
  const client = await db.pool.connect();
  let placed = null;
  try {
    await client.query('BEGIN');
    // Метка импорта и изменение содержимого — в одной транзакции: либо оба, либо ничего
    const mark = await client.query('INSERT INTO seed_imports (key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING key', [entry.key]);
    if (!mark.rowCount) throw Object.assign(new Error('already'), { already: true });
    const { rows } = await client.query('SELECT data FROM site_content WHERE id = 1 FOR UPDATE');
    if (!rows[0]) throw new Error('нет содержимого сайта');
    const data = validateContent(content.fillMissing(defaultContent, rows[0].data));
    placed = applySeedVideo(data, entry, saved.id);
    if (placed) {
      await client.query('UPDATE site_content SET data = $1, updated_at = now() WHERE id = 1', [JSON.stringify(validateContent(data))]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    await media.removeMedia(saved.id);
    if (err.already) return;
    throw err;
  } finally {
    client.release();
  }
  if (!placed) await media.removeMedia(saved.id);
  content.notifyChange();
  console.log(`[seed] ролик ${entry.file} добавлен: ${placed === 'project' ? 'в проект' : placed === 'works' ? 'в «Работы»' : 'некуда (список полон)'}`);
}

// Запускается в фоне после старта сервера: обработка видео может занять минуту
async function importSeedVideos() {
  for (const entry of SEED_VIDEOS) {
    try {
      await importOne(entry);
    } catch (err) {
      // Не помечаем как импортированный — попробуем при следующем запуске
      console.error(`[seed] ролик ${entry.file} не импортирован:`, err.message);
    }
  }
}

module.exports = { importSeedVideos, applySeedVideo, SEED_VIDEOS };
