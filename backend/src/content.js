'use strict';

const express = require('express');
const db = require('./db');
const { schema, validateContent, ValidationError, collectImageIds } = require('./schema');
const defaultContent = require('./defaultContent');
const { requireAuth, audit } = require('./auth');

const listeners = new Set();
function onContentChange(fn) {
  listeners.add(fn);
}
function notifyChange() {
  for (const fn of listeners) fn();
}

// true — если содержимое создано только что (первый запуск)
async function ensureSeed() {
  const { rowCount } = await db.query(
    'INSERT INTO site_content (id, data) VALUES (1, $1) ON CONFLICT (id) DO NOTHING',
    [JSON.stringify(validateContent(defaultContent))],
  );
  return rowCount === 1;
}

async function setSeedPhotos(ids) {
  const { data } = await getContent();
  if (ids.hero) data.hero.photo = ids.hero;
  if (ids.about) data.about.photo = ids.about;
  if (ids.hobby) data.hobbies.photo = ids.hobby;
  if (ids.contact) data.contacts.photo = ids.contact;
  (ids.certificates || []).forEach((id, i) => {
    if (id && data.certificates.items[i]) data.certificates.items[i].photo = id;
  });
  (ids.projects || []).forEach((p, i) => {
    if (!data.projects.items[i]) return;
    if (p.photo1) data.projects.items[i].photo1 = p.photo1;
    if (p.photo2) data.projects.items[i].photo2 = p.photo2;
  });
  // Пока нет фото с мероприятий — фоном служат чёрно-белое и портретное фото
  data.decor.photos = [ids.about, ids.hobby].filter(Boolean);
  await db.query('UPDATE site_content SET data = $1, updated_at = now() WHERE id = 1', [JSON.stringify(validateContent(data))]);
  notifyChange();
}

// Поля, которых ещё нет в сохранённых данных (появились в новой версии сайта), берём из стартового
// содержимого. Поля, которые очистили в админке, остаются пустыми — они в данных есть.
function fillMissing(defaults, value) {
  if (value === undefined) return defaults;
  if (defaults && value && typeof defaults === 'object' && typeof value === 'object'
      && !Array.isArray(defaults) && !Array.isArray(value)) {
    const out = { ...value };
    for (const [key, def] of Object.entries(defaults)) out[key] = fillMissing(def, value[key]);
    return out;
  }
  return value;
}

async function getContent() {
  const { rows } = await db.query('SELECT data, updated_at FROM site_content WHERE id = 1');
  if (!rows[0]) return { data: validateContent(defaultContent), updatedAt: null };
  return { data: validateContent(fillMissing(defaultContent, rows[0].data)), updatedAt: rows[0].updated_at };
}

const router = express.Router();

router.get('/schema', requireAuth, (req, res) => res.json(schema));

router.get('/content', requireAuth, async (req, res, next) => {
  try {
    res.json(await getContent());
  } catch (err) {
    next(err);
  }
});

router.put('/content', requireAuth, async (req, res, next) => {
  try {
    // Без объекта data не сохраняем ничего: иначе пустой или битый запрос стёр бы весь сайт
    const incoming = req.body?.data;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming) || !incoming.hero || !Object.keys(incoming).length) {
      return res.status(400).json({ error: 'Нет данных для сохранения. Обновите страницу и попробуйте ещё раз' });
    }
    let data;
    try {
      data = validateContent(incoming);
    } catch (err) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
      throw err;
    }
    const ids = [...collectImageIds(schema, data)];
    if (ids.length) {
      const { rows } = await db.query('SELECT id FROM media WHERE id = ANY($1::uuid[])', [ids]);
      if (rows.length !== ids.length) return res.status(400).json({ error: 'Одно из изображений удалено. Выберите его заново' });
    }
    const { rows } = await db.query(
      'UPDATE site_content SET data = $1, updated_at = now() WHERE id = 1 RETURNING updated_at',
      [JSON.stringify(data)],
    );
    await audit(req.adminId, 'content_saved', req);
    notifyChange();
    return res.json({ data, updatedAt: rows[0].updated_at });
  } catch (err) {
    return next(err);
  }
});

module.exports = { router, getContent, ensureSeed, setSeedPhotos, onContentChange, notifyChange, fillMissing };
