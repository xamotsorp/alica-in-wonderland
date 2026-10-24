#!/bin/sh
# Выбирает режим HTTP или HTTPS до того, как стандартный скрипт nginx подставит переменные в шаблоны.
set -eu

if ! echo "${DOMAIN:-}" | grep -Eq '^[A-Za-z0-9.-]{1,253}$'; then
    echo "[nginx] DOMAIN не задан или содержит недопустимые символы" >&2
    exit 1
fi
if ! echo "${ADMIN_PATH:-}" | grep -Eq '^[A-Za-z0-9_-]{12,64}$'; then
    echo "[nginx] ADMIN_PATH: от 12 до 64 символов (латиница, цифры, - и _)" >&2
    exit 1
fi

mkdir -p /etc/nginx/templates
rm -f /etc/nginx/conf.d/default.conf
cp /etc/nginx/site-templates/locations.inc.template /etc/nginx/templates/locations.inc.template

if [ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
    cp /etc/nginx/site-templates/https.conf.template /etc/nginx/templates/site.conf.template
    echo "[nginx] режим HTTPS для ${DOMAIN}"
    # Перечитываем конфигурацию раз в 12 часов, чтобы подхватить продлённый сертификат
    (while :; do sleep 43200; nginx -s reload 2>/dev/null || true; done) &
else
    cp /etc/nginx/site-templates/http.conf.template /etc/nginx/templates/site.conf.template
    echo "[nginx] режим HTTP (сертификата для ${DOMAIN} пока нет)"
fi
