# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts=false && npm cache clean --force

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
# tini корректно передаёт сигналы остановки процессу node
RUN apk add --no-cache tini \
 && mkdir -p /data/uploads && chown node:node /data/uploads
COPY --from=deps --chown=root:root /app/node_modules ./node_modules
COPY --chown=root:root package.json ./
COPY --chown=root:root src ./src
COPY --chown=root:root seed ./seed
# Код принадлежит root и только читается; процесс работает от непривилегированного пользователя
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/healthz || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
