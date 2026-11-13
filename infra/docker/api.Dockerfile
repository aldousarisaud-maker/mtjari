# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo

FROM base AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ openssl && rm -rf /var/lib/apt/lists/*
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,target=/pnpm/store pnpm install --frozen-lockfile --filter @mtjari/api...
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @mtjari/shared build && pnpm --filter @mtjari/db build && pnpm --filter @mtjari/api build
# Self-contained production tree (prod deps only) for the runtime image.
RUN pnpm --filter @mtjari/api deploy --prod --legacy /out/api \
 && pnpm --filter @mtjari/db deploy --legacy /out/db

FROM node:22-bookworm-slim AS api
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /out/api ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD node -e "fetch('http://127.0.0.1:4000/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/main.js"]

# One-shot migration runner (uses the owner role; never exposed).
FROM node:22-bookworm-slim AS migrate
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /out/db ./
USER node
CMD ["node_modules/.bin/prisma", "migrate", "deploy"]
