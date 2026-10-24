#!/usr/bin/env bash
# Создаёт боевой .env со случайными секретами.
#   ./scripts/gen-env.sh            — спросит домен
#   ./scripts/gen-env.sh alisa.ru   — домен сразу
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  echo "Файл .env уже есть. Если хотите создать заново — удалите его (секреты базы поменяются!)." >&2
  exit 1
fi

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]]; then read -rp "Домен сайта (например alisa-smm.ru): " DOMAIN; fi
DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN%/}"
if ! [[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
  echo "Похоже, это не домен: $DOMAIN" >&2
  exit 1
fi

ADMIN_PATH="$(openssl rand -hex 12)"
DB_PASSWORD="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 40)"

umask 077
cat > .env <<EOF
DOMAIN=${DOMAIN}
PUBLIC_ORIGIN=https://${DOMAIN}
ADMIN_PATH=${ADMIN_PATH}
POSTGRES_PASSWORD=${DB_PASSWORD}
POSTGRES_USER=portfolio
POSTGRES_DB=portfolio
COOKIE_SECURE=true
ADMIN_IP_ALLOWLIST=
HTTP_PORT=80
HTTPS_PORT=443
EOF

echo
echo "  Готово: .env создан (доступ только владельцу файла)."
echo "  Адрес админки после получения HTTPS: https://${DOMAIN}/${ADMIN_PATH}/"
echo "  Сохраните этот адрес в менеджере паролей."
echo
