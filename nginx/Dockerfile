# syntax=docker/dockerfile:1
# Шрифты берём из npm (fontsource) на этапе сборки — сайт не обращается к внешним CDN.
FROM node:25-alpine AS fonts
WORKDIR /f
RUN npm init -y >/dev/null \
 && npm install --no-audit --no-fund @fontsource-variable/inter@5.3.0 @fontsource-variable/playfair-display@5.3.0 \
 && mkdir /out \
 && cd node_modules/@fontsource-variable \
 && cp inter/files/inter-cyrillic-wght-normal.woff2 \
       inter/files/inter-latin-wght-normal.woff2 \
       playfair-display/files/playfair-display-cyrillic-wght-normal.woff2 \
       playfair-display/files/playfair-display-latin-wght-normal.woff2 \
       playfair-display/files/playfair-display-cyrillic-wght-italic.woff2 \
       playfair-display/files/playfair-display-latin-wght-italic.woff2 /out/

# Образ nginx без root: процесс работает от пользователя nginx (101), порты 8080/8443
FROM nginxinc/nginx-unprivileged:1.28-alpine
USER root
RUN rm -f /etc/nginx/conf.d/default.conf \
 && mkdir -p /etc/nginx/templates /etc/nginx/site-templates /etc/nginx/snippets /var/www/certbot /srv/media \
 && chown -R 101:0 /etc/nginx/templates /etc/nginx/conf.d
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/snippets/ /etc/nginx/snippets/
COPY nginx/templates/locations.inc.template nginx/site-templates/ /etc/nginx/site-templates/
COPY --chmod=0755 nginx/15-select-mode.sh /docker-entrypoint.d/15-select-mode.sh
COPY frontend/static/ /usr/share/nginx/html/static/
COPY frontend/static/robots.txt /usr/share/nginx/html/robots.txt
COPY frontend/admin/ /usr/share/nginx/html/admin/
COPY --from=fonts /out/ /usr/share/nginx/html/static/fonts/
RUN rm -f /usr/share/nginx/html/index.html /usr/share/nginx/html/50x.html /usr/share/nginx/html/static/robots.txt
USER 101
