'use strict';

const express = require('express');
const config = require('./config');
const db = require('./db');
const sec = require('./security');

const COOKIE = config.cookieSecure ? '__Host-sid' : 'sid';

const ipLimiter = new sec.RateLimiter({ windowMs: 15 * 60_000, max: 10 });
// Смена пароля и настройка 2FA: не больше 5 попыток за 15 минут на администратора
const sensitiveLimiter = new sec.RateLimiter({ windowMs: 15 * 60_000, max: 5 });
const TOO_MANY = { error: 'Слишком много попыток. Попробуйте через 15 минут.' };
const pendingTotp = new Map(); // id сессии → { secret, expires }

function clientIp(req) {
  // nginx передаёт реальный IP в X-Real-IP; приложению доступна только внутренняя сеть Docker.
  return String(req.headers['x-real-ip'] || req.socket.remoteAddress || '').slice(0, 64);
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function setSessionCookie(res, token) {
  const attrs = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${config.sessionMaxHours * 3600}`];
  if (config.cookieSecure) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(res) {
  const attrs = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (config.cookieSecure) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

async function audit(adminId, action, req, details = null) {
  try {
    await db.query('INSERT INTO audit_log (admin_id, action, ip, details) VALUES ($1, $2, $3, $4)', [
      adminId,
      action,
      clientIp(req),
      details,
    ]);
  } catch (err) {
    console.error('[audit]', err.message);
  }
}

// Доступ к админке только с разрешённых IP (если список задан)
function ipAllowlist(req, res, next) {
  if (config.adminIpAllowlist.length && !config.adminIpAllowlist.includes(clientIp(req))) {
    return res.status(404).json({ error: 'Не найдено' });
  }
  return next();
}

async function loadSession(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token || token.length > 100) return null;
  const { rows } = await db.query(
    `SELECT s.id, s.csrf_token, s.last_seen, s.expires_at, a.id AS admin_id, a.username,
            a.totp_secret IS NOT NULL AS totp_enabled
       FROM sessions s JOIN admins a ON a.id = s.admin_id
      WHERE s.id = $1`,
    [sec.sha256(token)],
  );
  const s = rows[0];
  if (!s) return null;
  const now = Date.now();
  const idleLimit = new Date(s.last_seen).getTime() + config.sessionIdleMinutes * 60_000;
  if (new Date(s.expires_at).getTime() <= now || idleLimit <= now) {
    await db.query('DELETE FROM sessions WHERE id = $1', [s.id]);
    return null;
  }
  // last_seen обновляем не чаще раза в минуту
  if (now - new Date(s.last_seen).getTime() > 60_000) {
    await db.query('UPDATE sessions SET last_seen = now() WHERE id = $1', [s.id]);
  }
  return s;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (origin) return origin === config.publicOrigin;
  const site = req.headers['sec-fetch-site'];
  return !site || site === 'same-origin';
}

// Проверка входа + защита от CSRF для всех изменяющих запросов
function requireAuth(req, res, next) {
  loadSession(req)
    .then((session) => {
      if (!session) return res.status(401).json({ error: 'Нужно войти заново' });
      if (!['GET', 'HEAD'].includes(req.method)) {
        if (!sameOrigin(req)) return res.status(403).json({ error: 'Запрос отклонён' });
        if (!sec.safeEqual(req.headers['x-csrf-token'] || '', session.csrf_token)) {
          return res.status(403).json({ error: 'Запрос отклонён, обновите страницу' });
        }
      }
      req.session = session;
      req.adminId = session.admin_id;
      return next();
    })
    .catch(next);
}

const router = express.Router();

// ---------- Защита входа от перебора ----------
// 1) Пара «IP + логин»: после 5 ошибок этот IP не может входить под этим логином 15 минут,
//    дальше блок растёт (30, 60 мин … до суток). Злоумышленник блокирует только себя,
//    а не настоящего администратора.
// 2) Аккаунт целиком: после 30 ошибок подряд с любых IP — пауза 30 минут (массовый перебор).
// Для несуществующих логинов счётчики ведутся так же, поэтому по ответам нельзя понять,
// существует ли логин.
const PAIR_MAX_FAILS = 5;
const ACCOUNT_MAX_FAILS = 30;
const ACCOUNT_LOCK_MIN = 30;
const pairState = new Map(); // `${ip}|${login}` → { fails, lockedUntil, locks, last }
const ghostAccounts = new Map(); // несуществующие логины: login → { fails, lockedUntil, last }

function pairKey(ip, login) {
  return `${ip}|${login.toLowerCase()}`;
}

function isPairLocked(ip, login) {
  const s = pairState.get(pairKey(ip, login));
  return Boolean(s && s.lockedUntil > Date.now());
}

function registerPairFail(ip, login) {
  const key = pairKey(ip, login);
  const s = pairState.get(key) || { fails: 0, lockedUntil: 0, locks: 0, last: 0 };
  s.fails += 1;
  s.last = Date.now();
  if (s.fails >= PAIR_MAX_FAILS) {
    s.locks += 1;
    s.fails = 0;
    s.lockedUntil = Date.now() + Math.min(15 * 2 ** (s.locks - 1), 24 * 60) * 60_000;
  }
  pairState.set(key, s);
}

function ghostLocked(login) {
  const g = ghostAccounts.get(login.toLowerCase());
  return Boolean(g && g.lockedUntil > Date.now());
}

function registerGhostFail(login) {
  const key = login.toLowerCase();
  const g = ghostAccounts.get(key) || { fails: 0, lockedUntil: 0, last: 0 };
  g.fails += 1;
  g.last = Date.now();
  if (g.fails >= ACCOUNT_MAX_FAILS) {
    g.fails = 0;
    g.lockedUntil = Date.now() + ACCOUNT_LOCK_MIN * 60_000;
  }
  ghostAccounts.set(key, g);
}

setInterval(() => {
  const dayAgo = Date.now() - 24 * 3600_000;
  for (const map of [pairState, ghostAccounts]) {
    for (const [key, s] of map) if (s.lockedUntil < Date.now() && s.last < dayAgo) map.delete(key);
  }
}, 3600_000).unref();

router.post('/login', async (req, res, next) => {
  try {
    const ip = clientIp(req);
    const username = typeof req.body?.username === 'string' ? req.body.username.trim().slice(0, 64) : '';
    const password = typeof req.body?.password === 'string' ? req.body.password.slice(0, 200) : '';
    const code = typeof req.body?.code === 'string' ? req.body.code.replace(/\s/g, '').slice(0, 6) : '';
    const tooMany = { error: 'Слишком много попыток. Попробуйте позже.' };

    if (!sameOrigin(req)) return res.status(403).json({ error: 'Запрос отклонён' });
    if (!ipLimiter.hit(ip)) return res.status(429).json(tooMany);
    if (!username || !password) return res.status(400).json({ error: 'Введите логин и пароль' });
    if (isPairLocked(ip, username)) return res.status(429).json(tooMany);

    const { rows } = await db.query('SELECT * FROM admins WHERE lower(username) = lower($1)', [username]);
    const admin = rows[0];

    const accountLocked = admin
      ? Boolean(admin.locked_until && new Date(admin.locked_until) > new Date())
      : ghostLocked(username);
    if (accountLocked) {
      await audit(admin ? admin.id : null, 'login_locked', req);
      return res.status(429).json(tooMany);
    }

    // Пароль проверяется всегда (для несуществующего логина — по хешу-заглушке), чтобы время ответа было одинаковым
    const passwordOk = await sec.verifyPassword(password, admin ? admin.password_hash : await sec.dummyHash());
    let totpStep = null;
    if (passwordOk && admin?.totp_secret) totpStep = sec.verifyTotp(admin.totp_secret, code, admin.totp_last_step);
    const ok = Boolean(admin && passwordOk && (!admin.totp_secret || totpStep !== null));

    if (!ok) {
      registerPairFail(ip, username);
      if (admin) {
        const fails = admin.failed_attempts + 1;
        const lock = fails >= ACCOUNT_MAX_FAILS;
        await db.query(
          `UPDATE admins SET failed_attempts = CASE WHEN $2 THEN 0 ELSE $3 END,
                  locked_until = CASE WHEN $2 THEN now() + make_interval(mins => $4) ELSE locked_until END
            WHERE id = $1`,
          [admin.id, lock, fails, ACCOUNT_LOCK_MIN],
        );
        await audit(admin.id, lock ? 'account_locked' : 'login_failed', req, { fails, needCode: Boolean(passwordOk && admin.totp_secret) });
      } else {
        registerGhostFail(username);
        await audit(null, 'login_failed_unknown_user', req);
      }
      return res.status(isPairLocked(ip, username) ? 429 : 401).json(
        isPairLocked(ip, username) ? tooMany : { error: 'Неверный логин, пароль или код' },
      );
    }

    await db.query(
      'UPDATE admins SET failed_attempts = 0, locked_until = NULL, totp_last_step = COALESCE($2, totp_last_step) WHERE id = $1',
      [admin.id, totpStep],
    );
    pairState.delete(pairKey(ip, username));
    ipLimiter.reset(ip);

    const token = sec.randomToken(32);
    const csrf = sec.randomToken(32);
    await db.query('DELETE FROM sessions WHERE expires_at < now()');
    await db.query(
      `INSERT INTO sessions (id, admin_id, csrf_token, ip, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(hours => $6))`,
      [sec.sha256(token), admin.id, csrf, ip, String(req.headers['user-agent'] || '').slice(0, 300), config.sessionMaxHours],
    );
    setSessionCookie(res, token);
    await audit(admin.id, 'login', req);
    return res.json({ username: admin.username, csrfToken: csrf, totpEnabled: Boolean(admin.totp_secret) });
  } catch (err) {
    return next(err);
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ username: req.session.username, csrfToken: req.session.csrf_token, totpEnabled: req.session.totp_enabled });
});

router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await db.query('DELETE FROM sessions WHERE id = $1', [req.session.id]);
    clearSessionCookie(res);
    await audit(req.adminId, 'logout', req);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

async function checkPassword(adminId, password) {
  const { rows } = await db.query('SELECT password_hash FROM admins WHERE id = $1', [adminId]);
  return Boolean(rows[0]) && sec.verifyPassword(String(password || '').slice(0, 200), rows[0].password_hash);
}

router.post('/password', requireAuth, async (req, res, next) => {
  try {
    if (!sensitiveLimiter.hit(`${req.path}:${req.adminId}`)) return res.status(429).json(TOO_MANY);
    const { current, next: nextPassword } = req.body || {};
    if (!(await checkPassword(req.adminId, current))) {
      await audit(req.adminId, 'password_change_failed', req);
      return res.status(400).json({ error: 'Текущий пароль указан неверно' });
    }
    const problems = sec.passwordProblems(nextPassword);
    if (problems.length) return res.status(400).json({ error: `Новый пароль: ${problems.join(', ')}` });
    await db.query('UPDATE admins SET password_hash = $2, password_changed_at = now() WHERE id = $1', [
      req.adminId,
      await sec.hashPassword(nextPassword),
    ]);
    // Выходим на всех других устройствах
    await db.query('DELETE FROM sessions WHERE admin_id = $1 AND id <> $2', [req.adminId, req.session.id]);
    await audit(req.adminId, 'password_changed', req);
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

router.post('/totp/setup', requireAuth, (req, res) => {
  if (req.session.totp_enabled) return res.status(400).json({ error: 'Двухфакторная защита уже включена' });
  const secret = sec.generateTotpSecret();
  pendingTotp.set(req.session.id, { secret, expires: Date.now() + 10 * 60_000 });
  res.json({ secret, uri: sec.totpUri(secret, req.session.username) });
});

router.post('/totp/enable', requireAuth, async (req, res, next) => {
  try {
    if (!sensitiveLimiter.hit(`${req.path}:${req.adminId}`)) return res.status(429).json(TOO_MANY);
    const pending = pendingTotp.get(req.session.id);
    if (!pending || pending.expires < Date.now()) return res.status(400).json({ error: 'Начните настройку заново' });
    const step = sec.verifyTotp(pending.secret, String(req.body?.code || ''), null);
    if (step === null) return res.status(400).json({ error: 'Код не подошёл. Проверьте время на телефоне' });
    await db.query('UPDATE admins SET totp_secret = $2, totp_last_step = $3 WHERE id = $1', [req.adminId, pending.secret, step]);
    pendingTotp.delete(req.session.id);
    await audit(req.adminId, 'totp_enabled', req);
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

router.post('/totp/disable', requireAuth, async (req, res, next) => {
  try {
    if (!sensitiveLimiter.hit(`${req.path}:${req.adminId}`)) return res.status(429).json(TOO_MANY);
    const { rows } = await db.query('SELECT totp_secret, totp_last_step FROM admins WHERE id = $1', [req.adminId]);
    const admin = rows[0];
    if (!admin?.totp_secret) return res.status(400).json({ error: 'Двухфакторная защита не включена' });
    const passwordOk = await checkPassword(req.adminId, req.body?.password);
    const step = sec.verifyTotp(admin.totp_secret, String(req.body?.code || ''), admin.totp_last_step);
    if (!passwordOk || step === null) {
      await audit(req.adminId, 'totp_disable_failed', req);
      return res.status(400).json({ error: 'Неверный пароль или код' });
    }
    await db.query('UPDATE admins SET totp_secret = NULL, totp_last_step = NULL WHERE id = $1', [req.adminId]);
    await audit(req.adminId, 'totp_disabled', req);
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

router.get('/audit', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT action, ip, created_at FROM audit_log ORDER BY created_at DESC LIMIT 50',
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of pendingTotp) if (value.expires < now) pendingTotp.delete(key);
}, 60_000).unref();

module.exports = { router, requireAuth, ipAllowlist, audit, clientIp };
