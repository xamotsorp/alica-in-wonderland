#!/usr/bin/env bash
# Проверка безопасности сайта «снаружи», как это сделал бы пентестер.
#
#   ./scripts/security-check.sh https://alisa-smm.ru
#   ADMIN_USER=Alica ADMIN_PASS='…' ./scripts/security-check.sh https://alisa-smm.ru
#   ADMIN_USER=… ADMIN_PASS=… BRUTEFORCE=1 ./scripts/security-check.sh http://localhost:8080
#
# Без логина проверяется всё публичное. С ADMIN_USER/ADMIN_PASS — ещё сессия, CSRF и загрузка файлов
# (загруженный тестовый файл удаляется). BRUTEFORCE=1 включает проверку перебора пароля:
# после неё ваш IP не сможет входить под этим логином 15 минут — запускайте последней.
set -u

BASE="${1:-http://localhost:8080}"
BASE="${BASE%/}"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PASS=0
FAIL=0

ok()   { PASS=$((PASS + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
bad()  { FAIL=$((FAIL + 1)); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; }
code() { curl -s -o /dev/null -w '%{http_code}' -A "$UA" --max-time 15 "$@" 2>/dev/null; }
expect() { # описание, ожидаемые коды через |, аргументы curl
  local name="$1" want="$2"; shift 2
  local got; got="$(code "$@")"
  if [[ "|$want|" == *"|$got|"* ]]; then ok "$name ($got)"; else bad "$name: получили $got, ждали $want"; fi
}
section() { printf '\n\033[1m%s\033[0m\n' "$1"; }
# Путь к файлу для curl (в Git Bash под Windows /tmp/... нужно перевести в C:\...)
fp() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi; }

section "1. Заголовки безопасности главной страницы"
curl -s -D "$TMP/h" -o "$TMP/page.html" -A "$UA" --max-time 15 "$BASE/" >/dev/null
for h in "content-security-policy: default-src 'self'" "x-frame-options: deny" "x-content-type-options: nosniff" \
         "referrer-policy: strict-origin-when-cross-origin" "permissions-policy:" "cross-origin-opener-policy: same-origin" \
         "cross-origin-resource-policy: same-origin"; do
  if tr 'A-Z' 'a-z' < "$TMP/h" | grep -q "^$h"; then ok "${h%%:*}"; else bad "нет заголовка ${h%%:*}"; fi
done
if grep -qi '^x-powered-by' "$TMP/h"; then bad "раскрывается X-Powered-By"; else ok "нет X-Powered-By"; fi
if grep -qiE '^server: .*[0-9]' "$TMP/h"; then bad "в Server видна версия"; else ok "версия веб-сервера скрыта"; fi
if grep -qi "frame-ancestors 'none'" "$TMP/h"; then ok "CSP запрещает встраивание во фреймы"; else bad "нет frame-ancestors"; fi
if grep -qiE "script-src[^;]*'unsafe-inline'" "$TMP/h"; then bad "CSP разрешает inline-скрипты"; else ok "CSP без unsafe-inline"; fi
if [[ "$BASE" == https://* ]]; then
  if grep -qi '^strict-transport-security: max-age=[0-9]\{8\}' "$TMP/h"; then ok "HSTS"; else bad "нет HSTS"; fi
  HTTP_URL="http://${BASE#https://}"
  loc="$(curl -s -o /dev/null -w '%{redirect_url}' -A "$UA" --max-time 15 "$HTTP_URL/")"
  if [[ "$loc" == https://* ]]; then ok "HTTP перенаправляет на HTTPS"; else bad "HTTP не перенаправляет на HTTPS ($loc)"; fi
fi

section "2. Сканеры, служебные файлы и подмена Host (ожидаем обрыв соединения — 000)"
for p in /.env /.git/HEAD /.git/config /wp-login.php /wp-admin/ /xmlrpc.php /phpmyadmin/ /server-status \
         /actuator/health /backup.sql /db.sql /config.yml /docker-compose.yml /.aws/credentials /vendor/phpunit/ /index.php; do
  expect "$p" "000|404" "$BASE$p"
done
expect "чужой Host" "000|400|421" -H "Host: evil.example" "$BASE/"
expect "сканер sqlmap по User-Agent" "000" -A "sqlmap/1.7" "$BASE/"
expect "пустой User-Agent" "000" -A "" "$BASE/"

section "3. Обход каталогов (path traversal)"
for p in "/static/../../../../etc/passwd" "/media/../../../etc/passwd" "/static/%2e%2e/%2e%2e/%2e%2e/etc/passwd" \
         "/media/..%2f..%2f..%2fetc%2fpasswd" "/%2e%2e/%2e%2e/etc/passwd" "/static//../../etc/passwd"; do
  got="$(curl -s -A "$UA" --path-as-is --max-time 15 -o "$TMP/t" -w '%{http_code}' "$BASE$p")"
  if grep -q 'root:' "$TMP/t" 2>/dev/null; then bad "$p отдаёт системный файл!"; else ok "$p ($got)"; fi
done
expect "/media/ отдаёт только <uuid>.webp" "404|000" "$BASE/media/photo.webp"
expect "/media/произвольное.php" "000|404" "$BASE/media/shell.php"

section "4. Скрытые и служебные адреса"
expect "/admin не существует" "404" "$BASE/admin"
expect "/healthz не виден снаружи" "404" "$BASE/healthz"
expect "/api/ без раздела" "404" "$BASE/api/"
for m in TRACE TRACK PROPFIND CONNECT OPTIONS; do expect "метод $m" "405|400|000" -X "$m" "$BASE/"; done

section "5. API админки без входа (ожидаем 401)"
for p in /api/admin/me /api/admin/content /api/admin/schema /api/admin/media /api/admin/audit; do expect "GET $p" "401" "$BASE$p"; done
expect "PUT content" "401" -X PUT -H "Origin: $BASE" -H 'Content-Type: application/json' -d '{"data":{}}' "$BASE/api/admin/content"
expect "POST media" "401" -X POST -H "Origin: $BASE" -F "file=@/dev/null" "$BASE/api/admin/media"
expect "DELETE media" "401" -X DELETE -H "Origin: $BASE" "$BASE/api/admin/media/00000000-0000-4000-8000-000000000000"
expect "POST password" "401" -X POST -H "Origin: $BASE" -H 'Content-Type: application/json' -d '{}' "$BASE/api/admin/password"

section "6. Форма входа"
expect "вход с чужого сайта (CSRF)" "403" -X POST -H "Origin: https://evil.example" -H 'Content-Type: application/json' -d '{"username":"a","password":"b"}' "$BASE/api/admin/login"
expect "битый JSON" "400" -X POST -H "Origin: $BASE" -H 'Content-Type: application/json' -d '{"username":' "$BASE/api/admin/login"
head -c 2000000 /dev/zero | tr '\0' 'a' > "$TMP/big"
expect "огромный запрос" "413" -X POST -H "Origin: $BASE" -H 'Content-Type: application/json' --data-binary @"$(fp "$TMP/big")" "$BASE/api/admin/login"
expect "SQL-инъекция в логине" "401|429" -X POST -H "Origin: $BASE" -H 'Content-Type: application/json' \
  -d "{\"username\":\"' OR '1'='1' --\",\"password\":\"x' OR 1=1--\"}" "$BASE/api/admin/login"

section "7. Ограничение частоты запросов"
seq 1 120 | xargs -P 30 -I{} curl -s -o /dev/null -w '%{http_code}\n' -A "$UA" --max-time 15 "$BASE/" > "$TMP/flood"
if grep -q 429 "$TMP/flood"; then ok "наплыв запросов режется (429: $(grep -c 429 "$TMP/flood") из 120)"; else bad "нет ограничения частоты"; fi

if [[ -n "${ADMIN_USER:-}" && -n "${ADMIN_PASS:-}" ]]; then
  section "8. Сессия, CSRF и загрузка файлов (с входом)"
  sleep 2
  login() {
    printf '{"username":%s,"password":%s}' "$(printf '%s' "$ADMIN_USER" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '"%s"' "$ADMIN_USER")" \
      "$(printf '%s' "$ADMIN_PASS" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '"%s"' "$ADMIN_PASS")" > "$TMP/login.json"
    curl -s -D "$1.h" -c "$1" -A "$UA" -H "Origin: $BASE" -H 'Content-Type: application/json' --data-binary @"$(fp "$TMP/login.json")" "$BASE/api/admin/login"
  }
  resp="$(login "$TMP/c1")"
  csrf="$(printf '%s' "$resp" | sed -n 's/.*"csrfToken":"\([^"]*\)".*/\1/p')"
  if [[ -n "$csrf" ]]; then ok "вход выполнен"; else bad "не удалось войти: $resp"; fi
  setc="$(grep -i '^set-cookie' "$TMP/c1.h" | tr 'A-Z' 'a-z')"
  for f in httponly "samesite=strict" "path=/"; do [[ "$setc" == *"$f"* ]] && ok "cookie: $f" || bad "cookie без $f"; done
  if [[ "$BASE" == https://* ]]; then
    [[ "$setc" == *secure* ]] && ok "cookie: secure" || bad "cookie без secure"
    [[ "$setc" == *__host-* ]] && ok "cookie с префиксом __Host-" || bad "cookie без __Host-"
  fi
  login "$TMP/c2" >/dev/null
  t1="$(awk '/sid/{print $7}' "$TMP/c1")"; t2="$(awk '/sid/{print $7}' "$TMP/c2")"
  [[ -n "$t1" && "$t1" != "$t2" ]] && ok "при каждом входе новый токен (нет фиксации сессии)" || bad "токен сессии не меняется"
  expect "сохранение без CSRF-токена" "403" -b "$TMP/c1" -X PUT -H "Origin: $BASE" -H 'Content-Type: application/json' -d '{"data":{}}' "$BASE/api/admin/content"
  expect "сохранение с чужого сайта" "403" -b "$TMP/c1" -X PUT -H "Origin: https://evil.example" -H "X-CSRF-Token: $csrf" -H 'Content-Type: application/json' -d '{"data":{}}' "$BASE/api/admin/content"
  expect "сохранение как text/plain" "400|403|415" -b "$TMP/c1" -X PUT -H "Origin: $BASE" -H "X-CSRF-Token: $csrf" -H 'Content-Type: text/plain' -d '{"data":{}}' "$BASE/api/admin/content"

  up() { curl -s -b "$TMP/c1" -A "$UA" -H "Origin: $BASE" -H "X-CSRF-Token: $csrf" -F "file=@$(fp "$1");type=$2" "$BASE/api/admin/media"; }
  printf '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>' > "$TMP/x.svg"
  r="$(up "$TMP/x.svg" image/svg+xml)"; [[ "$r" == *error* ]] && ok "SVG со скриптом отклонён" || bad "SVG принят: $r"
  printf '<html><script>alert(1)</script></html>' > "$TMP/x.png"
  r="$(up "$TMP/x.png" image/png)"; [[ "$r" == *error* ]] && ok "HTML под видом PNG отклонён" || bad "HTML принят: $r"
  printf '<?php system($_GET[1]); ?>' > "$TMP/x.jpg"
  r="$(up "$TMP/x.jpg" image/jpeg)"; [[ "$r" == *error* ]] && ok "PHP под видом JPG отклонён" || bad "PHP принят: $r"
  # Полиглот: настоящий PNG 1×1, к которому дописан PHP-код
  printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' | base64 -d > "$TMP/poly.png"
  printf '<?php system($_GET[1]); ?>' >> "$TMP/poly.png"
  r="$(up "$TMP/poly.png" image/png)"
  url="$(printf '%s' "$r" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p')"; mid="$(printf '%s' "$r" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
  if [[ -n "$url" ]]; then
    curl -s -D "$TMP/mh" -o "$TMP/m" -A "$UA" "$BASE$url"
    grep -q '<?php' "$TMP/m" && bad "PHP-код сохранился в файле" || ok "картинка перекодирована, PHP-код вырезан"
    grep -qi '^content-type: image/webp' "$TMP/mh" && ok "файл отдаётся как image/webp" || bad "неверный Content-Type у фото"
    expect "удаление тестового файла" "200" -b "$TMP/c1" -X DELETE -H "Origin: $BASE" -H "X-CSRF-Token: $csrf" "$BASE/api/admin/media/$mid"
  else
    bad "полиглот не загрузился: $r"
  fi
  head -c 20000000 /dev/urandom > "$TMP/huge.jpg"
  expect "файл больше 16 МБ (413 или обрыв)" "413|000" -b "$TMP/c1" -H "Origin: $BASE" -H "X-CSRF-Token: $csrf" -F "file=@$(fp "$TMP/huge.jpg");type=image/jpeg" "$BASE/api/admin/media"
  expect "нестандартный id фото" "404" -b "$TMP/c1" -X DELETE -H "Origin: $BASE" -H "X-CSRF-Token: $csrf" "$BASE/api/admin/media/..%2f..%2fetc"

  expect "выход" "200" -b "$TMP/c1" -X POST -H "Origin: $BASE" -H "X-CSRF-Token: $csrf" "$BASE/api/admin/logout"
  expect "старая сессия после выхода не работает" "401" -b "$TMP/c1" "$BASE/api/admin/me"
fi

if [[ "${BRUTEFORCE:-0}" == "1" && -n "${ADMIN_USER:-}" ]]; then
  section "9. Перебор пароля и перечисление логинов"
  try() { curl -s -o /dev/null -w '%{http_code} ' -A "$UA" -H "Origin: $BASE" -H 'Content-Type: application/json' \
          -d "{\"username\":\"$1\",\"password\":\"wrong-password-$RANDOM\"}" "$BASE/api/admin/login"; }
  # Пауза 13 с между попытками: так ответы показывают логику приложения, а не общий лимит nginx (5 в минуту)
  echo "    это займёт около 3 минут…"
  ghostname="no-such-user-$RANDOM$RANDOM"
  real=""; for i in 1 2 3 4 5 6; do real+="$(try "$ADMIN_USER")"; sleep 13; done
  ghost=""; for i in 1 2 3 4 5 6; do ghost+="$(try "$ghostname")"; sleep 13; done
  echo "    существующий логин:   $real"
  echo "    несуществующий логин: $ghost"
  [[ "$real" == *429* ]] && ok "перебор блокируется" || bad "перебор не блокируется"
  [[ "${real:0:16}" == "${ghost:0:16}" ]] && ok "ответы одинаковые — существование логина не выдаётся" || bad "по ответам видно, существует ли логин"
fi

printf '\n\033[1mИтог: %d проверок пройдено, %d с ошибками\033[0m\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
