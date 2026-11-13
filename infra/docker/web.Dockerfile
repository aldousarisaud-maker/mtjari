# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,target=/pnpm/store pnpm install --frozen-lockfile --filter @mtjari/web...
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @mtjari/shared build && pnpm --filter @mtjari/web build

FROM node:22-bookworm-slim AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
