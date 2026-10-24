'use strict';

// Админка портфолио. Весь интерфейс строится через DOM API и textContent —
// innerHTML с данными не используется, поэтому внедрить скрипт через текст нельзя.

(() => {
  const API = '/api/admin';
  const app = document.getElementById('app');
  const toastEl = document.getElementById('toast');

  const state = {
    me: null,
    schema: null,
    data: null,
    media: [],
    dirty: false,
    section: null,
  };

  // ---------- Утилиты ----------

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (key in node && typeof value !== 'string') node[key] = value;
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of [].concat(children)) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  let toastTimer = null;
  function toast(message, isError = false) {
    toastEl.textContent = message;
    toastEl.className = isError ? 'toast error' : 'toast';
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
    }, isError ? 6000 : 3000);
  }

  class ApiError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }

  async function api(method, path, body, { raw = false, onProgress } = {}) {
    if (raw && onProgress) return uploadWithProgress(path, body, onProgress);
    const headers = { Accept: 'application/json' };
    if (state.me?.csrfToken) headers['X-CSRF-Token'] = state.me.csrfToken;
    let payload;
    if (body !== undefined) {
      if (raw) payload = body;
      else {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
      }
    }
    const res = await fetch(API + path, { method, headers, body: payload, credentials: 'same-origin', cache: 'no-store' });
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (res.status === 401 && path !== '/login') {
      state.me = null;
      renderLogin('Сессия закончилась, войдите снова');
      throw new ApiError(401, 'Нужно войти');
    }
    if (!res.ok) throw new ApiError(res.status, json?.error || `Ошибка ${res.status}`);
    return json;
  }

  function uploadWithProgress(path, formData, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', API + path);
      xhr.setRequestHeader('X-CSRF-Token', state.me.csrfToken);
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      });
      xhr.addEventListener('load', () => {
        let json = null;
        try {
          json = JSON.parse(xhr.responseText);
        } catch {
          json = null;
        }
        if (xhr.status === 401) {
          state.me = null;
          renderLogin('Сессия закончилась, войдите снова');
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(json);
        else reject(new ApiError(xhr.status, json?.error || `Ошибка ${xhr.status}`));
      });
      xhr.addEventListener('error', () => reject(new ApiError(0, 'Нет связи с сервером')));
      xhr.send(formData);
    });
  }

  function setDirty(value) {
    state.dirty = value;
    const note = document.querySelector('.dirty-note');
    const save = document.querySelector('#save-btn');
    if (note) note.hidden = !value;
    if (save) save.disabled = !value;
  }

  window.addEventListener('beforeunload', (e) => {
    if (state.dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // ---------- Вход ----------

  function renderLogin(message = '') {
    const error = el('p', { class: 'error', text: message, hidden: !message });
    const codeField = el('label', { class: 'field' }, [
      el('span', { text: 'Код из приложения (если включена 2FA)' }),
      el('input', { class: 'input', name: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', pattern: '[0-9]*' }),
    ]);
    const button = el('button', { class: 'btn btn-primary', type: 'submit', text: 'Войти' });
    const form = el('form', { novalidate: true }, [
      el('label', { class: 'field' }, [
        el('span', { text: 'Логин' }),
        el('input', { class: 'input', name: 'username', autocomplete: 'username', required: true, maxlength: '64' }),
      ]),
      el('label', { class: 'field' }, [
        el('span', { text: 'Пароль' }),
        el('input', { class: 'input', name: 'password', type: 'password', autocomplete: 'current-password', required: true, maxlength: '200' }),
      ]),
      codeField,
      error,
      button,
    ]);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      button.disabled = true;
      error.hidden = true;
      try {
        state.me = await api('POST', '/login', {
          username: String(fd.get('username') || ''),
          password: String(fd.get('password') || ''),
          code: String(fd.get('code') || ''),
        });
        await boot();
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
        form.password.value = '';
        form.code.value = '';
      } finally {
        button.disabled = false;
      }
    });
    app.replaceChildren(
      el('div', { class: 'login-wrap' }, [
        el('div', { class: 'login-card' }, [
          el('div', { class: 'logo', 'aria-hidden': 'true' }),
          el('h1', { text: 'Вход в админку' }),
          el('p', { class: 'sub', text: 'Портфолио: тексты, фото и безопасность' }),
          form,
        ]),
      ]),
    );
    form.username.focus();
  }

  // ---------- Значения по умолчанию из схемы ----------

  function emptyValue(node) {
    if (node.type === 'string' || node.type === 'image') return '';
    if (node.type === 'select' || node.type === 'toggle') return node.default;
    if (node.type === 'list') return [];
    const out = {};
    for (const [key, child] of Object.entries(node.fields)) out[key] = emptyValue(child);
    return out;
  }

  // ---------- Построение формы по схеме ----------

  function stringField(node, value, onChange) {
    const input = node.multiline
      ? el('textarea', { class: 'input', maxlength: String(node.max), rows: node.max > 300 ? '5' : '3' })
      : el('input', { class: 'input', maxlength: String(node.max), type: node.format === 'email' ? 'email' : node.format === 'phone' ? 'tel' : 'text' });
    input.value = value || '';
    const counter = el('span', { class: 'counter' });
    const update = () => {
      counter.textContent = `${input.value.length} / ${node.max}`;
      counter.classList.toggle('over', input.value.length > node.max);
    };
    input.addEventListener('input', () => {
      update();
      onChange(input.value);
    });
    update();
    return { input, counter };
  }

  function imageField(node, value, onChange) {
    const wrap = el('div', { class: 'image-field' });
    const draw = (id) => {
      const m = state.media.find((x) => x.id === id);
      const preview = m
        ? el('img', { class: 'image-preview', src: m.thumb, alt: m.alt || 'Выбранное фото' })
        : el('div', { class: 'image-preview', text: id ? 'Фото удалено' : 'Нет фото' });
      const pick = el('button', {
        class: 'btn',
        type: 'button',
        text: m ? 'Заменить' : 'Выбрать фото',
        onclick: () =>
          openPicker((picked) => {
            onChange(picked);
            draw(picked);
          }),
      });
      const clear = m
        ? el('button', {
            class: 'btn btn-danger',
            type: 'button',
            text: 'Убрать',
            onclick: () => {
              onChange('');
              draw('');
            },
          })
        : null;
      wrap.replaceChildren(preview, el('div', { class: 'stack' }, [pick, clear]));
    };
    draw(value);
    return wrap;
  }

  function renderNode(node, value, onChange, label) {
    if (node.type === 'string') {
      const { input, counter } = stringField(node, value, onChange);
      return el('label', { class: 'field' }, [el('span', { text: label || node.label }), input, counter]);
    }
    if (node.type === 'image') {
      return el('div', { class: 'field' }, [el('span', { text: label || node.label }), imageField(node, value, onChange)]);
    }
    if (node.type === 'select') {
      const select = el('select', { class: 'input' }, node.options.map((o) => el('option', { value: o.value, text: o.label })));
      select.value = value;
      select.addEventListener('change', () => onChange(select.value));
      return el('label', { class: 'field' }, [el('span', { text: label || node.label }), select]);
    }
    if (node.type === 'toggle') {
      const box = el('input', { type: 'checkbox', checked: Boolean(value) });
      box.addEventListener('change', () => onChange(box.checked));
      return el('label', { class: 'toggle' }, [box, el('span', { text: label || node.label })]);
    }
    if (node.type === 'object') {
      const box = el('div', { class: 'stack' });
      for (const [key, child] of Object.entries(node.fields)) {
        box.append(
          renderNode(child, value[key], (v) => {
            value[key] = v;
            setDirty(true);
          }),
        );
      }
      return box;
    }
    if (node.type === 'list') return renderList(node, value, label);
    return el('p', { text: 'Неизвестное поле' });
  }

  function renderList(node, arr, label) {
    const isStrings = node.of.type === 'string';
    const wrap = el('div', { class: `stack${isStrings ? ' list-strings' : ''}` });
    const redraw = () => {
      const items = arr.map((item, i) => {
        const head = el('div', { class: 'list-head' }, [
          el('strong', { text: `${node.itemLabel || 'Элемент'} ${i + 1}` }),
          el('button', {
            class: 'btn btn-icon', type: 'button', title: 'Выше', 'aria-label': 'Переместить выше', text: '↑', disabled: i === 0,
            onclick: () => {
              [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
              setDirty(true);
              redraw();
            },
          }),
          el('button', {
            class: 'btn btn-icon', type: 'button', title: 'Ниже', 'aria-label': 'Переместить ниже', text: '↓', disabled: i === arr.length - 1,
            onclick: () => {
              [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
              setDirty(true);
              redraw();
            },
          }),
          el('button', {
            class: 'btn btn-icon btn-danger', type: 'button', title: 'Удалить', 'aria-label': 'Удалить', text: '✕',
            onclick: () => {
              if (!confirm('Удалить этот элемент?')) return;
              arr.splice(i, 1);
              setDirty(true);
              redraw();
            },
          }),
        ]);
        let body;
        if (isStrings) {
          const { input, counter } = stringField(node.of, item, (v) => {
            arr[i] = v;
            setDirty(true);
          });
          body = el('div', { class: 'field' }, [input, counter]);
        } else if (node.of.type === 'image') {
          // Список фото: значение элемента — id изображения
          body = imageField(node.of, item, (v) => {
            arr[i] = v;
            setDirty(true);
          });
        } else {
          body = renderNode(node.of, item, () => {});
        }
        return el('div', { class: 'list-item' }, [head, body]);
      });
      const add = el('button', {
        class: 'btn',
        type: 'button',
        text: `+ Добавить ${String(node.itemLabel || 'элемент').toLowerCase()}`,
        disabled: arr.length >= node.max,
        onclick: () => {
          arr.push(emptyValue(node.of));
          setDirty(true);
          redraw();
        },
      });
      wrap.replaceChildren(
        ...(label === false ? [] : [el('div', { class: 'group-title', text: node.label })]),
        ...items,
        el('div', {}, [add, arr.length >= node.max ? el('span', { class: 'hint', text: `  Максимум ${node.max}` }) : null]),
      );
    };
    redraw();
    return wrap;
  }

  // ---------- Медиатека ----------

  async function refreshMedia() {
    state.media = await api('GET', '/media');
  }

  function dropzone(onUploaded) {
    const input = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/avif', multiple: true, hidden: true });
    const progress = el('div', { class: 'progress', hidden: true }, [el('i')]);
    const status = el('span', { class: 'hint' });
    const zone = el('div', { class: 'dropzone', tabindex: '0', role: 'button', 'aria-label': 'Загрузить фото' }, [
      el('strong', { text: 'Перетащите фото сюда или нажмите, чтобы выбрать' }),
      el('span', { text: 'JPG, PNG, WebP, AVIF · до 15 МБ · метаданные (геопозиция, модель телефона) удаляются автоматически' }),
      progress,
      status,
      input,
    ]);
    const bar = progress.querySelector('i');

    async function uploadFiles(files) {
      const list = [...files].slice(0, 20);
      for (let i = 0; i < list.length; i += 1) {
        const fd = new FormData();
        fd.append('file', list[i]);
        progress.hidden = false;
        status.textContent = `Загружаю ${i + 1} из ${list.length}: ${list[i].name}`;
        try {
          const media = await api('POST', '/media', fd, {
            raw: true,
            onProgress: (p) => {
              bar.style.width = `${Math.round(p * 100)}%`;
            },
          });
          state.media.unshift(media);
          onUploaded(media);
        } catch (err) {
          toast(`${list[i].name}: ${err.message}`, true);
        }
      }
      progress.hidden = true;
      bar.style.width = '0';
      status.textContent = '';
    }

    zone.addEventListener('click', () => input.click());
    zone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        input.click();
      }
    });
    input.addEventListener('change', () => {
      uploadFiles(input.files);
      input.value = '';
    });
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('over');
      uploadFiles(e.dataTransfer.files);
    });
    return zone;
  }

  function openPicker(onPick) {
    const grid = el('div', { class: 'media-grid' });
    const close = () => modal.remove();
    const drawGrid = () => {
      grid.replaceChildren(
        ...(state.media.length
          ? state.media.map((m) =>
              el('button', {
                class: 'media-pick', type: 'button', title: m.alt || 'Выбрать',
                onclick: () => {
                  onPick(m.id);
                  setDirty(true);
                  close();
                },
              }, [el('img', { src: m.thumb, alt: m.alt || 'Фото', loading: 'lazy' })]))
          : [el('p', { class: 'hint', text: 'Пока нет загруженных фото — загрузите первое выше.' })]),
      );
    };
    const modal = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Выбор фото' }, [
      el('div', { class: 'modal-box stack' }, [
        el('div', { class: 'modal-head' }, [
          el('h3', { text: 'Выберите фото' }),
          el('button', { class: 'btn', type: 'button', text: 'Закрыть', onclick: close }),
        ]),
        dropzone(() => drawGrid()),
        grid,
      ]),
    ]);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) close();
    });
    modal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
    drawGrid();
    document.body.append(modal);
    modal.querySelector('button').focus();
  }

  function renderMediaSection(container) {
    const grid = el('div', { class: 'media-grid' });
    const draw = () => {
      grid.replaceChildren(
        ...(state.media.length
          ? state.media.map((m) => {
              const alt = el('input', { class: 'input', maxlength: '200', placeholder: 'Описание (для доступности и SEO)' });
              alt.value = m.alt || '';
              alt.addEventListener('change', async () => {
                try {
                  const updated = await api('PATCH', `/media/${m.id}`, { alt: alt.value });
                  m.alt = updated.alt;
                  toast('Описание сохранено');
                } catch (err) {
                  toast(err.message, true);
                }
              });
              return el('div', { class: 'media-card' }, [
                el('img', { src: m.thumb, alt: m.alt || 'Фото', loading: 'lazy' }),
                el('div', { class: 'meta' }, [
                  el('span', { text: `${m.width}×${m.height} · ${Math.round(m.bytes / 1024)} КБ` }),
                  alt,
                  el('button', {
                    class: 'btn btn-small btn-danger', type: 'button', text: 'Удалить',
                    onclick: async () => {
                      if (!confirm('Удалить фото навсегда?')) return;
                      try {
                        await api('DELETE', `/media/${m.id}`);
                        state.media = state.media.filter((x) => x.id !== m.id);
                        draw();
                        toast('Фото удалено');
                      } catch (err) {
                        toast(err.message, true);
                      }
                    },
                  }),
                ]),
              ]);
            })
          : [el('p', { class: 'hint', text: 'Фото пока нет.' })]),
      );
    };
    draw();
    container.append(
      el('div', { class: 'stack' }, [
        el('p', { class: 'hint', text: 'Сюда загружаются все фото. Чтобы фото появилось на сайте, выберите его в разделе «Главный экран» или «Работы» и нажмите «Сохранить».' }),
        dropzone(() => draw()),
        grid,
      ]),
    );
  }

  // ---------- Безопасность ----------

  function passwordInput(name, autocomplete) {
    return el('input', { class: 'input', type: 'password', name, autocomplete, maxlength: '200', required: true });
  }

  function renderSecuritySection(container) {
    // Смена пароля
    const pwdError = el('p', { class: 'error', hidden: true });
    const pwdForm = el('form', { class: 'stack' }, [
      el('label', { class: 'field' }, [el('span', { text: 'Текущий пароль' }), passwordInput('current', 'current-password')]),
      el('label', { class: 'field' }, [el('span', { text: 'Новый пароль (от 12 символов)' }), passwordInput('next', 'new-password')]),
      el('label', { class: 'field' }, [el('span', { text: 'Повторите новый пароль' }), passwordInput('repeat', 'new-password')]),
      pwdError,
      el('div', {}, [el('button', { class: 'btn btn-primary', type: 'submit', text: 'Сменить пароль' })]),
    ]);
    pwdForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      pwdError.hidden = true;
      if (pwdForm.next.value !== pwdForm.repeat.value) {
        pwdError.textContent = 'Новые пароли не совпадают';
        pwdError.hidden = false;
        return;
      }
      try {
        await api('POST', '/password', { current: pwdForm.current.value, next: pwdForm.next.value });
        pwdForm.reset();
        toast('Пароль изменён. На других устройствах выполнен выход');
      } catch (err) {
        pwdError.textContent = err.message;
        pwdError.hidden = false;
      }
    });

    // Двухфакторная защита
    const totpBox = el('div', { class: 'stack' });
    const drawTotp = () => {
      if (state.me.totpEnabled) {
        const err = el('p', { class: 'error', hidden: true });
        const form = el('form', { class: 'stack' }, [
          el('p', {}, [el('span', { class: 'badge badge-ok', text: 'Включена' }), ' Вход требует код из приложения.']),
          el('label', { class: 'field' }, [el('span', { text: 'Пароль' }), passwordInput('password', 'current-password')]),
          el('label', { class: 'field' }, [el('span', { text: 'Код из приложения' }), el('input', { class: 'input', name: 'code', inputmode: 'numeric', maxlength: '6', required: true })]),
          err,
          el('div', {}, [el('button', { class: 'btn btn-danger', type: 'submit', text: 'Отключить 2FA' })]),
        ]);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          try {
            await api('POST', '/totp/disable', { password: form.password.value, code: form.code.value });
            state.me.totpEnabled = false;
            toast('Двухфакторная защита отключена');
            drawTotp();
          } catch (ex) {
            err.textContent = ex.message;
            err.hidden = false;
          }
        });
        totpBox.replaceChildren(form);
        return;
      }
      totpBox.replaceChildren(
        el('p', {}, [el('span', { class: 'badge badge-warn', text: 'Выключена' }), ' Рекомендуем включить: даже если пароль утечёт, без телефона войти не получится.']),
        el('div', {}, [
          el('button', {
            class: 'btn btn-accent', type: 'button', text: 'Включить 2FA',
            onclick: async () => {
              try {
                const { secret, uri } = await api('POST', '/totp/setup');
                const err = el('p', { class: 'error', hidden: true });
                const form = el('form', { class: 'stack' }, [
                  el('p', { text: '1. Откройте приложение-аутентификатор (Яндекс Ключ, Google Authenticator, 1Password и т. п.) и добавьте аккаунт по ключу:' }),
                  el('div', { class: 'secret', text: secret.replace(/(.{4})/g, '$1 ').trim() }),
                  el('p', { class: 'hint' }, ['На телефоне можно нажать ссылку: ', el('a', { href: uri, text: 'добавить в приложение' })]),
                  el('label', { class: 'field' }, [el('span', { text: '2. Введите 6-значный код из приложения' }), el('input', { class: 'input', name: 'code', inputmode: 'numeric', maxlength: '6', required: true, autocomplete: 'one-time-code' })]),
                  err,
                  el('div', {}, [el('button', { class: 'btn btn-primary', type: 'submit', text: 'Подтвердить' })]),
                ]);
                form.addEventListener('submit', async (e) => {
                  e.preventDefault();
                  try {
                    await api('POST', '/totp/enable', { code: form.code.value });
                    state.me.totpEnabled = true;
                    toast('Двухфакторная защита включена');
                    drawTotp();
                  } catch (ex) {
                    err.textContent = ex.message;
                    err.hidden = false;
                  }
                });
                totpBox.replaceChildren(form);
              } catch (ex) {
                toast(ex.message, true);
              }
            },
          }),
        ]),
      );
    };
    drawTotp();

    // Журнал
    const auditBox = el('div', { class: 'audit' }, [el('p', { class: 'hint', text: 'Загружаю…' })]);
    const actions = {
      login: 'Вход', logout: 'Выход', login_failed: 'Неудачный вход', login_failed_unknown_user: 'Вход с неизвестным логином',
      login_locked: 'Попытка входа при блокировке', content_saved: 'Сохранены тексты', media_uploaded: 'Загружено фото',
      media_deleted: 'Удалено фото', password_changed: 'Сменён пароль', password_change_failed: 'Неудачная смена пароля',
      totp_enabled: 'Включена 2FA', totp_disabled: 'Отключена 2FA', totp_disable_failed: 'Неудачное отключение 2FA',
    };
    api('GET', '/audit')
      .then((rows) => {
        auditBox.replaceChildren(
          ...rows.map((r) =>
            el('div', {}, [
              el('span', { text: new Date(r.created_at).toLocaleString('ru-RU') }),
              el('strong', { text: actions[r.action] || r.action }),
              el('span', { class: 'hint', text: r.ip || '' }),
            ])),
        );
      })
      .catch(() => auditBox.replaceChildren(el('p', { class: 'hint', text: 'Не удалось загрузить журнал' })));

    container.append(
      el('div', { class: 'stack' }, [
        el('section', { class: 'card stack' }, [el('h3', { text: 'Двухфакторная защита' }), totpBox]),
        el('section', { class: 'card stack' }, [el('h3', { text: 'Пароль' }), pwdForm]),
        el('section', { class: 'card stack' }, [el('h3', { text: 'Журнал действий (последние 50)' }), auditBox]),
      ]),
    );
  }

  // ---------- Основной экран ----------

  function sections() {
    const fromSchema = Object.entries(state.schema.fields).map(([key, node]) => ({ key, label: node.label, node }));
    return [...fromSchema, { key: '__media', label: 'Медиатека' }, { key: '__security', label: 'Безопасность' }];
  }

  async function save() {
    const btn = document.querySelector('#save-btn');
    btn.disabled = true;
    try {
      const res = await api('PUT', '/content', { data: state.data });
      // Сервер возвращает очищенную версию; перерисовываем форму, чтобы она редактировала именно её.
      state.data = res.data;
      setDirty(false);
      renderApp();
      toast('Сохранено — изменения уже на сайте');
    } catch (err) {
      btn.disabled = false;
      toast(err.message, true);
    }
  }

  function renderApp() {
    const list = sections();
    if (!state.section) state.section = list[0].key;
    const current = list.find((s) => s.key === state.section) || list[0];

    const sidebar = el('aside', { class: 'sidebar' });
    const navButtons = list.map((s, i) => {
      const b = el('button', {
        type: 'button', text: s.label, class: s.key === current.key ? 'active' : '',
        'aria-current': s.key === current.key ? 'page' : false,
        onclick: () => {
          state.section = s.key;
          renderApp();
        },
      });
      return i === list.length - 2 ? [el('hr'), b] : [b];
    }).flat();

    sidebar.append(
      el('div', { class: 'brand' }, [el('i', { 'aria-hidden': 'true' }), 'Портфолио']),
      el('nav', { 'aria-label': 'Разделы' }, navButtons),
      el('div', { class: 'who' }, [
        el('div', { text: `Вы вошли как ${state.me.username}` }),
        el('button', {
          class: 'btn btn-small', type: 'button', text: 'Выйти',
          onclick: async () => {
            if (state.dirty && !confirm('Есть несохранённые изменения. Всё равно выйти?')) return;
            await api('POST', '/logout').catch(() => {});
            state.me = null;
            setDirty(false);
            renderLogin();
          },
        }),
      ]),
    );

    const isContent = !current.key.startsWith('__');
    const topbar = el('div', { class: 'topbar' }, [
      el('button', {
        class: 'btn menu-toggle', type: 'button', text: 'Меню', 'aria-label': 'Открыть меню',
        onclick: () => sidebar.classList.toggle('open'),
      }),
      el('h2', { text: current.label }),
      el('span', { class: 'dirty-note', text: 'Есть несохранённые изменения', hidden: !state.dirty }),
      el('a', { class: 'btn', href: '/', target: '_blank', rel: 'noopener', text: 'Открыть сайт' }),
      el('button', { id: 'save-btn', class: 'btn btn-accent', type: 'button', text: 'Сохранить', disabled: !state.dirty, onclick: save }),
    ]);

    const content = el('div', { class: 'content' });
    if (isContent) {
      const node = current.node;
      const value = state.data[current.key];
      content.append(
        el('div', { class: 'card' }, [
          node.type === 'list'
            ? renderList(node, value, false)
            : renderNode(node, value, () => {}),
        ]),
      );
    } else if (current.key === '__media') {
      renderMediaSection(content);
    } else {
      renderSecuritySection(content);
    }

    app.replaceChildren(el('div', { class: 'layout' }, [sidebar, el('main', { class: 'main' }, [topbar, content])]));
  }

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && state.me && state.dirty) {
      e.preventDefault();
      save();
    }
  });

  async function boot() {
    const [schema, content] = await Promise.all([api('GET', '/schema'), api('GET', '/content')]);
    state.schema = schema;
    state.data = content.data;
    await refreshMedia();
    setDirty(false);
    renderApp();
  }

  (async () => {
    try {
      state.me = await api('GET', '/me');
      await boot();
    } catch (err) {
      if (err.status !== 401) renderLogin(err.status ? '' : 'Нет связи с сервером');
    }
  })();
})();
