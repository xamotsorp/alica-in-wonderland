'use strict';

process.env.PUBLIC_ORIGIN = 'https://example.ru';
process.env.DATABASE_URL = 'postgres://x:y@localhost:5432/z';

const test = require('node:test');
const assert = require('node:assert/strict');
const sec = require('../src/security');
const { validateContent, ValidationError } = require('../src/schema');
const defaults = require('../src/defaultContent');
const { renderPage } = require('../src/render');

test('пароль: верный проходит, неверный нет', async () => {
  const hash = await sec.hashPassword('очень-длинный-пароль-123');
  assert.ok(hash.startsWith('scrypt$15$8$1$'));
  assert.equal(await sec.verifyPassword('очень-длинный-пароль-123', hash), true);
  assert.equal(await sec.verifyPassword('очень-длинный-пароль-124', hash), false);
  assert.equal(await sec.verifyPassword('x', 'мусор'), false);
});

test('TOTP: тестовый вектор RFC 6238', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // "12345678901234567890"
  assert.equal(sec.totpAt(secret, 1), '287082');
  assert.equal(sec.totpAt(secret, 37037036), '081804');
});

test('TOTP: повтор того же кода отклоняется', () => {
  const secret = sec.generateTotpSecret();
  const step = Math.floor(Date.now() / 1000 / 30);
  const code = sec.totpAt(secret, step);
  const used = sec.verifyTotp(secret, code, null);
  assert.ok(used !== null);
  assert.equal(sec.verifyTotp(secret, code, used), null);
  assert.equal(sec.verifyTotp(secret, 'abc123', null), null);
});

test('слабый пароль отклоняется', () => {
  assert.ok(sec.passwordProblems('short').length > 0);
  assert.ok(sec.passwordProblems('aaaaaaaaaaaaaaaa').length > 0);
  assert.equal(sec.passwordProblems('Нормальный-пароль-2026').length, 0);
});

test('схема: стартовое содержимое валидно', () => {
  const data = validateContent(defaults);
  assert.equal(data.hero.firstName, 'Алиса');
  assert.equal(data.experience.length, 3);
});

test('схема: лишние поля отбрасываются, длинные строки и мусор — ошибка', () => {
  const data = validateContent({ ...defaults, evil: '<script>', hero: { ...defaults.hero, extra: 1 } });
  assert.equal('evil' in data, false);
  assert.equal('extra' in data.hero, false);
  assert.throws(() => validateContent({ hero: { firstName: 'a'.repeat(41) } }), ValidationError);
  assert.throws(() => validateContent({ hero: { photo: '../../etc/passwd' } }), ValidationError);
  assert.throws(() => validateContent({ contacts: { telegram: 'javascript:alert(1)' } }), ValidationError);
  assert.throws(() => validateContent({ contacts: { email: '"><svg onload=1>@x.ru' } }), ValidationError);
  assert.throws(() => validateContent({ results: new Array(9).fill({}) }), ValidationError);
});

test('рендер: HTML из базы экранируется', () => {
  const data = validateContent({
    ...defaults,
    hero: { ...defaults.hero, firstName: '<img src=x onerror=alert(1)>' },
    about: { heading: '"><script>alert(1)</script>', paragraphs: ['a\nb'] },
    contacts: { ...defaults.contacts, telegram: '@alisa_smm' },
  });
  const html = renderPage(data, new Map());
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('href="https://t.me/alisa_smm"'));
  assert.ok(html.includes('a<br>b'));
});

test('графики: точки разбираются, мусор отбрасывается', () => {
  const { parsePoints } = require('../src/render');
  const pts = parsePoints('1-й месяц: 20 000\nСтарт: 3,5\nбез двоеточия\nплохое: abc; минус: -5');
  assert.deepEqual(pts, [{ label: '1-й месяц', value: 20000 }, { label: 'Старт', value: 3.5 }]);
});

test('рендер: меню разделов и графики на месте, подпись графика экранируется', () => {
  const data = validateContent({
    ...defaults,
    charts: [{ title: '<b>x</b>', caption: '', unit: '%', points: 'a: 1\nb: 2' }],
  });
  const html = renderPage(data, new Map());
  assert.ok(html.includes('class="menu-panel"'));
  assert.ok(html.includes('href="#growth"'));
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'));
  assert.ok(html.includes('<svg class="chart-svg"'));
});

