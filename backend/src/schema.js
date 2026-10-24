'use strict';

// Схема содержимого сайта. По ней сервер проверяет сохранение, а админка строит формы.
// Любое поле, которого нет в схеме, при сохранении отбрасывается.

const str = (label, max, extra = {}) => ({ type: 'string', label, max, ...extra });
const text = (label, max, extra = {}) => ({ type: 'string', label, max, multiline: true, ...extra });
const list = (label, of, max, extra = {}) => ({ type: 'list', label, of, max, ...extra });
const obj = (label, fields, extra = {}) => ({ type: 'object', label, fields, ...extra });
const image = (label) => ({ type: 'image', label });
// Выбор из фиксированного списка и переключатель: сервер принимает только перечисленные значения
const select = (label, options, def) => ({ type: 'select', label, options, default: def });
const toggle = (label, def) => ({ type: 'toggle', label, default: def });

const tasks = list('Пункты', text('Пункт', 300), 8, { itemLabel: 'Пункт' });

const schema = obj('Сайт', {
  hero: obj('Главный экран', {
    firstName: str('Имя', 40),
    lastName: str('Фамилия', 60),
    role: str('Должность', 80),
    tagline: text('Короткое описание под именем', 240),
    status: str('Статус (бейдж над именем)', 80),
    formats: str('Формат работы', 120),
    location: str('Город', 80),
    photo: image('Фото'),
  }),
  highlights: list('Цифры на главном экране', obj('Цифра', {
    value: str('Значение', 14),
    label: str('Подпись', 60),
  }), 4, { itemLabel: 'Цифра' }),
  about: obj('Обо мне', {
    heading: str('Заголовок', 140),
    paragraphs: list('Абзацы', text('Абзац', 700), 6, { itemLabel: 'Абзац' }),
    photo: image('Фото рядом с текстом'),
    principles: list('Принципы работы', obj('Принцип', {
      title: str('Заголовок', 60),
      text: text('Пояснение', 220),
    }), 4, { itemLabel: 'Принцип' }),
  }),
  projects: obj('Проекты (мероприятия)', {
    heading: str('Заголовок раздела', 80),
    intro: text('Вступление', 300),
    items: list('Проекты', obj('Проект', {
      title: str('Название мероприятия', 90),
      category: str('Тип (конференция, фестиваль, форум…)', 40),
      period: str('Когда', 40),
      photo1: image('Главное фото'),
      photo2: image('Второе фото'),
      about: text('О мероприятии: чему посвящено, кто аудитория', 420),
      task: text('Задача', 360),
      done: list('Что сделала', text('Пункт', 220), 5, { itemLabel: 'Пункт' }),
      metrics: list('Результаты в цифрах (замените на реальные)', obj('Цифра', {
        value: str('Значение', 16),
        label: str('Подпись', 60),
      }), 4, { itemLabel: 'Цифра' }),
    }), 12, { itemLabel: 'Проект' }),
  }),
  results: list('Ключевые результаты', obj('Результат', {
    value: str('Крупная цифра', 16),
    title: str('Заголовок', 60),
    text: text('Пояснение', 220),
  }), 8, { itemLabel: 'Результат' }),
  charts: list('Графики роста', obj('График', {
    title: str('Заголовок', 80),
    caption: str('Подпись (проект, период)', 120),
    unit: str('Единица (например, % или подписчиков)', 20),
    points: text('Точки: «подпись: число», каждая с новой строки (например «1-й месяц: 20000»). Только реальные цифры из статистики', 400),
  }), 4, { itemLabel: 'График' }),
  experience: list('Опыт в SMM', obj('Место работы', {
    role: str('Должность', 120),
    place: str('Где / с кем', 120),
    period: str('Период', 80),
    summary: text('Кратко о проекте', 400),
    tasks,
    result: text('Результат', 400),
  }), 10, { itemLabel: 'Место работы' }),
  works: obj('Работы (галерея)', {
    heading: str('Заголовок', 80),
    intro: text('Вступление', 300),
    items: list('Карточки', obj('Работа', {
      photo: image('Изображение'),
      title: str('Название', 80),
      caption: text('Подпись', 220),
      tag: str('Метка (ниша)', 40),
    }), 40, { itemLabel: 'Работа' }),
  }),
  skills: list('Навыки', obj('Группа навыков', {
    group: str('Группа', 40),
    items: text('Навыки через запятую', 400),
  }), 10, { itemLabel: 'Группа' }),
  certificates: obj('Сертификаты', {
    heading: str('Заголовок раздела', 80),
    intro: text('Вступление', 300),
    items: list('Сертификаты', obj('Сертификат', {
      title: str('Название курса', 100),
      school: str('Школа или платформа', 80),
      period: str('Даты обучения или дата выдачи', 60),
      details: str('Объём (часы, занятия, дипломная работа)', 120),
      skills: text('Чему научилась — через запятую', 300),
      number: str('Номер сертификата (если есть)', 60),
      photo: image('Скан сертификата'),
    }), 12, { itemLabel: 'Сертификат' }),
  }),
  hobbies: obj('Увлечения', {
    heading: str('Заголовок', 80),
    intro: text('Вступление', 300),
    photo: image('Фото'),
    items: list('Увлечения', obj('Увлечение', {
      title: str('Название', 60),
      text: text('Пара предложений', 260),
    }), 6, { itemLabel: 'Увлечение' }),
  }),
  otherExperience: list('Другой опыт работы', obj('Место работы', {
    role: str('Должность', 120),
    place: str('Организация', 120),
    period: str('Период', 80),
    tasks,
  }), 6, { itemLabel: 'Место работы' }),
  education: list('Образование и курсы', obj('Запись', {
    title: str('Название', 200),
    details: str('Подробности', 200),
  }), 6, { itemLabel: 'Запись' }),
  contacts: obj('Контакты', {
    heading: str('Заголовок блока', 120),
    text: text('Текст', 300),
    telegram: str('Telegram (ник без ссылки)', 40, { format: 'telegram' }),
    email: str('Почта', 120, { format: 'email' }),
    phone: str('Телефон', 30, { format: 'phone' }),
    photo: image('Фото в блоке контактов'),
  }),
  theme: obj('Стиль сайта', {
    band: select('Фон блока «Проекты»', [
      { value: 'espresso', label: 'Эспрессо — тёмный тёплый' },
      { value: 'sand', label: 'Песок' },
      { value: 'powder', label: 'Пудра' },
      { value: 'sage', label: 'Шалфей' },
      { value: 'caramel', label: 'Карамель' },
    ], 'espresso'),
    paper: select('Фон страницы', [
      { value: 'warm', label: 'Тёплая бумага' },
      { value: 'milk', label: 'Молочный' },
      { value: 'cool', label: 'Холодный серый' },
    ], 'warm'),
    accent: select('Акцентный цвет', [
      { value: 'bronze', label: 'Бронза' },
      { value: 'terracotta', label: 'Терракота' },
      { value: 'olive', label: 'Оливка' },
      { value: 'graphite', label: 'Графит' },
    ], 'bronze'),
    headings: select('Шрифт заголовков', [
      { value: 'serif', label: 'С засечками — журнальный' },
      { value: 'sans', label: 'Без засечек — строгий' },
    ], 'serif'),
    motion: toggle('Анимации при прокрутке', true),
    grain: toggle('Фактура бумаги (зерно)', true),
    guides: toggle('Тонкие линии-сетка на фоне', true),
    rails: toggle('Подписи на полях широкого экрана', true),
  }),
  decor: obj('Оформление', {
    photos: list('Фоновые фото (мероприятия, съёмки) — на сайте показываются чёрно-белыми и полупрозрачными',
      image('Фото'), 8, { itemLabel: 'Фото' }),
    badge: str('Текст в круглом значке у фото на главном экране', 70),
  }),
  footer: obj('Подвал', {
    copyright: str('Текст после © (пусто — имя с главного экрана)', 80),
    credit: str('Подпись разработчика сайта', 80),
  }),
  seo: obj('Поисковики и вкладка браузера', {
    title: str('Заголовок вкладки', 70),
    description: text('Описание для поисковиков', 200),
  }),
});

