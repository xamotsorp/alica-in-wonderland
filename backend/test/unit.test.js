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

test('рендер: подпись разработчика в подвале', () => {
  const html = renderPage(validateContent(defaults), new Map());
  assert.ok(html.includes('Designed &amp; developed by xamotsorp'));
  const none = renderPage(validateContent({ ...defaults, footer: { credit: '' } }), new Map());
  assert.ok(!none.includes('footer-credit'));
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
