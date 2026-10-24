// Подключается в <head> без defer: класс .js ставится до отрисовки, чтобы анимации не «мигали».
document.documentElement.classList.add('js');

document.addEventListener('DOMContentLoaded', () => {
  const root = document.documentElement;
  // Анимации выключены в системе или в админке («Стиль сайта»)
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches || root.classList.contains('no-motion');

  // Запуск анимации имени на первом экране
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('loaded')));

  // Полоса прокрутки сверху и кнопка «Связаться» после первого экрана
  const header = document.querySelector('.site-header');
  const bar = document.querySelector('.scroll-progress span');
  const railFill = document.querySelector('.rail-line i');
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const progress = max > 0 ? Math.min(window.scrollY / max, 1) : 0;
      if (bar) bar.style.transform = `scaleX(${progress})`;
      if (railFill) railFill.style.transform = `scaleY(${progress})`;
      if (header) header.classList.toggle('scrolled', window.scrollY > window.innerHeight * 0.6);
      ticking = false;
    });
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });

  // Полноэкранное меню (<details>): блокируем прокрутку под ним, закрываем по пункту и Escape
  const menu = document.querySelector('.menu');
  if (menu) {
    const summary = menu.querySelector('summary');
    menu.addEventListener('toggle', () => {
      summary.setAttribute('aria-label', menu.open ? 'Закрыть меню' : 'Меню: разделы сайта');
      if (menu.open) {
        const first = menu.querySelector('.menu-panel a');
        if (first) setTimeout(() => first.focus({ preventScroll: true }), 50);
      }
    });
    menu.addEventListener('click', (e) => {
      const contact = e.target.closest('.menu-foot a');
      if (contact) {
        menu.open = false;
        return;
      }
      const link = e.target.closest('.menu-panel a');
      if (!link) return;
      // Сначала закрываем меню, потом сами прокручиваем к разделу —
      // иначе закрытие блока обрывает плавную прокрутку браузера
      e.preventDefault();
      const id = link.getAttribute('href').slice(1);
      const target = document.getElementById(id);
      menu.open = false;
      if (target) {
        const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches && !root.classList.contains('no-motion');
        requestAnimationFrame(() => target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' }));
        history.replaceState(null, '', `#${id}`);
      }
    });
    // Клик мимо меню — закрываем
    document.addEventListener('click', (e) => {
      if (menu.open && !menu.contains(e.target)) menu.open = false;
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menu.open) {
        menu.open = false;
        summary.focus();
      }
    });
  }

  // Правая рейка на полях: номер и название раздела, который сейчас на экране
  const rail = document.querySelector('.rail-right');
  if (rail && 'IntersectionObserver' in window) {
    const railNum = rail.querySelector('.rail-num');
    const railLabel = rail.querySelector('.rail-label');
    const info = new Map();
    document.querySelectorAll('.menu-panel a').forEach((a) => {
      const id = a.getAttribute('href').slice(1);
      info.set(id, {
        num: a.querySelector('.menu-num')?.textContent || '',
        label: a.querySelector('.menu-label')?.textContent || '',
      });
    });
    const hero = { num: '00', label: 'Главная' };
    let current = null;
    const show = (item) => {
      if (current === item) return;
      current = item;
      document.querySelectorAll('.menu-panel a').forEach((a) => {
        a.classList.toggle('current', info.get(a.getAttribute('href').slice(1)) === item);
      });
      rail.classList.add('swap');
      setTimeout(() => {
        railNum.textContent = item.num;
        railLabel.textContent = item.label;
        rail.classList.remove('swap');
      }, 180);
    };
    const railIo = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) show(info.get(entry.target.id) || hero);
        });
      },
      { rootMargin: '-45% 0px -50% 0px' },
    );
    info.forEach((_, id) => {
      const section = document.getElementById(id);
      if (section) railIo.observe(section);
    });
    const heroSection = document.querySelector('.hero');
    if (heroSection) {
      heroSection.id = heroSection.id || 'hero';
      info.set(heroSection.id, hero);
      railIo.observe(heroSection);
    }
  }

  // Отсчёт цифр: «850K», «+6 500», «3,5 года», «×5» считаются от нуля до значения
  function animateCount(el) {
    const original = el.textContent;
    const m = original.match(/^(\D*?)(\d[\d\s ]*(?:[.,]\d+)?)([\s\S]*)$/);
    if (!m || reduceMotion) return;
    const [, prefix, numText, suffix] = m;
    const grouped = /\d[\s ]\d/.test(numText);
    const decimals = (numText.split(/[.,]/)[1] || '').length;
    const target = Number(numText.replace(/[\s ]/g, '').replace(',', '.'));
    if (!Number.isFinite(target) || target === 0) return;
    const fmt = new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: grouped,
    });
    const duration = 1600;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - (1 - t) ** 3;
      el.textContent = prefix + fmt.format(target * eased) + suffix;
      if (t < 1) requestAnimationFrame(step);
      else el.textContent = original;
    };
    el.textContent = prefix + fmt.format(0) + suffix;
    requestAnimationFrame(step);
  }

  // Появление блоков, фото и запуск счётчиков при прокрутке
  const items = document.querySelectorAll('.reveal, .img-reveal');
  const counters = document.querySelectorAll('[data-count]');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        });
      },
      { rootMargin: '0px 0px -6% 0px', threshold: 0.06 },
    );
    items.forEach((el, i) => {
      if (el.classList.contains('reveal')) el.style.transitionDelay = `${Math.min((i % 3) * 80, 160)}ms`;
      io.observe(el);
    });

    const countIo = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          animateCount(entry.target);
          countIo.unobserve(entry.target);
        });
      },
      { threshold: 0.6 },
    );
    counters.forEach((el) => countIo.observe(el));
  } else {
    items.forEach((el) => el.classList.add('in'));
  }

  // Просмотр фото из раздела «Работы»
  const box = document.querySelector('.lightbox');
  if (box) {
    const boxImg = box.querySelector('img');
    const boxCap = box.querySelector('figcaption');
    let lastFocus = null;
    const close = () => {
      box.hidden = true;
      boxImg.removeAttribute('src');
      document.body.style.overflow = '';
      if (lastFocus) lastFocus.focus();
    };
    document.querySelectorAll('[data-lightbox]').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        lastFocus = link;
        boxImg.src = link.getAttribute('href');
        boxImg.alt = link.dataset.caption || '';
        boxCap.textContent = link.dataset.caption || '';
        box.hidden = false;
        document.body.style.overflow = 'hidden';
        box.querySelector('.lightbox-close').focus();
      });
    });
    box.addEventListener('click', (e) => {
      if (e.target === box || e.target.closest('.lightbox-close')) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !box.hidden) close();
    });
  }
});
