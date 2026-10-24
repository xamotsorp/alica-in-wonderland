'use strict';

// Все настройки берутся из переменных окружения. Без обязательных — сервер не стартует.

function required(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Не задана переменная окружения ${name}`);
  }
  return value.trim();
}

function bool(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function int(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
}

const publicOrigin = required('PUBLIC_ORIGIN').replace(/\/+$/, '');
if (!/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(publicOrigin)) {
  throw new Error('PUBLIC_ORIGIN должен выглядеть как https://example.ru');
}

const config = Object.freeze({
  port: int('PORT', 3000),
  publicOrigin,
  databaseUrl: required('DATABASE_URL'),
  uploadsDir: process.env.UPLOADS_DIR || '/data/uploads',
  // Cookie с флагом Secure работает только по HTTPS. Отключать — только для локальной проверки.
  cookieSecure: bool('COOKIE_SECURE', true),
  sessionIdleMinutes: int('SESSION_IDLE_MINUTES', 120),
  sessionMaxHours: int('SESSION_MAX_HOURS', 12),
  // Необязательный список IP, с которых разрешён вход в админку (через запятую).
  adminIpAllowlist: (process.env.ADMIN_IP_ALLOWLIST || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  maxUploadMb: int('MAX_UPLOAD_MB', 15),
});

module.exports = config;
