# syntax=docker/dockerfile:1.7
# Karjoo production image — built on GitHub by .github/workflows/deploy-lightsail.yml
# and run on AWS Lightsail (deploy/lightsail/). One image serves the web app and
# the one-shot migrate job (`npm run db:migrate`); ops scripts (tsx) run from it too.
# (Dockerfile.web is the old London dev-host image that ran over a bind mount.)

# ---- base: Chromium for the resume PDF renderer (playwright-core, CHROMIUM_PATH)
FROM node:22-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium fonts-noto-core fonts-noto-color-emoji tini \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---- deps: full install (tsx + drizzle-kit are needed for migrations/ops scripts)
FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# ---- browser extension: public/karjoo-extension.zip is extension/dist, zipped
FROM node:22-bookworm-slim AS extension
RUN apt-get update && apt-get install -y --no-install-recommends zip && rm -rf /var/lib/apt/lists/*
WORKDIR /ext
COPY extension/package.json extension/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY extension/ ./
RUN npm run build && cd dist && zip -qr /karjoo-extension.zip .

# ---- build
FROM deps AS build
COPY . .
COPY --from=extension /karjoo-extension.zip public/karjoo-extension.zip
ARG NEXT_PUBLIC_SITE_URL=https://karjoo.1xai.ir
# src/lib/env.ts validates DATABASE_URL at import; the build never connects, so a
# placeholder is enough here. The real value comes from .env at runtime.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    DATABASE_URL=postgres://build:build@127.0.0.1:9/build
RUN npm run build

# ---- runner
FROM base AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    CHROMIUM_PATH=/usr/bin/chromium \
    PORT=3000
COPY --from=build --chown=node:node /app ./
RUN mkdir -p uploads .karjoo-runtime/catalogs && chown -R node:node uploads .karjoo-runtime
USER node
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3000"]
