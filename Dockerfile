FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_BASE_PATH=/
ENV VITE_BASE_PATH=${VITE_BASE_PATH}
RUN npm run build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/banquet.sqlite \
    NODE_EXTRA_CA_CERTS=/app/certs/russian-trusted-root-ca.pem
WORKDIR /app
RUN mkdir -p /data/backups && chown -R node:node /app /data
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/certs ./certs
COPY --from=build --chown=node:node /app/scripts/setup-max.mjs ./scripts/setup-max.mjs
COPY --from=build --chown=node:node /app/package.json ./package.json
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=6 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server/index.mjs"]
