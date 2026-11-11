'use strict';

// Серверный рендер публичной страницы. Весь текст из базы проходит через esc(),
// ссылки собираются только из проверенных схемой полей — внедрить HTML или javascript: нельзя.

const config = require('./config');
const { parseVideoLink } = require('./video');

const ASSET_VERSION = process.env.ASSET_VERSION || String(Date.now());

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Переносы строк из админки → <br>
function multiline(value) {
  return esc(value).replace(/\n/g, '<br>');
}

function asset(p) {
  return `/static/${p}?v=${encodeURIComponent(ASSET_VERSION)}`;
}

const has = (v) => typeof v === 'string' && v.trim() !== '';
const nonEmpty = (arr, ...keys) => (arr || []).filter((item) => keys.some((k) => has(item[k])));
const pad2 = (n) => String(n).padStart(2, '0');

function img(media, id, { cls = '', sizes = '100vw', alt = '', eager = false } = {}) {
  const m = media.get(id);
  if (!m) return '';
  const altText = alt || m.alt || '';
  return `<img class="${cls}" src="${esc(m.url)}" srcset="${esc(m.thumb)} 800w, ${esc(m.url)} ${m.width}w" sizes="${esc(sizes)}" width="${m.width}" height="${m.height}" alt="${esc(altText)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
}

// ---------- Видео ----------

function fmtDuration(sec) {
  const t = Math.round(Number(sec) || 0);
  return t > 0 ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` : '';
}

// Ролик: свой файл (тег <video>) или ссылка на VK Видео / YouTube / Rutube.
// Чужой плеер не грузится, пока посетитель не нажмёт «смотреть»: страница не тормозит,
// а сторонние сайты не получают данные посетителя без его действия.
function resolveVideo(item, videos) {
  const file = item.video && videos.get(item.video);
  if (file) return { file };
  const link = has(item.videoUrl) ? parseVideoLink(item.videoUrl) : null;
  return link ? { link } : null;
}

function videoShape(item, v) {
  if (item.shape === 'vertical' || item.shape === 'horizontal') return item.shape;
  if (v.file) return v.file.height > v.file.width ? 'vertical' : 'horizontal';
  return v.link.vertical ? 'vertical' : 'horizontal';
}

function videoBlock(item, v, { media, title = '', cls = '', sizes = '100vw', fallbackCover = '' }) {
  const shape = videoShape(item, v);
  const cover = item.photo && media.has(item.photo) ? media.get(item.photo) : null;
  // Для ссылки без своей обложки можно взять фото мероприятия
  const linkCover = cover ? item.photo : (fallbackCover && media.has(fallbackCover) ? fallbackCover : '');
  const label = title || 'Видео';
  if (v.file) {
    const m = v.file;
    const poster = cover ? cover.url : m.thumb;
    const dur = fmtDuration(m.duration);
    return `<div class="vid vid-${shape} ${cls}">
      <video class="vid-player" controls playsinline preload="none" poster="${esc(poster)}" width="${m.width}" height="${m.height}" aria-label="${esc(label)}">
        <source src="${esc(m.url)}" type="video/mp4">
      </video>
      ${dur ? `<span class="vid-badge" aria-hidden="true">${dur}</span>` : ''}
    </div>`;
  }
  const l = v.link;
  return `<div class="vid vid-${shape} vid-ext ${cls}">
      <a class="vid-facade${linkCover ? '' : ' vid-facade-plain'}" href="${esc(l.page)}" target="_blank" rel="noopener noreferrer" data-embed="${esc(l.embed)}" data-title="${esc(label)}">
        ${linkCover ? img(media, linkCover, { cls: 'vid-cover', sizes, alt: '' }) : ''}
        <span class="vid-play" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M8 5.5v13l10.5-6.5z"/></svg></span>
        <span class="vid-provider">${esc(l.name)}</span>
        <span class="visually-hidden">Смотреть: ${esc(label)}</span>
      </a>
    </div>`;
}

