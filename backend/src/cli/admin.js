'use strict';

// Управление администратором из консоли сервера:
//   node src/cli/admin.js create <логин>   — создать админа, пароль сгенерируется
//   node src/cli/admin.js reset <логин>    — новый пароль, сброс блокировки и 2FA, выход со всех устройств
//   node src/cli/admin.js rename <старый> <новый> — сменить логин (пароль и 2FA сохраняются)
//   node src/cli/admin.js list             — список админов

const db = require('../db');
const sec = require('../security');

function generatePassword() {
  // 20 символов без похожих друг на друга (0/O, 1/l)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_!@#%';
  const bytes = require('node:crypto').randomBytes(20);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

async function main() {
  const [command, username, newName] = process.argv.slice(2);
  const valid = (u) => /^[A-Za-z0-9_.-]{3,64}$/.test(u || '');
  await db.waitForDatabase(10);
  await db.migrate();

  if (command === 'list') {
    const { rows } = await db.query(
      'SELECT username, totp_secret IS NOT NULL AS totp, locked_until, created_at FROM admins ORDER BY id',
    );
    console.table(rows);
    return;
  }

  if (command === 'rename') {
    if (!valid(username) || !valid(newName)) {
      console.log('Использование: admin.js rename <старый логин> <новый логин>');
      process.exitCode = 1;
      return;
    }
    const taken = await db.query('SELECT 1 FROM admins WHERE lower(username) = lower($1) AND lower(username) <> lower($2)', [newName, username]);
    if (taken.rowCount) {
      console.log('Такой логин уже занят.');
      process.exitCode = 1;
      return;
    }
    const { rows } = await db.query('UPDATE admins SET username = $2 WHERE lower(username) = lower($1) RETURNING id', [username, newName]);
    if (!rows[0]) {
      console.log('Логин не найден.');
      process.exitCode = 1;
      return;
    }
    // Выход на всех устройствах: войти нужно уже под новым логином
    await db.query('DELETE FROM sessions WHERE admin_id = $1', [rows[0].id]);
    console.log(`
  Логин изменён: ${username} → ${newName}. Пароль прежний.
`);
    return;
  }

  if (!['create', 'reset'].includes(command) || !valid(username)) {
    console.log('Использование: admin.js create|reset <логин> (латиница, цифры, _ . -, от 3 символов) | rename <старый> <новый> | list');
    process.exitCode = 1;
    return;
  }

  let login = username;
  const password = generatePassword();
  const hash = await sec.hashPassword(password);

  if (command === 'create') {
    // Логины сравниваются без учёта регистра: alica и Alica — один и тот же вход
    const exists = await db.query('SELECT 1 FROM admins WHERE lower(username) = lower($1)', [username]);
    const { rowCount } = exists.rowCount ? { rowCount: 0 } : await db.query(
      'INSERT INTO admins (username, password_hash) VALUES ($1, $2) ON CONFLICT (username) DO NOTHING',
      [username, hash],
    );
    if (!rowCount) {
      console.log('Такой логин уже есть. Чтобы сменить пароль, используйте reset.');
      process.exitCode = 1;
      return;
    }
  } else {
    const { rows } = await db.query(
      `UPDATE admins SET password_hash = $2, failed_attempts = 0, locked_until = NULL,
              totp_secret = NULL, totp_last_step = NULL, password_changed_at = now()
        WHERE lower(username) = lower($1) RETURNING id, username`,
      [username, hash],
    );
    if (!rows[0]) {
      console.log('Логин не найден.');
      process.exitCode = 1;
      return;
    }
    await db.query('DELETE FROM sessions WHERE admin_id = $1', [rows[0].id]);
    login = rows[0].username;
  }

  console.log('\n  Логин:  ' + login);
  console.log('  Пароль: ' + password);
  console.log('\n  Сохраните пароль в менеджере паролей — повторно он не показывается.');
  console.log('  После входа включите двухфакторную защиту в разделе «Безопасность».\n');
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