test('новые поля получают значения по умолчанию, очищенные — остаются пустыми', () => {
  const { fillMissing } = require('../src/content');
  const out = fillMissing({ a: 'def', b: 'def', nested: { c: 'x', d: 'y' }, list: [1] }, { a: '', nested: { c: '' } });
  assert.deepEqual(out, { a: '', b: 'def', nested: { c: '', d: 'y' }, list: [1] });
});

test('рендер: проекты выводятся с метриками, пункт меню появляется', () => {
  const html = renderPage(validateContent(defaults), new Map());
  assert.ok(html.includes('id="projects"'));
  assert.ok(html.includes('href="#projects"'));
  assert.ok(html.includes('GIS DAYS 2026'));
  assert.ok(html.includes('class="case-metrics"'));
});

test('стиль сайта: принимаются только значения из списка', () => {
  const data = validateContent({ ...defaults, theme: { band: 'sand', paper: '"><script>', accent: 'olive', motion: 'yes', grain: false } });
  assert.equal(data.theme.band, 'sand');
  assert.equal(data.theme.paper, 'warm');
  assert.equal(data.theme.accent, 'olive');
  assert.equal(data.theme.motion, true);
  assert.equal(data.theme.grain, false);
  assert.equal(data.theme.headings, 'serif');
});

test('рендер: стиль сайта попадает в атрибуты страницы', () => {
  const html = renderPage(validateContent({ ...defaults, theme: { ...defaults.theme, band: 'sage', motion: false, grain: false } }), new Map());
  assert.ok(html.includes('data-band="sage"'));
  assert.ok(html.includes('class="no-motion no-grain"'));
  const plain = renderPage(validateContent(defaults), new Map());
  assert.ok(plain.includes('data-band="espresso"'));
  assert.ok(!plain.includes('no-motion'));
});

test('рендер: раздел сертификатов и пункт меню', () => {
  const html = renderPage(validateContent(defaults), new Map());
  assert.ok(html.includes('id="certificates"'));
  assert.ok(html.includes('href="#certificates"'));
  assert.ok(html.includes('GB-2025-0628-1147'));
  assert.ok(html.indexOf('id="skills"') < html.indexOf('id="certificates"'));
});

test('подвал: не редактируется — поле отбрасывается, текст всегда из кода', () => {
  const { schema } = require('../src/schema');
  assert.equal('footer' in schema.fields, false, 'подвала нет в админке');
  // Старые данные из базы или подделанный запрос с footer не меняют подвал
  const data = validateContent({ ...defaults, footer: { copyright: 'Чужой текст', credit: '' } });
  assert.equal('footer' in data, false);
  const html = renderPage(data, new Map());
  assert.ok(html.includes('Designed &amp; developed by xamotsorp'));
  assert.ok(html.includes('Alica in Wonderland'));
  assert.ok(!html.includes('Чужой текст'));
});

test('почта: нельзя подмешать параметры в mailto', () => {
  assert.throws(() => validateContent({ contacts: { email: 'a?cc=evil@x.ru@y.ru' } }), ValidationError);
  assert.throws(() => validateContent({ contacts: { email: 'alisa&bcc=evil@mail.ru' } }), ValidationError);
  assert.equal(validateContent({ contacts: { email: 'alisa.smm+work@mail.ru' } }).contacts.email, 'alisa.smm+work@mail.ru');
});

test('схема: __proto__ и лишние ключи не попадают в данные', () => {
  const data = validateContent(JSON.parse('{"__proto__":{"polluted":1},"hero":{"__proto__":{"x":1},"firstName":"A"}}'));
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(data, '__proto__'), false);
  assert.equal(data.hero.firstName, 'A');
});