const FORMATS = {
  telegram: { re: /^@?[A-Za-z0-9_]{5,32}$/, hint: 'ник из 5–32 латинских букв, цифр или _' },
  // Только обычные символы адреса: без ? & = и т. п., чтобы в ссылку mailto: нельзя было подмешать cc/bcc/subject
  email: { re: /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}$/, hint: 'адрес вида name@mail.ru' },
  phone: { re: /^\+?[0-9][0-9\s()-]{5,24}$/, hint: 'только цифры, пробелы, скобки, дефис и +' },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

class ValidationError extends Error {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.path = path;
  }
}

function cleanString(value) {
  // Удаляем управляющие символы (кроме переноса строки) и нормализуем юникод.
  return value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '')
    .trim();
}

function validate(node, value, path) {
  switch (node.type) {
    case 'string': {
      if (value === undefined || value === null) return '';
      if (typeof value !== 'string') throw new ValidationError(path, 'ожидается текст');
      let s = cleanString(value);
      if (!node.multiline) s = s.replace(/\n+/g, ' ');
      if (s.length > node.max) throw new ValidationError(path, `не длиннее ${node.max} символов`);
      if (s && node.format) {
        const f = FORMATS[node.format];
        if (!f.re.test(s)) throw new ValidationError(path, f.hint);
        if (node.format === 'telegram') s = s.replace(/^@/, '');
      }
      return s;
    }
    case 'select': {
      return node.options.some((o) => o.value === value) ? value : node.default;
    }
    case 'toggle': {
      return typeof value === 'boolean' ? value : node.default;
    }
    case 'image': {
      if (value === undefined || value === null || value === '') return '';
      if (typeof value !== 'string' || !UUID_RE.test(value)) throw new ValidationError(path, 'неверное изображение');
      return value;
    }
    case 'list': {
      if (value === undefined || value === null) return [];
      if (!Array.isArray(value)) throw new ValidationError(path, 'ожидается список');
      if (value.length > node.max) throw new ValidationError(path, `не больше ${node.max} элементов`);
      return value.map((item, i) => validate(node.of, item, `${path}[${i + 1}]`));
    }
    case 'object': {
      if (value === undefined || value === null) value = {};
      if (typeof value !== 'object' || Array.isArray(value)) throw new ValidationError(path, 'ожидается объект');
      const out = {};
      for (const [key, child] of Object.entries(node.fields)) {
        out[key] = validate(child, value[key], path ? `${path} → ${child.label}` : child.label);
      }
      return out;
    }
    default:
      throw new Error(`Неизвестный тип схемы: ${node.type}`);
  }
}

function validateContent(data) {
  return validate(schema, data, '');
}

// Все id изображений, на которые ссылается содержимое
function collectImageIds(node = schema, value, out = new Set()) {
  if (node.type === 'image' && value) out.add(value);
  if (node.type === 'list' && Array.isArray(value)) value.forEach((v) => collectImageIds(node.of, v, out));
  if (node.type === 'object' && value) {
    for (const [key, child] of Object.entries(node.fields)) collectImageIds(child, value[key], out);
  }
  return out;
}

module.exports = { schema, validateContent, ValidationError, collectImageIds, UUID_RE };
