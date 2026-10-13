# =============================================================================
# Multi-stage. Runtime sobre la imagen oficial de Playwright (trae Chromium y
# el usuario no-root `pwuser`). El front Next.js NO va acá.
# =============================================================================

# ---- Builder ----------------------------------------------------------------
FROM node:20-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- Runtime ----------------------------------------------------------------
# La versión DEBE coincidir con la de `playwright` en package.json.
FROM mcr.microsoft.com/playwright:v1.55.1-jammy AS runtime
ENV NODE_ENV=production \
    STATE_DIR=/data \
    BACKUP_DIR=/backups \
    HEALTH_PORT=8080
WORKDIR /app

# pg_dump para el backup diario de la base. Ubuntu jammy trae el 14 y pg_dump
# tiene que ser >= la versión del servidor (Supabase: 17), así que va del repo
# oficial de PostgreSQL. Si Supabase sube la base a 18, cambiá PG_CLIENT a 18.
ARG PG_CLIENT=17
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
      https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt jammy-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-${PG_CLIENT} \
 && rm -rf /var/lib/apt/lists/*

# Volumen de estado (storageState/cookies) y de backups. Permisos restringidos
# al usuario no-root.
RUN mkdir -p /data /backups && chown -R pwuser:pwuser /data /backups && chmod 700 /backups

COPY --chown=pwuser:pwuser package.json ./
COPY --from=builder --chown=pwuser:pwuser /app/node_modules ./node_modules
COPY --from=builder --chown=pwuser:pwuser /app/dist ./dist
COPY --chown=pwuser:pwuser scripts ./scripts

USER pwuser
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "dist/healthcheck.js"]

CMD ["node", "dist/index.js"]