function icon(name) {
  const paths = {
    tg: '<path d="M21.5 4.5 2.9 11.7c-1 .4-1 1.7 0 2l4.7 1.5 1.8 5.6c.3.8 1.3 1 1.9.4l2.6-2.5 4.7 3.5c.7.5 1.7.1 1.9-.8l3.1-15.2c.2-1.1-.9-2-2-1.7Zm-4 4.2-7.8 7-.3 3.3-1.4-4.6 9.2-5.9c.4-.2.6.1.3.2Z"/>',
    mail: '<path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm1 3.2V17h16V8.2l-7.4 5.2a1 1 0 0 1-1.2 0L4 8.2ZM5.7 7l6.3 4.4L18.3 7H5.7Z"/>',
    phone: '<path d="M6.6 2.5 9 2a1 1 0 0 1 1.1.6l1.4 3.4a1 1 0 0 1-.3 1.2L9.6 8.6a12 12 0 0 0 5.8 5.8l1.4-1.6a1 1 0 0 1 1.2-.3l3.4 1.4a1 1 0 0 1 .6 1.1l-.5 2.4a2 2 0 0 1-2 1.6A16.6 16.6 0 0 1 3 4.5a2 2 0 0 1 1.6-2Z"/>',
    arrow: '<path d="M5 12h12.6l-4.3-4.3 1.4-1.4L21.4 13l-6.7 6.7-1.4-1.4 4.3-4.3H5v-2Z"/>',
    chevron: '<path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2"/>',
  };
  return `<svg class="icon icon-${name}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}

function contactLinks(c) {
  const links = [];
  if (has(c.telegram)) links.push({ href: `https://t.me/${encodeURIComponent(c.telegram)}`, label: `@${c.telegram}`, kind: 'Telegram', icon: 'tg', ext: true });
  if (has(c.email)) links.push({ href: `mailto:${c.email}`, label: c.email, kind: 'Почта', icon: 'mail' });
  if (has(c.phone)) links.push({ href: `tel:${c.phone.replace(/[^\d+]/g, '')}`, label: c.phone, kind: 'Телефон', icon: 'phone' });
  return links;
}

function linkAttrs(l) {
  return `href="${esc(l.href)}"${l.ext ? ' target="_blank" rel="noopener noreferrer"' : ''}`;
}

// ---------- Графики ----------

const numberFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

function parsePoints(text) {
  return String(text || '')
    .split(/[\n;]+/)
    .map((line) => {
      const i = line.lastIndexOf(':');
      if (i < 0) return null;
      const label = line.slice(0, i).trim();
      const value = Number(line.slice(i + 1).replace(/\s/g, '').replace(',', '.'));
      return label && Number.isFinite(value) && value >= 0 ? { label: label.slice(0, 24), value } : null;
    })
    .filter(Boolean)
    .slice(0, 12);
}

function growthLabel(points) {
  if (points.length < 2 || points[0].value <= 0) return '';
  const ratio = points[points.length - 1].value / points[0].value;
  if (ratio >= 2) return `×${numberFmt.format(Math.round(ratio * 10) / 10)}`;
  return `+${Math.round((ratio - 1) * 100)} %`;
}