test('XSS-фаззинг: вредоносный HTML во всех текстовых полях не исполняется', () => {
  const { schema } = require('../src/schema');
  const payloads = [
    '"><img src=x onerror=alert(1)>',
    "'><svg onload=alert(1)>",
    '</script><script>alert(1)</script>',
    'javascript:alert(1)',
    '<a href="javascript:alert(1)">x</a>',
    '{{constructor.constructor(\'alert(1)\')()}}',
  ];
  for (const p of payloads) {
    // заполняем каждое текстовое поле схемы полезной нагрузкой (с учётом лимита длины)
    const fill = (node) => {
      if (node.type === 'string') return node.format ? '' : p.slice(0, node.max);
      if (node.type === 'list') return [fill(node.of), fill(node.of)].slice(0, node.max);
      if (node.type === 'object') return Object.fromEntries(Object.entries(node.fields).map(([k, v]) => [k, fill(v)]));
      if (node.type === 'select' || node.type === 'toggle') return node.default;
      return '';
    };
    const data = validateContent(fill(schema));
    data.charts = [{ title: p.slice(0, 80), caption: p.slice(0, 120), unit: '%', points: `${p.slice(0, 20)}: 5\nb: 7` }];
    const html = renderPage(validateContent(data), new Map());
    const body = html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, '');
    assert.ok(!/<img src=x/i.test(body), `img через: ${p}`);
    assert.ok(!/<svg onload/i.test(body), `svg через: ${p}`);
    assert.ok(!/<script>alert/i.test(body), `script через: ${p}`);
    assert.ok(!/href="javascript:/i.test(body), `javascript: в ссылке через: ${p}`);
    assert.ok(!/<a href="javascript/i.test(body), `ссылка через: ${p}`);
    // в JSON-LD нельзя закрыть тег script
    const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
    assert.ok(!ld.includes('<'), 'в JSON-LD не должно быть «<»');
  }
});

// ---------- Видео ----------

test('видео: ссылки VK Видео, YouTube и Rutube разбираются, чужие — нет', () => {
  const { parseVideoLink } = require('../src/video');
  const yt = parseVideoLink('https://youtube.com/shorts/dQw4w9WgXcQ?si=abc');
  assert.equal(yt.provider, 'youtube');
  assert.equal(yt.vertical, true);
  assert.equal(yt.embed, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&playsinline=1&autoplay=1');
  assert.equal(parseVideoLink('youtu.be/dQw4w9WgXcQ').url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(parseVideoLink('https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=10').vertical, false);

  const clip = parseVideoLink('https://vk.com/clip-12345_67890');
  assert.equal(clip.provider, 'vk');
  assert.equal(clip.vertical, true);
  assert.equal(clip.url, 'https://vkvideo.ru/clip-12345_67890');
  assert.equal(parseVideoLink('https://vk.com/feed?z=video-1_2%2Fpl_cat').page, 'https://vkvideo.ru/video-1_2');
  const code = parseVideoLink('<iframe src="https://vkvideo.ru/video_ext.php?oid=-1&amp;id=2&amp;hash=abc123" width="853"></iframe>');
  assert.equal(code.embed, 'https://vkvideo.ru/video_ext.php?oid=-1&id=2&hash=abc123&hd=2&autoplay=1');
  // Ссылка с хэшем сохраняется так, что хэш не теряется при повторном разборе
  assert.equal(parseVideoLink(code.url).embed, code.embed);

  const rt = parseVideoLink('https://rutube.ru/video/0123456789abcdef0123456789abcdef/');
  assert.equal(rt.embed, 'https://rutube.ru/play/embed/0123456789abcdef0123456789abcdef?autoplay=1');
  assert.equal(parseVideoLink('https://rutube.ru/shorts/0123456789abcdef0123456789abcdef/').vertical, true);

  for (const bad of [
    'https://evil.ru/video-1_2', 'javascript:alert(1)', 'https://youtube.com.evil.ru/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=short', 'https://user:pw@vk.com/video-1_2', 'https://vk.com:8443/video-1_2',
    '<iframe src="https://evil.ru/embed"></iframe>', 'https://rutube.ru/video/../../etc/', '',
  ]) assert.equal(parseVideoLink(bad), null, bad);
});

test('видео: ссылка приводится к единому виду при сохранении, мусор — ошибка', () => {
  const data = validateContent({
    ...defaults,
    works: { ...defaults.works, items: [{ title: 'Reels', videoUrl: 'youtu.be/dQw4w9WgXcQ', shape: 'oops' }] },
  });
  assert.equal(data.works.items[0].videoUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(data.works.items[0].shape, 'auto');
  assert.deepEqual(data.projects.items[0].videos, []);
  assert.throws(() => validateContent({ works: { items: [{ videoUrl: 'https://evil.ru/x' }] } }), ValidationError);
  assert.throws(() => validateContent({ works: { items: [{ video: '../../etc/passwd' }] } }), ValidationError);
});

test('рендер: свой ролик и ролик по ссылке в «Работах» и проектах', () => {
  const vid = '11111111-1111-4111-8111-111111111111';
  const pic = '22222222-2222-4222-8222-222222222222';
  const media = new Map([
    [vid, { id: vid, kind: 'video', url: `/media/${vid}.mp4`, thumb: `/media/${vid}-thumb.webp`, width: 1080, height: 1920, duration: 34.2, alt: '' }],
    [pic, { id: pic, kind: 'image', url: `/media/${pic}.webp`, thumb: `/media/${pic}-thumb.webp`, width: 1200, height: 800, alt: '' }],
  ]);
  const projects = structuredClone(defaults.projects);
  projects.items[0].photo1 = pic;
  projects.items[0].videos = [{ videoUrl: 'https://vk.com/clip-1_2', title: 'Репортаж' }];
  const data = validateContent({
    ...defaults,
    projects,
    works: { ...defaults.works, items: [
      { title: 'Свой Reels', video: vid },
      { title: 'Shorts', videoUrl: 'https://youtube.com/shorts/dQw4w9WgXcQ', shape: 'horizontal' },
      // Видео в поле для фото не выводится как картинка
      { title: 'Не фото', photo: vid },
    ] },
  });
  const html = renderPage(data, media);
  assert.ok(html.includes('href="#works"'));
  assert.ok(html.includes(`<source src="/media/${vid}.mp4" type="video/mp4">`));
  assert.ok(html.includes('class="vid vid-vertical work-vid"'));
  assert.ok(html.includes('0:34'));
  assert.ok(html.includes('class="vid vid-horizontal vid-ext work-vid"'));
  assert.ok(html.includes('data-embed="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&amp;playsinline=1&amp;autoplay=1"'));
  assert.ok(!html.includes('Не фото'));
  // Ролик проекта: плеер VK, обложка — фото мероприятия
  assert.ok(html.includes('class="case-videos reveal"'));
  assert.ok(html.includes('data-embed="https://vkvideo.ru/video_ext.php?oid=-1&amp;id=2&amp;hd=2&amp;autoplay=1"'));
  assert.ok(html.includes('Репортаж'));
  assert.ok(!html.includes('<iframe'), 'чужой плеер не встраивается до нажатия');
});

// ---------- Видимость разделов и карточек ----------

test('видимость: данные, сохранённые до переключателей, выводятся как раньше', () => {
  const { fillMissing } = require('../src/content');
  // Так выглядят данные на сервере до обновления: нет sections и visible, часть карточек удалена, поле очищено
  const old = structuredClone(defaults);
  delete old.sections;
  old.projects.items = old.projects.items.slice(0, 2);
  old.results = old.results.slice(1);
  old.hero.tagline = '';
  const strip = (v) => {
    if (Array.isArray(v)) v.forEach(strip);
    else if (v && typeof v === 'object') { delete v.visible; Object.values(v).forEach(strip); }
  };
  strip(old);
  const data = validateContent(fillMissing(defaults, JSON.parse(JSON.stringify(old))));
  // Правки сохранились: удалённое не вернулось, очищенное не заполнилось
  assert.equal(data.projects.items.length, 2);
  assert.equal(data.results.length, defaults.results.length - 1);
  assert.equal(data.hero.tagline, '');
  // Всё включено по умолчанию
  assert.ok(Object.values(data.sections).every((v) => v === true));
  assert.ok(data.projects.items.every((p) => p.visible === true));
  const html = renderPage(data, new Map());
  for (const id of ['about', 'projects', 'results', 'growth', 'experience', 'skills', 'certificates', 'hobbies', 'contacts']) {
    assert.ok(html.includes(`href="#${id}"`), `раздел ${id} в меню`);
  }
});

test('видимость: выключенный раздел и скрытая карточка не выводятся, но остаются в данных', () => {
  const projects = structuredClone(defaults.projects);
  projects.items[1].visible = false;
  const data = validateContent({
    ...defaults,
    projects,
    sections: { certificates: false, contacts: false },
  });
  assert.equal(data.sections.certificates, false);
  assert.equal(data.sections.projects, true);
  assert.equal(data.projects.items[1].visible, false);
  assert.equal(data.projects.items.length, defaults.projects.items.length);
  const html = renderPage(data, new Map());
  assert.ok(!html.includes('id="certificates"') && !html.includes('href="#certificates"'));
  assert.ok(!html.includes('id="contacts"') && !html.includes('href="#contacts"'));
  assert.ok(html.includes(defaults.projects.items[0].title));
  assert.ok(!html.includes(defaults.projects.items[1].title), 'скрытый проект не выводится');
  assert.ok(html.includes(defaults.projects.items[2].title.replace(/&/g, '&amp;')));
});

test('видимость: всё выключено — страница всё равно строится', () => {
  const sections = Object.fromEntries(Object.keys(validateContent(defaults).sections).map((k) => [k, false]));
  const html = renderPage(validateContent({ ...defaults, sections }), new Map());
  assert.ok(html.includes('id="hero-title"'));
  assert.ok(!html.includes('Смотреть портфолио'));
  assert.ok(!html.includes('href="#about"'));
});
