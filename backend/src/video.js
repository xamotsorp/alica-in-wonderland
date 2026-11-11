'use strict';

// Ссылки на ролики VK Видео, YouTube и Rutube. Из ссылки берём только id ролика и собираем
// адрес плеера сами — так в страницу не попадёт ничего, кроме этих трёх плееров.
// Можно вставить обычную ссылку, ссылку «Поделиться» или целиком код <iframe>.

const PROVIDERS = {
  vk: { name: 'VK Видео', origin: 'https://vkvideo.ru' },
  youtube: { name: 'YouTube', origin: 'https://www.youtube-nocookie.com' },
  rutube: { name: 'Rutube', origin: 'https://rutube.ru' },
};

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const RUTUBE_ID = /^[0-9a-f]{32}$/;
const VK_PAIR = /^(clip|video)(-?\d{1,12})_(\d{1,12})$/;

function hostOf(url) {
  return url.hostname.toLowerCase().replace(/^(www|m)\./, '');
}

function youtube(url, host) {
  let id = '';
  let vertical = false;
  if (host === 'youtu.be') id = url.pathname.split('/')[1] || '';
  else if (['youtube.com', 'youtube-nocookie.com', 'music.youtube.com'].includes(host)) {
    const [, kind, value] = url.pathname.split('/');
    if (kind === 'watch') id = url.searchParams.get('v') || '';
    else if (['shorts', 'embed', 'live', 'v'].includes(kind)) id = value || '';
    vertical = kind === 'shorts';
  } else return null;
  if (!YT_ID.test(id)) return null;
  return {
    provider: 'youtube',
    vertical,
    url: vertical ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`,
    embed: `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1&autoplay=1`,
  };
}

function rutube(url, host) {
  if (host !== 'rutube.ru') return null;
  const parts = url.pathname.split('/').filter(Boolean);
  let id = '';
  let vertical = false;
  if (parts[0] === 'video' && parts[1] !== 'private') id = parts[1];
  else if (parts[0] === 'video' && parts[1] === 'private') id = parts[2];
  else if (parts[0] === 'shorts') {
    id = parts[1];
    vertical = true;
  } else if (parts[0] === 'play' && parts[1] === 'embed') id = parts[2];
  if (!RUTUBE_ID.test(id || '')) return null;
  // У ролика по ссылке («приватного») есть ключ доступа p
  const key = url.searchParams.get('p') || '';
  const p = /^[A-Za-z0-9_-]{1,64}$/.test(key) ? key : '';
  const q = p ? `?p=${p}` : '';
  return {
    provider: 'rutube',
    vertical,
    url: `https://rutube.ru/${vertical ? 'shorts' : 'video'}/${id}/${q}`,
    embed: `https://rutube.ru/play/embed/${id}${q}${q ? '&' : '?'}autoplay=1`,
  };
}

function vk(url, host) {
  if (!['vk.com', 'vk.ru', 'vkvideo.ru'].includes(host)) return null;
  let kind = 'video';
  let oid = '';
  let id = '';
  const hash = /^[0-9a-f]{1,32}$/.test(url.searchParams.get('hash') || '') ? url.searchParams.get('hash') : '';
  if (url.pathname === '/video_ext.php') {
    oid = url.searchParams.get('oid') || '';
    id = url.searchParams.get('id') || '';
    if (!/^-?\d{1,12}$/.test(oid) || !/^\d{1,12}$/.test(id)) return null;
  } else {
    // vk.com/video-123_456, vkvideo.ru/clip-123_456, vk.com/feed?z=video-123_456%2F…
    const candidates = [url.pathname.split('/').filter(Boolean).pop() || '', (url.searchParams.get('z') || '').split('/')[0]];
    const match = candidates.map((c) => VK_PAIR.exec(c)).find(Boolean);
    if (!match) return null;
    [, kind, oid, id] = match;
  }
  const h = hash ? `&hash=${hash}` : '';
  return {
    provider: 'vk',
    vertical: kind === 'clip',
    // Хэш из кода вставки нужен плееру для некоторых роликов — сохраняем его в ссылке
    url: hash
      ? `https://vkvideo.ru/video_ext.php?oid=${oid}&id=${id}${h}${kind === 'clip' ? '&clip=1' : ''}`
      : `https://vkvideo.ru/${kind}${oid}_${id}`,
    page: `https://vkvideo.ru/${kind}${oid}_${id}`,
    embed: `https://vkvideo.ru/video_ext.php?oid=${oid}&id=${id}${h}&hd=2&autoplay=1`,
  };
}

// Возвращает { provider, name, vertical, url, page, embed } или null, если ссылка не подходит
function parseVideoLink(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s || s.length > 1000) return null;
  // Код вставки: берём адрес из src="…"
  const src = /<iframe[^>]*\ssrc\s*=\s*["']([^"']+)["']/i.exec(s);
  if (src) s = src[1].replace(/&amp;/g, '&');
  if (/^\/\//.test(s)) s = `https:${s}`;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let url;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
  const host = hostOf(url);
  const found = youtube(url, host) || rutube(url, host) || vk(url, host);
  if (!found) return null;
  return { page: found.url, ...found, name: PROVIDERS[found.provider].name };
}

// Для проверки сохранения: приводит ссылку к единому виду или возвращает null
function normalizeVideoLink(input) {
  const v = parseVideoLink(input);
  return v ? v.url : null;
}

const FRAME_ORIGINS = Object.values(PROVIDERS).map((p) => p.origin);

module.exports = { parseVideoLink, normalizeVideoLink, FRAME_ORIGINS };