function chartSvg(points, unit, id) {
  const W = 480;
  const H = 280;
  const top = 36;
  const bottom = 40;
  const max = Math.max(...points.map((p) => p.value)) || 1;
  const slot = W / points.length;
  const barW = Math.min(64, slot * 0.58);
  const fmt = (v) => `${numberFmt.format(v)}${unit === '%' ? ' %' : ''}`;
  const bars = points.map((p, i) => {
    const h = Math.max(2, ((H - top - bottom) * p.value) / max);
    const x = slot * i + (slot - barW) / 2;
    const y = H - bottom - h;
    const last = i === points.length - 1;
    return `<rect class="bar${last ? ' bar-last' : ''}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3"/>
      <text class="bar-value${last ? ' bar-value-last' : ''}" x="${(x + barW / 2).toFixed(1)}" y="${(y - 9).toFixed(1)}" text-anchor="middle">${esc(fmt(p.value))}</text>
      <text class="bar-label" x="${(x + barW / 2).toFixed(1)}" y="${H - 12}" text-anchor="middle">${esc(p.label)}</text>`;
  }).join('');
  const desc = points.map((p) => `${p.label}: ${fmt(p.value)}`).join('; ');
  return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${id}-desc" preserveAspectRatio="xMidYMid meet">
    <desc id="${id}-desc">${esc(desc)}</desc>
    <line class="axis" x1="0" y1="${H - bottom}" x2="${W}" y2="${H - bottom}"/>
    ${bars}
  </svg>`;
}

// ---------- Страница ----------

function sectionHead(num, kicker, title, id, light = false) {
  return `<header class="section-head reveal${light ? ' section-head-light' : ''}">
    <span class="ghost-num" aria-hidden="true">${num}</span>
    <p class="kicker"><span class="kicker-num">${num}</span>${esc(kicker)}</p>
    <h2 id="${id}-title">${esc(title)}</h2>
  </header>`;
}

function renderPage(data, allMedia) {
  // Видео из медиатеки — отдельно: в поля для фото они не попадают, и наоборот
  const media = new Map();
  const videos = new Map();
  for (const [id, m] of allMedia) (m.kind === 'video' ? videos : media).set(id, m);
  const h = data.hero;
  // Стиль сайта из админки: значения уже проверены схемой (только из списка)
  const t = data.theme;
  const themeClasses = [!t.motion && 'no-motion', !t.grain && 'no-grain', !t.guides && 'no-guides', !t.rails && 'no-rails']
    .filter(Boolean).join(' ');
  const fullName = [h.firstName, h.lastName].filter(has).join(' ') || 'Портфолио';
  const contacts = contactLinks(data.contacts);
  const primary = contacts[0];
  const highlights = nonEmpty(data.highlights, 'value');
  const paragraphs = (data.about.paragraphs || []).filter(has);
  const principles = nonEmpty(data.about.principles, 'title');
  const results = nonEmpty(data.results, 'value', 'title');
  const charts = (data.charts || [])
    .map((c) => ({ ...c, points: parsePoints(c.points) }))
    .filter((c) => has(c.title) && c.points.length >= 2);
  const experience = nonEmpty(data.experience, 'role', 'place');
  const works = (data.works.items || [])
    .map((w) => ({ ...w, v: resolveVideo(w, videos) }))
    .filter((w) => w.v || media.has(w.photo));
  const skills = nonEmpty(data.skills, 'items');
  const hobbies = nonEmpty(data.hobbies.items, 'title');
  const other = nonEmpty(data.otherExperience, 'role', 'place');
  const education = nonEmpty(data.education, 'title');
  const heroPhoto = h.photo && media.has(h.photo);
  const aboutPhoto = data.about.photo && media.has(data.about.photo);
  const hobbyPhoto = data.hobbies.photo && media.has(data.hobbies.photo);
  const contactPhoto = data.contacts.photo && media.has(data.contacts.photo);
  const projects = (data.projects.items || []).filter((p) => has(p.title));
  const certificates = (data.certificates.items || []).filter((c) => has(c.title));
  // Фоновые фото (мероприятия, съёмки): чёрно-белые и полупрозрачные, по кругу для разных разделов
  const decorPhotos = (data.decor.photos || []).filter((id) => media.has(id));
  const bgPhoto = (i, variant) => {
    if (!decorPhotos.length) return '';
    const m = media.get(decorPhotos[i % decorPhotos.length]);
    return `<div class="section-bg section-bg-${variant}" aria-hidden="true"><img src="${esc(m.thumb)}" alt="" loading="lazy" decoding="async"></div>`;
  };
  const badge = has(data.decor.badge) ? `<svg class="badge" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <defs><path id="badge-circle" d="M100,100 m-76,0 a76,76 0 1,1 152,0 a76,76 0 1,1 -152,0"/></defs>
      <circle class="badge-bg" cx="100" cy="100" r="99"/>
      <text class="badge-text"><textPath href="#badge-circle" textLength="474" lengthAdjust="spacing">${esc(data.decor.badge.toUpperCase())}</textPath></text>
      <path class="badge-star" d="M100 82 L104 96 L118 100 L104 104 L100 118 L96 104 L82 100 L96 96 Z"/>
    </svg>` : '';

  // Разделы по порядку — из них строятся номера и выпадающее меню
  const sections = [
    paragraphs.length && { id: 'about', label: 'Обо мне' },
    projects.length && { id: 'projects', label: data.projects.heading || 'Проекты' },
    results.length && { id: 'results', label: 'Результаты' },
    charts.length && { id: 'growth', label: 'Рост в цифрах' },
    experience.length && { id: 'experience', label: 'Опыт' },
    works.length && { id: 'works', label: data.works.heading || 'Работы' },
    skills.length && { id: 'skills', label: 'Навыки' },
    certificates.length && { id: 'certificates', label: data.certificates.heading || 'Сертификаты' },
    hobbies.length && { id: 'hobbies', label: data.hobbies.heading || 'Увлечения' },
    (other.length || education.length) && { id: 'more', label: other.length ? 'Другой опыт' : 'Образование' },
    { id: 'contacts', label: 'Контакты' },
  ].filter(Boolean);
  const num = Object.fromEntries(sections.map((s, i) => [s.id, pad2(i + 1)]));

  const ogImage = heroPhoto ? `${config.publicOrigin}${media.get(h.photo).url}` : '';
  const title = data.seo.title || `${fullName} — ${h.role}`;
  const description = data.seo.description || h.tagline;
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: fullName,
    jobTitle: h.role,
    description,
    url: config.publicOrigin,
    ...(ogImage ? { image: ogImage } : {}),
  }).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="ru" data-band="${esc(t.band)}" data-paper="${esc(t.paper)}" data-accent="${esc(t.accent)}" data-headings="${esc(t.headings)}"${themeClasses ? ` class="${themeClasses}"` : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(config.publicOrigin)}/">
<meta property="og:type" content="profile">
<meta property="og:locale" content="ru_RU">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(config.publicOrigin)}/">
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#F3F1EC">
<link rel="icon" href="${asset('img/favicon.svg')}" type="image/svg+xml">
<link rel="preload" href="/static/fonts/playfair-display-cyrillic-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/static/fonts/inter-cyrillic-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${asset('css/site.css')}">
<script src="${asset('js/site.js')}"></script>
<script type="application/ld+json">${jsonLd}</script>
</head>
<body id="top">
<a class="skip-link" href="#main">К содержимому</a>
<div class="scroll-progress" aria-hidden="true"><span></span></div>

<header class="site-header">
  ${primary ? `<a class="btn btn-dark btn-small header-cta" ${linkAttrs(primary)}>Связаться</a>` : ''}
  <details class="menu">
    <summary class="burger" aria-label="Меню: разделы сайта"><span></span><span></span><span></span></summary>
    <div class="menu-dropdown">
      <p class="menu-title">Разделы</p>
      <nav class="menu-panel" aria-label="Разделы сайта">
        ${sections.map((s) => `<a href="#${s.id}"><span class="menu-num">${num[s.id]}</span><span class="menu-label">${esc(s.label)}</span></a>`).join('')}
      </nav>
      ${contacts.length ? `<div class="menu-foot">${contacts.map((l) => `<a ${linkAttrs(l)}>${esc(l.label)}</a>`).join('')}</div>` : ''}
    </div>
  </details>
</header>

<div class="guides" aria-hidden="true"></div>
<div class="rail rail-left" aria-hidden="true"><span>${esc(fullName)} — ${esc(h.role)} · Портфолио ${new Date().getFullYear()}</span></div>
<div class="rail rail-right" aria-hidden="true">
  <span class="rail-num">00</span>
  <span class="rail-line"><i></i></span>
  <span class="rail-label">Главная</span>
</div>

<main id="main">
<section class="hero${heroPhoto ? '' : ' hero-no-photo'}" aria-labelledby="hero-title">
  <div class="container hero-grid">
    <div class="hero-text">
      <p class="hero-role reveal">${esc(h.role)}</p>
      <h1 id="hero-title" class="hero-name">
        <span class="line"><span>${esc(h.firstName || fullName)}</span></span>
        ${has(h.lastName) ? `<span class="line"><em>${esc(h.lastName)}</em></span>` : ''}
      </h1>
      ${has(h.tagline) ? `<p class="hero-tagline reveal">${multiline(h.tagline)}</p>` : ''}
      <div class="hero-actions reveal">
        ${primary ? `<a class="btn btn-dark" ${linkAttrs(primary)}>Написать мне ${icon('arrow')}</a>` : ''}
        <a class="btn btn-line" href="#${sections[0].id}">Смотреть портфолио</a>
      </div>
      <ul class="hero-meta reveal">
        ${has(h.status) ? `<li><span class="dot" aria-hidden="true"></span>${esc(h.status)}</li>` : ''}
        ${has(h.formats) ? `<li>${esc(h.formats)}</li>` : ''}
        ${has(h.location) ? `<li>${esc(h.location)}</li>` : ''}
      </ul>
    </div>
    ${heroPhoto ? `<div class="hero-visual"><figure class="hero-figure img-reveal">
      ${img(media, h.photo, { cls: 'hero-photo', sizes: '(max-width: 900px) 90vw, 480px', alt: fullName, eager: true })}
      <figcaption><span>${esc(fullName)}</span><span>Портфолио · ${new Date().getFullYear()}</span></figcaption>
    </figure>${badge}</div>` : ''}
  </div>
  ${highlights.length ? `<div class="container"><ul class="stats" aria-label="Коротко в цифрах">
    ${highlights.map((s) => `<li class="stat reveal"><strong data-count>${esc(s.value)}</strong><span>${esc(s.label)}</span></li>`).join('')}
  </ul></div>` : ''}
</section>

${paragraphs.length ? `<section class="section about" id="about" aria-labelledby="about-title">
  <div class="container about-grid${aboutPhoto ? '' : ' about-no-photo'}">
    ${aboutPhoto ? `<figure class="about-figure img-reveal">${img(media, data.about.photo, { cls: 'about-photo', sizes: '(max-width: 900px) 90vw, 420px' })}</figure>` : ''}
    <div class="about-body">
      ${sectionHead(num.about, 'Обо мне', data.about.heading || 'Обо мне', 'about')}
      <div class="about-text">
        ${paragraphs.map((p, i) => `<p class="reveal${i === 0 ? ' lead' : ''}">${multiline(p)}</p>`).join('')}
      </div>
    </div>
  </div>
  ${principles.length ? `<div class="container"><ol class="principles">
    ${principles.map((p, i) => `<li class="principle reveal"><span class="principle-num">${pad2(i + 1)}</span><h3>${esc(p.title)}</h3>${has(p.text) ? `<p>${multiline(p.text)}</p>` : ''}</li>`).join('')}
  </ol></div>` : ''}
</section>` : ''}

${projects.length ? `<section class="section projects" id="projects" aria-labelledby="projects-title">
  <div class="container">
    ${sectionHead(num.projects, 'Проекты', data.projects.heading || 'Проекты', 'projects')}
    ${has(data.projects.intro) ? `<p class="section-intro reveal">${multiline(data.projects.intro)}</p>` : ''}
    <ol class="cases">
      ${projects.map((p, i) => {
        const photos = [p.photo1, p.photo2].filter((id) => id && media.has(id));
        const done = (p.done || []).filter(has);
        const metrics = nonEmpty(p.metrics, 'value');
        const clips = (p.videos || []).map((c) => ({ ...c, v: resolveVideo(c, videos) })).filter((c) => c.v);
        return `<li class="case${photos.length ? '' : ' case-no-photo'}">
        ${photos.length ? `<div class="case-media${photos.length > 1 ? ' case-media-two' : ''}">
          ${photos.map((id, k) => `<a class="case-photo case-photo-${k + 1} img-reveal" href="${esc(media.get(id).url)}" data-lightbox data-caption="${esc(p.title)}">
            ${img(media, id, { cls: 'case-img', sizes: k ? '(max-width: 900px) 60vw, 300px' : '(max-width: 900px) 92vw, 640px', alt: `${p.title} — фото ${k + 1}` })}
          </a>`).join('')}
        </div>` : ''}
        <article class="case-body reveal">
          <p class="case-meta"><span class="case-num">${pad2(i + 1)}</span>${esc([p.category, p.period].filter(has).join(' · '))}</p>
          <h3>${esc(p.title)}</h3>
          ${has(p.about) ? `<p class="case-about">${multiline(p.about)}</p>` : ''}
          ${has(p.task) ? `<div class="case-block"><span class="case-label">Задача</span><p>${multiline(p.task)}</p></div>` : ''}
          ${done.length ? `<div class="case-block"><span class="case-label">Что сделала</span><ul class="case-done">${done.map((d) => `<li>${multiline(d)}</li>`).join('')}</ul></div>` : ''}
          ${metrics.length ? `<ul class="case-metrics" aria-label="Результаты">${metrics.map((m) => `<li><strong data-count>${esc(m.value)}</strong><span>${esc(m.label)}</span></li>`).join('')}</ul>` : ''}
        </article>
        ${clips.length ? `<div class="case-videos reveal">
          <span class="case-label">Ролики с площадки</span>
          <ul class="case-videos-list">
            ${clips.map((c, k) => `<li class="case-video">
              ${videoBlock(c, c.v, { media, title: c.title || p.title, sizes: '(max-width: 640px) 70vw, 280px', fallbackCover: photos[k % Math.max(photos.length, 1)] || '' })}
              ${has(c.title) ? `<p class="case-video-title">${esc(c.title)}</p>` : ''}
            </li>`).join('')}
          </ul>
        </div>` : ''}
      </li>`;
      }).join('')}
    </ol>
  </div>
</section>` : ''}

${results.length ? `<section class="section results has-bg" id="results" aria-labelledby="results-title">
  ${bgPhoto(0, 'right')}
  <div class="container">
    ${sectionHead(num.results, 'Результаты', 'Цифры, за которые меня зовут', 'results')}
    <ul class="results-grid">
      ${results.map((r) => `<li class="result reveal">
        <strong class="result-value" data-count>${esc(r.value)}</strong>
        <h3>${esc(r.title)}</h3>
        ${has(r.text) ? `<p>${multiline(r.text)}</p>` : ''}
      </li>`).join('')}
    </ul>
  </div>
</section>` : ''}

${charts.length ? `<section class="section growth" id="growth" aria-labelledby="growth-title">
  <div class="container">
    ${sectionHead(num.growth, 'Рост в цифрах', 'Как менялись показатели', 'growth')}
    <div class="charts-grid">
      ${charts.map((c, i) => `<figure class="chart reveal">
        <figcaption class="chart-head">
          <span class="chart-title">${esc(c.title)}</span>
          ${growthLabel(c.points) ? `<span class="chart-growth">${esc(growthLabel(c.points))}</span>` : ''}
        </figcaption>
        ${chartSvg(c.points, c.unit, `chart-${i}`)}
        ${has(c.caption) ? `<p class="chart-caption">${esc(c.caption)}${has(c.unit) && c.unit !== '%' ? ` · ${esc(c.unit)}` : ''}</p>` : ''}
      </figure>`).join('')}
    </div>
  </div>
</section>` : ''}

${experience.length ? `<section class="section experience" id="experience" aria-labelledby="experience-title">
  <div class="container">
    ${sectionHead(num.experience, 'Опыт', 'Где я работала и что сделала', 'experience')}
    <ol class="jobs">
      ${experience.map((e) => `<li class="job reveal">
        <div class="job-meta">
          <span class="job-period">${esc(e.period)}</span>
          ${has(e.place) ? `<span class="job-place">${esc(e.place)}</span>` : ''}
        </div>
        <article class="job-body">
          <h3>${esc(e.role)}</h3>
          ${has(e.summary) ? `<p class="job-summary">${multiline(e.summary)}</p>` : ''}
          ${(e.tasks || []).filter(has).length ? `<ul class="job-tasks">${e.tasks.filter(has).map((t) => `<li>${multiline(t)}</li>`).join('')}</ul>` : ''}
          ${has(e.result) ? `<p class="job-result"><span>Результат</span>${multiline(e.result)}</p>` : ''}
        </article>
      </li>`).join('')}
    </ol>
  </div>
</section>` : ''}

${works.length ? `<section class="section works" id="works" aria-labelledby="works-title">
  <div class="container">
    ${sectionHead(num.works, 'Портфолио', data.works.heading || 'Работы', 'works')}
    ${has(data.works.intro) ? `<p class="section-intro reveal">${multiline(data.works.intro)}</p>` : ''}
    <ul class="works-grid">
      ${works.map((w) => {
        const sizes = '(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw';
        const m = media.get(w.photo);
        return `<li class="work reveal${w.v ? ' work-video' : ''}">
        ${w.v ? videoBlock(w, w.v, { media, title: w.title, cls: 'work-vid', sizes }) : `<a class="work-link" href="${esc(m.url)}" data-lightbox data-caption="${esc([w.title, w.caption].filter(has).join(' — '))}">
          ${img(media, w.photo, { cls: 'work-img', sizes, alt: w.title || m.alt })}
        </a>`}
        <div class="work-text">
          ${has(w.tag) ? `<span class="work-tag">${esc(w.tag)}</span>` : ''}
          ${has(w.title) ? `<h3>${esc(w.title)}</h3>` : ''}
          ${has(w.caption) ? `<p>${multiline(w.caption)}</p>` : ''}
        </div>
      </li>`;
      }).join('')}
    </ul>
  </div>
</section>` : ''}

${skills.length ? `<section class="section skills has-bg" id="skills" aria-labelledby="skills-title">
  ${bgPhoto(1, 'left')}
  <div class="container">
    ${sectionHead(num.skills, 'Навыки', 'Чем я владею', 'skills')}
    <dl class="skills-list">
      ${skills.map((s) => `<div class="skill-row reveal">
        <dt>${esc(s.group)}</dt>
        <dd><ul class="chips">${s.items.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></dd>
      </div>`).join('')}
    </dl>
  </div>
</section>` : ''}

${certificates.length ? `<section class="section certificates" id="certificates" aria-labelledby="certificates-title">
  <div class="container">
    ${sectionHead(num.certificates, 'Обучение', data.certificates.heading || 'Сертификаты', 'certificates')}
    ${has(data.certificates.intro) ? `<p class="section-intro reveal">${multiline(data.certificates.intro)}</p>` : ''}
    <ul class="cert-grid">
      ${certificates.map((c) => {
        const m = c.photo && media.has(c.photo) ? media.get(c.photo) : null;
        const skillsList = c.skills.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
        return `<li class="cert reveal">
        ${m ? `<a class="cert-scan" href="${esc(m.url)}" data-lightbox data-caption="${esc([c.title, c.school].filter(has).join(' — '))}">
          ${img(media, c.photo, { cls: 'cert-img', sizes: '(max-width: 900px) 90vw, 280px', alt: `Сертификат: ${c.title}` })}
          <span class="cert-zoom">Смотреть</span>
        </a>` : ''}
        <div class="cert-body">
          ${has(c.school) ? `<p class="cert-school">${esc(c.school)}</p>` : ''}
          <h3>${esc(c.title)}</h3>
          <p class="cert-meta">${[c.period, c.details].filter(has).map(esc).join('<br>')}</p>
          ${skillsList.length ? `<ul class="chips">${skillsList.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
          ${has(c.number) ? `<p class="cert-number">№ ${esc(c.number)}</p>` : ''}
        </div>
      </li>`;
      }).join('')}
    </ul>
  </div>
</section>` : ''}

${hobbies.length ? `<section class="section hobbies" id="hobbies" aria-labelledby="hobbies-title">
  <div class="container hobbies-grid${hobbyPhoto ? '' : ' hobbies-no-photo'}">
    <div class="hobbies-body">
      ${sectionHead(num.hobbies, 'Личное', data.hobbies.heading || 'Увлечения', 'hobbies')}
      ${has(data.hobbies.intro) ? `<p class="section-intro reveal">${multiline(data.hobbies.intro)}</p>` : ''}
      <ul class="hobby-list">
        ${hobbies.map((x) => `<li class="hobby reveal"><h3>${esc(x.title)}</h3>${has(x.text) ? `<p>${multiline(x.text)}</p>` : ''}</li>`).join('')}
      </ul>
    </div>
    ${hobbyPhoto ? `<figure class="hobbies-figure img-reveal">${img(media, data.hobbies.photo, { cls: 'hobbies-photo', sizes: '(max-width: 900px) 90vw, 420px' })}</figure>` : ''}
  </div>
</section>` : ''}

${other.length || education.length ? `<section class="section more" id="more" aria-labelledby="more-title">
  <div class="container">
    ${sectionHead(num.more, other.length ? 'Ещё опыт' : 'Учёба', other.length ? 'Другой опыт и образование' : 'Образование и курсы', 'more')}
    <div class="more-grid">
      ${other.map((o) => `<article class="more-card reveal">
        <p class="job-period">${esc([o.period, o.place].filter(has).join(' · ') || 'Опыт работы')}</p>
        <h3>${esc(o.role)}</h3>
        ${(o.tasks || []).filter(has).length ? `<ul class="job-tasks">${o.tasks.filter(has).map((t) => `<li>${multiline(t)}</li>`).join('')}</ul>` : ''}
      </article>`).join('')}
      ${education.length ? `<article class="more-card reveal">
        <p class="job-period">Образование и курсы</p>
        <ul class="edu-list">${education.map((e) => `<li><strong>${esc(e.title)}</strong>${has(e.details) ? `<span>${esc(e.details)}</span>` : ''}</li>`).join('')}</ul>
      </article>` : ''}
    </div>
  </div>
</section>` : ''}

<section class="section contact" id="contacts" aria-labelledby="contacts-title">
  <div class="container">
    <div class="contact-card reveal${contactPhoto ? ' contact-card-photo' : ''}">
      ${contactPhoto ? '' : bgPhoto(2, 'contact')}
      <div class="contact-main">
      <p class="kicker kicker-light"><span class="kicker-num">${num.contacts}</span>Контакты</p>
      <h2 id="contacts-title">${esc(data.contacts.heading || 'Связаться со мной')}</h2>
      ${has(data.contacts.text) ? `<p class="contact-text">${multiline(data.contacts.text)}</p>` : ''}
      <ul class="contact-links">
        ${contacts.length ? contacts.map((l) => `<li><a class="contact-link" ${linkAttrs(l)}>${icon(l.icon)}<span><small>${esc(l.kind)}</small>${esc(l.label)}</span></a></li>`).join('') : '<li class="contact-empty">Контакты скоро появятся</li>'}
      </ul>
      </div>
      ${contactPhoto ? `<figure class="contact-figure img-reveal">${img(media, data.contacts.photo, { cls: 'contact-photo', sizes: '(max-width: 900px) 80vw, 380px', alt: fullName })}</figure>` : ''}
    </div>
  </div>
</section>
</main>

<footer class="site-footer">
  <div class="container footer-inner">
    <span${has(data.footer.copyright) ? ' lang="en"' : ''}>© ${new Date().getFullYear()} ${esc(data.footer.copyright || fullName)}</span>
    ${has(data.footer.credit) ? `<span class="footer-credit" lang="en">${esc(data.footer.credit)}</span>` : ''}
    <a href="#top">Наверх ↑</a>
  </div>
</footer>

<div class="lightbox" hidden role="dialog" aria-modal="true" aria-label="Просмотр изображения">
  <button class="lightbox-close" type="button" aria-label="Закрыть">×</button>
  <figure><img alt=""><figcaption></figcaption></figure>
</div>
</body>
</html>`;
}

module.exports = { renderPage, esc, parsePoints, fmtDuration };
